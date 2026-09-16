import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'

const targets = await (await fetch('http://127.0.0.1:52821/json')).json()
const page = targets.find(target => target.type === 'page')
assert.ok(page, 'Chrome CDP page is required')
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))

let requestId = 0
const pending = new Map()
const runtimeErrors = []
socket.addEventListener('message', event => {
  const response = JSON.parse(event.data)
  if (response.method === 'Runtime.exceptionThrown') runtimeErrors.push(response.params.exceptionDetails)
  if (!response.id) return
  const resolve = pending.get(response.id)
  pending.delete(response.id)
  resolve(response)
})

function call(method, params = {}) {
  const id = ++requestId
  return new Promise((resolve, reject) => {
    pending.set(id, response => response.error ? reject(new Error(`${method}: ${response.error.message}`)) : resolve(response.result))
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  let response
  try {
    response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  } catch (error) {
    throw new Error(`${error.message}; expression=${expression}`)
  }
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails))
  return response.result.value
}

const pause = delay => new Promise(resolve => setTimeout(resolve, delay))
async function until(expression) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(expression)) return
    await pause(100)
  }
  throw new Error(`Timed out: ${expression}`)
}

async function setWidth(width) {
  await call('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false })
  await pause(150)
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `${width}px must not overflow horizontally`)
  assert.equal(await evaluate('Array.from(document.querySelectorAll(".menu-title,.nav-btn")).every(element => getComputedStyle(element).whiteSpace === "nowrap" && element.getBoundingClientRect().height <= 32)'), true, `${width}px top-bar labels must remain on one line`)
}

async function setView(view, readySelector) {
  await evaluate(`window.integration.ui.getState().setView(${JSON.stringify(view)})`)
  await until(`!!(document.querySelector('.app-shell--${view}') && document.querySelector(${JSON.stringify(readySelector)}))`)
  assert.equal(await evaluate('document.querySelectorAll(".ws-top").length'), 1, `${view} must keep one TopBar`)
  assert.equal(await evaluate('document.querySelector("#shell-global-host") === window.__shellGlobalHost'), true, `${view} must preserve global host identity`)
}

try {
  await call('Runtime.enable')
  await call('Page.navigate', { url: 'http://127.0.0.1:52822/integration.html?shell=1' })
  await call('Page.bringToFront')
  await until('!!(document.querySelector(".app-shell--workspace") && document.querySelector("#shell-global-host"))')
  await evaluate('window.__shellGlobalHost = document.querySelector("#shell-global-host"); true')

  for (const width of [720, 959, 960, 1200]) {
    await setWidth(width)

    await setView('workspace', '.ws-main')
    assert.equal(await evaluate('document.querySelectorAll(".ws-status").length'), 1, 'workspace owns the only status bar')

    await setView('diary', '.diary-layout')
    assert.equal(await evaluate('document.querySelectorAll(".ws-status").length'), 0, 'diary does not render status bar')
    if (width < 960) {
      assert.equal(await evaluate('(()=>{const main=document.querySelector(".diary-cal").getBoundingClientRect(),secondary=document.querySelector(".diary-tl").getBoundingClientRect();return secondary.top >= main.bottom - 1 && secondary.width >= main.width - 1})()'), true, `${width}px diary timeline must follow the calendar`)
    } else {
      assert.equal(await evaluate('(()=>{const main=document.querySelector(".diary-cal").getBoundingClientRect(),secondary=document.querySelector(".diary-tl").getBoundingClientRect();return secondary.left >= main.right - 1})()'), true, `${width}px diary keeps two columns`)
    }

    await setView('memories', '.memories-preview')
    assert.equal(await evaluate('document.querySelectorAll(".ws-status").length'), 0, 'memories does not render status bar')
    if (width < 960) {
      assert.equal(await evaluate('(()=>{const main=document.querySelector(".memories-main").getBoundingClientRect(),secondary=document.querySelector(".memories-preview").getBoundingClientRect();return secondary.top >= main.bottom - 1 && secondary.width >= main.width - 1})()'), true, `${width}px memories preview must follow the main content`)
    } else {
      assert.equal(await evaluate('(()=>{const main=document.querySelector(".memories-main").getBoundingClientRect(),secondary=document.querySelector(".memories-preview").getBoundingClientRect();return secondary.left >= main.right - 1})()'), true, `${width}px memories keeps two columns`)
    }
  }

  await setWidth(720)
  await evaluate('window.integration.pref.getState().setLanguage("en-US"); true')
  await pause(150)
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, '720px English top bar must not overflow horizontally')
  await evaluate('window.integration.pref.getState().setLanguage("zh-CN"); true')
  await pause(150)
  await setView('memories', '.memories-preview')
  const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await mkdir('out/demo/frontend-foundation', { recursive: true })
  await writeFile('out/demo/frontend-foundation/app-shell-720.png', Buffer.from(screenshot.data, 'base64'))
  assert.deepEqual(runtimeErrors, [])
  console.log('PASS: AppShell actual components at 720/959/960/1200; one TopBar; workspace-only StatusBar; narrow secondary content follows main; global host identity stable; zh/en top bar has no horizontal overflow; no runtime exceptions')
} finally {
  socket.close()
}
