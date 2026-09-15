import { Muya, zhCN } from '@muyajs/core'

import { createMuyaOptions, validatePlantumlServer } from '../../src/renderer/src/components/muya-note/muya-config'
import { registerMuyaPlugins } from '../../src/renderer/src/components/muya-note/muya-runtime'
import '../../src/renderer/src/components/muya-note/muya-theme.css'
import './style.css'

const INITIAL_MARKDOWN = [
  '# Muya 真内核验收稿',
  '',
  '**粗体删除区** [链接删除区](https://example.com) `行内代码删除区` ***嵌套格式删除区***',
  '',
  '把光标移入上面任一格式。Muya 会只显示当前 token 的标记；删除时相邻格式应继续保持排版。',
  '',
  '## 自动补全',
  '',
  '在本节末尾输入 `*`、`**`、反引号、括号或引号，验证成对补全；输入三个反引号后验证语言选择。',
  '',
  '> 这是引用。还可以验证 ~~删除线~~、<u>下划线</u>、$E = mc^2$ 和脚注[^trace]。',
  '',
  '- [x] 已完成：真正接入 Muya',
  '- [ ] 待验收：中文输入法、撤销重做、剪贴板',
  '',
  '| 能力 | 当前状态 |',
  '| --- | --- |',
  '| 实时排版 | Muya 原生 |',
  '| Markdown 真源 | 保留 |',
  '',
  '```typescript',
  "const longTracePath = 'D:/Code/Project/Qore/Trace/very-long-markdown-path/this-code-line-is-used-to-verify-that-wrapCodeBlocks-really-changes-the-layout.ts'",
  '```',
  '',
  '$$',
  '\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}',
  '$$',
  '',
  '```mermaid',
  'flowchart LR',
  '  A[输入 Markdown] --> B[Muya JSONState]',
  '  B --> C[同一编辑面实时排版]',
  '```',
  '',
  '```vega-lite',
  '{',
  '  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",',
  '  "data": { "values": [{ "能力": "输入", "值": 4 }, { "能力": "渲染", "值": 7 }] },',
  '  "mark": "bar",',
  '  "encoding": {',
  '    "x": { "field": "能力", "type": "nominal" },',
  '    "y": { "field": "值", "type": "quantitative" }',
  '  }',
  '}',
  '```',
  '',
  '```plantuml',
  '@startuml',
  'Alice -> Bob: 默认离线，不发送源码',
  '@enduml',
  '```',
  '',
  '```flowchart',
  'st=>start: 开始',
  'op=>operation: 实时编辑',
  'e=>end: 保存 Markdown',
  'st->op->e',
  '```',
  '',
  '```sequence',
  'Alice->Bob: 输入 Markdown',
  'Bob-->Alice: 返回实时排版',
  '```',
  '',
  '[^trace]: Trace 始终以 Markdown 字符串作为持久化真源。',
  '',
  '在这里继续输入并验证自动配对：'
].join('\n')

const query = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Demo 元素不存在：${selector}`)
  return element
}

registerMuyaPlugins()

const editorHost = query<HTMLElement>('#muya-editor')
const markdownOutput = query<HTMLTextAreaElement>('#markdown-output')
const eventLog = query<HTMLOListElement>('#event-log')
const eventCount = query<HTMLElement>('#event-count')
const documentState = query<HTMLElement>('#document-state')
const liveRenderToggle = query<HTMLInputElement>('#live-render-toggle')
const liveRenderDetail = query<HTMLElement>('#live-render-detail')
const wrapToggle = query<HTMLInputElement>('#wrap-toggle')
const wrapDetail = query<HTMLElement>('#wrap-detail')
const plantumlInput = query<HTMLInputElement>('#plantuml-server')
const plantumlState = query<HTMLElement>('#plantuml-state')

const muya = new Muya(editorHost, {
  ...createMuyaOptions(''),
  markdown: INITIAL_MARKDOWN
})
muya.locale(zhCN)
muya.init()

let recordedEventCount = 0

function updateMarkdownSnapshot(): void {
  markdownOutput.value = muya.getMarkdown()
}

function recordEvent(label: string, detail: string): void {
  recordedEventCount += 1
  eventCount.textContent = `${recordedEventCount} 次事件`

  const item = document.createElement('li')
  const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  item.textContent = `${timestamp} · ${label} · ${detail}`
  eventLog.prepend(item)

  while (eventLog.children.length > 8) eventLog.lastElementChild?.remove()
}

muya.on('json-change', (change: { source?: string }) => {
  updateMarkdownSnapshot()
  documentState.textContent = '内容已更新'
  recordEvent('json-change', `${change.source ?? 'unknown'} · ${muya.getMarkdown().length} 字符`)
})

muya.on(
  'selection-change',
  (selection: { kind?: string; isCollapsed?: boolean; formats?: string[] }) => {
    const formatSummary = selection.formats?.length ? selection.formats.join(', ') : '无格式'
    const selectionState = selection.isCollapsed === false ? '范围选择' : '光标'
    recordEvent('selection-change', `${selection.kind ?? 'text'} · ${selectionState} · ${formatSummary}`)
  }
)

liveRenderToggle.addEventListener('change', () => {
  const enabled = liveRenderToggle.checked
  muya.domNode.classList.toggle('trace-muya-source-mode', !enabled)
  liveRenderDetail.textContent = enabled ? '开启 · 光标所在标记可见' : '关闭 · 全部标记可见'
  recordEvent('setting-change', `实时渲染${enabled ? '开启' : '关闭'}`)
})

wrapToggle.addEventListener('change', () => {
  const enabled = wrapToggle.checked
  muya.setOptions({ wrapCodeBlocks: enabled })
  wrapDetail.textContent = enabled ? '开启 · 长代码行折行' : '关闭 · 长代码行横向滚动'
  recordEvent('setting-change', `自动换行${enabled ? '开启' : '关闭'}`)
})

query<HTMLButtonElement>('#plantuml-apply').addEventListener('click', () => {
  try {
    const server = validatePlantumlServer(plantumlInput.value)
    muya.setOptions({ plantumlServer: server }, true)
    plantumlInput.setAttribute('aria-invalid', 'false')
    plantumlState.classList.remove('setting-error')
    plantumlState.textContent = server
      ? `已启用 ${server}；PlantUML 源码会发送到该服务。`
      : '未配置，不联网；PlantUML 样例显示离线提示。'
    recordEvent('setting-change', server ? 'PlantUML Server 已启用' : 'PlantUML 保持离线')
  } catch (error) {
    plantumlInput.setAttribute('aria-invalid', 'true')
    plantumlState.classList.add('setting-error')
    plantumlState.textContent = error instanceof Error ? error.message : String(error)
  }
})

query<HTMLButtonElement>('#undo-button').addEventListener('click', () => muya.undo())
query<HTMLButtonElement>('#redo-button').addEventListener('click', () => muya.redo())
query<HTMLButtonElement>('#reset-button').addEventListener('click', () => {
  muya.setContent(INITIAL_MARKDOWN, true)
  updateMarkdownSnapshot()
  documentState.textContent = '验收样例已恢复'
  recordEvent('content-reset', '恢复初始 Markdown')
})

updateMarkdownSnapshot()
window.addEventListener('beforeunload', () => muya.destroy())
