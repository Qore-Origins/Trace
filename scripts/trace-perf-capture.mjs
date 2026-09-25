import { cpus, release, totalmem } from 'node:os'
import { dirname, resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

const DEFAULT_PORT = 9222
const TREE_FRAME_SAMPLE_MS = 1500

function argumentValue(args, name, fallback) {
  const index = args.indexOf(name)
  return index === -1 ? fallback : args[index + 1] ?? fallback
}

function percentile(values, fraction) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1)
  return sorted[index]
}

function summarize(values) {
  if (values.length === 0) return { count: 0, p50Ms: null, p95Ms: null, minMs: null, maxMs: null }
  return {
    count: values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    minMs: Math.min(...values),
    maxMs: Math.max(...values)
  }
}

class CdpClient {
  constructor(webSocketUrl) {
    this.nextId = 0
    this.pending = new Map()
    this.socket = new WebSocket(webSocketUrl)
    this.opened = new Promise((resolveOpen, rejectOpen) => {
      this.socket.addEventListener('open', () => resolveOpen(), { once: true })
      this.socket.addEventListener('error', () => rejectOpen(new Error('CDP WebSocket connection failed')), { once: true })
    })
    this.socket.addEventListener('message', (event) => this.receive(String(event.data)))
    this.socket.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('CDP WebSocket closed'))
      this.pending.clear()
    })
  }

  receive(raw) {
    const message = JSON.parse(raw)
    if (message.id === undefined) return
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    if (message.error) pending.reject(new Error(message.error.message))
    else pending.resolve(message.result)
  }

  async send(method, params = {}) {
    await this.opened
    const id = ++this.nextId
    return new Promise((resolveResponse, rejectResponse) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        rejectResponse(new Error(`CDP request timed out: ${method}`))
      }, 15000)
      this.pending.set(id, {
        resolve: (result) => {
          clearTimeout(timeout)
          resolveResponse(result)
        },
        reject: (error) => {
          clearTimeout(timeout)
          rejectResponse(error)
        }
      })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    this.socket.close()
  }
}

async function fetchJson(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`DevTools endpoint returned HTTP ${response.status}: ${url}`)
  return response.json()
}

async function waitFor(evaluate, description, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  let lastValue = null
  while (Date.now() < deadline) {
    try {
      lastValue = await evaluate()
      if (lastValue) return lastValue
    } catch (error) {
      if (!(error instanceof Error) || !/context|execution/i.test(error.message)) throw error
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 75))
  }
  throw new Error(`Timed out waiting for ${description}; last value: ${JSON.stringify(lastValue)}`)
}

function metricSummary(measures) {
  const grouped = new Map()
  for (const measure of measures) {
    const detail = measure.detail && typeof measure.detail === 'object' ? measure.detail : {}
    const key = `${measure.name}|${detail.taskCount ?? ''}`
    const entries = grouped.get(key) ?? { name: measure.name, taskCount: detail.taskCount ?? null, durations: [] }
    entries.durations.push(measure.duration)
    grouped.set(key, entries)
  }
  return [...grouped.values()].map((entry) => ({ ...entry, ...summarize(entry.durations), durations: entry.durations }))
}

async function collectSnapshot(evaluate) {
  const runtime = await evaluate(`(() => {
    const measures = performance.getEntriesByType('measure')
      .filter((entry) => entry.name.startsWith('trace:'))
      .map((entry) => ({ name: entry.name, duration: entry.duration, detail: entry.detail ?? null }));
    const marks = performance.getEntriesByType('mark')
      .filter((entry) => entry.name.startsWith('trace:'))
      .map((entry) => ({ name: entry.name, startTime: entry.startTime }));
    const navigation = performance.getEntriesByType('navigation')[0];
    const paint = performance.getEntriesByType('paint').map((entry) => ({ name: entry.name, startTime: entry.startTime }));
    const memory = performance.memory ? {
      usedJsHeapBytes: performance.memory.usedJSHeapSize,
      totalJsHeapBytes: performance.memory.totalJSHeapSize,
      heapLimitBytes: performance.memory.jsHeapSizeLimit
    } : null;
    const taskCounts = [...document.querySelectorAll('.task-row')].reduce((counts, row) => {
      const card = row.closest('[data-component-id]');
      const key = card?.getAttribute('data-component-id') ?? 'unknown';
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {});
    const frames = window.__tracePerfFrameSample;
    return {
      capturedAt: new Date().toISOString(),
      title: document.title,
      href: location.href,
      timeOrigin: performance.timeOrigin,
      appInteractiveMark: marks.find((mark) => mark.name === 'trace:app-interactive') ?? null,
      navigation: navigation ? {
        domContentLoadedMs: navigation.domContentLoadedEventEnd,
        loadEventMs: navigation.loadEventEnd,
        responseMs: navigation.responseEnd - navigation.requestStart
      } : null,
      paint,
      memory,
      counts: {
        treeRows: document.querySelectorAll('.tree-row').length,
        taskRows: document.querySelectorAll('.task-row').length,
        taskCards: Object.keys(taskCounts).length,
        noteCards: document.querySelectorAll('.note-static, .note-muya-host').length,
        diagrams: document.querySelectorAll('.mu-diagram-preview svg, .mu-diagram-preview img').length,
        diagramErrors: document.querySelectorAll('.mu-diagram-error').length
      },
      taskCounts,
      marks,
      measures,
      frameSample: frames?.done ? frames.timestamps : null
    };
  })()`)

  const frameIntervals = runtime.frameSample?.slice(1).map((time, index) => time - runtime.frameSample[index]) ?? []
  const frames = frameIntervals.length > 0 ? {
    sampledFrames: frameIntervals.length,
    p50IntervalMs: percentile(frameIntervals, 0.5),
    p95IntervalMs: percentile(frameIntervals, 0.95),
    estimatedP50Fps: 1000 / percentile(frameIntervals, 0.5),
    droppedFramesOver20Ms: frameIntervals.filter((interval) => interval > 20).length
  } : null

  return {
    ...runtime,
    frameSample: undefined,
    treeFrames: frames,
    traceMetricSummary: metricSummary(runtime.measures)
  }
}

async function exerciseApp(evaluate, skipTreeAnimation, verifyStaticDiagrams) {
  await waitFor(() => evaluate(`Boolean(document.querySelector('.app-shell'))`), 'workspace application shell')

  if (!skipTreeAnimation) {
    const rootExpanded = await evaluate(`(() => {
      const rootLabel = document.querySelector('.tree-root-label');
      const rootRow = rootLabel?.closest('.tree-row');
      const switcher = rootRow?.querySelector('.tree-switcher') ?? document.querySelector('.tree-switcher');
      return Boolean(switcher?.classList.contains('open'));
    })()`)

    if (rootExpanded) {
      await evaluate(`(() => {
        const rootLabel = document.querySelector('.tree-root-label');
        const switcher = rootLabel?.closest('.tree-row')?.querySelector('.tree-switcher') ?? document.querySelector('.tree-switcher.open');
        switcher?.click();
        return true;
      })()`)
      await waitFor(() => evaluate(`document.querySelectorAll('.tree-node-title').length === 0`), 'root collapse before expansion sample')
    }

    await evaluate(`(() => {
      const rootLabel = document.querySelector('.tree-root-label');
      const switcher = rootLabel?.closest('.tree-row')?.querySelector('.tree-switcher') ?? document.querySelector('.tree-switcher');
      if (!switcher) throw new Error('Could not find the plan-library tree switcher');
      window.__tracePerfFrameSample = { timestamps: [], done: false };
      const sample = window.__tracePerfFrameSample;
      const tick = (time) => {
        if (sample.timestamps.length === 0) sample.startTime = time;
        sample.timestamps.push(time);
        if (time - sample.startTime >= ${TREE_FRAME_SAMPLE_MS}) sample.done = true;
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      switcher.click();
      return true;
    })()`)
    await waitFor(
      () => evaluate(`window.__tracePerfFrameSample?.done === true`),
      'tree animation frame sample',
      Math.max(TREE_FRAME_SAMPLE_MS + 5000, 45000)
    )
  }

  await waitFor(() => evaluate(`[...document.querySelectorAll('.tree-node-title')].some((node) => node.textContent.includes('Perf Plan 0001'))`), 'first synthetic plan in tree')
  const firstPlanOpened = await evaluate(`(() => {
    const node = [...document.querySelectorAll('.tree-node-title')].find((item) => item.textContent.includes('Perf Plan 0001'));
    if (!node) return false;
    node.click();
    return true;
  })()`)
  if (!firstPlanOpened) throw new Error('Could not open Perf Plan 0001')
  const expectedPlanContent = verifyStaticDiagrams ? 'Static diagram regression' : 'Muya performance sample'
  await waitFor(
    () => evaluate(`document.querySelector('.ws-content')?.textContent.includes(${JSON.stringify(expectedPlanContent)})`),
    'first synthetic plan contents'
  )

  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }))`)
  await waitFor(() => evaluate(`Boolean(document.querySelector('.o-input'))`), 'search overlay')
  await evaluate(`(() => {
    const input = document.querySelector('.o-input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, 'Performance sample');
    input?.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Performance sample' }));
    return true;
  })()`)
  await waitFor(() => evaluate(`document.querySelectorAll('.o-item').length > 0`), 'search result for synthetic sample', 20000)
  await evaluate(`document.querySelector('.o-input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)

  const beforeActivationTimeOrigin = await evaluate(`performance.timeOrigin`)
  const noteActivated = await evaluate(`(() => {
    const note = document.querySelector('.note-static');
    if (!note) return false;
    note.click();
    return true;
  })()`)
  if (!noteActivated) throw new Error('Synthetic plan did not expose a static NoteCard')

  let activationOutcome = null
  await waitFor(async () => {
    activationOutcome = await evaluate(`(() => ({
      timeOrigin: performance.timeOrigin,
      editable: Boolean(document.querySelector('.note-muya-host [contenteditable="true"]')),
      loading: Boolean(document.querySelector('.note-muya-loading')),
      fallback: Boolean(document.querySelector('.note-muya-fallback'))
    }))()`)
    return activationOutcome.editable || activationOutcome.fallback || activationOutcome.timeOrigin !== beforeActivationTimeOrigin
  }, 'first Muya activation result')

  if (!activationOutcome.editable) {
    throw new Error(`First Muya activation did not remain editable: ${JSON.stringify(activationOutcome)}`)
  }

  await waitFor(() => evaluate(`document.querySelectorAll('.mu-diagram-preview svg, .mu-diagram-preview img, .mu-diagram-error').length > 0`), 'local Mermaid render or explicit diagram error', 20000)
  let staticDiagramSmoke = null
  if (verifyStaticDiagrams) {
    await evaluate(`(() => {
      const rootLabel = document.querySelector('.tree-root-label');
      if (!rootLabel) throw new Error('Could not find the plan-library root label');
      rootLabel.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      rootLabel.focus();
      return true;
    })()`)
    await waitFor(() => evaluate(`Boolean(document.querySelector('.note-static'))`), 'NoteCard inactive reading view')
    staticDiagramSmoke = await waitFor(() => evaluate(`(() => {
      const diagrams = [...document.querySelectorAll('.note-static .note-diagram')];
      const states = Object.fromEntries(diagrams.map((diagram) => [diagram.dataset.diagramLanguage, diagram.dataset.diagramState]));
      const readyLanguages = ['mermaid', 'vega-lite', 'flowchart', 'sequence'];
      const ready = readyLanguages.every((language) => states[language] === 'ready');
      const plantumlFallback = states.plantuml === 'plantuml-required';
      const plainCodePreserved = Boolean(document.querySelector('.note-static pre[data-lang="typescript"] code'));
      if (!ready || !plantumlFallback || !plainCodePreserved) return null;
      return {
        states,
        renderedSvgCount: document.querySelectorAll('.note-static .note-diagram-preview svg').length,
        plainCodePreserved
      };
    })()`), 'all five inactive-view diagram outcomes and ordinary code fallback', 60000)
  }
  return {
    firstActivation: {
      stayedInSameRenderer: activationOutcome.timeOrigin === beforeActivationTimeOrigin,
      editable: activationOutcome.editable,
      loading: activationOutcome.loading,
      fallback: activationOutcome.fallback
    },
    staticDiagramSmoke
  }
}

async function main() {
  const args = process.argv.slice(2)
  const port = Number(argumentValue(args, '--port', DEFAULT_PORT))
  const baseUrl = `http://127.0.0.1:${port}`
  const targets = await fetchJson(`${baseUrl}/json/list`)
  const target = targets.find((item) => item.type === 'page' && !item.url.startsWith('devtools://'))
  if (!target?.webSocketDebuggerUrl) throw new Error(`No renderer page is available at ${baseUrl}/json/list`)

  const client = new CdpClient(target.webSocketDebuggerUrl)
  await client.send('Runtime.enable')
  await client.send('Page.enable')
  await client.send('Page.bringToFront')
  const evaluate = async (expression) => {
    const response = await client.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true
    })
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text ?? 'Renderer evaluation failed')
    return response.result?.value
  }

  try {
    const interaction = args.includes('--exercise')
      ? await exerciseApp(evaluate, args.includes('--skip-tree-animation'), args.includes('--verify-static-diagrams'))
      : null
    const snapshot = await collectSnapshot(evaluate)
    const report = {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      machine: {
        platform: process.platform,
        release: release(),
        architecture: process.arch,
        cpuModel: cpus()[0]?.model ?? 'unknown',
        logicalCpuCount: cpus().length,
        totalMemoryBytes: totalmem()
      },
      renderer: {
        targetUrl: target.url,
        userAgent: await evaluate('navigator.userAgent'),
        interaction,
        ...snapshot
      }
    }

    const outputPath = argumentValue(args, '--output', null)
    if (outputPath) {
      const absolutePath = resolve(outputPath)
      await mkdir(dirname(absolutePath), { recursive: true })
      await writeFile(absolutePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } finally {
    client.close()
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
