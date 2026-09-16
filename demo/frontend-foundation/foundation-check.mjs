import assert from 'node:assert/strict'
const targets = await (await fetch('http://127.0.0.1:52821/json')).json()
const socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl)
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
let id = 0
const pending = new Map()
const errors = []
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails)
  if (message.id) { pending.get(message.id)(message); pending.delete(message.id) }
})
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const next = ++id
    pending.set(next, result => result.error ? reject(result.error) : resolve(result.result))
    socket.send(JSON.stringify({ id: next, method, params }))
  })
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(expression) {
  for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(100) }
  throw new Error(`Timed out: ${expression}`)
}
async function key(key, code, virtualKey) {
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: virtualKey, text: key === 'Enter' ? '\r' : key === ' ' ? ' ' : undefined })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKey })
  await pause(200)
}
try {
  await call('Runtime.enable')
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  await call('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false })
  await call('Page.navigate', { url: 'http://127.0.0.1:52822/integration.html?foundation=1' })
  await until('!!document.querySelector(".task-title input")')
  await pause(600)
  await evaluate('window.integration.plan.getState().mutate(doc=>{doc.due_date="2026-09-17"})')
  await until('!!document.querySelector(".due-input")')
  await key('Tab', 'Tab', 9)
  for (const selector of ['.task-title input', '.task-date', '.due-input', '.menu-title', '.nav-btn', '.tree-node-title']) {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`)
    const focus = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),s=getComputedStyle(e);return {visible:e.matches(':focus-visible'),outline:s.outlineStyle,width:s.outlineWidth,active:document.activeElement.tagName,box:e.getBoundingClientRect().toJSON(),parents:[e,...(()=>{let a=[],p=e.parentElement;while(p){a.push(p);p=p.parentElement}return a})()].map(p=>({class:p.className,display:getComputedStyle(p).display,visibility:getComputedStyle(p).visibility,inert:p.inert}))}})()`)
    assert.equal(focus.visible, true, JSON.stringify({selector,...focus}))
    assert.equal(focus.outline, 'solid', selector)
    assert.equal(focus.width, '2px', selector)
  }
  for (const activation of [['Enter','Enter',13], [' ','Space',32]]) {
    await evaluate('document.querySelector(".menu-title").focus()')
    await key(...activation)
    await until('!!document.querySelector(".ant-dropdown-menu")')
    await key('Escape','Escape',27)
    await evaluate('document.body.click()')
    await pause(200)
  }
  await evaluate('window.integration.search.setState({open:true,keywords:"任务",hits:[{scope:"plan",path:"demo",snippet:"任务定位"}],locate:async()=>{window.searchActivations=(window.searchActivations||0)+1}})')
  await until('!!document.querySelector(".o-item")')
  await evaluate('document.querySelector(".o-input").focus()')
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".o-input")).outlineStyle'), 'solid', 'search input focus')
  for (const activation of [['Enter','Enter',13], [' ','Space',32]]) {
    await evaluate('document.querySelector(".o-item").focus()')
    await key(...activation)
  }
  assert.equal(await evaluate('window.searchActivations'), 2)
  await evaluate('document.querySelector(".o-item").focus()')
  await key('Escape', 'Escape', 27)
  assert.equal(await evaluate('!!document.querySelector(".search-overlay")'), false, 'Escape from search result closes overlay')
  assert.equal(await evaluate('document.querySelector(".ws-status").getAttribute("aria-live")'), 'polite')
  await evaluate(`(()=>{const probes=document.createElement('section');probes.id='score-probes';for(const score of [0,30,50,80,100]){for(const surface of ['paper','paper-dim','fill','trace-bg']){const e=document.createElement('span');e.dataset.scoreInk='';e.textContent=String(score);e.style.color=window.integration.scoreTextColor(score);e.style.backgroundColor='var(--'+surface+')';probes.append(e)}const badge=document.createElement('span');badge.dataset.scoreInk='';badge.textContent=String(score);badge.style.color='var(--score-badge-ink)';badge.style.backgroundColor=window.integration.scoreColor(score);probes.append(badge)}document.body.append(probes)})()`)
  for (const dark of [false, true]) {
    await evaluate(`if(document.documentElement.classList.contains('theme-dark')!==${dark})document.querySelector('#toggle-theme').click();window.integration.plan.getState().mutate(doc=>{doc.components[0].payload.items[0].status='done';doc.components[0].payload.items[1].status='doing'})`)
    await pause(250)
    const ratios = await evaluate(`(()=>{
      const lum=c=>{const a=c.match(/[\\d.]+/g).slice(0,3).map(n=>{const v=Number(n)/(c.startsWith('color(srgb')?1:255);return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return a[0]*.2126+a[1]*.7152+a[2]*.0722};
      return [...document.querySelectorAll('.task-title input,.card .kind,.ws-status,.name,#antd-primary-probe,#antd-danger-probe,#antd-danger-text-probe,#antd-primary-link-probe,#antd-error-text-probe,[data-score-ink]')].map(e=>{
        const s=getComputedStyle(e);let ancestor=e,bg='';while(ancestor){bg=getComputedStyle(ancestor).backgroundColor;if(bg!=='rgba(0, 0, 0, 0)')break;ancestor=ancestor.parentElement}
        const a=lum(s.color),b=lum(bg);return {text:e.value||e.textContent,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),opacity:s.opacity}
      });})()`)
    for (const info of ratios) assert.ok(info.ratio >= 4.5, JSON.stringify({ dark, ...info }))
    console.log('PASS contrast theme', dark ? 'dark' : 'light', 'minimum', Math.min(...ratios.map(info => info.ratio)))
  }
  assert.notEqual(await evaluate('getComputedStyle(document.querySelector(".slot")).transitionDuration'), '0s', 'normal tree height animation')
  await evaluate(`const probe=document.createElement('section');probe.id='motion-probes';probe.innerHTML='<div class="mem-card">回忆</div><button class="mem-roll">换一条</button><button class="fmt-btn">格式</button><div class="folder-item">目录</div><button class="win-btn">窗口</button>';document.body.append(probe)`)
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  for (const selector of ['.mem-card','.mem-roll','.fmt-btn','.folder-item','.win-btn','.slot']) {
    assert.equal(await evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).transitionDuration`), '0s', selector)
  }
  await evaluate('window.integration.reset();document.querySelector(".task-del").focus()')
  await key(' ', 'Space', 32)
  await until('document.querySelectorAll(".task-del").length===3')
  await evaluate('document.querySelector(".trace-undo button").click()')
  await until('document.querySelectorAll(".task-del").length===4')
  await evaluate('window.integration.tree.getState().requestAnimRemove("demo");window.integration.tree.getState().requestAnimRemove("demo")')
  await until('window.integration.deleteCalls===1 && !document.querySelector(".tree-node-title")')
  await pause(400)
  assert.equal(await evaluate('window.integration.deleteCalls'), 1, 'tree delete callback exactly once')
  assert.equal(await evaluate('document.activeElement.matches(".tree-scroll,.tree-row.root")'), true, 'deleted tree focus terminal state')
  assert.deepEqual(errors, [], 'no runtime exceptions')
  await evaluate('window.integration.tree.setState({selectedPath:"demo",selectedKind:"plan",childrenMap:{"":[{path:"QA-folder",name:"QA-folder",kind:"folder",has_children:false}]},loaded:{"":true},expandedKeys:[""]});window.integration.ui.setState({nameDialog:null})')
  await until('!!document.querySelector(".tree-quick button")')
  await evaluate('document.querySelector(".tree-quick button").focus()')
  await pause(250)
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".tree-quick")).opacity'), '1')
  await key('Enter', 'Enter', 13)
  assert.equal(await evaluate('window.integration.tree.getState().selectedPath'), 'demo', 'quick action does not open parent')
  assert.equal(await evaluate('window.integration.ui.getState().nameDialog.mode'), 'create-plan')
  console.log('PASS computed keyboard focus including due input/menu Enter+Space/search Enter+Space/aria-live/normal tree motion/reduced memories+fmt+folder+window+tree/task delete+undo/tree delete exactly once+focus terminal/no runtime exceptions')
} finally {
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  socket.close()
}
