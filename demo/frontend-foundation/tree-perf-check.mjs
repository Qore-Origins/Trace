import assert from 'node:assert/strict'

const targets = await (await fetch('http://127.0.0.1:52821/json')).json()
const page = targets.find((target) => target.type === 'page')
assert.ok(page, 'Chrome CDP page is required')
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }))

let nextId = 0
const pending = new Map()
let traceEvents = []
let finishTrace = null
socket.addEventListener('message', (event) => {
  const response = JSON.parse(event.data)
  if (response.method === 'Tracing.dataCollected') traceEvents.push(...response.params.value)
  if (response.method === 'Tracing.tracingComplete') finishTrace?.()
  if (!response.id) return
  const complete = pending.get(response.id)
  pending.delete(response.id)
  complete(response)
})

function call(method, params = {}) {
  const id = ++nextId
  return new Promise((resolve, reject) => {
    pending.set(id, (response) => response.error ? reject(response.error) : resolve(response.result))
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}

async function until(expression) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(expression)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out: ${expression}`)
}

async function layoutDuration() {
  const metrics = (await call('Performance.getMetrics')).metrics
  if (!metrics.some((metric) => metric.name === 'LayoutDuration')) throw new Error('Chrome CDP LayoutDuration metric is unavailable')
  return metrics.find((metric) => metric.name === 'LayoutDuration')?.value ?? 0
}

async function sampleToggle(path) {
  const beforeLayout = await layoutDuration()
  traceEvents = []
  await call('Tracing.start', { categories: 'devtools.timeline', transferMode: 'ReportEvents' })
  const frames = await evaluate(`(async () => {
    const samples = []
    let previous = 0
    let start = 0
    const finished = new Promise((resolve) => {
      const frame = (time) => {
        if (!start) start = time
        if (previous) samples.push(time - previous)
        previous = time
        if (time - start < 700) requestAnimationFrame(frame)
        else resolve(samples)
      }
      requestAnimationFrame(frame)
    })
    document.querySelector('[data-path="${path}"] .tree-switcher').click()
    return await finished
  })()`)
  const traceComplete = new Promise((resolve) => { finishTrace = resolve })
  await call('Tracing.end')
  await traceComplete
  finishTrace = null
  const afterLayout = await layoutDuration()
  const sorted = frames.toSorted((a, b) => a - b)
  const layoutStarts = new Map()
  let styleLayoutMs = 0
  for (const event of traceEvents) {
    if (event.name !== 'AnimationFrame::StyleAndLayout') continue
    const key = `${event.pid}:${event.tid}:${event.id2?.local ?? ''}`
    if (event.ph === 'b') layoutStarts.set(key, event.ts)
    if (event.ph === 'e' && layoutStarts.has(key)) {
      styleLayoutMs += (event.ts - layoutStarts.get(key)) / 1000
      layoutStarts.delete(key)
    }
  }
  return {
    frameP95Ms: sorted[Math.ceil(sorted.length * .95) - 1],
    styleLayoutMs: Math.round(styleLayoutMs * 100) / 100,
    cdpLayoutMs: Math.round((afterLayout - beforeLayout) * 100000) / 100,
    traceEvents: traceEvents.length,
    frames: frames.length
  }
}

try {
  await call('Runtime.enable')
  await call('Performance.enable')
  await call('Page.navigate', { url: 'http://127.0.0.1:52822/integration.html' })
  await until('!!window.integration?.tree && !!document.querySelector(".tree-row.root")')
  await evaluate(`(() => {
    window.__traceTreeRowRenderCounts = Object.create(null)
    const rows = Array.from({ length: 1000 }, (_, index) => {
      const name = 'folder-' + String(index).padStart(4, '0')
      return { path: name, name, kind: 'folder', has_children: index === 500, order: index }
    })
    const parent = rows[500].path
    const children = Array.from({ length: 4 }, (_, index) => ({
      path: parent + '/leaf-' + index,
      name: 'leaf-' + index,
      kind: 'plan',
      has_children: false,
      order: index
    }))
    window.integration.tree.setState({
      childrenMap: { '': rows, [parent]: children },
      loaded: { '': true, [parent]: true },
      expandedKeys: [''],
      selectedPath: null,
      selectedKind: null
    })
  })()`)
  await until('document.querySelectorAll(".tree-row").length === 1001')
  assert.ok(await evaluate('!!window.__traceTreeRowRenderCounts'), 'tree row render counter must be installed')

  await evaluate('window.__traceTreeRowRenderCounts = Object.create(null)')
  await evaluate('window.integration.tree.getState().setExpanded(["", "folder-0500"])')
  await until('document.querySelectorAll(".tree-row").length === 1005')
  const counts = await evaluate('window.__traceTreeRowRenderCounts')
  const unrelatedRenders = Object.entries(counts)
    .filter(([path]) => path !== '' && path !== 'folder-0500' && !path.startsWith('folder-0500/'))
    .reduce((sum, [, count]) => sum + count, 0)
  console.log(JSON.stringify({ visibleBefore: 1001, visibleAfter: 1005, unrelatedRenders }))
  assert.equal(unrelatedRenders, 0, 'expanding one leaf-level folder must not rerender unrelated rows')

  const largeCollapse = await sampleToggle('folder-0500')
  await until('document.querySelectorAll(".tree-row").length === 1001')
  const largeExpand = await sampleToggle('folder-0500')
  await until('document.querySelectorAll(".tree-row").length === 1005')

  await evaluate(`(() => {
    const rows = Array.from({ length: 100 }, (_, index) => {
      const name = 'folder-' + String(index).padStart(4, '0')
      return { path: name, name, kind: 'folder', has_children: index === 50, order: index }
    })
    const parent = rows[50].path
    const children = Array.from({ length: 4 }, (_, index) => ({
      path: parent + '/leaf-' + index, name: 'leaf-' + index, kind: 'plan', has_children: false, order: index
    }))
    window.integration.tree.setState({
      childrenMap: { '': rows, [parent]: children }, loaded: { '': true, [parent]: true }, expandedKeys: ['']
    })
  })()`)
  await until('document.querySelectorAll(".tree-row").length === 101')
  const smallExpand = await sampleToggle('folder-0050')
  await until('document.querySelectorAll(".tree-row").length === 105')
  const smallCollapse = await sampleToggle('folder-0050')
  await until('document.querySelectorAll(".tree-row").length === 101')
  console.log(JSON.stringify({ animation: { smallExpand, smallCollapse, largeExpand, largeCollapse } }))
} finally {
  socket.close()
}
