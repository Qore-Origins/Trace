import '../../src/renderer/src/styles/workspace.css'
import './style.css'

// 待验收原型：冻结既有 Trace 风格，不新增视觉变体；只验证动作与删除模型。
const UNDO_DURATION_MS = 5000
interface Task { id: number; title: string }
interface UndoSnapshot { item: Task; index: number; expiresAt: number }
function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id)
  if (!result) throw new Error(`Missing demo element: ${id}`)
  return result as T
}
const samples: Task[] = [
  { id: 1, title: '先完成最小可验证闭环，再扩展体验' },
  { id: 2, title: '保持文件边界，避免多智能体同时覆盖修改' },
  { id: 3, title: '验证长路径 D:/Code/Project/Qore/Trace/frontend-foundation-demo/continuous-long-name' }
]
let tasks = [...samples]
let cardVisible = true
let snapshot: UndoSnapshot | null = null
let timer: ReturnType<typeof setTimeout> | undefined
const dialog = element<HTMLDialogElement>('confirm')
const taskList = element<HTMLUListElement>('tasks')
const systemTheme = matchMedia('(prefers-color-scheme: dark)')
const theme = element<HTMLSelectElement>('theme')

function announce(message: string): void { element('feedback').textContent = message }
function renderState(): void {
  element('state').textContent = JSON.stringify({ cardVisible, tasks, undo: snapshot }, null, 2)
}
function clearUndo(): void {
  clearTimeout(timer)
  timer = undefined
  snapshot = null
  element('undo').hidden = true
  renderState()
}
function focusRow(index: number): void {
  const rows = taskList.querySelectorAll<HTMLButtonElement>('button')
  ;(rows[Math.min(index, rows.length - 1)] ?? element('card')).focus()
}
function renderTasks(): void {
  taskList.replaceChildren()
  for (const task of tasks) {
    const row = document.createElement('li')
    const text = document.createElement('span')
    text.textContent = task.title
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'action quiet'
    button.textContent = '删除'
    button.setAttribute('aria-label', `删除任务：${task.title}`)
    button.addEventListener('click', () => removeTask(task.id))
    row.append(text, button)
    taskList.append(row)
  }
  renderState()
}
function removeTask(id: number): void {
  const index = tasks.findIndex(task => task.id === id)
  if (index < 0) return
  clearUndo()
  snapshot = { item: tasks[index], index, expiresAt: Date.now() + UNDO_DURATION_MS }
  tasks = tasks.filter(task => task.id !== id)
  renderTasks()
  element('undo-label').textContent = `已删除任务：${snapshot.item.title}`
  element('undo').hidden = false
  const progress = element('progress')
  progress.replaceWith(progress.cloneNode())
  timer = setTimeout(() => {
    const hasFocus = element('undo').contains(document.activeElement)
    clearUndo()
    announce('撤销期限已过，删除已确认')
    if (hasFocus) focusRow(index)
  }, UNDO_DURATION_MS)
  announce('任务已删除，5 秒内可撤销；只保留最近一次删除')
  focusRow(index)
}
element('undo-button').addEventListener('click', () => {
  if (!snapshot || Date.now() >= snapshot.expiresAt) {
    clearUndo()
    focusRow(0)
    return
  }
  const { item, index } = snapshot
  tasks.splice(index, 0, item)
  clearUndo()
  renderTasks()
  focusRow(index)
  announce('已撤销，任务恢复原位置')
})
element('dismiss').addEventListener('click', () => { clearUndo(); focusRow(0); announce('已关闭撤销提示') })
element('delete-card').addEventListener('click', () => { if (cardVisible && !dialog.open) dialog.showModal() })
element('confirm-cancel').addEventListener('click', () => dialog.close('cancel'))
element('confirm-delete').addEventListener('click', () => {
  if (!cardVisible || !dialog.open) return
  cardVisible = false
  clearUndo()
  element('card').hidden = true
  dialog.close('delete')
  renderState()
})
dialog.addEventListener('close', () => {
  element<HTMLButtonElement>('delete-card').disabled = !cardVisible
  ;(cardVisible ? element('delete-card') : element('reset')).focus()
  announce(cardVisible ? '已取消删除组件' : '组件已删除，可重置样本')
})
element('reset').addEventListener('click', () => {
  clearUndo()
  tasks = [...samples]
  cardVisible = true
  element('card').hidden = false
  element<HTMLButtonElement>('delete-card').disabled = false
  renderTasks()
  announce('内存样本已重置')
})
for (const [id, message] of [['save', 'Demo 确认保存：仅内存，无真实写盘'], ['cancel', '已取消当前操作'], ['edit', '编辑入口示意：此批只验收动作样式']]) {
  element(id).addEventListener('click', () => announce(message))
}
function applyTheme(): void {
  document.documentElement.classList.toggle('theme-dark', theme.value === 'dark' || (theme.value === 'system' && systemTheme.matches))
}
theme.addEventListener('change', applyTheme)
systemTheme.addEventListener('change', applyTheme)
window.addEventListener('pagehide', () => clearTimeout(timer))
applyTheme()
renderTasks()
