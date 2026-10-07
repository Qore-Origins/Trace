'use strict'

const assert = require('node:assert/strict')
const { spawn, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { randomBytes } = require('node:crypto')

const runnerArguments = process.argv.slice(2)
const supportedRunnerArguments = ['--d1-close-diagnostic', '--d3-delete-reference-diagnostic']
if (runnerArguments.some((argument) => !supportedRunnerArguments.includes(argument))) {
  process.stderr.write('FAIL: unrecognized isolated runner argument.\n')
  process.exit(2)
}
const d1CloseDiagnostic = runnerArguments.includes('--d1-close-diagnostic')
const d3DeleteReferenceDiagnostic = runnerArguments.includes('--d3-delete-reference-diagnostic')
if (d1CloseDiagnostic && d3DeleteReferenceDiagnostic) {
  process.stderr.write('FAIL: select only one isolated diagnostic mode.\n')
  process.exit(2)
}

const worktree = path.resolve(__dirname, '..', '.worktrees', 'codex', 'xiaoyuan-plan-operations')
const helperPath = path.resolve(__dirname, 'trace-phase2-isolated-electron-bootstrap.cjs')
const mainBundlePath = path.join(worktree, 'out', 'main', 'index.js')
const electronPath = path.join(worktree, 'node_modules', 'electron', 'dist', 'electron.exe')
const fakeKey = `qa-only-${randomBytes(12).toString('hex')}`
const runId = randomBytes(16).toString('hex')
const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-agent-phase2-isolated-e2e-'))
const markerPath = path.join(runRoot, '.trace-phase2-qa-owner')
const userDataPath = path.join(runRoot, 'user-data')
const sessionDataPath = path.join(runRoot, 'session-data')
const libraryPath = path.join(runRoot, 'disposable-library')
const markerValue = `trace-phase2-qa-owner:${runId}`
const sentinel = 'TRACE_PHASE2_QA_ISOLATION_VERIFIED'
const debugSessionId = 'electron-renderer-empty'
const debugRunId = 'pre-fix'
const debugEnvPath = path.resolve(__dirname, '..', '.dbg', `${debugSessionId}.env`)
const debugEventUrl = (() => {
  try {
    const entries = fs.readFileSync(debugEnvPath, 'utf8').split(/\r?\n/)
    const configuredUrl = entries.find((entry) => entry.startsWith('DEBUG_SERVER_URL='))?.slice('DEBUG_SERVER_URL='.length)
    const configuredSession = entries.find((entry) => entry.startsWith('DEBUG_SESSION_ID='))?.slice('DEBUG_SESSION_ID='.length)
    return configuredSession === debugSessionId && /^http:\/\/127\.0\.0\.1:\d+\/event$/.test(configuredUrl ?? '') ? configuredUrl : ''
  } catch { return '' }
})()
const CDP_UNANSWERED_WATCH_MS = 5_000
const CDP_COMMAND_TIMEOUT_MS = 30_000
const MAX_D3_DIAGNOSTIC_VIEW_COUNT = 6
const MAX_D3_DIAGNOSTIC_VIEW_LABEL_LENGTH = 24

let child
let provider
let cdp
let succeeded = false
let output = ''
let requestCount = 0
let queuedSyntheticToolCall
let activeStartedInvokeChannel
const providerRequests = []

function reportDebug(hypothesisId, location, message, data = {}) {
  if (!debugEventUrl) return
  const event = { sessionId: debugSessionId, runId: debugRunId, traceId: runId, hypothesisId, location, msg: `[DEBUG] ${message}`, data, ts: Date.now() }
  void fetch(debugEventUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) }).catch(() => {})
}

function canonicalWindowsPath(value) {
  return path.resolve(value).replace(/^\\\\\?\\/, '').replace(/[\\/]+$/, '').toLocaleLowerCase('en-US')
}

function assertOk(result, action) {
  assert.equal(result?.ok, true, `${action} failed with Trace result ${JSON.stringify({ code: result?.code, message: result?.message })}`)
  return result.data
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function baseEnvironment() {
  const env = {}
  for (const name of [
    'PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
    'COMSPEC', 'HOMEDRIVE', 'HOMEPATH', 'OS', 'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER'
  ]) {
    if (process.env[name]) env[name] = process.env[name]
  }
  return env
}

function startProvider() {
  provider = http.createServer((request, response) => {
    const loopback = request.socket.remoteAddress === '127.0.0.1' || request.socket.remoteAddress === '::ffff:127.0.0.1'
    if (!loopback) {
      response.writeHead(403).end()
      return
    }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > 256 * 1024) request.destroy()
      else chunks.push(chunk)
    })
    request.on('end', () => {
      requestCount += 1
      let body
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {
        response.writeHead(400).end()
        return
      }
      providerRequests.push({
        authorizationMatches: request.headers.authorization === `Bearer ${fakeKey}`,
        model: body.model,
        toolChoice: body.tool_choice,
        toolNames: Array.isArray(body.tools) ? body.tools.map((entry) => entry?.function?.name).filter((name) => typeof name === 'string') : []
      })
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      const isCapabilityProbe = JSON.stringify(body.tool_choice).includes('trace_capability_probe')
      const queuedCalls = isCapabilityProbe
        ? { id: 'qa-capability-call', name: 'trace_capability_probe', arguments: JSON.stringify({ value: 'ready' }) }
        : queuedSyntheticToolCall
      queuedSyntheticToolCall = undefined
      const calls = queuedCalls ? (Array.isArray(queuedCalls) ? queuedCalls : [queuedCalls]) : []
      if (!calls.length) {
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'The explicitly authorized test operation is complete.' } }] })}\n\n`)
        response.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n')
        response.end('data: [DONE]\n\n')
        return
      }
      const delta = {
        choices: [{ delta: { tool_calls: calls.map((call, index) => ({ index, id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) } }]
      }
      response.write(`data: ${JSON.stringify(delta)}\n\n`)
      response.write('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n')
      response.end('data: [DONE]\n\n')
    })
  })
  return new Promise((resolve, reject) => {
    provider.once('error', reject)
    provider.listen(0, '127.0.0.1', () => {
      const address = provider.address()
      if (!address || typeof address === 'string') return reject(new Error('Loopback provider did not bind a TCP port'))
      resolve(address.port)
    })
  })
}

async function waitFor(predicate, description, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`Electron exited before ${description} (exit ${child.exitCode})`)
    }
    const value = await predicate()
    if (value) return value
    await delay(100)
  }
  throw new Error(`Timed out waiting for ${description}`)
}

async function reserveLoopbackPort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Unable to reserve a loopback debugging port')
  const { port } = address
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}

class CdpClient {
  constructor(webSocketUrl, clientName = 'unknown') {
    this.clientName = clientName
    this.runtimeExceptionCount = 0
    this.expectedBusinessRejections = 0
    this.webSocket = new WebSocket(webSocketUrl)
    this.nextId = 0
    this.pending = new Map()
    this.webSocket.addEventListener('close', () => this.rejectPending('websocket closed'))
    this.webSocket.addEventListener('error', () => this.rejectPending('websocket failed'))
    this.webSocket.addEventListener('message', (event) => {
      let message
      try { message = JSON.parse(event.data) } catch { return }
      if (!message.id) {
        if (message.method === 'Runtime.exceptionThrown') {
          const details = message.params?.exceptionDetails
          // 保留最近一次未捕获异常文本（脱敏同 reportDebug）——末尾断言失败时随消息输出供定位
          this.lastRendererException = String(details?.exception?.description ?? details?.text ?? 'unknown')
            .replaceAll(fakeKey, '[redacted]').replace(/file:\/\/\/[^\s)]+/gi, '[file-url]').replace(/[A-Z]:\\[^\s)]+/gi, '[local-path]').slice(0, 300)
          // Context 入口的「不完整选择」业务拒绝（Codex worktree 产品代码故意 throw 阻止关闭）：
          // 预期副产物，单独计数并正向断言其发生过——不计入未捕获异常（2026-09-12 D3 运行定性）
          if (this.lastRendererException.includes('incomplete reference choices')) {
            this.expectedBusinessRejections = (this.expectedBusinessRejections ?? 0) + 1
            reportDebug('A', 'renderer-runtime', 'expected-business-rejection', { count: this.expectedBusinessRejections })
          } else {
            this.runtimeExceptionCount += 1
          }
          reportDebug('A', 'renderer-runtime', 'exception-thrown', {
            exceptionClass: details?.exception?.className ?? 'unknown',
            lineNumber: Number.isInteger(details?.lineNumber) ? details.lineNumber : null,
            columnNumber: Number.isInteger(details?.columnNumber) ? details.columnNumber : null,
            message: String(details?.exception?.description ?? details?.text ?? 'unknown')
              .replaceAll(fakeKey, '[redacted]').replace(/file:\/\/\/[^\s)]+/gi, '[file-url]').replace(/[A-Z]:\\[^\s)]+/gi, '[local-path]').slice(0, 240),
            stack: (details?.stackTrace?.callFrames ?? []).slice(0, 4).map((frame) => ({
              functionName: frame.functionName || '<anonymous>',
              source: String(frame.url ?? '').split(/[\\/]/).at(-1) || 'inline',
              lineNumber: Number.isInteger(frame.lineNumber) ? frame.lineNumber : null,
              columnNumber: Number.isInteger(frame.columnNumber) ? frame.columnNumber : null
            }))
          })
        } else if (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error') {
          reportDebug('A', 'renderer-runtime', 'console-error-entry', { source: message.params.entry.source ?? 'unknown' })
        }
        return
      }
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      clearTimeout(pending.unansweredTimer)
      clearTimeout(pending.commandTimeoutTimer)
      reportDebug('C', 'cdp-client', 'command-response', {
        client: this.clientName, id: message.id, method: pending.method, elapsedMs: Date.now() - pending.startedAt, failed: Boolean(message.error)
      })
      if (message.error) pending.reject(new Error(`CDP ${pending.method} failed: ${message.error.message}`))
      else pending.resolve(message.result)
    })
  }

  rejectPending(reason) {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id)
      clearTimeout(pending.unansweredTimer)
      clearTimeout(pending.commandTimeoutTimer)
      pending.reject(new Error(`CDP ${pending.method} ${reason}`))
    }
  }

  async connect() {
    if (this.webSocket.readyState === WebSocket.OPEN) return
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP websocket open timed out')), 10_000)
      this.webSocket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
      this.webSocket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP websocket failed')) }, { once: true })
    })
  }

  send(method, params = {}) {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const startedAt = Date.now()
      const unansweredTimer = setTimeout(() => reportDebug('C', 'cdp-client', 'command-unanswered-watch', {
        client: this.clientName, id, method, elapsedMs: Date.now() - startedAt
      }), CDP_UNANSWERED_WATCH_MS)
      unansweredTimer.unref?.()
      const commandTimeoutTimer = setTimeout(() => {
        const pending = this.pending.get(id)
        if (!pending) return
        this.pending.delete(id)
        clearTimeout(pending.unansweredTimer)
        reportDebug('C', 'cdp-client', 'command-timeout', {
          client: this.clientName, id, method, elapsedMs: Date.now() - startedAt
        })
        reject(new Error(`CDP ${method} timed out after ${CDP_COMMAND_TIMEOUT_MS}ms`))
      }, CDP_COMMAND_TIMEOUT_MS)
      commandTimeoutTimer.unref?.()
      this.pending.set(id, { method, resolve, reject, startedAt, unansweredTimer, commandTimeoutTimer })
      reportDebug('C', 'cdp-client', 'command-start', { client: this.clientName, id, method })
      this.webSocket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
    if (result.exceptionDetails) throw new Error(`Renderer evaluation failed: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`)
    return result.result?.value
  }

  close() {
    this.rejectPending('client closed')
    try { this.webSocket.close() } catch { /* Already closed. */ }
  }
}

async function targets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`)
  if (!response.ok) throw new Error(`DevTools target list returned HTTP ${response.status}`)
  return response.json()
}

async function mainPage(port) {
  const target = await waitFor(async () => {
    const pages = await targets(port)
    return pages.find((page) => page.type === 'page' && /renderer\/index\.html/i.test(page.url))
  }, 'main renderer target')
  cdp = new CdpClient(target.webSocketDebuggerUrl, 'main-renderer')
  await cdp.connect()
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')
  await waitFor(async () => await cdp.evaluate('Boolean(window.trace && typeof window.trace.invoke === "function")'), 'preload bridge')
  if (debugEventUrl) {
    try {
      const observerResult = await cdp.evaluate(`(() => {
        const root = document.getElementById('root')
        const report = (message, data) => fetch(${JSON.stringify(debugEventUrl)}, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: ${JSON.stringify(debugSessionId)}, runId: ${JSON.stringify(debugRunId)},
            hypothesisId: 'D', location: 'renderer-observer', msg: '[DEBUG] ' + message, data, ts: Date.now() })
        }).catch(() => {})
        report('root-initial', { exists: Boolean(root), childCount: root?.childElementCount ?? 0 })
        if (root && !window.__tracePhase2RootObserver) {
          let previousCount = root.childElementCount
          window.__tracePhase2RootObserver = new MutationObserver(() => {
            const childCount = root.childElementCount
            if (childCount !== previousCount) {
              previousCount = childCount
              report('root-child-count-changed', { childCount })
            }
          })
          window.__tracePhase2RootObserver.observe(root, { childList: true })
          window.addEventListener('error', (event) => report('window-error', { errorName: event.error?.name ?? 'unknown' }))
          window.addEventListener('unhandledrejection', (event) => report('unhandled-rejection', { reasonType: typeof event.reason }))
        }
        return { exists: Boolean(root), childCount: root?.childElementCount ?? 0 }
      })()`)
      reportDebug('D', 'runner-mainPage', 'root-observer-installed', observerResult)
    } catch (error) {
      reportDebug('A', 'runner-mainPage', 'root-observer-install-error', { errorName: error?.name ?? 'unknown' })
    }
  }
  const rootState = await waitFor(async () => {
    const state = await cdp.evaluate(`(() => {
      const root = document.getElementById('root')
      return { exists: Boolean(root), childCount: root?.childElementCount ?? 0 }
    })()`)
    return state.exists && state.childCount > 0 ? state : null
  }, 'React renderer root to mount', 15_000)
  reportDebug('D', 'runner-mainPage', 'root-mounted', rootState)
  assert.equal(cdp.runtimeExceptionCount, 0, 'main renderer must not emit uncaught JavaScript exceptions before root mount')
  return cdp
}

async function invoke(channel, payload) {
  const args = payload === undefined ? '' : `,${JSON.stringify(payload)}`
  const startedAt = Date.now()
  reportDebug('B', 'runner-invoke', 'ipc-invoke-start', { channel })
  try {
    const result = await cdp.evaluate(`(async () => await window.trace.invoke(${JSON.stringify(channel)}${args}))()`)
    reportDebug('B', 'runner-invoke', 'ipc-invoke-complete', {
      channel, elapsedMs: Date.now() - startedAt, ok: result?.ok === true,
      code: Number.isInteger(result?.code) ? result.code : null
    })
    return result
  } catch (error) {
    reportDebug('B', 'runner-invoke', 'ipc-invoke-error', { channel, elapsedMs: Date.now() - startedAt, errorName: error?.name ?? 'unknown' })
    throw error
  }
}

async function startInvoke(channel, payload) {
  const args = payload === undefined ? '' : `,${JSON.stringify(payload)}`
  activeStartedInvokeChannel = channel
  const startedAt = Date.now()
  reportDebug('B', 'runner-startInvoke', 'async-ipc-invoke-start', { channel })
  const result = await cdp.evaluate(`(() => {
    window.__tracePhase2QaResult = null
    window.__tracePhase2QaError = null
    window.__tracePhase2QaPromise = window.trace.invoke(${JSON.stringify(channel)}${args})
      .then((value) => { window.__tracePhase2QaResult = value })
      .catch((error) => { window.__tracePhase2QaError = String(error) })
    return 'started'
  })()`)
  reportDebug('B', 'runner-startInvoke', 'async-ipc-invoke-dispatched', { channel, elapsedMs: Date.now() - startedAt })
  return result
}

async function waitForApproval(port, expectedEndpoint, expectedModel, action = 'allow', verifySnapshot) {
  const target = await waitFor(async () => {
    const pages = await targets(port)
    return pages.find((page) => page.type === 'page' && /agent-approval\.html/i.test(page.url))
  }, 'isolated external approval window')
  const approval = new CdpClient(target.webSocketDebuggerUrl, 'external-approval')
  await approval.connect()
  let lastEvaluationError = ''
  const details = await waitFor(async () => {
    try {
      const value = await approval.evaluate(`(() => ({
        text: document.body.innerText,
        endpoint: document.querySelector('[data-agent-approval-endpoint]')?.textContent ?? '',
        model: document.querySelector('[data-agent-approval-model]')?.textContent ?? '',
        body: document.querySelector('[data-agent-approval-body]')?.textContent ?? '',
        allowEnabled: Array.from(document.querySelectorAll('button')).some((button) => button.textContent?.trim() === '允许发送' && !button.disabled),
        cancelEnabled: Array.from(document.querySelectorAll('button')).some((button) => button.textContent?.trim() === '取消' && !button.disabled)
      }))()`)
      return (action === 'allow' ? value.allowEnabled : value.cancelEnabled) ? value : null
    } catch (error) {
      lastEvaluationError = error.message
      return null
    }
  }, 'approval snapshot render').catch((error) => {
    if (lastEvaluationError) throw new Error(`${error.message}; last renderer evaluation: ${lastEvaluationError}`)
    throw error
  })
  assert.equal(details.endpoint, expectedEndpoint)
  assert.equal(details.model, expectedModel)
  assert.match(details.text, /允许发送/)
  assert.equal(details.body.includes(fakeKey), false, 'API key must never appear in outbound preview')
  if (verifySnapshot) await verifySnapshot(details)
  const actionLabel = action === 'allow' ? '允许发送' : '取消'
  reportDebug('C', 'runner-waitForApproval', 'approval-action-click-start', { action })
  const scheduled = await approval.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.trim() === ${JSON.stringify(actionLabel)} && !item.disabled)
    if (!button) return false
    window.setTimeout(() => button.click(), 50)
    return true
  })()`)
  reportDebug('C', 'runner-waitForApproval', 'approval-action-click-scheduled', { action, scheduled })
  assert.equal(scheduled, true)
  approval.close()
  reportDebug('C', 'runner-waitForApproval', 'approval-cdp-closed', { action })
}

async function waitForTrustedConfirmation(port, { action, kind, expectedName, expectedBatchId, expectedTrashEntryId }) {
  const target = await waitFor(async () => {
    const pages = await targets(port)
    return pages.find((page) => page.type === 'page' && page.title === 'Trace Local Operation Confirmation')
  }, 'main-process local operation confirmation window')
  const confirmation = new CdpClient(target.webSocketDebuggerUrl, 'main-operation-confirmation')
  await confirmation.connect()
  const details = await waitFor(async () => {
    const value = await confirmation.evaluate(`(() => {
      const summary = document.querySelector('[data-confirmation-summary="true"]')
      const accept = document.querySelector('[data-confirm-action="accept"]')
      const cancel = document.querySelector('[data-confirm-action="cancel"]')
      const trashEntry = summary?.querySelector('[data-trash-entry-name]')
      return {
        title: document.title,
        kind: summary?.getAttribute('data-confirmation-kind') ?? '',
        summary: summary?.innerText ?? '',
        batchId: summary?.getAttribute('data-operation-batch-id') ?? '',
        trashEntryId: trashEntry?.getAttribute('data-trash-entry-id') ?? '',
        trashName: trashEntry?.getAttribute('data-trash-entry-name') ?? '',
        trashTargetPath: trashEntry?.getAttribute('data-trash-target-path') ?? '',
        acceptEnabled: Boolean(accept && !accept.disabled),
        cancelEnabled: Boolean(cancel && !cancel.disabled)
      }
    })()`)
    return value.title === 'Trace Local Operation Confirmation' && value.summary && value.acceptEnabled && value.cancelEnabled
      ? value
      : null
  }, 'main-process confirmation summary and actions')
  assert.equal(details.title, 'Trace Local Operation Confirmation')
  assert.equal(details.kind, kind)
  assert.equal(details.summary.includes(fakeKey), false, 'API key must never appear in local operation confirmation')
  assert.match(details.summary, new RegExp(expectedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  if (kind === 'agent-operation') assert.equal(details.batchId, expectedBatchId, 'trusted summary must identify the exact frozen operation batch')
  if (kind === 'trash-purge') {
    assert.equal(details.trashEntryId, expectedTrashEntryId, 'purge summary must identify the exact authorized trash entry')
    assert.equal(details.trashName, expectedName)
    assert.notEqual(details.trashTargetPath, '', 'purge summary must identify the original relative path')
  }
  assert.equal(details.summary.includes('confirmationToken'), false, 'private confirmation token must not be rendered')

  const selector = action === 'accept'
    ? '[data-confirm-action="accept"]'
    : '[data-confirm-action="cancel"]'
  const clicked = await confirmation.evaluate(`(() => {
    const button = document.querySelector(${JSON.stringify(selector)})
    if (!button || button.disabled) return false
    button.click()
    return true
  })()`)
  assert.equal(clicked, true, `trusted confirmation ${action} action must be available`)
  confirmation.close()
  return details
}

async function waitForStartedInvoke() {
  const channel = activeStartedInvokeChannel ?? 'unknown'
  const startedAt = Date.now()
  try {
    const result = await waitFor(async () => {
      const state = await cdp.evaluate(`({ result: window.__tracePhase2QaResult, error: window.__tracePhase2QaError })`)
      if (state.error) throw new Error(`Renderer IPC rejected: ${state.error}`)
      return state.result
    }, 'renderer IPC completion')
    reportDebug('B', 'runner-waitForStartedInvoke', 'async-ipc-invoke-complete', {
      channel, elapsedMs: Date.now() - startedAt, ok: result?.ok === true,
      code: Number.isInteger(result?.code) ? result.code : null
    })
    activeStartedInvokeChannel = undefined
    return result
  } catch (error) {
    reportDebug('B', 'runner-waitForStartedInvoke', 'async-ipc-invoke-error', {
      channel, elapsedMs: Date.now() - startedAt, errorName: error?.name ?? 'unknown'
    })
    activeStartedInvokeChannel = undefined
    throw error
  }
}

async function startAgentToolOperation(port, providerEndpoint, sessionId, grantSet, message, call) {
  const calls = Array.isArray(call) ? call : [call]
  const operationNames = calls.map((item) => item.name).join(', ')
  const preview = assertOk(await invoke('agent:preview:create', {
    sessionId,
    message,
    selections: [],
    includeHistory: false,
    targetGrantSetId: grantSet.id,
    targetRefs: grantSet.targets.map((item) => item.ref)
  }), `Create outbound preview for ${operationNames}`)
  for (const item of calls) assert.equal(preview.tools?.some((tool) => tool.function.name === item.name), true, `${item.name} must be in the approved tool set`)
  queuedSyntheticToolCall = call
  await startInvoke('agent:request:send', { token: preview.token, sessionId })
  await waitForApproval(port, `${providerEndpoint}/chat/completions`, 'synthetic-model')
  const identity = assertOk(await waitForStartedInvoke(), `Dispatch approved ${operationNames} request`)
  const batch = await waitFor(async () => {
    const sessionRead = assertOk(await invoke('agent:session:read', { id: sessionId }), `Read ${operationNames} audit`)
    return sessionRead.operationBatches?.find((item) => item.requestId === identity.requestId && item.status === 'pending-confirmation') ?? null
  }, `${operationNames} operation batch to be persisted`)
  return { identity, batch }
}

async function confirmAgentOperation(port, sessionId, batch, expectedName, action = 'accept', providerEndpoint) {
  await startInvoke('agent:operation:confirm', { sessionId, batchId: batch.id })
  await waitForTrustedConfirmation(port, {
    action, kind: 'agent-operation', expectedName, expectedBatchId: batch.id
  })
  if (action === 'accept') {
    assert.equal(typeof providerEndpoint, 'string', 'accepting an Agent tool operation must account for its follow-up outbound preview')
    await waitForApproval(port, `${providerEndpoint}/chat/completions`, 'synthetic-model', 'cancel')
  }
  return assertOk(await waitForStartedInvoke(), `Complete trusted confirmation for ${batch.id}`)
}

async function continueAgentOperation(port, providerEndpoint, sessionId, batchId) {
  await startInvoke('agent:request:continue', { sessionId, batchId })
  await waitForApproval(port, `${providerEndpoint}/chat/completions`, 'synthetic-model')
  const identity = assertOk(await waitForStartedInvoke(), `Dispatch continuation for ${batchId}`)
  const session = await waitFor(async () => {
    const current = assertOk(await invoke('agent:session:read', { id: sessionId }), `Read continuation for ${batchId}`)
    const assistant = current.messages.find((message) => message.role === 'assistant' && message.requestId === identity.requestId)
    return assistant?.status === 'complete' ? current : null
  }, `Continuation response for ${batchId}`)
  return { identity, session }
}

async function trashPlanThroughAgent(port, providerEndpoint, profileId, name) {
  const plan = assertOk(await invoke('storage:createPlan', { parent_path: '', name }), `Create disposable ${name}`)
  const grantSet = assertOk(await invoke('agent:target:grant', {
    targets: [{ kind: 'plan', path: plan.path }]
  }), `Grant one exact @ plan target for ${name}`)
  const session = assertOk(await invoke('agent:session:create', {
    title: `Isolated trash ${name}`, profileId
  }), `Create isolated trash session for ${name}`)
  const target = grantSet.targets[0]
  const call = {
    id: `qa-trash-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: 'plan.trash',
    arguments: JSON.stringify({ target_ref: target.ref, expected_revision: target.revision })
  }
  const { identity, batch } = await startAgentToolOperation(port, providerEndpoint, session.id, grantSet,
    `@${name} move this plan to the disposable test trash`, call)
  assert.equal(batch.requestId, identity.requestId, 'operation audit must retain its originating request identity')
  const preview = assertOk(await invoke('agent:operation:read', { sessionId: session.id, batchId: batch.id }),
    `Read exact trash operation preview for ${name}`)
  assert.equal(preview.operations.length, 1)
  assert.equal(preview.operations[0].operation, 'plan.trash')
  assert.equal(preview.operations[0].status, 'ready')
  assert.equal(Object.hasOwn(preview, 'confirmationToken'), false)
  const committed = await confirmAgentOperation(port, session.id, batch, name, 'accept', providerEndpoint)
  assert.equal(committed.operations[0].status, 'succeeded')
  await continueAgentOperation(port, providerEndpoint, session.id, batch.id)
  return { plan, requestId: identity.requestId, sessionId: session.id, batchId: batch.id }
}

async function readTrashEntryThroughAgent(port, providerEndpoint, profileId, entry, otherEntry) {
  const grantSet = assertOk(await invoke('agent:target:grant', {
    targets: [{ kind: 'trash', entryId: entry.id }]
  }), 'Grant @ access to one exact trash entry')
  const session = assertOk(await invoke('agent:session:create', {
    title: 'Isolated @ trash read', profileId
  }), 'Create isolated read-only trash session')
  const preview = assertOk(await invoke('agent:preview:create', {
    sessionId: session.id,
    message: `@${entry.name} 只读取这一个回收站条目`,
    selections: [],
    includeHistory: false,
    targetGrantSetId: grantSet.id,
    targetRefs: [grantSet.targets[0].ref]
  }), 'Preview explicitly authorized trash read')
  queuedSyntheticToolCall = {
    id: 'qa-read-one-trash-entry',
    name: 'trash.list',
    arguments: JSON.stringify({ trash_entry_ref: grantSet.targets[0].ref })
  }
  await startInvoke('agent:request:send', { token: preview.token, sessionId: session.id })
  await waitForApproval(port, `${providerEndpoint}/chat/completions`, 'synthetic-model')
  const identity = assertOk(await waitForStartedInvoke(), 'Dispatch explicitly authorized trash.list tool request')

  await waitForApproval(port, `${providerEndpoint}/chat/completions`, 'synthetic-model')
  const completeSession = await waitFor(async () => {
    const current = assertOk(await invoke('agent:session:read', { id: session.id }), 'Read exact trash-list tool receipt')
    const toolResult = current.messages.find((message) => message.role === 'tool' && message.requestId === identity.requestId &&
      message.toolCallId === 'qa-read-one-trash-entry')
    const assistants = current.messages.filter((message) => message.role === 'assistant' && message.requestId === identity.requestId)
    return toolResult && assistants.length >= 2 && assistants.at(-1)?.status === 'complete'
      ? { current, toolResult }
      : null
  }, 'authorized trash.list result and follow-up to be persisted')
  const toolData = JSON.parse(completeSession.toolResult.content)
  assert.equal(toolData.ok, true)
  assert.deepEqual(toolData.entries.map((item) => item.id), [entry.id])
  assert.equal(toolData.entries.some((item) => item.id === otherEntry.id || item.name === otherEntry.name), false,
    'Agent trash.list must not reveal a second, ungranted entry')
  return { session: completeSession.current, grantSet, entry: toolData.entries[0] }
}

async function trashDialogState() {
  return cdp.evaluate(`(() => {
    const dialog = Array.from(document.querySelectorAll('.trash-dialog')).find((element) => element.getClientRects().length > 0)
    const primary = dialog?.querySelector('.ant-modal-footer button.ant-btn-primary')
    return {
      open: Boolean(dialog),
      entryIds: Array.from(dialog?.querySelectorAll('[data-trash-entry-id]') ?? []).map((element) => element.dataset.trashEntryId),
      restoreName: dialog?.querySelector('#trash-restore-name')?.value ?? null,
      purgeName: dialog?.querySelector('#trash-purge-name')?.value ?? null,
      preview: dialog?.querySelector('.trash-preview')?.textContent ?? '',
      error: dialog?.querySelector('.trash-error[role="alert"]')?.textContent ?? '',
      primaryLabel: primary?.textContent?.trim() ?? '',
      primaryDisabled: primary ? primary.disabled || primary.classList.contains('ant-btn-loading') : null
    }
  })()`)
}

async function recordTrashDialogCloseStructure(stage) {
  try {
    const structure = await cdp.evaluate(`(() => {
      const describeElement = (element) => {
        const style = getComputedStyle(element)
        return {
          connected: element.isConnected,
          rectCount: element.getClientRects().length,
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          pointerEvents: style.pointerEvents,
          ariaHidden: element.getAttribute('aria-hidden'),
          role: element.getAttribute('role'),
          ariaModal: element.getAttribute('aria-modal'),
          motionClasses: Array.from(element.classList).filter((name) => /motion|zoom|fade|slide|appear|enter|leave/.test(name))
        }
      }
      const dialogs = Array.from(document.querySelectorAll('.trash-dialog'))
      const wraps = Array.from(document.querySelectorAll('.ant-modal-wrap'))
      const active = document.activeElement
      return {
        dialogMatchCount: dialogs.length,
        modalWrapMatchCount: wraps.length,
        dialogs: dialogs.map((dialog) => {
          const closeControls = Array.from(dialog.querySelectorAll('.ant-modal-close'))
          const wrap = dialog.closest('.ant-modal-wrap')
          return {
            ...describeElement(dialog),
            wrap: wrap ? describeElement(wrap) : null,
            restoreInputPresent: Boolean(dialog.querySelector('#trash-restore-name')),
            purgeInputPresent: Boolean(dialog.querySelector('#trash-purge-name')),
            closeControlCount: closeControls.length,
            closeControls: closeControls.map((control) => ({
              ...describeElement(control),
              disabled: Boolean(control.disabled),
              ariaDisabled: control.getAttribute('aria-disabled'),
              loading: control.classList.contains('ant-btn-loading')
            }))
          }
        }),
        modalWraps: wraps.map(describeElement),
        activeElement: active ? { tag: active.tagName, classes: Array.from(active.classList) } : null
      }
    })()`)
    console.log(JSON.stringify({
      diagnostic: 'd1-trash-dialog-close-structure', stage,
      rendererRuntimeExceptionCount: cdp.runtimeExceptionCount, structure
    }))
  } catch (error) {
    console.error(JSON.stringify({
      diagnostic: 'd1-trash-dialog-close-structure', stage,
      snapshotAvailable: false, errorName: error?.name ?? 'unknown',
      rendererRuntimeExceptionCount: cdp.runtimeExceptionCount
    }))
  }
}

async function clickRendererControl(selector, description) {
  await waitFor(async () => cdp.evaluate(`(() => {
    const controls = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
      .filter((element) => element.getClientRects().length > 0)
    if (controls.length !== 1) return false
    const control = controls[0]
    if (control.disabled || control.classList.contains('ant-btn-loading')) return false
    control.click()
    return true
  })()`), description)
}

async function fillRendererInput(selector, value) {
  const selected = await cdp.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)})
    if (!(input instanceof HTMLInputElement) || input.disabled || !input.getClientRects().length) return false
    input.focus()
    input.select()
    return true
  })()`)
  assert.equal(selected, true, `React input ${selector} must be visible and enabled`)
  await cdp.send('Input.insertText', { text: value })
  await waitFor(async () => (await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)})?.value`)) === value,
    `React input ${selector} to reflect inserted text`)
}

async function openTrashDialog(entryId, action) {
  if (!(await trashDialogState()).open) {
    await clickRendererControl('.tree-trash-entry button', 'React tree trash entry button')
  }
  await waitFor(async () => (await trashDialogState()).entryIds.includes(entryId), 'exact trash entry to render')
  await clickRendererControl(`.trash-dialog [data-trash-entry-id="${entryId}"] button[data-trash-action="${action}"]`,
    `React ${action} action for exact trash entry`)
}

async function closeTrashDialog() {
  await clickRendererControl('.trash-dialog .ant-modal-close', 'React trash form close action')
  await waitFor(async () => {
    const state = await trashDialogState()
    return state.open && state.restoreName === null && state.purgeName === null
  }, 'React trash form to return to list')
  await clickRendererControl('.trash-dialog .ant-modal-close', 'React trash list close action')
  await waitFor(async () => !(await trashDialogState()).open, 'React trash dialog to close')
}

async function verifyTrashDialogConflictRestore(libraryId) {
  const originalName = 'QA UI Restore Conflict'
  const restoredName = 'QA UI Restored With Stable ID'
  const original = assertOk(await invoke('storage:createPlan', { parent_path: '', name: originalName }), 'Create UI conflict fixture')
  const originalTarget = assertOk(await invoke('plan-reference:commitTarget', {
    library_id: libraryId, path: original.path, mode: 'link'
  }), 'Allocate original stable plan ID through public IPC')
  const originalDocument = assertOk(await invoke('storage:readPlan', { path: original.path }), 'Snapshot complete original document')
  assert.equal(originalDocument.plan_id, originalTarget.plan_id)
  const deletionPreview = assertOk(await invoke('plan-reference:previewImpact', {
    library_id: libraryId, operation: 'delete-plan', path: original.path
  }), 'Preview fixture soft deletion through public IPC')
  assert.equal(deletionPreview.references.length, 0, 'isolated conflict fixture must have no inbound references')
  assertOk(await invoke('plan-reference:commitImpact', { library_id: libraryId, preview: deletionPreview, decisions: [] }),
    'Soft delete UI conflict fixture through public IPC')
  const entry = assertOk(await invoke('trash:list'), 'Locate UI conflict trash entry').find((item) => item.original_relative_path === original.path)
  assert.ok(entry)
  const replacement = assertOk(await invoke('storage:createPlan', { parent_path: '', name: originalName }), 'Create same-name live replacement')
  const replacementTarget = assertOk(await invoke('plan-reference:commitTarget', {
    library_id: libraryId, path: replacement.path, mode: 'link'
  }), 'Allocate distinct replacement stable plan ID')
  assert.notEqual(replacementTarget.plan_id, originalTarget.plan_id)
  const replacementDocument = assertOk(await invoke('storage:readPlan', { path: replacement.path }), 'Snapshot complete replacement document')

  await openTrashDialog(entry.id, 'restore')
  const conflict = await waitFor(async () => {
    const state = await trashDialogState()
    return /同名内容|already has an item with this name/.test(state.error) && state.primaryDisabled === false ? state : null
  }, 'React restore name-conflict error')
  assert.equal(conflict.restoreName, originalName)
  assert.equal(conflict.preview, '', 'conflicting destination must not receive a restore preview')
  assert.match(conflict.primaryLabel, /预览恢复|Preview restore/)
  assert.deepEqual(assertOk(await invoke('trash:list'), 'Verify conflict retained old entry').find((item) => item.id === entry.id), entry)
  assert.deepEqual(assertOk(await invoke('storage:readPlan', { path: replacement.path }), 'Verify conflict preserved replacement document'), replacementDocument)
  assert.equal(assertOk(await invoke('plan-reference:resolve', { library_id: libraryId, plan_id: originalTarget.plan_id }),
    'Resolve old ID while trashed').status, 'missing')

  await fillRendererInput('.trash-dialog #trash-restore-name', restoredName)
  await waitFor(async () => {
    const state = await trashDialogState()
    return state.restoreName === restoredName && !state.error && !state.preview && state.primaryDisabled === false
  }, 'React renamed restore to require a fresh preview')
  await clickRendererControl('.trash-dialog .ant-modal-footer button.ant-btn-primary', 'React preview restore button')
  const preview = await waitFor(async () => {
    const state = await trashDialogState()
    return state.preview.includes(restoredName) && state.primaryDisabled === false ? state : null
  }, 'React fresh restore preview with new destination')
  assert.match(preview.primaryLabel, /确认恢复|Confirm restore/)
  assert.equal(assertOk(await invoke('trash:list'), 'Verify preview alone retained old entry').some((item) => item.id === entry.id), true)
  await clickRendererControl('.trash-dialog .ant-modal-footer button.ant-btn-primary', 'React explicit confirm restore button')
  await waitFor(async () => {
    const state = await trashDialogState()
    return state.open && state.restoreName === null && !state.entryIds.includes(entry.id)
  }, 'React restored entry to disappear after refresh')
  assert.equal(assertOk(await invoke('trash:list'), 'Verify UI restore removed exact entry').some((item) => item.id === entry.id), false)
  assert.deepEqual(assertOk(await invoke('storage:readPlan', { path: restoredName }), 'Verify UI restored complete original document'), originalDocument)
  const resolved = assertOk(await invoke('plan-reference:resolve', { library_id: libraryId, plan_id: originalTarget.plan_id }), 'Resolve restored stable plan ID')
  assert.equal(resolved.status, 'found')
  assert.equal(resolved.target.plan_id, originalTarget.plan_id)
  assert.equal(resolved.target.path, restoredName)
  assert.deepEqual(assertOk(await invoke('storage:readPlan', { path: replacement.path }), 'Verify renamed restore preserved replacement document'), replacementDocument)
  const replacementResolved = assertOk(await invoke('plan-reference:resolve', { library_id: libraryId, plan_id: replacementTarget.plan_id }), 'Resolve unchanged replacement ID')
  assert.equal(replacementResolved.status, 'found')
  assert.equal(replacementResolved.target.path, originalName)
  await recordTrashDialogCloseStructure('before-close-click')
  await clickRendererControl('.trash-dialog .ant-modal-close', 'React restored trash list close action')
  await recordTrashDialogCloseStructure('after-close-click')
  try {
    await waitFor(async () => !(await trashDialogState()).open, 'React restored trash dialog to close')
  } catch (error) {
    await recordTrashDialogCloseStructure('close-wait-failed')
    throw error
  }
  console.log('PASS: CDP programmed React TrashDialog rejected a same-name restore, re-previewed and explicitly restored under a new name; stable IDs and complete replacement/original documents were preserved.')
}

async function verifyTrashDialogPurgeCancellation(port, entry) {
  await openTrashDialog(entry.id, 'purge')
  const empty = await waitFor(async () => {
    const state = await trashDialogState()
    return state.purgeName === '' && state.preview && state.primaryDisabled === true ? state : null
  }, 'React purge preview with empty-name disabled button')
  assert.match(empty.primaryLabel, /确认永久清除|Delete permanently/)
  await fillRendererInput('.trash-dialog #trash-purge-name', `${entry.name} wrong`)
  await waitFor(async () => (await trashDialogState()).primaryDisabled === true, 'React wrong-name purge button to stay disabled')
  assert.equal((await targets(port)).some((page) => page.title === 'Trace Local Operation Confirmation'), false,
    'empty and incorrect names must not open main purge confirmation')
  await fillRendererInput('.trash-dialog #trash-purge-name', entry.name)
  await waitFor(async () => (await trashDialogState()).primaryDisabled === false, 'React exact-name purge button to enable')
  await clickRendererControl('.trash-dialog .ant-modal-footer button.ant-btn-primary', 'React exact-name confirm purge button')
  await waitForTrustedConfirmation(port, {
    action: 'cancel', kind: 'trash-purge', expectedName: entry.name, expectedTrashEntryId: entry.id
  })
  await waitFor(async () => {
    const state = await trashDialogState()
    return state.purgeName === '' && state.error && !state.preview && state.primaryDisabled === true
  }, 'React cancelled main purge to clear preview and re-disable action')
  assert.deepEqual(assertOk(await invoke('trash:list'), 'Verify UI main purge cancellation preserved exact entry')
    .find((item) => item.id === entry.id), entry)
  await closeTrashDialog()
  console.log('PASS: CDP programmed React purge form disabled empty/wrong names, exact name opened the trusted main confirmation, and cancelling preserved the complete entry without permanent deletion.')
}

async function verifyMovedAndDeletedTarget(libraryId, profileId) {
  const beforeRequests = requestCount
  const name = 'QA Stable Target Lifecycle'
  const destination = 'QA Stable Target Destination'
  const plan = assertOk(await invoke('storage:createPlan', { parent_path: '', name }), 'Create target lifecycle fixture')
  assertOk(await invoke('storage:createFolder', { parent_path: '', name: destination }), 'Create target lifecycle destination')
  const target = assertOk(await invoke('plan-reference:commitTarget', {
    library_id: libraryId, path: plan.path, mode: 'link'
  }), 'Allocate lifecycle stable plan ID')
  const original = assertOk(await invoke('storage:readPlan', { path: plan.path }), 'Snapshot stable target document')
  const oldGrant = assertOk(await invoke('agent:target:grant', { targets: [{ kind: 'plan', path: plan.path }] }), 'Grant exact pre-move target')
  assertOk(await invoke('agent:target:validate', { setId: oldGrant.id, ref: oldGrant.targets[0].ref }), 'Validate pre-move grant')
  assertOk(await invoke('storage:movePlan', { path: plan.path, target_parent_path: destination }), 'Move stable plan through public IPC')
  const movedPath = `${destination}/${name}`
  const replacement = assertOk(await invoke('storage:createPlan', { parent_path: '', name }), 'Create distinct object at old lifecycle path')
  const replacementTarget = assertOk(await invoke('plan-reference:commitTarget', {
    library_id: libraryId, path: replacement.path, mode: 'link'
  }), 'Allocate distinct old-path replacement ID')
  assert.notEqual(replacementTarget.plan_id, target.plan_id)
  const stale = await invoke('agent:target:validate', { setId: oldGrant.id, ref: oldGrant.targets[0].ref })
  assert.equal(stale.ok, false, 'old grant must not silently follow the moved plan or bind its replacement')
  assert.equal(stale.code, 22, 'changed target grant must fail with CONFLICT')
  const resolved = assertOk(await invoke('plan-reference:resolve', { library_id: libraryId, plan_id: target.plan_id }), 'Resolve moved stable ID')
  assert.equal(resolved.status, 'found')
  assert.equal(resolved.target.path, movedPath)
  assert.equal(resolved.target.plan_id, target.plan_id)
  assert.deepEqual(assertOk(await invoke('storage:readPlan', { path: movedPath }), 'Read complete moved document'), original)
  const newGrant = assertOk(await invoke('agent:target:grant', { targets: [{ kind: 'plan', path: movedPath }] }), 'Explicitly reselect moved plan')
  assert.notEqual(newGrant.targets[0].ref, oldGrant.targets[0].ref)
  assert.equal(assertOk(await invoke('agent:target:validate', { setId: newGrant.id, ref: newGrant.targets[0].ref }), 'Validate fresh moved grant').path, movedPath)
  const session = assertOk(await invoke('agent:session:create', { title: 'Isolated lifecycle reselection', profileId }), 'Create new explicit reselection message session')
  const preview = assertOk(await invoke('agent:preview:create', {
    sessionId: session.id, message: `@${movedPath} explicitly select this moved synthetic plan again`, selections: [], includeHistory: false,
    targetGrantSetId: newGrant.id, targetRefs: [newGrant.targets[0].ref]
  }), 'Bind new message preview to explicit moved target')
  assert.deepEqual(preview.targets.map((item) => item.path), [movedPath])
  assertOk(await invoke('agent:preview:cancel', { token: preview.token }), 'Cancel lifecycle reselection outbound preview')
  const deletionPreview = assertOk(await invoke('plan-reference:previewImpact', {
    library_id: libraryId, operation: 'delete-plan', path: movedPath
  }), 'Preview stable target soft deletion')
  assert.equal(deletionPreview.references.length, 0)
  assertOk(await invoke('plan-reference:commitImpact', { library_id: libraryId, preview: deletionPreview, decisions: [] }), 'Soft delete moved lifecycle fixture')
  const deletedGrant = await invoke('agent:target:validate', { setId: newGrant.id, ref: newGrant.targets[0].ref })
  assert.equal(deletedGrant.ok, false)
  assert.equal(deletedGrant.code, 22, 'deleted target grant must fail with CONFLICT')
  assert.equal(assertOk(await invoke('plan-reference:resolve', { library_id: libraryId, plan_id: target.plan_id }), 'Resolve soft-deleted stable ID').status, 'missing')
  assert.equal(assertOk(await invoke('plan-reference:resolve', { library_id: libraryId, plan_id: replacementTarget.plan_id }), 'Resolve untouched old-path replacement').target.path, name)
  assert.equal(requestCount, beforeRequests, 'target lifecycle and local reselection must produce no provider traffic')
  console.log(`PASS: public IPC move/soft-delete invalidated exact old grants, kept stable-ID resolver identity and required explicit reselection; provider requests ${beforeRequests} -> ${requestCount}.`)
}

async function createMarkedPlan(libraryId, name, marker) {
  const plan = assertOk(await invoke('storage:createPlan', { parent_path: '', name }), `Create synthetic ${name}`)
  const target = assertOk(await invoke('plan-reference:commitTarget', { library_id: libraryId, path: plan.path, mode: 'link' }), `Allocate stable ID for ${name}`)
  const component = { id: randomBytes(16).toString('hex'), type: 'task_list', payload: { title: marker, items: [] } }
  assertOk(await invoke('storage:appendComponent', { path: plan.path, component }), `Append synthetic marker component to ${name}`)
  const document = assertOk(await invoke('storage:readPlan', { path: plan.path }), `Snapshot synthetic ${name} document`)
  assert.equal(document.plan_id, target.plan_id)
  return { plan, target, component, document }
}

async function verifyPlanReadOutboundCancellation(port, providerEndpoint, profileId, libraryId) {
  const beforeRequests = requestCount
  const marker = 'QA_EXACT_AUTHORIZED_PLAN_READ_RESULT'
  const neighborMarker = 'QA_UNAUTHORIZED_NEIGHBOR_MUST_STAY_LOCAL'
  const fixture = await createMarkedPlan(libraryId, 'QA Read Authorized', marker)
  const neighbor = await createMarkedPlan(libraryId, 'QA Read Neighbor', neighborMarker)
  const grants = assertOk(await invoke('agent:target:grant', { targets: [{ kind: 'plan', path: fixture.plan.path }] }), 'Grant only exact plan.read fixture')
  const session = assertOk(await invoke('agent:session:create', { title: 'Isolated plan.read outbound cancel', profileId }), 'Create synthetic plan.read session')
  const preview = assertOk(await invoke('agent:preview:create', {
    sessionId: session.id, message: '@QA Read Authorized read this exact synthetic plan', selections: [], includeHistory: false,
    targetGrantSetId: grants.id, targetRefs: [grants.targets[0].ref]
  }), 'Preview plan.read initial outbound request')
  queuedSyntheticToolCall = { id: 'qa-exact-plan-read', name: 'plan.read', arguments: JSON.stringify({ plan_ref: grants.targets[0].ref }) }
  await startInvoke('agent:request:send', { token: preview.token, sessionId: session.id })
  await waitForApproval(port, `${providerEndpoint}/chat/completions`, 'synthetic-model', 'allow', (details) => {
    assert.equal(details.body.includes(marker), false, 'plan content must not be sent before the explicit read')
    assert.equal(details.body.includes(neighborMarker), false)
    assert.equal(details.body.includes(preview.token), false, 'private initial preview capability must stay local')
  })
  const identity = assertOk(await waitForStartedInvoke(), 'Dispatch approved exact plan.read SSE request')
  let displayedReceipt
  await waitForApproval(port, `${providerEndpoint}/chat/completions`, 'synthetic-model', 'cancel', (details) => {
    assert.equal(requestCount, beforeRequests + 1, 'read continuation must still await outbound approval')
    const body = JSON.parse(details.body)
    const result = body.messages.find((item) => item.role === 'tool' && item.tool_call_id === 'qa-exact-plan-read')
    assert.ok(result, 'follow-up main preview must include the exact traceable read receipt')
    displayedReceipt = result.content
    const content = JSON.parse(result.content)
    assert.deepEqual(content, { ok: true, plan: {
      path: fixture.plan.path, plan_id: fixture.document.plan_id, updated_at: fixture.document.updated_at, components: fixture.document.components
    } })
    assert.equal(result.content.includes(marker), true)
    assert.equal(details.body.includes(neighborMarker), false, 'ungranted neighbor content must remain local')
    assert.equal(details.body.includes(preview.token), false)
    assert.equal(details.body.includes(grants.id), false, 'main grant-set capability must remain local')
    for (const privateField of ['confirmationToken', 'confirmation_token', 'entry_target_token', 'targetGrantSetId']) {
      assert.equal(details.body.includes(privateField), false, `${privateField} must not enter continuation outbound content`)
    }
  })
  const saved = await waitFor(async () => {
    const current = assertOk(await invoke('agent:session:read', { id: session.id }), 'Read preserved plan.read local receipt')
    const receipt = current.messages.find((item) => item.role === 'tool' && item.requestId === identity.requestId && item.toolCallId === 'qa-exact-plan-read')
    return receipt?.content === displayedReceipt && !current.messages.some((item) => item.status === 'streaming') ? { current, receipt } : null
  }, 'cancelled read continuation and exact local receipt')
  assert.equal(saved.current.requests.length, 1)
  assert.equal(saved.receipt.requestId, identity.requestId)
  assert.equal(saved.current.operationBatches[0].operations[0].status, 'succeeded')
  await waitFor(async () => !(await targets(port)).some((item) => /agent-approval\.html/i.test(item.url)), 'cancelled read approval window to close')
  assert.equal(requestCount, beforeRequests + 1, 'cancelling exact read-result outbound preview must not make a second HTTP request')
  assert.deepEqual(assertOk(await invoke('storage:readPlan', { path: neighbor.plan.path }), 'Verify neighbor remained unchanged'), neighbor.document)
  console.log(`PASS: real main approved plan.read once, displayed its exact synthetic receipt without neighbor/key/private tokens, and cancellation blocked a second HTTP request; provider requests ${beforeRequests} -> ${requestCount}.`)
}

async function clickRendererLabel(selector, labels, description) {
  // 带超时诊断：超时时 dump 选择器命中的候选文本与可见菜单项（2026-09-12 EditMenu 失败定位）
  const deadline = Date.now() + 60_000
  for (;;) {
    const state = await cdp.evaluate(`(() => {
      const visible = (element) => element.getClientRects().length > 0
      // startsWith 匹配：antd Menu 会把快捷键 extra（如 "Del"）渲进同一元素——严格相等永远失配
      // （"删除选中Del"；现有全部调用点的 label 无互为前缀冲突，已逐一核对）
      const controls = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
        .filter((element) => visible(element) && ${JSON.stringify(labels)}.some((label) => (element.textContent?.trim() ?? '').startsWith(label)))
      if (controls.length === 1 && !controls[0].disabled && !controls[0].classList.contains('ant-btn-loading')) {
        controls[0].click()
        return { clicked: true }
      }
      return {
        clicked: false,
        selectorMatches: Array.from(document.querySelectorAll(${JSON.stringify(selector)})).filter(visible).map((element) => ({ text: element.textContent?.trim() ?? '', disabled: element.disabled ?? null })),
        visibleMenuItems: Array.from(document.querySelectorAll('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item')).filter(visible).map((element) => element.textContent?.trim() ?? '')
      }
    })()`)
    if (state.clicked) return
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${description}; diagnostic=${JSON.stringify(state)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

async function refreshPlanTreeThroughF5() {
  const deadline = Date.now() + 5_000
  const withDeadline = (promise) => {
    const remainingMs = deadline - Date.now()
    assert.ok(remainingMs > 0, 'F5 preparation exceeded its 5-second deadline')
    let timeoutHandle
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error('F5 preparation exceeded its 5-second deadline')), remainingMs)
      })
    ]).finally(() => clearTimeout(timeoutHandle))
  }

  const focusState = await withDeadline(cdp.evaluate(`(() => {
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement) activeElement.blur()
    const focusedElement = document.activeElement
    const typingTarget = focusedElement instanceof HTMLElement && (
      focusedElement.tagName === 'INPUT' ||
      focusedElement.tagName === 'TEXTAREA' ||
      focusedElement.isContentEditable
    )
    window.__traceQaF5Proof = 'pending'
    const recordF5Handling = (event) => {
      if (event.key !== 'F5') return
      window.removeEventListener('keydown', recordF5Handling, true)
      window.setTimeout(() => {
        window.__traceQaF5Proof = event.defaultPrevented ? 'handled' : 'ignored'
      }, 0)
    }
    window.addEventListener('keydown', recordF5Handling, true)
    return { typingTarget, focusedTag: focusedElement?.tagName ?? null }
  })()`))
  assert.equal(focusState.typingTarget, false, `F5 must not be sent to a typing target (focused ${focusState.focusedTag ?? 'none'})`)

  const key = { key: 'F5', code: 'F5', windowsVirtualKeyCode: 116, nativeVirtualKeyCode: 116 }
  await withDeadline(cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...key }))
  await withDeadline(cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key }))
  let handling = 'pending'
  while (handling === 'pending') {
    handling = await withDeadline(cdp.evaluate("window.__traceQaF5Proof === 'pending' ? 'pending' : window.__traceQaF5Proof"))
    if (handling === 'pending') await delay(Math.min(100, Math.max(0, deadline - Date.now())))
  }
  assert.equal(handling, 'handled', 'the app must handle F5 instead of silently ignoring it')
}

async function refreshPlanTreeThroughViewMenu() {
  await clickRendererLabel('.menubar .menu-title', ['查看'], 'React View menu')
  await clickRendererLabel(
    '.ant-dropdown:not(.ant-dropdown-hidden) [role="menuitem"] .ant-dropdown-menu-title-content',
    ['刷新计划树'],
    'React refresh plan tree menu item'
  )
}

async function confirmOperationThroughReact(port, batch, expectedName, action) {
  const scope = `[data-agent-batch="${batch.id}"]`
  await clickRendererLabel('.agent-stage-nav button', ['02执行', '02Execute'], 'React execute stage')
  await waitFor(async () => cdp.evaluate(`(() => {
    const checkbox = document.querySelector(${JSON.stringify(`${scope} > .agent-operation-actions input[type="checkbox"]`)})
    if (!checkbox || checkbox.disabled || !checkbox.getClientRects().length) return false
    if (!checkbox.checked) checkbox.click()
    return true
  })()`), 'React exact-batch write approval checkbox')
  await clickRendererLabel(`${scope} > .agent-operation-actions button`, ['确认本地执行', 'Confirm local execution'], 'React exact-batch local execution button')
  await waitForTrustedConfirmation(port, { action, kind: 'agent-operation', expectedName, expectedBatchId: batch.id })
}

async function verifyReactFailedBatchRecovery(port, providerEndpoint, profileId, libraryId) {
  const beforeRequests = requestCount
  const fixture = await createMarkedPlan(libraryId, 'QA Batch Authorized A', 'QA_BATCH_ORIGINAL_TITLE')
  const parent = 'QA Batch Independent B'
  const occupiedName = 'QA Batch B1 Collision'
  assertOk(await invoke('storage:createFolder', { parent_path: '', name: parent }), 'Create independent B1 parent fixture')
  const grants = assertOk(await invoke('agent:target:grant', {
    targets: [{ kind: 'plan', path: fixture.plan.path }, { kind: 'folder', path: parent }]
  }), 'Grant independent A and B batch targets')
  const session = assertOk(await invoke('agent:session:create', { title: 'Isolated React failed batch recovery', profileId }), 'Create React batch session')
  const edit = (id, title) => ({ id, name: 'component.update', arguments: JSON.stringify({
    plan_ref: grants.targets[0].ref, component_id: fixture.component.id, expected_updated_at: fixture.document.updated_at, patch: { title }
  }) })
  const calls = [edit('qa_batch_a1', 'QA_BATCH_A1_SUCCESS_PREFIX'), {
    id: 'qa_batch_b1', name: 'plan.create', arguments: JSON.stringify({ parent_ref: grants.targets[1].ref, name_part: occupiedName })
  }, edit('qa_batch_a2', 'QA_BATCH_A2_CONTINUED_TAIL')]
  const { identity, batch } = await startAgentToolOperation(port, providerEndpoint, session.id, grants,
    '@QA Batch Authorized A edit title A1, create independent B1, then edit title A2 in that order', calls)
  assert.equal(requestCount, beforeRequests + 1)
  const preflight = assertOk(await invoke('agent:operation:read', { sessionId: session.id, batchId: batch.id }), 'Read ordered A1/B1/A2 preflight')
  assert.deepEqual(preflight.operations.map((item) => [item.callId, item.status]), calls.map((item) => [item.id, 'ready']))
  assert.equal(Object.hasOwn(preflight, 'confirmationToken'), false)
  const occupied = assertOk(await invoke('storage:createPlan', { parent_path: parent, name: occupiedName }), 'Create public-IPC B1 same-name occupancy after preflight')
  const occupiedTarget = assertOk(await invoke('plan-reference:commitTarget', { library_id: libraryId, path: occupied.path, mode: 'link' }), 'Allocate B1 occupant stable identity')
  const occupiedDocument = assertOk(await invoke('storage:readPlan', { path: occupied.path }), 'Snapshot complete B1 occupant document')
  await clickRendererControl('.view-nav button:nth-child(4)', 'React navigation to Agent workbench')
  await clickRendererLabel('.agent-session', [session.title], 'React select exact failed-batch session')
  await waitFor(async () => cdp.evaluate(`Boolean(document.querySelector(${JSON.stringify(`[data-agent-batch="${batch.id}"]`)}))`), 'React exact ordered batch to render')
  await confirmOperationThroughReact(port, batch, fixture.plan.name, 'accept')
  await waitForApproval(port, `${providerEndpoint}/chat/completions`, 'synthetic-model', 'cancel')
  const failedBatch = await waitFor(async () => {
    const value = assertOk(await invoke('agent:operation:read', { sessionId: session.id, batchId: batch.id }), 'Read actual React batch outcome')
    return value.status === 'execution-failed' ? value : null
  }, 'ordered React batch execution-failed receipt')
  assert.deepEqual(failedBatch.operations.map((item) => item.status), ['succeeded', 'failed', 'not-executed'])
  assert.equal(failedBatch.operations[1].errorCategory, 'name-conflict')
  const prefixDocument = assertOk(await invoke('storage:readPlan', { path: fixture.plan.path }), 'Read persisted successful A1 prefix')
  const prefixExpected = structuredClone(fixture.document)
  prefixExpected.components.find((item) => item.id === fixture.component.id).payload.title = 'QA_BATCH_A1_SUCCESS_PREFIX'
  assert.deepEqual({ ...prefixDocument, updated_at: fixture.document.updated_at }, prefixExpected)
  assert.equal(prefixDocument.updated_at, failedBatch.operations[0].afterUpdatedAt)
  assert.notEqual(prefixDocument.updated_at, fixture.document.updated_at)
  assert.deepEqual(assertOk(await invoke('storage:readPlan', { path: occupied.path }), 'Verify failed B1 preserved complete occupant'), occupiedDocument)
  assert.equal(assertOk(await invoke('plan-reference:resolve', { library_id: libraryId, plan_id: occupiedTarget.plan_id }), 'Verify B1 occupant resolver identity').target.path, occupied.path)
  assert.equal(requestCount, beforeRequests + 1)
  await clickRendererLabel('.agent-stage-nav button', ['03恢复', '03Recovery'], 'React recovery stage')
  await clickRendererLabel(`[data-agent-batch="${batch.id}"] > .agent-operation-actions button`, ['继续未执行项', 'Continue unexecuted items'], 'React continue only unexecuted A2')
  const attempt = await waitFor(async () => {
    const value = assertOk(await invoke('agent:session:read', { id: session.id }), 'Read React continuation attempt audit')
    return value.operationBatches.find((item) => item.attemptOf === batch.id && item.attemptKind === 'continue') ?? null
  }, 'React A2-only continuation preflight')
  assert.equal(attempt.status, 'pending-confirmation')
  assert.deepEqual(attempt.operations.map((item) => [item.callId, item.status]), [['qa_batch_a2', 'ready']])
  assert.equal(attempt.operations[0].beforeUpdatedAt, prefixDocument.updated_at)
  assert.deepEqual(assertOk(await invoke('storage:readPlan', { path: fixture.plan.path }), 'Verify continue preview caused no write'), prefixDocument)
  await confirmOperationThroughReact(port, attempt, fixture.plan.name, 'cancel')
  await waitFor(async () => !(await targets(port)).some((item) => item.title === 'Trace Local Operation Confirmation'), 'cancelled continuation main confirmation to close')
  assert.equal(assertOk(await invoke('agent:operation:read', { sessionId: session.id, batchId: attempt.id }), 'Verify cancelled attempt stays pending').status, 'pending-confirmation')
  assert.deepEqual(assertOk(await invoke('storage:readPlan', { path: fixture.plan.path }), 'Verify main-cancel preserved complete prefix and revision'), prefixDocument)
  assert.equal(requestCount, beforeRequests + 1)
  await confirmOperationThroughReact(port, attempt, fixture.plan.name, 'accept')
  const finished = await waitFor(async () => {
    const current = assertOk(await invoke('agent:session:read', { id: session.id }), 'Read final attempt and receipt ledger')
    const value = current.operationBatches.find((item) => item.id === attempt.id)
    return value?.operations[0]?.status === 'succeeded' ? { current, value } : null
  }, 'explicitly reconfirmed A2 success')
  const finalDocument = assertOk(await invoke('storage:readPlan', { path: fixture.plan.path }), 'Read exact continued A2 document')
  const finalExpected = structuredClone(prefixDocument)
  finalExpected.components.find((item) => item.id === fixture.component.id).payload.title = 'QA_BATCH_A2_CONTINUED_TAIL'
  assert.deepEqual({ ...finalDocument, updated_at: prefixDocument.updated_at }, finalExpected)
  assert.notEqual(finalDocument.updated_at, prefixDocument.updated_at)
  assert.equal(finalDocument.updated_at, finished.value.operations[0].afterUpdatedAt)
  const source = finished.current.operationBatches.find((item) => item.id === batch.id)
  assert.equal(source.requestId, identity.requestId)
  assert.deepEqual(source.operations.map((item) => item.status), ['succeeded', 'failed', 'not-executed'])
  assert.deepEqual(source.operations[0], failedBatch.operations[0], 'successful A1 prefix audit must not be replayed or rewritten')
  assert.deepEqual(source.operations[1], failedBatch.operations[1], 'B1 failed receipt must remain unchanged')
  assert.equal(source.operations[2].resolvedByAttempt, attempt.id)
  assert.equal(finished.current.operationBatches.length, 2, 'recovery adds exactly one A2 attempt and cancel/reconfirm does not replay the source')
  assert.deepEqual(finished.current.messages.filter((item) => item.role === 'tool').map((item) => item.toolCallId), calls.map((item) => item.id), 'tool receipt IDs must remain unique and ordered')
  assert.equal(finished.current.requests.length, 1)
  assert.deepEqual(assertOk(await invoke('storage:readPlan', { path: occupied.path }), 'Verify final recovery still preserved complete B1 occupant'), occupiedDocument)
  assert.equal(requestCount, beforeRequests + 1, 'React recovery preview/cancel/reconfirm must make no HTTP request')
  console.log(`PASS: CDP programmed React OperationView executed A1/B1/A2 as succeeded/name-conflict/not-executed, continued only A2, cancelled without writing and reconfirmed once; prefix and occupant preserved, attempts/receipts traced; provider requests ${beforeRequests} -> ${requestCount}.`)
}

async function createDeleteReferenceFixture(libraryId, entry) {
  const plans = {}
  for (const role of ['Target', 'Replacement', 'KeepSource', 'ReplaceSource']) {
    const name = `QA UI Delete ${entry} ${role}`
    const plan = assertOk(await invoke('storage:createPlan', { parent_path: '', name }), `Create ${name}`)
    const target = assertOk(await invoke('plan-reference:commitTarget', {
      library_id: libraryId, path: plan.path, mode: 'link'
    }), `Allocate ${name} stable identity through public IPC`)
    plans[role] = { plan, target }
  }
  assert.equal(new Set(Object.values(plans).map((item) => item.target.plan_id)).size, 4, 'each fixture plan must have a distinct public stable ID')
  for (const role of ['KeepSource', 'ReplaceSource']) {
    const component = { id: randomBytes(16).toString('hex'), type: 'plan_reference', payload: {
      mode: 'link', target_plan_id: plans.Target.target.plan_id,
      target_path_snapshot: plans.Target.plan.path, target_name_snapshot: plans.Target.plan.name
    } }
    assertOk(await invoke('storage:appendComponent', { path: plans[role].plan.path, component }), `Create legal ${role} link through validated public IPC`)
    plans[role].component = component
  }
  for (const item of Object.values(plans)) {
    item.document = assertOk(await invoke('storage:readPlan', { path: item.plan.path }), `Snapshot complete ${item.plan.name}`)
    assert.equal(item.document.plan_id, item.target.plan_id)
  }
  return plans
}

async function referenceInbound(libraryId, planId) {
  return assertOk(await invoke('plan-reference:inbound', { library_id: libraryId, plan_id: planId }), 'Read exact public reference inbound').references
}

function expectedInbound(source, targetId) {
  return { source_path: source.plan.path, source_component_id: source.component.id, target_plan_id: targetId }
}

async function assertDeleteFixtureUnchanged(libraryId, fixture, beforeTree, beforeTrash, description) {
  assert.deepEqual(assertOk(await invoke('storage:treeGetChildren', { parent_path: '' }), `${description}: live tree`), beforeTree)
  assert.deepEqual(assertOk(await invoke('trash:list'), `${description}: trash entries`), beforeTrash)
  for (const item of Object.values(fixture)) {
    assert.deepEqual(assertOk(await invoke('storage:readPlan', { path: item.plan.path }), `${description}: ${item.plan.name}`), item.document)
  }
  const resolved = assertOk(await invoke('plan-reference:resolve', {
    library_id: libraryId, plan_id: fixture.Target.target.plan_id
  }), `${description}: original resolver`)
  assert.equal(resolved.status, 'found')
  assert.equal(resolved.target.path, fixture.Target.plan.path)
  assert.deepEqual((await referenceInbound(libraryId, fixture.Target.target.plan_id)).sort((a, b) => a.source_path.localeCompare(b.source_path)),
    ['KeepSource', 'ReplaceSource'].map((role) => expectedInbound(fixture[role], fixture.Target.target.plan_id))
      .sort((a, b) => a.source_path.localeCompare(b.source_path)))
  assert.deepEqual(await referenceInbound(libraryId, fixture.Replacement.target.plan_id), [])
}

async function reactConfirmationState(title) {
  return cdp.evaluate(`(() => {
    const dialogs = Array.from(document.querySelectorAll('.ant-modal-confirm'))
      .filter((element) => element.getClientRects().length > 0 && element.querySelector('.ant-modal-confirm-title')?.textContent?.trim() === ${JSON.stringify(title)})
    return { count: dialogs.length, text: dialogs[0]?.innerText ?? '',
      groups: Array.from(dialogs[0]?.querySelectorAll('.ant-radio-group[aria-label]') ?? []).map((element) => element.getAttribute('aria-label')) }
  })()`)
}

async function clickReactConfirmation(title, label) {
  // 带超时诊断的轮询点击：超时时 dump 弹窗数/标题/按钮列表（含 disabled/loading）——
  // 2026-09-12 D3 运行在此超时且无诊断可用（用户授权至 Task 8 结束，failure-only 采样随轮询内置）
  const deadline = Date.now() + 60_000
  for (;;) {
    const state = await cdp.evaluate(`(() => {
      const dialogs = Array.from(document.querySelectorAll('.ant-modal-confirm'))
      const dialog = dialogs.find((element) => element.getClientRects().length > 0 && element.querySelector('.ant-modal-confirm-title')?.textContent?.trim() === ${JSON.stringify(title)})
      const buttons = Array.from(dialog?.querySelectorAll('button') ?? []).map((element) => ({ text: element.textContent?.trim() ?? '', disabled: element.disabled, loading: element.classList.contains('ant-btn-loading') }))
      // antd 两字按钮自动插空格（"取 消"/"删 除"）——匹配必须去空白后比较（模板串内 \\s 才能让浏览器收到 \s）
      const button = buttons.find((b) => b.text.replace(/\\s+/g, '') === ${JSON.stringify(label)} && !b.disabled && !b.loading)
      if (button && dialog) {
        const el = Array.from(dialog.querySelectorAll('button')).find((element) => (element.textContent?.trim() ?? '').replace(/\\s+/g, '') === ${JSON.stringify(label)})
        el.click()
        return { clicked: true, dialogs: dialogs.length }
      }
      return { clicked: false, dialogs: dialogs.length, titles: dialogs.map((d) => d.querySelector('.ant-modal-confirm-title')?.textContent?.trim() ?? null), buttons }
    })()`)
    if (state.clicked) return
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for React ${title}: ${label}; diagnostic=${JSON.stringify(state)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

function summarizeTreeTarget(nodes, targetPath) {
  if (!Array.isArray(nodes)) return { available: false }
  const matches = nodes.filter((node) => node && typeof node === 'object' && node.path === targetPath)
  return {
    available: true,
    rootNodeCount: nodes.length,
    exactTargetCount: matches.length,
    exactTargetKind: matches.length === 1 && typeof matches[0].kind === 'string' ? matches[0].kind : null
  }
}

async function reportD3TreeSelectionFailure(targetPath, stage, diagnosticContext) {
  const diagnostic = {
    diagnostic: 'd3-tree-selection-failure',
    stage,
    targetPath,
    rendererRuntimeExceptionCount: cdp.runtimeExceptionCount,
    initialRootTree: summarizeTreeTarget(diagnosticContext.initialRootTree, targetPath)
  }

  try {
    diagnostic.renderer = await cdp.evaluate(`(() => {
      const isVisible = (element) => element.getClientRects().length > 0
      const rows = Array.from(document.querySelectorAll('.tree-row'))
      const targetRows = rows.filter((row) => row.getAttribute('data-path') === ${JSON.stringify(targetPath)})
      const views = Array.from(document.querySelectorAll('.view-nav button'))
        .filter(isVisible)
        .slice(0, ${MAX_D3_DIAGNOSTIC_VIEW_COUNT})
        .map((button) => ({
          label: button.textContent?.trim().slice(0, ${MAX_D3_DIAGNOSTIC_VIEW_LABEL_LENGTH}) ?? '',
          current: button.getAttribute('aria-current') === 'page'
        }))
      return {
        rootMounted: Boolean(document.getElementById('root')?.childElementCount),
        f5Proof: window.__traceQaF5Proof === 'handled' ? 'handled' : 'unavailable',
        visibleTreeRowCount: rows.filter(isVisible).length,
        exactTargetRowCount: targetRows.length,
        exactTargetVisibleCount: targetRows.filter(isVisible).length,
        exactTargetSelectedCount: targetRows.filter((row) =>
          row.querySelector('.tree-node-title[role="button"] .name')?.style.fontWeight === '500'
        ).length,
        currentViews: views
      }
    })()`)
  } catch (error) {
    diagnostic.renderer = { available: false, errorName: error?.name ?? 'unknown' }
  }

  try {
    const workspaceResult = await invoke('workspace-tabs:get')
    const workspaceMatchesExpected = workspaceResult?.ok === true &&
      workspaceResult.data?.library_id === diagnosticContext.expectedLibraryId
    diagnostic.workspaceLibraryMatchesExpected = workspaceMatchesExpected
    if (workspaceMatchesExpected) {
      const treeResult = await invoke('storage:treeGetChildren', { parent_path: '' })
      diagnostic.currentRootTree = treeResult?.ok === true
        ? summarizeTreeTarget(treeResult.data, targetPath)
        : { available: false, code: Number.isInteger(treeResult?.code) ? treeResult.code : null }
    } else {
      diagnostic.currentRootTree = { available: false, skipped: 'library-identity-mismatch' }
    }
  } catch (error) {
    diagnostic.currentRootTree = { available: false, errorName: error?.name ?? 'unknown' }
  }

  console.error(`D3 tree selection diagnostic: ${JSON.stringify(diagnostic)}`)
}

async function selectTreeFixture(targetPath, diagnosticContext) {
  const selector = `.tree-row[data-path="${targetPath}"] .tree-node-title[role="button"]`
  let stage = 'exact-row-control'
  try {
    await clickRendererControl(selector, `React tree title selects exact ${targetPath}`)
    stage = 'selected-state'
    await waitFor(async () => cdp.evaluate(`document.querySelector(${JSON.stringify(`${selector} .name`)})?.style.fontWeight === '500'`), 'exact tree title selected state')
  } catch (error) {
    if (d3DeleteReferenceDiagnostic && diagnosticContext) {
      // 失败现场采样：全部行可见性/选中态 + 目标行存在性与字重（DeleteKey 选中超时定位）；
      // dump 同时拼进抛出的错误（stdout 可见——reportDebug 仅进内部调试服务）
      const dump = await cdp.evaluate(`(() => {
        const visible = (e) => e.getClientRects().length > 0
        const rows = Array.from(document.querySelectorAll('.tree-row')).map((r) => ({
          path: r.getAttribute('data-path'),
          visible: visible(r),
          selected: r.className.includes('selected')
        }))
        const title = document.querySelector(${JSON.stringify(selector)})
        return {
          rows,
          targetTitlePresent: !!title,
          targetVisible: title ? visible(title) : null,
          targetWeight: title ? (title.querySelector('.name') ? getComputedStyle(title.querySelector('.name')).fontWeight : null) : null
        }
      })()`).catch(() => null)
      await reportD3TreeSelectionFailure(targetPath, `${stage};dump=${JSON.stringify(dump)}`, diagnosticContext).catch(() => {})
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`${detail}; dump=${JSON.stringify(dump)}; lastRendererException=${cdp.lastRendererException ?? 'none'}`)
    }
    throw error
  }
}

async function triggerPlanDeleteEntry(entry, targetPath, diagnosticContext) {
  await selectTreeFixture(targetPath, diagnosticContext)
  if (entry === 'Context') {
    const dispatched = await cdp.evaluate(`(() => {
      const row = document.querySelector(${JSON.stringify(`.tree-row[data-path="${targetPath}"]`)})
      if (!row || !row.getClientRects().length) return false
      const rect = row.getBoundingClientRect()
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, buttons: 2,
        clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }))
      return true
    })()`)
    assert.equal(dispatched, true, 'CDP programmed context menu event must target the exact visible tree row')
    await clickRendererLabel('.ant-dropdown:not(.ant-dropdown-hidden) [role="menuitem"] .ant-dropdown-menu-title-content', ['删除'], 'visible React tree context menu delete item')
  } else if (entry === 'EditMenu') {
    await clickRendererLabel('.menubar .menu-title', ['编辑'], 'React Edit menu')
    await clickRendererLabel('.ant-dropdown:not(.ant-dropdown-hidden) [role="menuitem"] .ant-dropdown-menu-title-content', ['删除选中'], 'visible React Edit delete-selected item')
  } else {
    assert.equal(entry, 'DeleteKey')
    const focused = await cdp.evaluate(`(() => {
      const row = document.querySelector(${JSON.stringify(`.tree-row[data-path="${targetPath}"]`)})
      row?.focus()
      return { exactRow: document.activeElement === row,
        typing: document.activeElement?.matches('input, textarea, [contenteditable="true"], [role="textbox"]') ?? true }
    })()`)
    assert.deepEqual(focused, { exactRow: true, typing: false }, 'Delete must originate from exact tree focus outside any text editor')
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46, modifiers: 0 })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46, modifiers: 0 })
  }
}

async function chooseReferenceRadio(sourcePath, action) {
  const selector = `.ant-modal-confirm .ant-radio-group[aria-label="${sourcePath} 关联处理方式"] input[type="radio"][value="${action}"]`
  await clickRendererControl(selector, `React exact ${sourcePath} ${action} radio`)
  await waitFor(async () => cdp.evaluate(`document.querySelector(${JSON.stringify(selector)})?.checked === true`), 'React exact reference radio checked state')
}

async function chooseReferenceReplacement(sourcePath, replacement) {
  const label = `${sourcePath} 替代目标`
  const inputSelector = `.ant-modal-confirm input[role="combobox"][aria-label="${label}"]`
  await waitFor(async () => cdp.evaluate(`Boolean(document.querySelector(${JSON.stringify(inputSelector)}))`), 'React replacement Select combobox')
  await fillRendererInput(inputSelector, replacement.plan.name)
  const optionSelector = `.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="${replacement.plan.name}"]`
  await clickRendererControl(optionSelector, 'React searched unique plan-level replacement option')
  await waitFor(async () => cdp.evaluate(`(() => {
    const select = document.querySelector(${JSON.stringify(inputSelector)})?.closest('.ant-select')
    return select?.querySelector('.ant-select-selection-item')?.getAttribute('title') === ${JSON.stringify(replacement.plan.name)}
  })()`), 'React plan-level replacement selected label')
}

// D3-only 最小修正（用户 04:04 授权；Codex 03:42 诊断的实施）：
// worktree tree store 初始 expandedKeys 为空，库根 TreeGroup 不渲染顶层行——
// 通过真实树 UI 点击根 switcher 展开库根，并等待精确目标行可见后再进入删除/引用交互
async function expandLibraryRootThroughTreeUi(targetPath, diagnosticContext) {
  const targetSelector = `.tree-row[data-path="${targetPath}"]`
  const alreadyVisible = await cdp.evaluate(`!!document.querySelector(${JSON.stringify(targetSelector)})`)
  if (alreadyVisible) return
  let stage = 'root-switcher-click'
  try {
    await clickRendererControl('.tree-row[data-path=""] .tree-switcher', 'React tree root switcher expands the library root')
    stage = 'target-row-visible'
    await waitFor(async () => cdp.evaluate(`!!document.querySelector(${JSON.stringify(targetSelector)})`), 'exact target row visible after expanding the library root')
  } catch (error) {
    if (d3DeleteReferenceDiagnostic && diagnosticContext) {
      await reportD3TreeSelectionFailure(targetPath, stage, diagnosticContext).catch(() => {})
    }
    throw error
  }
}

async function verifyPlanDeleteReferenceEntry(libraryId, entry, exerciseIncompleteChoice, refreshMethod = 'menu') {
  const beforeRequests = requestCount
  const fixture = await createDeleteReferenceFixture(libraryId, entry)
  const beforeTree = assertOk(await invoke('storage:treeGetChildren', { parent_path: '' }), 'Snapshot deletion fixture live tree')
  const beforeTrash = assertOk(await invoke('trash:list'), 'Snapshot deletion fixture trash entries')
  const selectionDiagnosticContext = d3DeleteReferenceDiagnostic
    ? { expectedLibraryId: libraryId, initialRootTree: beforeTree }
    : null
  await clickRendererLabel('.view-nav button', ['计划'], 'React navigation to plan workspace')
  if (refreshMethod === 'f5') await refreshPlanTreeThroughF5()
  else await refreshPlanTreeThroughViewMenu()
  await expandLibraryRootThroughTreeUi(fixture.Target.plan.path, selectionDiagnosticContext)
  const firstTitle = `将计划「${fixture.Target.plan.name}」移入回收站？`
  await triggerPlanDeleteEntry(entry, fixture.Target.plan.path, selectionDiagnosticContext)
  const first = await waitFor(async () => {
    const state = await reactConfirmationState(firstTitle)
    return state.count === 1 ? state : null
  }, 'React initial exact soft-delete confirmation')
  assert.match(first.text, /之后可恢复/)
  await clickReactConfirmation(firstTitle, '取消')
  await waitFor(async () => (await reactConfirmationState(firstTitle)).count === 0, 'cancelled soft-delete confirmation to close')
  assert.equal((await reactConfirmationState('关联影响')).count, 0, 'initial cancellation must not enter reference decision UI')
  await assertDeleteFixtureUnchanged(libraryId, fixture, beforeTree, beforeTrash, `${entry} initial cancellation zero writes`)
  console.log(`PASS: CDP programmed ${entry} ordinary-plan delete cancelled the exact recoverable soft-delete confirmation; complete fixture/tree/trash/inbound remained unchanged.`)

  await triggerPlanDeleteEntry(entry, fixture.Target.plan.path, selectionDiagnosticContext)
  await clickReactConfirmation(firstTitle, '删除')
  const impact = await waitFor(async () => {
    const state = await reactConfirmationState('关联影响')
    return state.count === 1 && state.groups.length === 2 ? state : null
  }, 'real React reference impact dialog with both link sources')
  assert.deepEqual(impact.groups.sort(), ['KeepSource', 'ReplaceSource'].map((role) => `${fixture[role].plan.path} 关联处理方式`).sort())
  await chooseReferenceRadio(fixture.KeepSource.plan.path, 'keep')
  await chooseReferenceRadio(fixture.ReplaceSource.plan.path, 'replace')
  if (exerciseIncompleteChoice) {
    await clickReactConfirmation('关联影响', '确认并继续')
    await waitFor(async () => cdp.evaluate(`Array.from(document.querySelectorAll('.ant-message-notice-content')).some((element) => element.getClientRects().length > 0 && element.textContent.includes('请为每条关联选择处理方式和替代目标。'))`), 'explicit incomplete replacement warning')
    assert.equal((await reactConfirmationState('关联影响')).count, 1, 'incomplete replacement must keep impact dialog open')
    await assertDeleteFixtureUnchanged(libraryId, fixture, beforeTree, beforeTrash, 'missing replacement zero writes')
    console.log('PASS: real React impact confirmation rejected a missing replacement with the explicit warning; all four documents/tree/trash/inbound remained unchanged before selection.')
  }
  await chooseReferenceReplacement(fixture.ReplaceSource.plan.path, fixture.Replacement)
  await clickReactConfirmation('关联影响', '确认并继续')
  const entryDto = await waitFor(async () => {
    const entries = assertOk(await invoke('trash:list'), 'Read committed UI soft-delete entry')
    const matches = entries.filter((item) => item.original_relative_path === fixture.Target.plan.path)
    assert.ok(matches.length <= 1, 'UI deletion must create only one exact target entry')
    return matches[0] ?? null
  }, 'exact target to enter trash after UI decisions')
  assert.equal(entryDto.kind, 'plan')
  assert.equal(entryDto.name, fixture.Target.plan.name)
  assert.equal(entryDto.status, 'trashed')
  assert.equal(entryDto.can_restore, true)
  assert.deepEqual(assertOk(await invoke('trash:list'), 'Verify only exact target trash entry added').sort((a, b) => a.id.localeCompare(b.id)),
    [...beforeTrash, entryDto].sort((a, b) => a.id.localeCompare(b.id)))
  await waitFor(async () => !(await cdp.evaluate(`Boolean(document.querySelector(${JSON.stringify(`.tree-row[data-path="${fixture.Target.plan.path}"]`)}))`)), 'deleted target to leave actual React tree')
  // order 是派生值（2026-09-08 排序定稿：显示按文件名排序）——软删除移除后兄弟 order 压缩重排属预期实现行为；
  // 断言核心意图 = Target 离开活树且其余计划一个不少：比较名字序列而非 order 数值（2026-09-12 D3 运行实证 order 全体 -1 触发）
  assert.deepEqual(
    assertOk(await invoke('storage:treeGetChildren', { parent_path: '' }), 'Verify exact target left live tree').map((item) => item.name),
    beforeTree.filter((item) => item.path !== fixture.Target.plan.path).map((item) => item.name)
  )
  assert.equal(assertOk(await invoke('plan-reference:resolve', { library_id: libraryId, plan_id: fixture.Target.target.plan_id }), 'Resolve original target after UI deletion').status, 'missing')
  const kept = assertOk(await invoke('storage:readPlan', { path: fixture.KeepSource.plan.path }), 'Read kept link source after UI deletion')
  assert.deepEqual(kept, fixture.KeepSource.document, 'keep must preserve complete source DTO including unchanged link payload')
  const replaced = assertOk(await invoke('storage:readPlan', { path: fixture.ReplaceSource.plan.path }), 'Read actual replacement link source after UI deletion')
  const actualLink = replaced.components.find((item) => item.id === fixture.ReplaceSource.component.id)
  const expectedReplaced = structuredClone(fixture.ReplaceSource.document)
  expectedReplaced.components.find((item) => item.id === actualLink.id).payload = {
    mode: 'link', target_plan_id: fixture.Replacement.target.plan_id,
    target_path_snapshot: fixture.Replacement.plan.path, target_name_snapshot: fixture.Replacement.plan.name
  }
  assert.deepEqual({ ...replaced, updated_at: expectedReplaced.updated_at }, expectedReplaced, 'replace must change only reference target fields and source revision')
  assert.notEqual(replaced.updated_at, fixture.ReplaceSource.document.updated_at)
  assert.notEqual(actualLink.payload.target_plan_id, fixture.ReplaceSource.component.payload.target_plan_id)
  const actualResolved = assertOk(await invoke('plan-reference:resolve', {
    library_id: libraryId, plan_id: actualLink.payload.target_plan_id
  }), 'Resolve target ID read back from actual replacement payload')
  assert.equal(actualResolved.status, 'found')
  assert.equal(actualResolved.target.path, fixture.Replacement.plan.path)
  assert.deepEqual(await referenceInbound(libraryId, fixture.Target.target.plan_id), [expectedInbound(fixture.KeepSource, fixture.Target.target.plan_id)])
  assert.deepEqual(await referenceInbound(libraryId, actualLink.payload.target_plan_id), [expectedInbound(fixture.ReplaceSource, fixture.Replacement.target.plan_id)])
  assert.deepEqual(assertOk(await invoke('storage:readPlan', { path: fixture.Replacement.plan.path }), 'Verify replacement complete DTO untouched by UI deletion'), fixture.Replacement.document)
  await waitFor(async () => (await reactConfirmationState('关联影响')).count === 0 && (await reactConfirmationState(firstTitle)).count === 0, 'both successful delete confirmations to close')
  assert.equal(requestCount, beforeRequests, 'all ordinary-plan delete and reference UI decisions must stay local')
  console.log(`PASS: CDP programmed ${entry} ordinary-plan delete used real keep/replace radios and searched plan-level Select; exact recoverable target trashed, old ID missing, kept payload unchanged, actual replacement ID/path/name resolved, exact old/new inbound and complete replacement preserved; provider requests ${beforeRequests} -> ${requestCount}.`)

  const grant = assertOk(await invoke('trash:entryTarget', { entry_id: entryDto.id }), 'IPC-only authorize exact deleted target restore')
  const preview = assertOk(await invoke('trash:restore-preview', { entry_id: entryDto.id, entry_target_token: grant.token }), 'IPC-only preview exact target restore')
  assert.equal(assertOk(await invoke('trash:restore-commit', { confirmation_token: preview.confirmation_token }), 'IPC-only restore exact target').path, fixture.Target.plan.path)
  assert.deepEqual(assertOk(await invoke('storage:readPlan', { path: fixture.Target.plan.path }), 'IPC restore complete original target document'), fixture.Target.document)
  const restored = assertOk(await invoke('plan-reference:resolve', { library_id: libraryId, plan_id: kept.components.find((item) => item.id === fixture.KeepSource.component.id).payload.target_plan_id }), 'Resolve actual kept link after IPC restore')
  assert.equal(restored.status, 'found')
  assert.equal(restored.target.plan_id, fixture.Target.target.plan_id)
  assert.equal(restored.target.path, fixture.Target.plan.path)
  assert.deepEqual(assertOk(await invoke('storage:readPlan', { path: fixture.KeepSource.plan.path }), 'Verify IPC restore kept source untouched'), kept)
  assert.deepEqual(assertOk(await invoke('storage:readPlan', { path: fixture.ReplaceSource.plan.path }), 'Verify IPC restore did not reverse replacement link'), replaced)
  assert.deepEqual(assertOk(await invoke('storage:readPlan', { path: fixture.Replacement.plan.path }), 'Verify IPC restore replacement complete DTO'), fixture.Replacement.document)
  assert.deepEqual(assertOk(await invoke('trash:list'), 'IPC restore removed only exact target entry'), beforeTrash)
  assert.deepEqual(await referenceInbound(libraryId, fixture.Target.target.plan_id), [expectedInbound(fixture.KeepSource, fixture.Target.target.plan_id)])
  assert.deepEqual(await referenceInbound(libraryId, actualLink.payload.target_plan_id), [expectedInbound(fixture.ReplaceSource, fixture.Replacement.target.plan_id)])
  assert.equal(requestCount, beforeRequests, 'additional public IPC restore must stay local')
  console.log(`PASS: ${entry} additional restore was public IPC-only: original stable ID/kept link revived; replacement source and complete replacement DTO stayed unchanged.`)
}

async function verifyOrdinaryPlanDeleteReferenceUi(libraryId, refreshMethod = 'menu') {
  for (const [index, entry] of ['Context', 'EditMenu', 'DeleteKey'].entries()) {
    // entry 间 settle：上一轮 trash 移动/恢复的 rename 后，Windows 句柄锁定窗口内的原子写会 EPERM
    // （8A 偶发失败在 runner 的复现——用户已决定暂缓追因；runner 以间隔规避，不加任何文件系统重试）
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 800))
    await verifyPlanDeleteReferenceEntry(libraryId, entry, index === 0, refreshMethod)
  }
}

function spawnElectron(debugPort) {
  const env = {
    ...baseEnvironment(),
    TRACE_PHASE2_QA_ROOT: runRoot,
    TRACE_PHASE2_QA_MAIN_BUNDLE: mainBundlePath,
    ELECTRON_ENABLE_LOGGING: '1'
  }
  child = spawn(electronPath, [
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${debugPort}`,
    '--no-first-run',
    helperPath
  ], { cwd: worktree, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const collect = (chunk) => { output = (output + chunk.toString()).slice(-16_000) }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  child.on('error', (error) => { output += `\nspawn error: ${error.message}` })
  return waitFor(() => output.includes(sentinel), 'pre-main Electron isolation sentinel').then(async () => {
    const portFile = path.join(sessionDataPath, 'DevToolsActivePort')
    const portValue = await waitFor(() => {
      try {
        const [line] = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/)
        const parsed = Number(line)
        return Number.isInteger(parsed) && parsed > 0 ? parsed : null
      } catch { return null }
    }, 'Chromium loopback debugging port')
    assert.equal(portValue, debugPort, 'Electron remote debugging must use the selected loopback port')
    return portValue
  })
}

async function stopElectron() {
  cdp?.close()
  if (child && child.exitCode === null) {
    const pid = child.pid
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('Cannot safely identify the isolated Electron process')
    execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(5_000)])
  }
  if (child && child.exitCode === null) throw new Error('Isolated Electron process tree did not exit')
}

async function main() {
  fs.writeFileSync(markerPath, markerValue, { flag: 'wx' })
  fs.mkdirSync(libraryPath)
  fs.mkdirSync(userDataPath)
  fs.writeFileSync(path.join(userDataPath, 'config.json'), JSON.stringify({
    format_version: '1', root_dir: libraryPath, window: { width: 1200, height: 800, maximized: false }
  }), { flag: 'wx' })

  const port = d1CloseDiagnostic || d3DeleteReferenceDiagnostic ? null : await startProvider()
  const providerEndpoint = port === null ? null : `http://127.0.0.1:${port}/v1`
  const cdpPort = await spawnElectron(await reserveLoopbackPort())
  if (child) child.__qaCdpPort = cdpPort
  await mainPage(cdpPort)

  const bootstrap = assertOk(await invoke('app:bootstrap'), 'Read-only app bootstrap')
  assert.equal(bootstrap.rootConfigured, true, 'isolated root must be configured')
  assert.equal(canonicalWindowsPath(bootstrap.rootDir), canonicalWindowsPath(libraryPath), 'bootstrap root must exactly match disposable library before writes')
  console.log('PASS: Electron bootstrap root matched the unique disposable library; write IPC gate opened.')

  const initialTree = assertOk(await invoke('storage:treeGetChildren', { parent_path: '' }), 'Read empty disposable tree')
  assert.deepEqual(initialTree.map(({ kind, name, path: relativePath }) => ({ kind, name, path: relativePath })), [
    { kind: 'folder', name: 'Diary', path: 'Diary' }
  ], 'startup may create the automatic Diary root, but no other fixture content should exist')
  if (d1CloseDiagnostic) {
    const workspaceState = assertOk(await invoke('workspace-tabs:get'), 'Read disposable D1 library identity')
    assert.equal(typeof workspaceState.library_id, 'string')
    assert.notEqual(workspaceState.library_id, '')
    await verifyTrashDialogConflictRestore(workspaceState.library_id)
    assert.equal(provider, undefined, 'D1-only diagnostic must not start a provider server')
    assert.equal(requestCount, 0, 'D1-only diagnostic must produce no provider requests')
    succeeded = true
    console.log(JSON.stringify({
      result: 'PASS', mode: 'd1-close-diagnostic',
      renderer: 'Electron production renderer and preload bridge',
      provider: 'not started', providerRequestCount: requestCount,
      isolatedUserData: true, isolatedLibrary: true,
      rendererRuntimeExceptionCount: cdp.runtimeExceptionCount,
      exercised: ['react-trash-conflict-rename-resolve-close'], runId
    }, null, 2))
    return
  }
  if (d3DeleteReferenceDiagnostic) {
    const workspaceState = assertOk(await invoke('workspace-tabs:get'), 'Read disposable D3 library identity')
    assert.equal(typeof workspaceState.library_id, 'string')
    assert.notEqual(workspaceState.library_id, '')
    assert.equal(provider, undefined, 'D3-only diagnostic must not start a provider server')
    assert.equal(requestCount, 0, 'D3-only diagnostic must begin with no provider requests')
    const beforeRuntimeExceptions = cdp.runtimeExceptionCount
    assert.equal(beforeRuntimeExceptions, 0, 'D3-only renderer must start without uncaught JavaScript exceptions')
    await verifyOrdinaryPlanDeleteReferenceUi(workspaceState.library_id, 'f5')
    assert.equal(provider, undefined, 'D3-only diagnostic must not start a provider server')
    assert.equal(requestCount, 0, 'ordinary-plan deletion and reference UI decisions must produce no provider requests')
    assert.equal(cdp.runtimeExceptionCount, beforeRuntimeExceptions, `D3-only scenario must not introduce an uncaught renderer JavaScript exception; last=${cdp.lastRendererException ?? 'none'}`)
    assert.ok((cdp.expectedBusinessRejections ?? 0) >= 1, 'Context incomplete-choice business rejection must be observed exactly as designed')
    succeeded = true
    console.log(JSON.stringify({
      result: 'PASS', mode: 'd3-delete-reference-diagnostic',
      renderer: 'Electron production renderer and preload bridge',
      provider: 'not started', providerRequestCount: requestCount,
      isolatedUserData: true, isolatedLibrary: true,
      rendererRuntimeExceptionCount: cdp.runtimeExceptionCount,
      exercised: ['react-ordinary-plan-context-edit-menu-delete-key-link-keep-replace', 'missing-replacement-zero-write', 'ipc-only-reference-restore'], runId
    }, null, 2))
    return
  }
  assertOk(await invoke('storage:createFolder', { parent_path: '', name: 'QA Folder' }), 'Create disposable folder')
  assertOk(await invoke('storage:createPlan', { parent_path: 'QA Folder', name: 'QA Plan A' }), 'Create plan under disposable folder')
  assertOk(await invoke('storage:createPlan', { parent_path: '', name: 'QA Plan B' }), 'Create second disposable plan')
  const folderChildren = assertOk(await invoke('storage:treeGetChildren', { parent_path: 'QA Folder' }), 'Read nested disposable tree')
  assert.deepEqual(folderChildren.map((node) => node.name), ['QA Plan A'])
  console.log('PASS: real renderer -> preload -> main IPC enumerated only the automatic Diary root, then created and enumerated isolated folder/plans.')

  const profile = assertOk(await invoke('agent:profile:create', {
    name: 'Isolated QA Provider', endpoint: providerEndpoint, model: 'synthetic-model', presetId: null
  }), 'Create loopback-only provider profile')
  assertOk(await invoke('agent:key:set', { id: profile.id, key: fakeKey }), 'Save synthetic provider key in isolated userData')
  await startInvoke('agent:capability:test', { id: profile.id })
  await waitForApproval(cdpPort, `${providerEndpoint}/chat/completions`, 'synthetic-model')
  const capabilityResult = assertOk(await waitForStartedInvoke(), 'Complete loopback capability request')
  assert.equal(capabilityResult.status, 'passed', 'synthetic loopback SSE tool call must pass capability test')
  assert.equal(requestCount, 1, 'provider must not be contacted before the isolated approval is clicked')
  assert.equal(providerRequests[0]?.authorizationMatches, true, 'only the synthetic key may be sent to loopback')
  assert.equal(providerRequests[0]?.model, 'synthetic-model')
  console.log('PASS: isolated approval window displayed endpoint/model, omitted the key, and gated one 127.0.0.1 SSE capability request.')

  const profiles = assertOk(await invoke('agent:profile:list'), 'Read isolated provider profiles')
  assert.equal(profiles.profiles.find((item) => item.id === profile.id)?.keyStatus, 'saved')
  const session = assertOk(await invoke('agent:session:create', { title: 'Isolated Electron QA', profileId: profile.id }), 'Create isolated agent session')
  const grantSet = assertOk(await invoke('agent:target:grant', {
    targets: [{ kind: 'folder', path: 'QA Folder' }, { kind: 'plan', path: 'QA Plan B' }]
  }), 'Grant two explicit @ targets')
  assert.equal(grantSet.targets.length, 2, 'multiple explicit targets must remain separate grants')
  const folderChildrenThroughGrant = assertOk(await invoke('agent:target:children', {
    setId: grantSet.id, ref: grantSet.targets[0].ref
  }), 'Read direct children through folder target grant')
  assert.deepEqual(folderChildrenThroughGrant.map((item) => item.path), ['QA Folder/QA Plan A'])

  const contextPreview = assertOk(await invoke('agent:preview:create', {
    sessionId: session.id,
    message: 'Summarize only the selected disposable test plan.',
    selections: [{ kind: 'plan', path: 'QA Folder/QA Plan A' }],
    includeHistory: false,
    targetGrantSetId: grantSet.id,
    targetRefs: grantSet.targets.map((item) => item.ref)
  }), 'Create explicit context/outbound preview')
  assert.equal(contextPreview.contexts.length, 1)
  assert.equal(contextPreview.contexts[0].path, 'QA Folder/QA Plan A')
  assert.equal(contextPreview.targets.length, 2, 'outbound preview must bind the exact multiple target grant set')
  assert.equal(JSON.stringify(contextPreview).includes(fakeKey), false, 'credential must not enter preview DTO')
  assertOk(await invoke('agent:preview:cancel', { token: contextPreview.token }), 'Cancel no-send explicit context preview')
  assert.equal(requestCount, 1, 'creating/canceling a preview must not contact the provider')
  console.log('PASS: two @ targets, one explicitly selected context and cancellation were represented in the real renderer IPC preview without provider traffic.')

  const createCall = {
    id: 'qa-create-plan-call', name: 'plan.create',
    arguments: JSON.stringify({ parent_ref: grantSet.targets[0].ref, name_part: 'QA Generated Plan' })
  }
  const { identity: requestIdentity, batch } = await startAgentToolOperation(cdpPort, providerEndpoint, session.id, grantSet,
    'Create a synthetic plan named QA Generated Plan inside @QA Folder.', createCall)
  assert.equal(batch.requestId, requestIdentity.requestId)
  assert.equal(requestCount, 2)
  assert.equal(providerRequests[1]?.authorizationMatches, true)
  assert.equal(batch.status, 'pending-confirmation')
  const batchRead = assertOk(await invoke('agent:operation:read', { sessionId: session.id, batchId: batch.id }), 'Read exact tool operation preview')
  assert.equal(batchRead.operations.length, 1)
  assert.equal(batchRead.operations[0].operation, 'plan.create')
  assert.equal(batchRead.operations[0].status, 'ready')
  assert.equal(batchRead.operations[0].changes.some((change) => change.after?.includes('QA Generated Plan')), true)
  assert.equal(Object.hasOwn(batchRead, 'confirmationToken'), false, 'renderer must not receive the local confirmation capability')
  const cancelledConfirmation = await confirmAgentOperation(cdpPort, session.id, batchRead, 'QA Generated Plan', 'cancel')
  assert.equal(cancelledConfirmation.status, 'pending-confirmation', 'closing the trusted confirmation must leave the operation pending')
  const stillPending = assertOk(await invoke('agent:operation:read', { sessionId: session.id, batchId: batch.id }), 'Verify operation remained pending after closing confirmation')
  assert.equal(stillPending.status, 'pending-confirmation')
  const afterCancelTree = assertOk(await invoke('storage:treeGetChildren', { parent_path: 'QA Folder' }), 'Verify cancelled confirmation caused no write')
  assert.equal(afterCancelTree.some((node) => node.name === 'QA Generated Plan'), false, 'local cancellation must be fail-closed')

  const confirmedBatch = await confirmAgentOperation(cdpPort, session.id, batchRead, 'QA Generated Plan', 'accept', providerEndpoint)
  assert.equal(confirmedBatch.operations[0].status, 'succeeded')
  assertOk(await invoke('agent:operation:read', { sessionId: session.id, batchId: batch.id }), 'Verify completed operation receipt')
  const finalTree = assertOk(await invoke('storage:treeGetChildren', { parent_path: 'QA Folder' }), 'Verify created disposable plan')
  assert.equal(finalTree.some((node) => node.name === 'QA Generated Plan'), true)
  const savedSession = assertOk(await invoke('agent:session:read', { id: session.id }), 'Verify local session provenance')
  assert.equal(savedSession.requests.length, 1)
  assert.equal(savedSession.requests[0].model, 'synthetic-model')
  assert.equal(savedSession.requests[0].sources.length, 0)
  assert.equal(savedSession.operationBatches[0].operations[0].undoStatus, 'available')
  console.log('PASS: approved synthetic SSE plan.create tool call was previewed, cancelled without writing, then confirmed into the disposable library and locally traced.')

  await continueAgentOperation(cdpPort, providerEndpoint, session.id, batch.id)
  assert.equal(requestCount, 3, 'accepted create operation must send exactly one approved continuation')

  const trashedPlanA = await trashPlanThroughAgent(cdpPort, providerEndpoint, profile.id, 'QA Trash Read A')
  assert.equal(requestCount, 5, 'first confirmed trash operation must use one initial request and one approved continuation')
  const trashedPlanB = await trashPlanThroughAgent(cdpPort, providerEndpoint, profile.id, 'QA Trash Purge B')
  assert.equal(requestCount, 7, 'second confirmed trash operation must use one initial request and one approved continuation')
  assert.equal(trashedPlanA.plan.path, 'QA Trash Read A')
  assert.equal(trashedPlanB.plan.path, 'QA Trash Purge B')
  const listedTrash = assertOk(await invoke('trash:list'), 'List exact disposable trash entries')
  const trashEntryA = listedTrash.find((item) => item.name === 'QA Trash Read A')
  const trashEntryB = listedTrash.find((item) => item.name === 'QA Trash Purge B')
  assert.ok(trashEntryA, 'confirmed plan.trash must create its exact disposable entry')
  assert.ok(trashEntryB, 'second confirmed plan.trash must create a separate disposable entry')
  assert.notEqual(trashEntryA.id, trashEntryB.id)

  const agentTrashRead = await readTrashEntryThroughAgent(cdpPort, providerEndpoint, profile.id, trashEntryA, trashEntryB)
  assert.equal(requestCount, 9, 'single-entry Agent read must separately approve its initial and continuation request')
  assert.equal(agentTrashRead.entry.name, 'QA Trash Read A')
  console.log('PASS: Agent trash.list read only the explicitly granted single entry and did not expose its sibling.')

  const workspaceState = assertOk(await invoke('workspace-tabs:get'), 'Read current disposable library identity')
  assert.equal(typeof workspaceState.library_id, 'string')
  assert.notEqual(workspaceState.library_id, '')
  await verifyTrashDialogConflictRestore(workspaceState.library_id)
  await verifyTrashDialogPurgeCancellation(cdpPort, trashEntryB)
  assert.equal(requestCount, 9, 'local React trash interaction must not contact the provider')

  const restoreGrant = assertOk(await invoke('trash:entryTarget', { entry_id: trashEntryA.id }), 'Authorize exact disposable restore entry')
  const restorePreview = assertOk(await invoke('trash:restore-preview', {
    entry_id: trashEntryA.id, entry_target_token: restoreGrant.token
  }), 'Preview disposable trash restore')
  const restored = assertOk(await invoke('trash:restore-commit', { confirmation_token: restorePreview.confirmation_token }),
    'Commit disposable trash restore')
  assert.equal(restored.path, 'QA Trash Read A')
  const afterRestore = assertOk(await invoke('trash:list'), 'Verify restored entry left trash')
  assert.equal(afterRestore.some((item) => item.id === trashEntryA.id), false)
  const afterRestoreTree = assertOk(await invoke('storage:treeGetChildren', { parent_path: '' }), 'Verify restored plan returns to the tree')
  assert.equal(afterRestoreTree.some((item) => item.name === 'QA Trash Read A'), true)
  console.log('PASS: exact disposable entry restored through preview/commit and returned to the tree.')

  const purgeGrant = assertOk(await invoke('trash:entryTarget', { entry_id: trashEntryB.id }), 'Authorize exact disposable purge entry')
  const purgePreview = assertOk(await invoke('trash:purge-preview', {
    entry_id: trashEntryB.id, entry_target_token: purgeGrant.token
  }), 'Preview disposable trash purge')
  await startInvoke('trash:purge-commit', { confirmation_token: purgePreview.confirmation_token })
  await waitForTrustedConfirmation(cdpPort, {
    action: 'cancel', kind: 'trash-purge', expectedName: 'QA Trash Purge B', expectedTrashEntryId: trashEntryB.id
  })
  const cancelledPurge = await waitForStartedInvoke()
  assert.equal(cancelledPurge?.ok, false, 'cancelling trusted purge confirmation must fail closed')
  const afterPurgeCancel = assertOk(await invoke('trash:list'), 'Verify cancelled purge kept the entry')
  assert.equal(afterPurgeCancel.some((item) => item.id === trashEntryB.id), true)

  await startInvoke('trash:purge-commit', { confirmation_token: purgePreview.confirmation_token })
  await waitForTrustedConfirmation(cdpPort, {
    action: 'accept', kind: 'trash-purge', expectedName: 'QA Trash Purge B', expectedTrashEntryId: trashEntryB.id
  })
  const acceptedPurge = assertOk(await waitForStartedInvoke(), 'Accept exact purge in trusted main window')
  assert.equal(acceptedPurge.changed_plan_ids.length, 0)
  const afterAcceptedPurge = assertOk(await invoke('trash:list'), 'Verify accepted purge removed the entry')
  assert.equal(afterAcceptedPurge.some((item) => item.id === trashEntryB.id), false)
  const finalDisposableTree = assertOk(await invoke('storage:treeGetChildren', { parent_path: '' }), 'Verify final disposable library tree')
  assert.equal(finalDisposableTree.some((item) => item.name === 'QA Trash Read A'), true)
  assert.equal(finalDisposableTree.some((item) => item.name === 'QA Trash Purge B'), false)
  console.log('PASS: trusted purge cancellation preserved the entry; accepting the frozen exact-entry confirmation permanently removed it.')

  const beforeExtendedRuntimeExceptions = cdp.runtimeExceptionCount
  await verifyMovedAndDeletedTarget(workspaceState.library_id, profile.id)
  assert.equal(requestCount, 9, 'move/delete invalidation must leave the original nine-request baseline intact')
  await verifyPlanReadOutboundCancellation(cdpPort, providerEndpoint, profile.id, workspaceState.library_id)
  assert.equal(requestCount, 10, 'read-result outbound cancellation must add only its initial authorized request')
  await verifyReactFailedBatchRecovery(cdpPort, providerEndpoint, profile.id, workspaceState.library_id)
  assert.equal(requestCount, 11, 'failed batch and local recovery must add only the initial ordered-tool request')
  await verifyOrdinaryPlanDeleteReferenceUi(workspaceState.library_id)
  assert.equal(requestCount, 11, 'ordinary-plan deletion and link keep/replace UI must add no provider request')
  assert.equal(cdp.runtimeExceptionCount, beforeExtendedRuntimeExceptions, 'extended scenarios must not introduce an uncaught renderer JavaScript exception')
  console.log('PASS: extended target/read/batch scenarios did not increase main renderer Runtime.exceptionThrown count.')

  succeeded = true
  console.log(JSON.stringify({
    result: 'PASS',
    renderer: 'Electron production renderer and preload bridge',
    mainBundle: 'production built main bundle',
    provider: 'synthetic SSE bound to 127.0.0.1 only',
    providerRequestCount: requestCount,
    isolatedUserData: true,
    isolatedLibrary: true,
    interaction: 'CDP programmed renderer interaction; native IME/DPI/screen-reader experience not exercised',
    rendererRuntimeExceptionCount: cdp.runtimeExceptionCount,
    exercised: ['preview-cancel-accept', 'agent-trash-list-scope', 'react-trash-conflict-rename-resolve', 'react-purge-name-gate-main-cancel', 'trash-restore', 'trusted-purge-cancel-accept', 'target-move-delete-grant-invalidation-resolver', 'plan-read-exact-result-outbound-cancel', 'react-ordered-name-conflict-a2-only-recovery', 'react-ordinary-plan-context-edit-delete-key-link-keep-replace', 'react-reference-missing-replacement-zero-write', 'ipc-only-reference-restore'],
    runId
  }, null, 2))
}

async function cleanup() {
  await stopElectron().catch((error) => { console.error(`Electron shutdown verification failed: ${error.message}`); succeeded = false })
  if (provider) await new Promise((resolve) => provider.close(resolve))
  if (!succeeded) {
    console.error(`Failure fixture retained for inspection: ${runRoot}`)
    return
  }
  const rootInfo = fs.lstatSync(runRoot)
  const actualRoot = canonicalWindowsPath(fs.realpathSync(runRoot))
  const expectedParent = canonicalWindowsPath(os.tmpdir())
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || path.dirname(actualRoot) !== expectedParent || fs.readFileSync(markerPath, 'utf8') !== markerValue) {
    throw new Error('Refusing to remove a Temp path that does not match this QA run identity')
  }
  fs.rmSync(runRoot, { recursive: true, force: false })
  console.log('PASS: exact owned temporary fixture was removed after Electron exited.')
}

main()
  .catch((error) => {
    if (d1CloseDiagnostic) {
      console.error(JSON.stringify({
        result: 'FAIL', mode: 'd1-close-diagnostic',
        providerStarted: Boolean(provider), providerRequestCount: requestCount,
        rendererRuntimeExceptionCount: cdp?.runtimeExceptionCount ?? null, runId
      }))
    } else if (d3DeleteReferenceDiagnostic) {
      console.error(JSON.stringify({
        result: 'FAIL', mode: 'd3-delete-reference-diagnostic',
        providerStarted: Boolean(provider), providerRequestCount: requestCount,
        rendererRuntimeExceptionCount: cdp?.runtimeExceptionCount ?? null, runId
      }))
    }
    console.error(`Isolated Electron acceptance failed: ${error.stack || error.message}`.replaceAll(fakeKey, '[redacted]'))
    process.exitCode = 1
  })
  .finally(async () => { await cleanup() })
