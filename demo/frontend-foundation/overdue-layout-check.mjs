import assert from 'node:assert/strict'

const devtoolsPort = Number(process.argv[2] ?? 52821)
const vitePort = Number(process.argv[3] ?? 52822)
for (const port of [devtoolsPort, vitePort]) {
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, `无效的本地端口：${port}`)
}
const targets = await (await fetch(`http://127.0.0.1:${devtoolsPort}/json`)).json()
const page = targets.find((target) => target.type === 'page')
assert.ok(page, '找不到 Chrome 测试页面')

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let nextId = 0
const pending = new Map()
socket.addEventListener('message', (event) => {
  const response = JSON.parse(event.data)
  if (!response.id) return
  const resolve = pending.get(response.id)
  pending.delete(response.id)
  resolve(response)
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
  throw new Error(`等待超时：${expression}`)
}

const taskDetailId = 'dddddddddddddddddddddddddddddddd'
const taskListId = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const fixture = {
  format_version: '1',
  created_at: '2026-09-27T00:00:00Z',
  updated_at: '2026-09-27T00:00:00Z',
  components: [
    { id: taskDetailId, type: 'task_detail', payload: {
      title: '逾期任务详情', description: '取消勾选时标题行应保持位置稳定',
      planned_at: '2020-01-01', status: 'done', completed_at: '2026-09-27T00:00:00Z'
    } },
    { id: taskListId, type: 'task_list', payload: {
      title: '逾期任务列表', items: [{
        id: 'ffffffffffffffffffffffffffffffff', title: '已完成的过期任务',
        planned_at: '2020-01-01', status: 'done', completed_at: '2026-09-27T00:00:00Z'
      }]
    } }
  ]
}

async function resetFixture() {
  await evaluate(`window.integration.plan.setState({currentPath:'demo',document:${JSON.stringify(fixture)},serverUpdatedAt:${JSON.stringify(fixture.updated_at)},saveState:'idle'})`)
  await until(`Boolean(document.querySelector('[data-component-id="${taskDetailId}"] .single-title') && document.querySelector('[data-component-id="${taskListId}"] .task-title'))`)
  await evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
}

async function collectFrames(componentId, titleSelector, toggleSelector) {
  return evaluate(`(async () => {
    const card = document.querySelector('[data-component-id="${componentId}"]')
    const title = card.querySelector(${JSON.stringify(titleSelector)})
    const toggle = card.querySelector(${JSON.stringify(toggleSelector)})
    const measure = () => {
      const badge = card.querySelector('.tag-overdue')
      const cardRect = card.getBoundingClientRect()
      const titleRect = title.getBoundingClientRect()
      return {
        cardWidth: cardRect.width,
        cardX: cardRect.x,
        cardHeight: cardRect.height,
        cardY: cardRect.y,
        titleWidth: titleRect.width,
        titleX: titleRect.x,
        titleY: titleRect.y,
        badgeWidth: badge?.getBoundingClientRect().width ?? 0,
        badgeHeight: badge?.getBoundingClientRect().height ?? 0,
        badgeOpacity: badge ? getComputedStyle(badge).opacity : null,
        badgeHidden: badge?.getAttribute('aria-hidden') ?? null,
        hasBadge: Boolean(badge)
      }
    }
    const frames = [measure()]
    toggle.click()
    frames.push(measure())
    for (let index = 0; index < 24; index++) {
      await new Promise((resolve) => requestAnimationFrame(resolve))
      frames.push(measure())
    }
    return frames
  })()`)
}

function range(frames, key) {
  const values = frames.map((frame) => frame[key])
  return Math.max(...values) - Math.min(...values)
}

const failures = []
try {
  await call('Runtime.enable')
  await call('Page.navigate', { url: `http://127.0.0.1:${vitePort}/integration.html` })
  await until('Boolean(window.integration?.plan)')

  for (const variant of [
    { width: 1200, dark: false, reduceMotion: false },
    { width: 720, dark: true, reduceMotion: false },
    { width: 720, dark: false, reduceMotion: true }
  ]) {
    await call('Emulation.setDeviceMetricsOverride', {
      width: variant.width, height: 800, deviceScaleFactor: 1, mobile: false
    })
    await call('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: variant.reduceMotion ? 'reduce' : 'no-preference' }]
    })
    await evaluate(`(() => {
      const isDark = document.documentElement.classList.contains('theme-dark')
      if (isDark !== ${variant.dark}) document.querySelector('#toggle-theme').click()
    })()`)
    await resetFixture()

    for (const target of [
      { name: '任务详情', id: taskDetailId, title: '.head .single-title', toggle: '.ant-checkbox-input' },
      { name: '任务列表', id: taskListId, title: '.task-title', toggle: '.state-ring' }
    ]) {
      const entering = await collectFrames(target.id, target.title, target.toggle)
      const leaving = await collectFrames(target.id, target.title, target.toggle)
      const measurement = {
        cardWidth: Math.max(range(entering, 'cardWidth'), range(leaving, 'cardWidth')),
        cardX: Math.max(range(entering, 'cardX'), range(leaving, 'cardX')),
        cardHeight: Math.max(range(entering, 'cardHeight'), range(leaving, 'cardHeight')),
        cardY: Math.max(range(entering, 'cardY'), range(leaving, 'cardY')),
        titleWidth: Math.max(range(entering, 'titleWidth'), range(leaving, 'titleWidth')),
        titleX: Math.max(range(entering, 'titleX'), range(leaving, 'titleX')),
        titleY: Math.max(range(entering, 'titleY'), range(leaving, 'titleY')),
        badgeWidth: range(entering, 'badgeWidth'),
        badgeHeight: range(entering, 'badgeHeight'),
        before: entering[0],
        visible: entering.at(-1),
        hiddenAgain: leaving.at(-1)
      }
      console.log(`${variant.width}px ${variant.dark ? '暗色' : '亮色'} ${variant.reduceMotion ? '减动效' : '正常动效'} ${target.name}: ${JSON.stringify(measurement)}`)
      const stable = measurement.cardWidth <= 0.5 && measurement.cardX <= 0.5 &&
        measurement.cardHeight <= 0.5 && measurement.cardY <= 0.5 &&
        measurement.titleWidth <= 0.5 && measurement.titleX <= 0.5 && measurement.titleY <= 0.5 &&
        measurement.badgeWidth <= 0.5 && measurement.badgeHeight <= 0.5
      const accessible = measurement.before.hasBadge && measurement.before.badgeHidden === 'true' &&
        measurement.visible.badgeHidden === 'false' && measurement.hiddenAgain.badgeHidden === 'true'
      if (!stable || !accessible) failures.push(`${target.name} ${variant.width}px：布局稳定=${stable}，逾期可访问性=${accessible}`)
    }
    const noOverflow = await evaluate('document.documentElement.scrollWidth <= innerWidth')
    if (!noOverflow) failures.push(`${variant.width}px：页面水平溢出`)
  }

  const futureFixture = structuredClone(fixture)
  futureFixture.components[0].payload.planned_at = '2099-01-01'
  futureFixture.components[1].payload.items[0].planned_at = undefined
  await evaluate(`window.integration.plan.setState({document:${JSON.stringify(futureFixture)}})`)
  await evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const nonOverdueBadgeCount = await evaluate('document.querySelectorAll(".card .tag-overdue").length')
  if (nonOverdueBadgeCount !== 0) failures.push(`非逾期任务仍出现 ${nonOverdueBadgeCount} 个标签槽位`)

  assert.deepEqual(failures, [], failures.join('\n'))
  console.log('PASS: 任务详情与任务列表逾期状态往返无布局跳动，覆盖窄窗口、双主题和减动效')
} finally {
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  socket.close()
}
