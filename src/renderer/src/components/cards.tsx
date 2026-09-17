// 计划单片组件卡（前端详细设计 §3.3-3.5 / LLD §2.3）：渲染即编辑；payload 直改 + 防抖保存
// 组件卡拖拽排序（2026-09-07，@dnd-kit 同款 AI Resource Hub）：手柄发起（distance 8 防误触），
// 拖动中被拖卡放大投影置顶、其余卡 transform 实时让位，落点 arrayMove 语义换序
import { useEffect } from 'react'
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import type { Component, NotePayload } from '@shared/plan-types'
import { validateNoteText } from '@shared/validation'
import { usePlanMutations } from '../stores/plan-store'
import { useNoteEditorStore } from '../stores/note-editor-store'
import { usePrefStore } from '../stores/pref-store'
import { useTranslation } from '../i18n'
import { NoteMarkdown } from './note-md'
import { MuyaNoteEditor } from './muya-note/MuyaNoteEditor'
import { CardShell } from './cards/CardShell'
import { createCardRegistry, resolveCardRenderer } from './cards/card-registry'

export { scoreColor, scoreTextColor } from './cards/MoodCard'
// ---------- 注释旁批（§3.5） ----------
// 非活跃卡保持轻量、安全的静态 Markdown；同一时刻仅一个活跃卡挂载 Muya。
function NoteCard({ comp, index, total }: { comp: Component; index: number; total: number }): React.JSX.Element {
  const { t } = useTranslation()
  const { patchComponent } = usePlanMutations()
  const activeComponentId = useNoteEditorStore((state) => state.activeComponentId)
  const activate = useNoteEditorStore((state) => state.activate)
  const deactivate = useNoteEditorStore((state) => state.deactivate)
  const { noteLiveRender, noteWrap, plantumlServer, language } = usePrefStore()
  const p = comp.payload as NotePayload
  const active = activeComponentId === comp.id

  useEffect(() => () => deactivate(comp.id), [comp.id, deactivate])

  const openLink = (url: string): void => {
    if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer')
    // 相对/无协议链接仅拦截内嵌导航（防止 Electron 页面跳走），不打开
  }

  const updateMarkdown = (markdown: string): void => {
    validateNoteText(markdown, t('cards.noteLabel'))
    patchComponent(comp.id, (payload) => {
      ;(payload as NotePayload).content = markdown
    })
  }

  const activateFromStaticView = (target: EventTarget | null): void => {
    if (target instanceof Element && target.closest('a, button')) return
    activate(comp.id)
  }

  return (
    <CardShell kind="note" componentId={comp.id} index={index} total={total} extraClass="note">
      {active ? (
        <MuyaNoteEditor
          value={p.content}
          onChange={updateMarkdown}
          liveRender={noteLiveRender}
          wrap={noteWrap}
          plantumlServer={plantumlServer}
          language={language}
          placeholder={t('cards.notePlaceholder')}
        />
      ) : (
        <div
          className="note-static"
          role="button"
          tabIndex={0}
          aria-label={t('cards.noteActivate')}
          onClick={(event) => activateFromStaticView(event.target)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            activate(comp.id)
          }}
        >
          {p.content.trim() ? (
            <NoteMarkdown content={p.content} onLink={openLink} wrap={noteWrap} />
          ) : (
            <div className="note-empty">{t('cards.notePlaceholder')}</div>
          )}
        </div>
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
