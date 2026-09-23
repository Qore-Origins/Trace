import assert from 'node:assert/strict'

const targets = await (await fetch('http://127.0.0.1:52821/json')).json()
const page = targets.find((target) => target.type === 'page')
assert.ok(page, 'Chrome CDP page is required')
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }))

let nextId = 0
const pending = new Map()
const consoleErrors = []
socket.addEventListener('message', (event) => {
  const response = JSON.parse(event.data)
  if (response.method === 'Runtime.consoleAPICalled' && response.params.type === 'error') {
    consoleErrors.push(response.params.args.map((arg) => arg.value ?? arg.description).join(' '))
  }
  if (!response.id) return
  pending.get(response.id)?.(response)
  pending.delete(response.id)
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

try {
  await call('Runtime.enable')
  await call('Page.navigate', { url: 'http://127.0.0.1:52822/integration.html' })
  await until('!!window.integration?.plan && !!document.querySelector(".card")')
  await evaluate(`(() => {
    const current = window.integration.plan.getState().document
    window.integration.plan.setState({ document: {
      ...current,
      components: [...current.components, {
        id: '33333333333333333333333333333333',
        type: 'note',
        payload: { content: '# 123', created_at: '2026-09-23T00:00:00Z' }
      }]
    } })
  })()`)
  await until('document.querySelector(".card.note .note-static h1")?.textContent === "123"')

  const activate = `document.querySelector('.card.note .note-static').click()`
  await evaluate(activate)
  await until('!!document.querySelector(".card.note .note-muya-host")')
  await until('!document.querySelector(".card.note .note-muya-loading")')
  assert.equal(await evaluate('!!document.querySelector(".card.note .note-muya-host")'), true, consoleErrors.join('\n'))
  await evaluate(`document.querySelector('.mu-float-wrapper')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`)
  assert.equal(await evaluate('!!document.querySelector(".card.note .note-muya-host")'), true)

  await evaluate(`document.querySelector('.ws-tree').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`)
  await until('document.querySelector(".card.note .note-static h1")?.textContent === "123"')

  await evaluate(activate)
  await until('!!document.querySelector(".card.note .note-muya-host")')
  await evaluate(`document.querySelector('#toggle-theme').dispatchEvent(new FocusEvent('focusin', { bubbles: true }))`)
  await until('document.querySelector(".card.note .note-static h1")?.textContent === "123"')

  await evaluate(activate)
  await until('!!document.querySelector(".card.note .note-muya-host")')
  await evaluate(`(() => {
    const button = document.querySelector('.card.note .actions button:first-child')
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    button.click()
  })()`)
  await until('document.querySelector(".card.note .note-static h1")?.textContent === "123"')
  assert.equal(await evaluate('Array.from(document.querySelectorAll(".card")).findIndex((card) => card.classList.contains("note"))'), 1)

  await evaluate(activate)
  await until('!!document.querySelector(".card.note .note-muya-host")')
  await evaluate(`(() => {
    const button = document.querySelector('.card.note .actions button:nth-child(2)')
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    button.click()
  })()`)
  await until('document.querySelector(".card.note .note-static h1")?.textContent === "123"')
  assert.equal(await evaluate('Array.from(document.querySelectorAll(".card")).findIndex((card) => card.classList.contains("note"))'), 2)
  console.log('note focus QA passed: outside click, Muya float, move up/down, heading render')
} finally {
  socket.close()
}
