// 计划单片组件卡（前端详细设计 §3.3-3.5 / LLD §2.3）：渲染即编辑；payload 直改 + 防抖保存
// 组件卡拖拽排序（2026-09-07，@dnd-kit 同款 AI Resource Hub）：手柄发起（distance 8 防误触），
// 拖动中被拖卡放大投影置顶、其余卡 transform 实时让位，落点 arrayMove 语义换序
import { useState, useRef } from 'react'
import { Input, Button } from 'antd'
import { EditOutlined, MenuUnfoldOutlined } from '@ant-design/icons'
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import type { Component, NotePayload } from '@shared/plan-types'
import { validateNoteText } from '@shared/validation'
import { usePlanMutations } from '../stores/plan-store'
import { useTranslation } from '../i18n'
import { NoteMarkdown } from './note-md'
import { CardShell } from './cards/CardShell'
import { createCardRegistry, resolveCardRenderer } from './cards/card-registry'

export { scoreColor, scoreTextColor } from './cards/MoodCard'
// ---------- 注释旁批（§3.5） ----------
// 双态：有内容默认预览（Markdown 子集渲染，含代码块）；空内容/切编辑 → textarea 编辑
// 编辑态格式工具栏（2026-09-12 用户需求，marktext/word 式一键样式）：选区包裹 markdown 语法
// 渲染态「自动换行」开关：切代码块/超长行 pre 折行显示（卡内局部状态，不持久化）
function NoteCard({ comp, index, total }: { comp: Component; index: number; total: number }): React.JSX.Element {
  const { t } = useTranslation()
  const { patchComponent } = usePlanMutations()
  const p = comp.payload as NotePayload
  const [editing, setEditing] = useState(p.content.trim() === '')
  const [wrap, setWrap] = useState(true) // 默认折行：注释卡固定宽度、不出现横向滚动条（用户澄清 2026-09-12）；开关切回原始排版
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const openLink = (url: string): void => {
    if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer')
    // 相对/无协议链接仅拦截内嵌导航（防止 Electron 页面跳走），不打开
  }

  // 选区包裹语法（before/after 夹住选区；无选区插语法对，光标落在中间）
  const wrapSelection = (before: string, after: string): void => {
    const ta = taRef.current
    if (!ta) return
    const s = ta.selectionStart
    const e = ta.selectionEnd
    const next = p.content.slice(0, s) + before + p.content.slice(s, e) + after + p.content.slice(e)
    validateNoteText(next, t('cards.noteLabel'))
    patchComponent(comp.id, (payload) => {
      ;(payload as NotePayload).content = next
    })
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(s + before.length, e + before.length)
    })
  }

  const fmtButtons: Array<{ label: string; cls: string; title: string; before: string; after: string }> = [
    { label: 'B', cls: 'b', title: t('cards.fmtBold'), before: '**', after: '**' },
    { label: 'I', cls: 'i', title: t('cards.fmtItalic'), before: '*', after: '*' },
    { label: 'S', cls: 's', title: t('cards.fmtStrike'), before: '~~', after: '~~' },
    { label: 'U', cls: 'u', title: t('cards.fmtUnderline'), before: '<u>', after: '</u>' },
    { label: '‹›', cls: '', title: t('cards.fmtCode'), before: '`', after: '`' },
    { label: '▢', cls: '', title: t('cards.fmtCodeBlock'), before: '\n```\n', after: '\n```\n' },
    { label: t('cards.fmtLink'), cls: '', title: t('cards.fmtLink'), before: '[', after: '](url)' }
  ]

  return (
    <CardShell kind="note" componentId={comp.id} index={index} total={total} extraClass="note">
      {editing ? (
        <>
          <div className="note-fmt-bar">
            {fmtButtons.map((b) => (
              <button
                key={b.cls + b.label}
                type="button"
                className={`fmt-btn ${b.cls}`}
                title={b.title}
                aria-label={b.title}
                onClick={() => wrapSelection(b.before, b.after)}
              >
                {b.label}
              </button>
            ))}
          </div>
          <Input.TextArea
            ref={(el) => {
              taRef.current = el?.resizableTextArea?.textArea ?? null
            }}
            variant="borderless"
            placeholder={t('cards.notePlaceholder')}
            autoSize
            value={p.content}
            onChange={(e) => {
              validateNoteText(e.target.value, t('cards.noteLabel'))
              patchComponent(comp.id, (payload) => {
                ;(payload as NotePayload).content = e.target.value
              })
            }}
          />
          <div className="note-actions">
            <Button size="small" type="text" onClick={() => setEditing(false)}>
              {t('cards.noteDone')}
            </Button>
            <span className="note-hint">{t('cards.noteMdHint')}</span>
          </div>
        </>
      ) : (
        <>
          <NoteMarkdown content={p.content} onLink={openLink} wrap={wrap} />
          <div className="note-actions note-actions-end">
            <Button
              size="small"
              type="text"
              className={wrap ? 'note-wrap-on' : undefined}
              icon={<MenuUnfoldOutlined />}
              title={t('cards.noteWrap')}
              aria-label={t('cards.noteWrap')}
              onClick={() => setWrap((w) => !w)}
            >
              {t('cards.noteWrap')}
            </Button>
            <Button size="small" type="text" icon={<EditOutlined />} onClick={() => setEditing(true)}>
              {t('cards.noteEdit')}
            </Button>
          </div>
        </>
      )}
      <div className="note-time">{p.created_at.slice(0, 10)}</div>
    </CardShell>
  )
}

const CARD_REGISTRY = createCardRegistry(NoteCard)

export function ComponentRenderer({ components, today }: { components: Component[]; today: Date }): React.JSX.Element {
  const { moveComponent } = usePlanMutations()
  // 同款 AI Resource Hub：指针 8px 位移才激活（防误触，手柄上的单击不触发拖拽）
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    if (!over || active.id === over.id) return
    const from = components.findIndex((c) => c.id === active.id)
    const to = components.findIndex((c) => c.id === over.id)
    if (from === -1 || to === -1) return
    // moveComponent 语义=先移除源再插入目标位，与 arrayMove 等价
    moveComponent(String(active.id), to)
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={components.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        {components.map((comp, index) => {
          const Renderer = resolveCardRenderer(CARD_REGISTRY, comp.type)
          return <Renderer key={comp.id} comp={comp} index={index} total={components.length} today={today} />
        })}
      </SortableContext>
    </DndContext>
  )
}
