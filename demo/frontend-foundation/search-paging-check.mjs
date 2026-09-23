import assert from 'node:assert/strict'

const targets = await (await fetch('http://127.0.0.1:52821/json')).json()
const page = targets.find((target) => target.type === 'page')
assert.ok(page, 'Chrome CDP page is required')
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }))

let nextId = 0
const pending = new Map()
socket.addEventListener('message', (event) => {
  const response = JSON.parse(event.data)
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

try {
  await call('Runtime.enable')
  await call('Page.navigate', { url: 'http://127.0.0.1:52822/integration.html?foundation' })
  await until('!!window.integration?.search && !!document.querySelector(".tree-row.root")')
  await evaluate(`(() => {
    const hits = Array.from({ length: 250 }, (_, index) => ({
      scope: index % 2 === 0 ? 'plan' : 'note',
      path: 'plan-' + index,
      snippet: 'result ' + index
    }))
    window.integration.search.setState({ open: true, keywords: 'result', hits, querying: false })
  })()`)
  await until('document.querySelectorAll(".o-item").length === 100')
  assert.equal(await evaluate('document.querySelector(".o-pagination")?.textContent.includes("100 / 250")'), true)
  assert.equal(await evaluate('document.querySelector(".o-item")?.tagName'), 'BUTTON')
  await evaluate('document.querySelector(".o-more").click()')
  await until('document.querySelectorAll(".o-item").length === 200')
  await evaluate('document.querySelector(".o-more").click()')
  await until('document.querySelectorAll(".o-item").length === 250')
  assert.equal(await evaluate('document.querySelector(".o-more")'), null)
  await evaluate('window.integration.search.setState({ keywords: "new query", hits: [{ scope: "plan", path: "new", snippet: "new" }] })')
  await until('document.querySelectorAll(".o-item").length === 1')
  console.log(JSON.stringify({ firstPage: 100, secondPage: 200, total: 250, queryReset: 1 }))
} finally {
  socket.close()
}
