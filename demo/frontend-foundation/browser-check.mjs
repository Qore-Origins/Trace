// 隔离 Chrome/CDP 验收，不访问用户浏览器配置或真实计划。
import assert from 'node:assert/strict'
const targets = await (await fetch('http://127.0.0.1:52821/json')).json()
const socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl)
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
let sequence = 0
const pending = new Map()
socket.addEventListener('message', event => {
  const response = JSON.parse(event.data)
  if (!response.id) return
  const callback = pending.get(response.id)
  pending.delete(response.id)
  callback(response)
})
function call(method, params = {}) {
  const id = ++sequence
  return new Promise((resolve, reject) => {
    pending.set(id, response => response.error ? reject(response.error) : resolve(response.result))
    socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}
try {
  await call('Page.navigate', { url: 'http://127.0.0.1:52820/' })
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await evaluate('document.querySelectorAll("#tasks li").length === 3')) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.equal(await evaluate('document.querySelectorAll("#tasks li").length'), 3)
  await evaluate('document.querySelector("#tasks button").click()')
  assert.equal(await evaluate('document.querySelectorAll("#tasks li").length'), 2)
  await evaluate('document.querySelector("#undo-button").click()')
  assert.equal(await evaluate('document.querySelector("#tasks li span").textContent'), '先完成最小可验证闭环，再扩展体验')
  await evaluate('document.querySelector("#delete-card").click()')
  assert.equal(await evaluate('document.querySelector("#confirm").open'), true)
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(await evaluate('document.activeElement.id'), 'delete-card')
  for (const width of [720, 959, 960, 1200]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false })
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true)
  }
  await evaluate('document.querySelector("#theme").value="dark";document.querySelector("#theme").dispatchEvent(new Event("change"))')
  assert.equal(await evaluate('document.documentElement.classList.contains("theme-dark")'), true)
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#save")).transitionDuration'), '0s')
  await evaluate('document.querySelector("#tasks button").click();document.querySelector("#tasks button").click();document.querySelector("#undo-button").click()')
  assert.equal(await evaluate('document.querySelectorAll("#tasks li").length'), 2)
  await evaluate('document.querySelector("#tasks button").click()')
  await new Promise(resolve => setTimeout(resolve, 5100))
  assert.equal(await evaluate('document.querySelector("#undo").hidden'), true)
  await evaluate('document.querySelector("#delete-card").click();document.querySelector("#confirm-delete").click()')
  assert.equal(await evaluate('document.querySelector("#card").hidden'), true)
  console.log('PASS: delete/undo/index, Escape focus, 4 widths, dark theme, reduced motion, single-slot undo, expiry, confirm')
} finally { socket.close() }
