'use strict'

const assert = require('node:assert/strict')
const { spawn, execFileSync } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

const workspace = path.resolve(__dirname, '..')
const electron = path.join(workspace, 'node_modules', 'electron', 'dist', 'electron.exe')
const bundle = path.join(workspace, 'out', 'main', 'index.js')
const bootstrap = path.join(__dirname, 'trace-phase2-isolated-electron-bootstrap.cjs')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-workflow-qa-'))
const library = path.join(root, 'disposable-library')
const userData = path.join(root, 'user-data')
const marker = path.join(root, '.trace-workflow-owner')
const owner = randomBytes(16).toString('hex')
let child
let socket
let stdout = ''
let success = false

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(check, description, timeout = 20000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (child && child.exitCode !== null) throw new Error(`Electron exited before ${description}: ${child.exitCode}`)
    try { const value = await check(); if (value) return value } catch { /* Startup may still be in progress. */ }
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${description}; output=${stdout.slice(-1000)}`)
}
function baseEnvironment() {
  const result = {}
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
    'COMSPEC', 'HOMEDRIVE', 'HOMEPATH', 'OS', 'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER']) {
    if (process.env[key]) result[key] = process.env[key]
  }
  return result
}
async function port() {
  const server = net.createServer()
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()))
  const value = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return value
}
class Cdp {
  constructor(url) {
    this.nextId = 0
    this.pending = new Map()
    socket = new WebSocket(url)
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (!message.id || !this.pending.has(message.id)) return
      const pending = this.pending.get(message.id)
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
    })
  }
  async connect() { await waitFor(() => socket.readyState === WebSocket.OPEN, 'CDP websocket') }
  command(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)) }, 15000)
      this.pending.set(id, { resolve, reject, timer })
      socket.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression) {
    const value = await this.command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
    if (value.exceptionDetails) throw new Error(value.exceptionDetails.text)
    return value.result?.value
  }
}
async function main() {
  fs.writeFileSync(marker, owner, { flag: 'wx' })
  fs.mkdirSync(library)
  fs.mkdirSync(userData)
  const debugPort = await port()
  child = spawn(electron, ['--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${debugPort}`,
    '--no-first-run', bootstrap], { cwd: workspace, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...baseEnvironment(), TRACE_PHASE2_QA_ROOT: root, TRACE_PHASE2_QA_MAIN_BUNDLE: bundle,
      TRACE_PHASE2_QA_ONBOARDING: '1' } })
  const collect = (data) => { stdout = (stdout + data.toString()).slice(-4000) }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  await waitFor(() => stdout.includes('TRACE_PHASE2_QA_ISOLATION_VERIFIED'), 'isolation sentinel')
  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
    const targets = await response.json()
    return targets.find((item) => item.type === 'page' && /renderer\/index\.html/i.test(item.url))
  }, 'main renderer')
  const cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.connect()
  await waitFor(() => cdp.evaluate('Boolean(window.trace && document.querySelector("#root")?.childElementCount)'), 'mounted renderer')
  const invoke = (channel, payload) => cdp.evaluate(`window.trace.invoke(${JSON.stringify(channel)},${JSON.stringify(payload ?? null)})`)
  const requireOk = async (channel, payload) => {
    const result = await invoke(channel, payload)
    assert.equal(result.ok, true, `${channel}: ${result.message ?? 'unknown error'}`)
    return result.data
  }
  await waitFor(() => cdp.evaluate(`Boolean(document.querySelector('.onboard')
    && document.querySelector('.onboard button'))`), 'first-run onboarding')
  await requireOk('app:setRootDir', { dirPath: library, confirmed: false })
  await cdp.command('Page.reload', { ignoreCache: true })
  await waitFor(() => cdp.evaluate(`Boolean(document.querySelector('.ws-content'))`), 'workspace after library selection')
  const app = await requireOk('app:bootstrap')
  assert.equal(path.resolve(app.rootDir).toLowerCase(), path.resolve(library).toLowerCase())
  const initial = await requireOk('plan-workflow:list')
  const preset = { format_version: '1', name_rules: [], content_templates: [{ id: 'basic', name: 'Basic',
    components: [{ type: 'heading', title: 'Goal' }, { type: 'task_list', title: 'Tasks' }] }],
    presets: [{ id: 'qa', name: 'QA Workflow', scope: { kind: 'global' }, enabled: true, is_default: true,
      outputs: [{ id: 'single', destination: { kind: 'selected' }, name_template_mode: 'explicit',
        name_template: '{this.folder_name}_{date}_{title}', content_template_id: 'basic', repeat: 'once' }] }] }
  await requireOk('plan-workflow:save', { library_id: initial.library_id, config: preset })
  const previewDraft = { selected_path: '', title: 'QA', target_date: '2026-10-13' }
  const preview = await requireOk('plan-workflow:preview', { library_id: initial.library_id, draft: previewDraft })
  assert.equal(preview.state, 'ready')
  assert.equal(preview.outputs.length, 1)
  assert.equal(preview.outputs[0].target_date, '2026-10-13')
  await waitFor(() => cdp.evaluate('Boolean(document.querySelector(".tree-footer .trace-action"))'), 'tree footer')
  const clicked = await cdp.evaluate(`(() => { const button = document.querySelector('.tree-footer .trace-action');
    if (!button) return false; button.click(); return true })()`)
  assert.equal(clicked, true, 'tree new-plan button')
  await waitFor(() => cdp.evaluate('Boolean(document.querySelector(".plan-workflow-create"))'), 'workflow modal')
  const modal = await cdp.evaluate(`(() => { const el = document.querySelector('.plan-workflow-create');
    return { text: el?.textContent?.slice(0, 500), inputs: [...el.querySelectorAll('input')].map(x => ({ type: x.type, value: x.value })) } })()`)
  assert.ok(modal.inputs.length >= 3, 'editable workflow fields are visible')
  assert.ok(modal.text.includes('QA Workflow'), 'automatched preset is visible')
  const fieldsSet = await cdp.evaluate(`(() => {
    const fields = document.querySelectorAll('.plan-workflow-create__fields input')
    if (fields.length < 2) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    for (const [input, value] of [[fields[0], 'QA'], [fields[1], '2026-10-13']]) {
      setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    return true
  })()`)
  assert.equal(fieldsSet, true, 'editable title and target date')
  const refreshClicked = await cdp.evaluate(`(() => { const button = document.querySelector('.plan-workflow-create__actions button');
    if (!button) return false; button.click(); return true })()`)
  assert.equal(refreshClicked, true, 'refresh preview button')
  await waitFor(() => cdp.evaluate(`Boolean(document.querySelector('.plan-workflow-create__output strong')?.textContent?.includes('20261013_QA'))`), 'refreshed UI preview')
  const createClicked = await cdp.evaluate(`(() => { const button = document.querySelectorAll('.plan-workflow-create__actions button')[1];
    if (!button || button.disabled) return false; button.click(); return true })()`)
  assert.equal(createClicked, true, 'enabled UI create button')
  const createdPath = preview.outputs[0].relative_path
  await waitFor(async () => (await requireOk('storage:treeGetChildren', { parent_path: '' }))
    .some((item) => item.path === createdPath), 'UI created tree item')
  const searchHit = await waitFor(async () => (await requireOk('search:query', { keywords: ['Goal'] }))
    .find((item) => item.path === createdPath && item.component_id), 'indexed heading')
  await cdp.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }))`)
  await waitFor(() => cdp.evaluate(`Boolean(document.querySelector('.search-overlay .o-input'))`), 'search overlay')
  await cdp.evaluate(`(() => { const input = document.querySelector('.search-overlay .o-input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Goal'); input.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await waitFor(() => cdp.evaluate(`Boolean([...document.querySelectorAll('.search-overlay .o-item')]
    .some((item) => item.textContent.includes('Goal')))`), 'visible search hit')
  await cdp.evaluate(`document.querySelector('.search-overlay .o-item').click()`)
  await waitFor(() => cdp.evaluate(`Boolean(!document.querySelector('.search-overlay')
    && document.querySelector('.ws-content .crumbs .here')?.textContent === ${JSON.stringify(createdPath)})`),
  'search backtrace to source plan')
  await waitFor(() => cdp.evaluate(`Boolean(document.querySelector(
    '[data-component-id=${JSON.stringify(searchHit.component_id)}].pulse'))`), 'source heading pulse')
  await cdp.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true, bubbles: true }))`)
  await waitFor(() => cdp.evaluate('Boolean(document.querySelector("#trace-settings-nav-workflows"))'), 'settings navigation')
  await cdp.evaluate(`document.querySelector('#trace-settings-nav-workflows').click()`)
  await waitFor(() => cdp.evaluate(`Boolean(document.querySelector('.plan-workflow-settings')?.textContent?.includes('QA Workflow'))`),
    'workflow preset in settings')
  await cdp.evaluate(`document.querySelector('.trace-settings-modal .ant-modal-close').click()`)
  fs.mkdirSync(path.join(library, 'Weekly_Plan'))
  fs.mkdirSync(path.join(library, 'Daily_Plan'))
  const weeklyConfig = { format_version: '1', name_rules: [], content_templates: [
    { id: 'week', name: 'Week', components: [{ type: 'heading', title: 'Weekly goal' }] },
    { id: 'day', name: 'Day', components: [{ type: 'task_list', title: 'Daily tasks' }] }
  ], presets: [{ id: 'week', name: 'Week and days', scope: { kind: 'category', path: 'Weekly_Plan' },
    enabled: true, is_default: true, outputs: [
      { id: 'week', destination: { kind: 'fixed', path: 'Weekly_Plan' }, name_template_mode: 'explicit',
        name_template: '{this.folder_name}_{week_start}-{week_end}', content_template_id: 'week', repeat: 'once', workflow_kind: 'week' },
      { id: 'days', destination: { kind: 'fixed', path: 'Daily_Plan' }, name_template_mode: 'explicit',
        name_template: '{this.folder_name}_{date}', content_template_id: 'day', repeat: 'each_day', workflow_kind: 'day' }
    ] }] }
  await requireOk('plan-workflow:save', { library_id: initial.library_id, config: weeklyConfig })
  const weekDraft = { selected_path: 'Weekly_Plan', period: { start_date: '2026-12-31', end_date: '2027-01-06' },
    tasks: [{ id: 'assigned', title: 'Prepare notes', target_date: '2027-01-01' }] }
  const weekPreview = await requireOk('plan-workflow:preview', { library_id: initial.library_id, draft: weekDraft })
  assert.equal(weekPreview.outputs.length, 8)
  assert.equal(weekPreview.outputs.find((item) => item.key === 'week').name, 'Weekly_Plan_20261231-20270106')
  const batch = await requireOk('plan-workflow:commitBatch', { library_id: initial.library_id, draft: weekDraft,
    revision_token: weekPreview.revision_token, confirmations: [] })
  assert.equal(batch.status, 'complete')
  assert.equal(batch.items.length, 8)
  const week = JSON.parse(fs.readFileSync(path.join(library, 'Weekly_Plan', 'Weekly_Plan_20261231-20270106', 'plan.json'), 'utf8'))
  const day = JSON.parse(fs.readFileSync(path.join(library, 'Daily_Plan', 'Daily_Plan_20270101', 'plan.json'), 'utf8'))
  assert.equal(Object.keys(week.workflow.day_plan_ids).length, 7)
  assert.equal(day.workflow.week_plan_id, week.plan_id)
  assert.equal(day.components.find((item) => item.type === 'task_list').payload.items[0].title, 'Prepare notes')
  const suggested = await requireOk('plan-workflow:suggestPeriod', { library_id: initial.library_id, selected_path: 'Weekly_Plan' })
  assert.deepEqual(suggested, { start_date: '2027-01-07', end_date: '2027-01-13' })
  const overlap = await requireOk('plan-workflow:preview', { library_id: initial.library_id,
    draft: { selected_path: 'Weekly_Plan', period: { start_date: '2027-01-05', end_date: '2027-01-11' } } })
  assert.ok(overlap.outputs.some((item) => item.conflicts.some((conflict) => conflict.code === 'period_overlap')))
  const nextDraft = { selected_path: 'Weekly_Plan', period: suggested }
  const nextPreview = await requireOk('plan-workflow:preview', { library_id: initial.library_id, draft: nextDraft })
  const nextBatch = await requireOk('plan-workflow:commitBatch', { library_id: initial.library_id, draft: nextDraft,
    revision_token: nextPreview.revision_token, confirmations: [] })
  assert.equal(nextBatch.status, 'complete')
  const nextWeek = JSON.parse(fs.readFileSync(path.join(library, 'Weekly_Plan', 'Weekly_Plan_20270107-20270113', 'plan.json'), 'utf8'))
  const handoff = await requireOk('plan-workflow:previewHandoff', { library_id: initial.library_id, week_plan_id: nextWeek.plan_id })
  assert.ok(handoff.tasks.some((item) => item.title === 'Prepare notes'))
  const sourceTask = handoff.tasks.find((item) => item.title === 'Prepare notes')
  const moved = await requireOk('plan-workflow:moveTask', { library_id: initial.library_id,
    week_plan_id: nextWeek.plan_id, source_plan_id: sourceTask.source_plan_id,
    source_task_id: sourceTask.source_task_id, target_date: '2027-01-07' })
  assert.equal(moved.status, 'complete')
  const sourceAfterMove = JSON.parse(fs.readFileSync(path.join(library, 'Daily_Plan', 'Daily_Plan_20270101', 'plan.json'), 'utf8'))
  const targetAfterMove = JSON.parse(fs.readFileSync(path.join(library, 'Daily_Plan', 'Daily_Plan_20270107', 'plan.json'), 'utf8'))
  assert.equal(sourceAfterMove.components.find((item) => item.type === 'task_list').payload.items[0].status, 'moved')
  assert.equal(targetAfterMove.components.find((item) => item.type === 'task_list').payload.items[0].source_plan_id, sourceAfterMove.plan_id)
  await requireOk('storage:createPlan', { parent_path: 'Daily_Plan', name: 'Existing-20270120' })
  const conflictDraft = { selected_path: 'Weekly_Plan', period: { start_date: '2027-01-14', end_date: '2027-01-20' },
    tasks: [{ id: 'other', title: 'Review', target_date: '2027-01-20' }] }
  const conflictPreview = await requireOk('plan-workflow:preview', { library_id: initial.library_id, draft: conflictDraft })
  assert.ok(conflictPreview.outputs.some((item) => item.target_date === '2027-01-20' &&
    item.conflicts.some((conflict) => conflict.code === 'same_date_candidate')))
  const unconfirmed = await invoke('plan-workflow:commitBatch', { library_id: initial.library_id,
    draft: conflictDraft, revision_token: conflictPreview.revision_token, confirmations: [] })
  assert.equal(unconfirmed.ok, false, 'same-date candidate must require explicit confirmation')
  console.log(JSON.stringify({ result: 'PASS', isolated: true, firstRunOnboarding: true, searchBacktrace: true,
    presetAutoMatched: true,
    modalEditableFields: modal.inputs.length, settingsPresetVisible: true, targetDate: preview.outputs[0].target_date, createdPath,
    weeklyOutputs: batch.items.length, linkedDays: Object.keys(week.workflow.day_plan_ids).length,
    nextWeekOutputs: nextBatch.items.length, handoff: moved.status, sameDateRequiresConfirmation: true }))
  success = true
}
async function cleanup() {
  if (socket) socket.close()
  if (child && child.exitCode === null) {
    execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(5000)])
  }
  if (!success) { console.error(`Failure fixture retained: ${root}`); return }
  const canonical = (value) => path.resolve(value).replace(/^\\\\\?\\/, '').toLowerCase()
  const info = fs.lstatSync(root)
  assert.ok(info.isDirectory() && !info.isSymbolicLink())
  assert.equal(path.dirname(canonical(fs.realpathSync(root))), canonical(os.tmpdir()))
  assert.equal(fs.readFileSync(marker, 'utf8'), owner)
  fs.rmSync(root, { recursive: true, force: false })
  console.log('PASS: exact owned Temp fixture removed after Electron exit')
}
main().catch((error) => { console.error(`FAIL: ${error.stack}`); process.exitCode = 1 }).finally(cleanup)
