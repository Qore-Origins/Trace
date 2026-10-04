import { randomUUID } from 'node:crypto'
import { promises as fs, readFileSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TraceBridge, TraceResult } from '../src/shared/ipc-contract'
import type { AgentApprovalRequestSnapshot, AgentMessageStatus, AgentOutboundPreview, AgentRequestEvent, AgentRequestIdentity } from '../src/shared/agent-types'
import type { AgentConversationService } from '../src/main/services/agent-conversation-service'
import type { StorageService } from '../src/main/services/storage-service'
import type { AgentTargetService } from '../src/main/services/agent-target-service'
import type { AgentProfileService } from '../src/main/services/agent-profile-service'
import type { AgentProviderTool } from '../src/main/services/agent-provider'
import { AGENT_MAX_MESSAGE_LENGTH } from '../src/main/services/agent-session-repository'

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>()
  const listeners = new Map<string, Set<(event: unknown, payload: unknown) => void>>()
  return {
    handlers, listeners,
    ipcMain: { handle: (name: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => handlers.set(name, handler), removeHandler: (name: string) => handlers.delete(name) },
    ipcRenderer: {
      invoke: (name: string, payload: unknown) => handlers.get(name)?.({}, payload),
      on: (name: string, listener: (event: unknown, payload: unknown) => void) => { const group = listeners.get(name) ?? new Set(); group.add(listener); listeners.set(name, group) },
      removeListener: (name: string, listener: (event: unknown, payload: unknown) => void) => listeners.get(name)?.delete(listener)
    },
    contextBridge: { exposeInMainWorld: (_key: string, value: unknown) => Reflect.set(window, 'trace', value) },
    dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
    safeStorage: { isAsyncEncryptionAvailable: vi.fn(async () => false), encryptStringAsync: vi.fn(async () => Buffer.from('encrypted-only')), decryptStringAsync: vi.fn(async () => ({ result: 'loopback-test-key', shouldReEncrypt: false })) }
  }
})
vi.mock('electron', () => electron)

let directory: string, root: string, profileId: string
let bridge: TraceBridge, server: Server, storage: StorageService, agentTargets: AgentTargetService, profiles: AgentProfileService
let dispose: () => void
let events: AgentRequestEvent[], bodies: string[], responses: ServerResponse[]
let respond: (response: ServerResponse) => void
let logs: ReturnType<typeof vi.fn>
let approvalSnapshots: AgentApprovalRequestSnapshot[]
let approveOutbound: (snapshot: AgentApprovalRequestSnapshot) => Promise<boolean>
const planReadTool: AgentProviderTool = { type: 'function', function: { name: 'plan.read', description: 'Read an explicitly granted plan.', parameters: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'], additionalProperties: false } } }
const chunk = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`
const end = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
function data<T>(result: TraceResult<T>): T { if (!result.ok) throw new Error(result.message); return result.data }
async function until(predicate: () => boolean) { await vi.waitFor(() => expect(predicate()).toBe(true), { timeout: 5000, interval: 10 }) }
async function createPreview(selections: { kind: 'plan'; path: string }[] = []): Promise<AgentOutboundPreview> {
  const session = data(await bridge.invoke('agent:session:create', { title: '会话', profileId }))
  return data(await bridge.invoke('agent:preview:create', { sessionId: session.id, message: '已批准的问题', selections }))
}
async function send(preview: AgentOutboundPreview): Promise<AgentRequestIdentity> {
  return data(await bridge.invoke('agent:request:send', { token: preview.token, sessionId: preview.sessionId }))
}
async function terminal(identity: AgentRequestIdentity) {
  await until(() => events.some((event) => event.type === 'terminal' && event.requestId === identity.requestId))
  return events.find((event) => event.type === 'terminal' && event.requestId === identity.requestId)!
}
async function plan(content: string) {
  await fs.mkdir(join(root, 'one'), { recursive: true })
  await fs.writeFile(join(root, 'one', 'plan.json'), JSON.stringify({ format_version: '1', created_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-02T00:00:00Z', components: [{ id: 'note', type: 'note', payload: { content, created_at: '2026-10-02T00:00:00Z' } }] }))
}
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); electron.handlers.clear(); electron.listeners.clear()
  // Only the Electron exposeInMainWorld boundary needs a window; keep Node's real fetch.
  vi.stubGlobal('window', {})
  electron.safeStorage.isAsyncEncryptionAvailable.mockResolvedValue(false)
  events = []; bodies = []; responses = []; logs = vi.fn(); approvalSnapshots = []
  approveOutbound = async (snapshot) => { approvalSnapshots.push(snapshot); return true }
  respond = (response) => response.end(chunk('第一段') + chunk('第二段') + end)
  server = createServer(async (request, response) => {
    const fragments: Buffer[] = []
    for await (const fragment of request) fragments.push(Buffer.from(fragment))
    bodies.push(Buffer.concat(fragments).toString('utf8')); responses.push(response)
    response.setHeader('content-type', 'text/event-stream'); respond(response)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('loopback port missing')
  directory = await fs.mkdtemp(join(tmpdir(), 'trace-agent-request-')); root = join(directory, 'library'); await fs.mkdir(root)
  const [{ registerIpc }, { StorageService }, { PlanRepository }, { AgentTargetService }, { AgentProfileService }] = await Promise.all([import('../src/main/ipc/register'), import('../src/main/services/storage-service'), import('../src/main/services/plan-repository'), import('../src/main/services/agent-target-service'), import('../src/main/services/agent-profile-service')])
  const repository = new PlanRepository()
  await repository.ensureLibraryRoot(root)
  storage = new StorageService(repository); storage.setRoot(root)
  agentTargets = new AgentTargetService(storage)
  profiles = new AgentProfileService(directory)
  dispose = registerIpc({ storage, agentUserDataDir: directory, agentProfiles: profiles, agentTargetService: agentTargets, agentToolDefinitions: () => [planReadTool], requestAgentApproval: (snapshot: AgentApprovalRequestSnapshot) => approveOutbound(snapshot), getWindow: () => ({ webContents: { isDestroyed: () => false, send: (name: string, payload: unknown) => electron.listeners.get(name)?.forEach((listener) => listener({}, payload)) } }), log: logs } as unknown as Parameters<typeof registerIpc>[0])
  await import('../src/preload/index'); bridge = window.trace
  bridge.on('trace:agent-request', (event) => events.push(event))
  profileId = data(await bridge.invoke('agent:profile:create', { name: '本机服务', endpoint: `http://127.0.0.1:${address.port}/v1`, model: 'test-model' })).id
  data(await bridge.invoke('agent:key:set', { id: profileId, key: 'loopback-test-key' }))
})
afterEach(async () => {
  dispose?.(); responses.forEach((response) => response.destroy()); server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); await fs.rm(directory, { recursive: true, force: true })
})

describe('agent request public IPC and loopback SSE', () => {
  it('requires a separately confirmed outbound snapshot before direct send IPC can fetch', async () => {
    approveOutbound = async (snapshot) => { approvalSnapshots.push(snapshot); return false }
    const preview = await createPreview()
    const result = await bridge.invoke('agent:request:send', { token: preview.token, sessionId: preview.sessionId })
    expect(approvalSnapshots).toHaveLength(1)
    expect(approvalSnapshots[0]).toMatchObject({
      endpoint: preview.target.endpoint.replace(/\/$/, '') + '/chat/completions',
      model: preview.target.model,
      serializedBody: JSON.stringify({ model: preview.target.model, messages: preview.messages, stream: true })
    })
    expect(approvalSnapshots[0]).toBeInstanceOf(Object)
    expect(result.ok).toBe(false)
    expect(bodies).toEqual([])
    expect(data(await bridge.invoke('agent:session:read', { id: preview.sessionId })).messages).toEqual([])
    expect(JSON.stringify(approvalSnapshots) + JSON.stringify(logs.mock.calls)).not.toContain('loopback-test-key')
  })

  it('waits for trusted confirmation and sends the identical frozen request body', async () => {
    let confirm!: (approved: boolean) => void
    let entered!: () => void
    const enteredApproval = new Promise<void>((resolve) => { entered = resolve })
    const decision = new Promise<boolean>((resolve) => { confirm = resolve })
    approveOutbound = async (snapshot) => { approvalSnapshots.push(snapshot); entered(); return decision }
    const preview = await createPreview()
    const sending = bridge.invoke('agent:request:send', { token: preview.token, sessionId: preview.sessionId })
    await enteredApproval

    expect(bodies).toEqual([])
    expect(data(await bridge.invoke('agent:session:read', { id: preview.sessionId })).messages).toEqual([])
    expect(approvalSnapshots[0]).toEqual({
      endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/chat/completions`,
      model: preview.target.model,
      serializedBody: JSON.stringify({ model: preview.target.model, messages: preview.messages, stream: true })
    })
    expect(Object.isFrozen(approvalSnapshots[0])).toBe(true)
    confirm(true)
    const result = await sending
    const identity = data(result)
    await terminal(identity)
    expect(bodies).toEqual([approvalSnapshots[0].serializedBody])
    expect(JSON.stringify(approvalSnapshots)).not.toContain('loopback-test-key')
  })

  it('sends exactly the approved preview without tools and persists every displayed fragment', async () => {
    await plan('批准的上下文')
    const preview = await createPreview([{ kind: 'plan', path: 'one' }])
    const expected = JSON.stringify({ model: preview.target.model, messages: preview.messages, stream: true })
    preview.messages[0].content = 'renderer-tampering'
    let persistedWhenShown = ''
    const persistenceMatches: boolean[] = []
    bridge.on('trace:agent-request', (event) => {
      if (event.type !== 'delta') return
      persistedWhenShown += event.text
      const session = JSON.parse(readFileSync(join(directory, 'agent-sessions', `${event.sessionId}.json`), 'utf8'))
      persistenceMatches.push(session.messages.find((message: { id: string }) => message.id === event.assistantId).content === persistedWhenShown)
    })
    const identity = await send(preview)
    expect(await terminal(identity)).toEqual({ ...identity, type: 'terminal', status: 'complete', marker: null, errorCategory: null })
    expect(bodies).toEqual([expected])
    expect(approvalSnapshots).toHaveLength(1)
    expect(approvalSnapshots[0].serializedBody).toBe(bodies[0])
    expect(approvalSnapshots[0].endpoint).toBe(`http://127.0.0.1:${(server.address() as { port: number }).port}/v1/chat/completions`)
    for (const event of events) expect(event).toMatchObject(identity)
    const shown = events.filter((event) => event.type === 'delta').map((event) => event.type === 'delta' ? event.text : '').join('')
    const session = data(await bridge.invoke('agent:session:read', { id: identity.sessionId }))
    expect(session.messages[1]).toMatchObject({ id: identity.assistantId, requestId: identity.requestId, content: shown, status: 'complete' })
    expect(shown).toBe('第一段第二段')
    expect(persistenceMatches).toEqual([true, true])
    expect(JSON.stringify(events) + JSON.stringify(session) + JSON.stringify(logs.mock.calls)).not.toContain('loopback-test-key')
  })
  it('sends native tools only after a passed capability and persists the complete call batch', async () => {
    await profiles.recordCapability(profileId, { status: 'passed', testedAt: new Date().toISOString(), errorCategory: null })
    respond = (response) => response.end('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"plan.read","arguments":"{\\"ref\\":\\"r1\\"}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n')
    const preview = await createPreview()
    expect(preview.tools).toEqual([planReadTool])
    expect(preview.toolChoice).toBe('auto')
    const expected = JSON.stringify({ model: preview.target.model, messages: preview.messages, stream: true, tools: preview.tools, tool_choice: 'auto' })
    const finalPreviewMessage = preview.messages.at(-1)
    if (finalPreviewMessage) finalPreviewMessage.content = 'renderer-tampering'
    if (preview.tools?.[0]) preview.tools[0].function.description = 'renderer-tampering'
    const identity = await send(preview)
    expect(await terminal(identity)).toMatchObject({ status: 'complete', errorCategory: null })
    expect(bodies).toEqual([expected])
    expect(approvalSnapshots).toHaveLength(1)
    expect(approvalSnapshots[0].serializedBody).toBe(bodies[0])
    expect(approvalSnapshots[0].serializedBody).toBe(expected)
    expect(approvalSnapshots[0].serializedBody).not.toContain('loopback-test-key')
    expect(bodies[0]).not.toContain('userMessageId')
    const saved = data(await bridge.invoke('agent:session:read', { id: identity.sessionId }))
    expect(saved.messages[1]).toMatchObject({ status: 'complete', toolCalls: [{ id: 'call_1', type: 'function', function: { name: 'plan.read', arguments: '{"ref":"r1"}' } }] })
    expect(saved.requests[0]).toMatchObject({ toolRounds: 1, toolCallCount: 1 })
  })
  it('rejects cancelled, malformed, missing and reused tokens with no additional HTTP dispatch', async () => {
    const cancelled = await createPreview(); data(await bridge.invoke('agent:preview:cancel', { token: cancelled.token }))
    const raw = bridge as unknown as { invoke(name: string, payload: unknown): Promise<TraceResult<unknown>> }
    for (const payload of [{ token: cancelled.token, sessionId: cancelled.sessionId }, { token: randomUUID(), sessionId: cancelled.sessionId }, { token: 'invalid', sessionId: cancelled.sessionId }, { token: cancelled.token, sessionId: cancelled.sessionId, messages: [] }, null]) expect((await raw.invoke('agent:request:send', payload)).ok).toBe(false)
    expect(bodies).toEqual([])
    const preview = await createPreview(); const identity = await send(preview); await terminal(identity)
    expect((await bridge.invoke('agent:request:send', { token: preview.token, sessionId: preview.sessionId })).ok).toBe(false)
    expect(bodies).toHaveLength(1)
  })
  it('does not bind a canceled preview and binds the confirmed grant only to its persisted user message', async () => {
    await plan('grant-bound-plan')
    const session = data(await bridge.invoke('agent:session:create', { title: '授权绑定', profileId }))
    const issued = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'plan', path: 'one' }] }))
    const target = issued.targets[0]
    const canceled = data(await bridge.invoke('agent:preview:create', { sessionId: session.id, message: '读取指定计划', selections: [], targetGrantSetId: issued.id, targetRefs: [target.ref] }))
    expect(canceled.targets).toEqual([target])
    expect(canceled.messages.at(-2)?.content).toContain(target.ref)
    expect(canceled).not.toHaveProperty('userMessageId')
    expect(canceled).not.toHaveProperty('targetGrantSetId')
    data(await bridge.invoke('agent:preview:cancel', { token: canceled.token }))
    await expect(agentTargets.resolveGrantForMessage({ setId: issued.id, ref: target.ref }, randomUUID()))
      .rejects.toMatchObject({ code: 22 })
    expect(bodies).toEqual([])

    const approved = data(await bridge.invoke('agent:preview:create', { sessionId: session.id, message: '读取指定计划', selections: [], targetGrantSetId: issued.id, targetRefs: [target.ref] }))
    const identity = await send(approved)
    await terminal(identity)
    const saved = data(await bridge.invoke('agent:session:read', { id: session.id }))
    const user = saved.messages.find((message) => message.role === 'user')!
    expect(user).toMatchObject({ status: 'complete', content: '读取指定计划' })
    await expect(agentTargets.resolveGrantForMessage({ setId: issued.id, ref: target.ref }, user.id))
      .resolves.toMatchObject({ kind: 'plan', path: 'one' })
    expect(JSON.parse(bodies[0]).messages).toContainEqual(expect.objectContaining({ role: 'system', content: expect.stringContaining(target.ref) }))

    const reuse = data(await bridge.invoke('agent:preview:create', { sessionId: session.id, message: '尝试复用授权', selections: [], targetGrantSetId: issued.id, targetRefs: [target.ref] }))
    expect((await bridge.invoke('agent:request:send', { token: reuse.token, sessionId: session.id })).ok).toBe(false)
    expect(bodies).toHaveLength(1)
  })
  it.each(['session', 'profile', 'source', 'capability', 'key-set', 'key-remove', 'key-add', 'missing-key'] as const)('rejects stale %s authorization before dispatch', async (change) => {
    await plan('before')
    if (change === 'missing-key' || change === 'key-add') data(await bridge.invoke('agent:key:remove', { id: profileId }))
    const preview = await createPreview([{ kind: 'plan', path: 'one' }])
    if (change === 'session') data(await bridge.invoke('agent:session:update', { id: preview.sessionId, title: 'changed', profileId }))
    if (change === 'profile') data(await bridge.invoke('agent:profile:update', { ...preview.target, model: 'changed' }))
    if (change === 'source') await plan('after')
    if (change === 'capability') await profiles.recordCapability(profileId, { status: 'passed', testedAt: new Date().toISOString(), errorCategory: null })
    if (change === 'key-set' || change === 'key-add') data(await bridge.invoke('agent:key:set', { id: profileId, key: 'replacement-key' }))
    if (change === 'key-remove') data(await bridge.invoke('agent:key:remove', { id: profileId }))
    expect((await bridge.invoke('agent:request:send', { token: preview.token, sessionId: preview.sessionId })).ok).toBe(false)
    expect(bodies).toEqual([])
  })
  it.each(['session', 'source', 'profile'] as const)('rechecks %s after asynchronous OS credential resolution immediately before dispatch', async (change) => {
    electron.safeStorage.isAsyncEncryptionAvailable.mockResolvedValue(true)
    data(await bridge.invoke('agent:key:set', { id: profileId, key: 'loopback-test-key' }))
    await plan('before')
    const preview = await createPreview([{ kind: 'plan', path: 'one' }])
    let release!: () => void, entered!: () => void
    const waiting = new Promise<void>((resolve) => { entered = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    electron.safeStorage.decryptStringAsync.mockImplementationOnce(async () => { entered(); await gate; return { result: 'loopback-test-key', shouldReEncrypt: false } })
    const sending = bridge.invoke('agent:request:send', { sessionId: preview.sessionId, token: preview.token })
    await waiting
    if (change === 'source') await plan('after')
    if (change === 'session') {
      const file = join(directory, 'agent-sessions', `${preview.sessionId}.json`)
      const saved = JSON.parse(await fs.readFile(file, 'utf8')); saved.revision += 1; saved.title = 'changed'
      await fs.writeFile(file, JSON.stringify(saved))
    }
    if (change === 'profile') {
      const file = join(directory, 'agent-profiles.json')
      const saved = JSON.parse(await fs.readFile(file, 'utf8')); saved.profiles[0].model = 'changed-during-decrypt'
      await fs.writeFile(file, JSON.stringify(saved))
    }
    release()
    expect((await sending).ok).toBe(false)
    expect(bodies).toEqual([])
    expect(data(await bridge.invoke('agent:session:read', { id: preview.sessionId })).messages).toEqual([])
  })
  it('rejects a preview that expires while credentials are being resolved', async () => {
    electron.safeStorage.isAsyncEncryptionAvailable.mockResolvedValue(true)
    data(await bridge.invoke('agent:key:set', { id: profileId, key: 'loopback-test-key' }))
    vi.useFakeTimers({ toFake: ['Date'] })
    const preview = await createPreview()
    electron.safeStorage.decryptStringAsync.mockImplementationOnce(async () => { vi.setSystemTime(Date.parse(preview.expiresAt) + 1); return { result: 'loopback-test-key', shouldReEncrypt: false } })
    expect((await bridge.invoke('agent:request:send', { sessionId: preview.sessionId, token: preview.token })).ok).toBe(false)
    vi.useRealTimers()
    expect(bodies).toEqual([])
  })
  it('rejects request/session mismatch, concurrent same-session sends, and wrong-request cancellation', async () => {
    respond = (response) => { response.write(chunk('prefix')) }
    const first = await createPreview(), other = await createPreview()
    expect((await bridge.invoke('agent:request:send', { token: first.token, sessionId: other.sessionId })).ok).toBe(false)
    const fresh = data(await bridge.invoke('agent:preview:create', { sessionId: first.sessionId, message: 'fresh', selections: [] }))
    const concurrent = data(await bridge.invoke('agent:preview:create', { sessionId: first.sessionId, message: 'other', selections: [] }))
    const identity = await send(fresh)
    await until(() => events.some((event) => event.type === 'delta'))
    expect((await bridge.invoke('agent:request:send', { token: concurrent.token, sessionId: first.sessionId })).ok).toBe(false)
    for (const payload of [{ sessionId: other.sessionId, requestId: identity.requestId }, { sessionId: identity.sessionId, requestId: randomUUID() }]) expect((await bridge.invoke('agent:request:cancel', payload)).ok).toBe(false)
    expect((await bridge.invoke('agent:session:update', { id: identity.sessionId, title: 'race', profileId })).ok).toBe(false)
    expect((await bridge.invoke('agent:session:delete', { id: identity.sessionId })).ok).toBe(false)
    data(await bridge.invoke('agent:request:cancel', { sessionId: identity.sessionId, requestId: identity.requestId }))
    expect(await terminal(identity)).toMatchObject({ status: 'user-interrupted', marker: '【用户中断】', errorCategory: null })
    expect(data(await bridge.invoke('agent:session:read', { id: identity.sessionId })).messages[1]).toMatchObject({ content: 'prefix', status: 'user-interrupted' })
    expect(data(await bridge.invoke('agent:session:read', { id: other.sessionId })).messages).toEqual([])
    await until(() => responses[0].destroyed)
    expect(bodies).toHaveLength(1)
  })
  it.each(['complete', 'error-interrupted', 'user-interrupted'] as const)('rejects cancellation after %s finalization is claimed but real terminal persistence is pending', async (status) => {
    const { AgentConversationService } = await import('../src/main/services/agent-conversation-service')
    const original = AgentConversationService.prototype.settleAssistant
    let release!: () => void, entered!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const pending = new Promise<void>((resolve) => { entered = resolve })
    // Control scheduling only: every settlement still calls the original service and
    // writes the real temporary session through the existing repository/filesystem.
    vi.spyOn(AgentConversationService.prototype, 'settleAssistant').mockImplementation(function (this: AgentConversationService, ...args: Parameters<AgentConversationService['settleAssistant']>) {
      if (args[3] !== status) return original.apply(this, args)
      entered()
      return gate.then(() => original.apply(this, args))
    })
    respond = (response) => {
      response.write(chunk('persisted-prefix'))
      if (status === 'user-interrupted') return
      response.end(status === 'complete' ? end : 'data: malformed\n\n')
    }
    const identity = await send(await createPreview())
    let firstCancellation: TraceResult<null> | undefined
    if (status === 'user-interrupted') {
      await until(() => events.some((event) => event.type === 'delta' && event.requestId === identity.requestId))
      firstCancellation = await bridge.invoke('agent:request:cancel', { sessionId: identity.sessionId, requestId: identity.requestId })
    }
    await pending
    const before = data(await bridge.invoke('agent:session:read', { id: identity.sessionId })).messages[1]
    expect(before).toMatchObject({ content: 'persisted-prefix', status: 'streaming' })
    expect(events.filter((event) => event.type === 'terminal' && event.requestId === identity.requestId)).toEqual([])
    const lateCancellation = await bridge.invoke('agent:request:cancel', { sessionId: identity.sessionId, requestId: identity.requestId })
    release()
    const final = await terminal(identity)
    expect(lateCancellation.ok).toBe(false)
    if (firstCancellation) expect(firstCancellation.ok).toBe(true)
    const marker = status === 'complete' ? null : status === 'user-interrupted' ? '【用户中断】' : '【异常中断】'
    expect(final).toMatchObject({ ...identity, status, marker, errorCategory: status === 'error-interrupted' ? 'protocol' : null })
    expect(data(await bridge.invoke('agent:session:read', { id: identity.sessionId })).messages[1]).toMatchObject({ content: 'persisted-prefix', status: status as AgentMessageStatus })
    expect(events.filter((event) => event.type === 'terminal' && event.requestId === identity.requestId)).toHaveLength(1)
    expect((await bridge.invoke('agent:request:cancel', { sessionId: identity.sessionId, requestId: identity.requestId })).ok).toBe(false)
    expect(bodies).toHaveLength(1)
  })
  it('isolates simultaneous sessions and consumes a concurrently replayed token only once', async () => {
    const first = await createPreview(), second = await createPreview()
    const results = await Promise.all([
      bridge.invoke('agent:request:send', { token: first.token, sessionId: first.sessionId }),
      bridge.invoke('agent:request:send', { token: first.token, sessionId: first.sessionId }),
      bridge.invoke('agent:request:send', { token: second.token, sessionId: second.sessionId })
    ])
    expect(results.map((result) => result.ok)).toEqual([true, false, true])
    for (const identity of [data(results[0]), data(results[2])]) {
      expect(await terminal(identity)).toMatchObject({ status: 'complete' })
      const saved = data(await bridge.invoke('agent:session:read', { id: identity.sessionId }))
      expect(saved.messages).toHaveLength(2)
      expect(saved.messages[1]).toMatchObject({ id: identity.assistantId, requestId: identity.requestId, content: '第一段第二段' })
    }
    expect(bodies).toHaveLength(2)
  })
  it.each(['protocol', 'network', 'http', 'tools'] as const)('persists %s failure as abnormal interruption without retry', async (failure) => {
    respond = (response) => {
      if (failure === 'http') { response.writeHead(503); response.end('private-error-body'); return }
      response.write(chunk('accepted-prefix'))
      if (failure === 'network') { response.flushHeaders(); setTimeout(() => response.destroy(), 30); return }
      if (failure === 'tools') response.end('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call","type":"function","function":{"name":"delete_plan","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n')
      else response.end('data: malformed-private-error\n\n')
    }
    const identity = await send(await createPreview())
    expect(await terminal(identity)).toMatchObject({ status: 'error-interrupted', marker: '【异常中断】', errorCategory: failure === 'tools' ? 'protocol' : failure })
    const stored = data(await bridge.invoke('agent:session:read', { id: identity.sessionId })).messages[1]
    expect(stored).toMatchObject({ content: failure === 'http' ? '' : 'accepted-prefix', status: 'error-interrupted' })
    expect(JSON.stringify(events)).not.toMatch(/private-error|delete_plan/)
    expect(bodies).toHaveLength(1)
    expect(JSON.parse(bodies[0])).not.toHaveProperty('tools')
  })
  it('never emits a fragment crossing the persisted UTF-16 limit and retains the bounded prefix', async () => {
    const fragment = 'x'.repeat(32 * 1024), count = AGENT_MAX_MESSAGE_LENGTH / fragment.length
    respond = (response) => response.end(Array.from({ length: count }, () => chunk(fragment)).join('') + chunk('crosses-boundary') + end)
    const identity = await send(await createPreview())
    expect(await terminal(identity)).toMatchObject({ status: 'error-interrupted', errorCategory: 'limit' })
    const shown = events.filter((event) => event.type === 'delta').map((event) => event.type === 'delta' ? event.text : '').join('')
    expect(shown.length).toBe(AGENT_MAX_MESSAGE_LENGTH); expect(shown).not.toContain('crosses-boundary')
    expect(data(await bridge.invoke('agent:session:read', { id: identity.sessionId })).messages[1]).toMatchObject({ content: shown, status: 'error-interrupted' })
  })
  it('registers request IPC without decrypting credentials or invoking the provider during startup', async () => {
    expect(electron.handlers.has('agent:request:send')).toBe(true)
    expect(electron.safeStorage.decryptStringAsync).not.toHaveBeenCalled()
    expect(bodies).toEqual([])
    await expect(fs.access(join(directory, 'agent-sessions'))).rejects.toThrow()
  })
})
