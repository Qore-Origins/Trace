// 计划单片组件卡（前端详细设计 §3.3-3.5 / LLD §2.3）：渲染即编辑；payload 直改 + 防抖保存
// 组件卡拖拽排序（2026-09-07，@dnd-kit 同款 AI Resource Hub）：手柄发起（distance 8 防误触），
// 拖动中被拖卡放大投影置顶、其余卡 transform 实时让位，落点 arrayMove 语义换序
import { useState } from 'react'
import { Input, Checkbox, Button, InputNumber, Slider } from 'antd'
import { ArrowUpOutlined, ArrowDownOutlined, DeleteOutlined, EditOutlined, HolderOutlined } from '@ant-design/icons'
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Component, HeadingPayload, MoodPayload, MultiPlanPayload, NotePayload, SinglePlanPayload, TaskDetailPayload, TaskItem, TaskListPayload } from '@shared/plan-types'
import { uuid32, validateNoteText, validateDueDate, validateScore, todayDateStr } from '@shared/validation'
import { isOverdue } from '@shared/task-state'
import { usePlanMutations } from '../stores/plan-store'
import { usePrefStore } from '../stores/pref-store'
import { useTranslation } from '../i18n'
import { NoteMarkdown } from './note-md'
import { MoodScoreRoll } from './mood-score-roll'

function CardShell(props: {
  kind: string
  componentId: string
  index: number
  total: number
  extraClass?: string
  head?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  const { t } = useTranslation()
  const kindLabel =
    props.kind === 'single_plan'
      ? t('cards.kindSinglePlan')
      : props.kind === 'multi_plan'
        ? t('cards.kindMultiPlan')
        : props.kind === 'task_list'
          ? t('cards.kindTaskList')
          : props.kind === 'task_detail'
            ? t('cards.kindTaskDetail')
            : props.kind === 'mood'
              ? t('cards.moodLabel')
              : props.kind === 'heading'
                ? t('content.insertHeading')
                : t('cards.kindNote')
  const { moveComponent, removeComponent } = usePlanMutations()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.componentId })
  // 剥掉 scale 分量（仅保留位移补偿）：dnd-kit useDerivedTransform 在 index 切换时会给出
  // 初始/当前矩形的比例（scaleX/scaleY），卡片高度不一时被拖卡被拉伸成目标卡形状
  // （用户报告"继承目标卡宽高"，CDP 实证 transform matrix scaleY=2.34——2026-09-10）
  const tt = transform ? { x: transform.x, y: transform.y, scaleX: 1, scaleY: 1 } : null
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(tt), transition }}
      className={`card ${props.extraClass ?? ''}${isDragging ? ' dragging' : ''}`}
      data-component-id={props.componentId}
    >
      <div className="kind">
        <span className="drag-handle" aria-label={t('cards.dragSort')} title={t('cards.dragSortTitle')} {...attributes} {...listeners}>
          <HolderOutlined />
        </span>
        {kindLabel}
      </div>
      {props.head}
      {props.children}
      <div className="actions">
        <button
          type="button"
          className="lite-btn"
          aria-label={t('cards.moveUp')}
          onClick={() => moveComponent(props.componentId, props.index - 1)}
          style={{ visibility: props.index > 0 ? 'visible' : 'hidden' }}
        >
          <ArrowUpOutlined />
        </button>
        <button
          type="button"
          className="lite-btn"
          aria-label={t('cards.moveDown')}
          onClick={() => moveComponent(props.componentId, props.index + 1)}
          style={{ visibility: props.index < props.total - 1 ? 'visible' : 'hidden' }}
        >
          <ArrowDownOutlined />
        </button>
        <button type="button" className="lite-btn danger" aria-label={t('cards.remove')} onClick={() => removeComponent(props.componentId)}>
          <DeleteOutlined />
        </button>
      </div>
    </div>
  )
}

// ---------- 单选计划（§3.3 有重量的卡） ----------
function SinglePlanCard({ comp, index, total }: { comp: Component; index: number; total: number }): React.JSX.Element {
  const { t } = useTranslation()
  const { patchComponent } = usePlanMutations()
  const p = comp.payload as SinglePlanPayload
  return (
    <CardShell
      kind="single_plan"
      componentId={comp.id}
      index={index}
      total={total}
      extraClass={p.done ? 'single-done' : ''}
      head={
        <div className="head">
          <Checkbox
            checked={p.done}
            onChange={(e) => patchComponent(comp.id, (payload) => {
              ;(payload as SinglePlanPayload).done = e.target.checked
            })}
          />
          <input
            className="single-title"
            value={p.title}
            placeholder={t('cards.singlePlaceholder')}
            onChange={(e) =>
              patchComponent(comp.id, (payload) => {
                ;(payload as SinglePlanPayload).title = e.target.value
              })
            }
          />
        </div>
      }
    >
      <div className="single-summary">
        <Input.TextArea
          variant="borderless"
          placeholder={t('cards.summaryPlaceholder')}
          autoSize
          value={p.summary ?? ''}
          onChange={(e) =>
            patchComponent(comp.id, (payload) => {
              ;(payload as SinglePlanPayload).summary = e.target.value
            })
          }
        />
      </div>
      <div className="single-due">
        <input
          type="date"
          className={`single-due-input${p.due_date && p.due_date < todayDateStr() ? ' overdue' : ''}`}
          value={p.due_date ?? ''}
          onChange={(e) => {
            validateDueDate(e.target.value || undefined)
            patchComponent(comp.id, (payload) => {
              ;(payload as SinglePlanPayload).due_date = e.target.value || undefined // 清空=undefined
            })
          }}
        />
        {p.due_date && p.due_date < todayDateStr() && <span className="single-due-overdue">{t('cards.overdue')}</span>}
      </div>
    </CardShell>
  )
}

// ---------- 多选计划（§3.4 岔路口；已选 x/n 常显） ----------
function MultiPlanCard({ comp, index, total }: { comp: Component; index: number; total: number }): React.JSX.Element {
  const { t } = useTranslation()
  const { patchComponent } = usePlanMutations()
  const p = comp.payload as MultiPlanPayload
  const selected = p.options.filter((o) => o.checked).length
  return (
    <CardShell
      kind="multi_plan"
      componentId={comp.id}
      index={index}
      total={total}
      head={
        <div className="head">
          <input
            className="single-title"
            style={{ fontSize: 14 }}
            value={p.title}
            placeholder={t('cards.multiPlaceholder')}
            onChange={(e) =>
              patchComponent(comp.id, (payload) => {
                ;(payload as MultiPlanPayload).title = e.target.value
              })
            }
          />
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
            {t('cards.selected', { done: selected, total: p.options.length })}
          </span>
        </div>
      }
    >
      <div>
        {p.options.map((o) => (
          <div className="task-row" key={o.id}>
            <Checkbox
              checked={o.checked}
              onChange={(e) =>
                patchComponent(comp.id, (payload) => {
                  const opt = (payload as MultiPlanPayload).options.find((x) => x.id === o.id)
                  if (opt) opt.checked = e.target.checked
                })
              }
            />
            <div className="task-title">
              <input
                value={o.text}
                onChange={(e) =>
                  patchComponent(comp.id, (payload) => {
                    const opt = (payload as MultiPlanPayload).options.find((x) => x.id === o.id)
                    if (opt) opt.text = e.target.value
                  })
                }
              />
            </div>
            <button
              type="button"
              className="task-del lite-btn danger"
              onClick={() =>
                patchComponent(comp.id, (payload) => {
                  const mp = payload as MultiPlanPayload
                  mp.options = mp.options.filter((x) => x.id !== o.id)
                })
              }
            >
              {t('cards.deleteRow')}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="lite-btn" style={{ marginTop: 4 }}
          onClick={() =>
            patchComponent(comp.id, (payload) => {
              ;(payload as MultiPlanPayload).options.push({ id: uuid32(), text: '', checked: false })
            })
          }
        >
          {t('cards.addOption')}
        </button>
      </div>
    </CardShell>
  )
}

// ---------- 任务列表（§3.2 足迹三态） ----------
function nextStatus(s: TaskItem['status']): TaskItem['status'] {
  // 状态机（shared/task-state）：唯一不可达 = not_started→done
  if (s === 'not_started') return 'in_progress'
  if (s === 'in_progress') return 'done'
  return 'in_progress' // done → in_progress（回退）
}

function TaskListCard({ comp, index, total, today }: { comp: Component; index: number; total: number; today: Date }): React.JSX.Element {
  const { t } = useTranslation()
  const { patchComponent } = usePlanMutations()
  const p = comp.payload as TaskListPayload
  const doneCount = p.items.filter((t) => t.status === 'done').length

  const patchItem = (taskId: string, fn: (item: TaskItem) => void): void =>
    patchComponent(comp.id, (payload) => {
      const item = (payload as TaskListPayload).items.find((x) => x.id === taskId)
      if (item) fn(item)
    })

  return (
    <CardShell
      kind="task_list"
      componentId={comp.id}
      index={index}
      total={total}
      head={
        <div className="head">
          <input
            className="single-title"
            style={{ fontSize: 14 }}
            value={p.title}
            placeholder={t('cards.taskListPlaceholder')}
            onChange={(e) =>
              patchComponent(comp.id, (payload) => {
                ;(payload as TaskListPayload).title = e.target.value
              })
            }
          />
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
            {t('cards.arrived', { done: doneCount, total: p.items.length })}
          </span>
        </div>
      }
    >
      <div>
        {p.items.map((item) => (
          <div className={`task-row ${item.status}`} key={item.id}>
            <button type="button" className="state-ring" aria-label="切换状态" onClick={() => patchItem(item.id, (it) => (it.status = nextStatus(it.status)))} />
            <div className="task-title">
              <input
                value={item.title}
                onChange={(e) => patchItem(item.id, (it) => (it.title = e.target.value))}
              />
            </div>
            <input
              type="date"
              className="task-date"
              value={item.planned_at ?? ''}
              onChange={(e) => patchItem(item.id, (it) => (it.planned_at = e.target.value || undefined))}
            />
            {isOverdue(item.status, item.planned_at, today) && <span className="tag-overdue">{t('cards.overdue')}</span>}
            <button
              type="button"
              className="task-del lite-btn danger"
              onClick={() =>
                patchComponent(comp.id, (payload) => {
                  const tl = payload as TaskListPayload
                  tl.items = tl.items.filter((x) => x.id !== item.id)
                })
              }
            >
              {t('cards.deleteRow')}
            </button>
          </div>
        ))}
        <button
          type="button"
          style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}
          onClick={() =>
            patchComponent(comp.id, (payload) => {
              ;(payload as TaskListPayload).items.push({ id: uuid32(), title: '', status: 'not_started' })
            })
          }
        >
          {t('cards.addTask')}
        </button>
      </div>
    </CardShell>
  )
}

// ---------- 任务详情（单任务完整卡） ----------
function TaskDetailCard({ comp, index, total, today }: { comp: Component; index: number; total: number; today: Date }): React.JSX.Element {
  const { t } = useTranslation()
  const { patchComponent } = usePlanMutations()
  const p = comp.payload as TaskDetailPayload
  const patch = (fn: (payload: TaskDetailPayload) => void): void => patchComponent(comp.id, (payload) => fn(payload as TaskDetailPayload))
  const statusText = p.status === 'done' ? t('cards.statusDone') : p.status === 'in_progress' ? t('cards.statusInProgress') : t('cards.statusNotStarted')
  return (
    <CardShell
      kind="task_detail"
      componentId={comp.id}
      index={index}
      total={total}
      head={
        <div className="head">
          <Checkbox checked={p.status === 'done'} onChange={(e) => patch((pl) => (pl.status = e.target.checked ? 'done' : 'in_progress'))} />
          <input
            className="single-title"
            style={{ fontSize: 14 }}
            value={p.title}
            placeholder={t('cards.taskPlaceholder')}
            onChange={(e) => patch((pl) => (pl.title = e.target.value))}
          />
          {isOverdue(p.status, p.planned_at, today) && <span className="tag-overdue">{t('cards.overdue')}</span>}
        </div>
      }
    >
      <Input.TextArea
        variant="borderless"
        placeholder={t('cards.descPlaceholder')}
        autoSize
        value={p.description ?? ''}
        onChange={(e) => {
          validateNoteText(e.target.value, t('cards.descLabel'))
          patch((pl) => (pl.description = e.target.value))
        }}
      />
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 4 }}>
        <input type="date" className="task-date" value={p.planned_at ?? ''} onChange={(e) => patch((pl) => (pl.planned_at = e.target.value || undefined))} />
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{t('cards.statusLabel', { value: statusText })}</span>
        {p.status === 'done' && p.completed_at && <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{p.completed_at.slice(0, 10)}</span>}
      </div>
    </CardShell>
  )
}

// ---------- 注释旁批（§3.5） ----------
// 双态：有内容默认预览（Markdown 子集渲染，含代码块）；空内容/切编辑 → textarea 编辑
function NoteCard({ comp, index, total }: { comp: Component; index: number; total: number }): React.JSX.Element {
  const { t } = useTranslation()
  const { patchComponent } = usePlanMutations()
  const p = comp.payload as NotePayload
  const [editing, setEditing] = useState(p.content.trim() === '')
  const openLink = (url: string): void => {
    if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer')
    // 相对/无协议链接仅拦截内嵌导航（防止 Electron 页面跳走），不打开
  }
  return (
    <CardShell kind="note" componentId={comp.id} index={index} total={total} extraClass="note">
      {editing ? (
        <>
          <Input.TextArea
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
          <NoteMarkdown content={p.content} onLink={openLink} />
          <div className="note-actions note-actions-end">
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

// ---------- 今日心情（日记向：大数字+描述+日期，评分 0-100 可小数） ----------
// 心情色阶：≤30 冷灰蓝 → ≥80 暖橙（线性）
export function scoreColor(score: number): string {
  const t = Math.max(0, Math.min(1, (score - 30) / 50))
  const from = [96, 130, 182] // 冷
  const to = [255, 122, 69] // 暖
  const mix = from.map((c, i) => Math.round(c + (to[i] - c) * t))
  return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`
}

function MoodCard({ comp, index, total }: { comp: Component; index: number; total: number }): React.JSX.Element {
  const { t } = useTranslation()
  const { patchComponent } = usePlanMutations()
  const scoreAnim = usePrefStore((s) => s.scoreAnim)
  const p = comp.payload as MoodPayload
  return (
    <CardShell kind="mood" componentId={comp.id} index={index} total={total} extraClass="mood">
      <div className="mood-row">
        <div className="mood-score" style={{ color: scoreColor(p.score) }}>
          {scoreAnim === 'roll' ? <MoodScoreRoll value={p.score} /> : p.score}
        </div>
        <InputNumber
          min={0} max={100} step={1} precision={2}
          className="mood-input"
          value={p.score}
          onChange={(v) => {
            try {
              patchComponent(comp.id, (payload) => { (payload as MoodPayload).score = validateScore(v) })
            } catch {
              // 非法输入静默拒绝（不改 store）
            }
          }}
        />
      </div>
      <Input.TextArea variant="borderless" autoSize placeholder={t('cards.moodPlaceholder')}
        value={p.text}
        onChange={(e) => { validateNoteText(e.target.value, t('cards.moodLabel')); patchComponent(comp.id, (pl) => { (pl as MoodPayload).text = e.target.value }) }} />
      <div className="mood-meta">
        <input type="date" className="mood-date" value={p.mood_date}
          onChange={(e) => {
            // 清空=回退今天（mood_date 契约必填；空值 guard 导致受控回弹——2026-09-09 ledger 此项）
            const next = e.target.value || todayDateStr()
            patchComponent(comp.id, (pl) => { (pl as MoodPayload).mood_date = next })
          }} />
        <span>{p.created_at.slice(0, 10)}</span>
      </div>
    </CardShell>
  )
}

// ---------- 标题（单行纯标题，字号滑杆 14-32 实时预览） ----------
function HeadingCard({ comp, index, total }: { comp: Component; index: number; total: number }): React.JSX.Element {
  const { t } = useTranslation()
  const { patchComponent } = usePlanMutations()
  const p = comp.payload as HeadingPayload
  // 与 TaskDetailCard.patch 同款包装：patchComponent 收 ComponentPayload 宽类型，此处夹窄为 HeadingPayload
  const replace = (fn: (pl: HeadingPayload) => void): void => patchComponent(comp.id, (payload) => fn(payload as HeadingPayload))
  return (
    <CardShell kind="heading" componentId={comp.id} index={index} total={total} extraClass="heading">
      <Input variant="borderless" placeholder={t('cards.headingPlaceholder')} className="heading-input"
        style={{ fontSize: p.size }}
        maxLength={200}
        value={p.title}
        onChange={(e) => replace((pl) => { pl.title = e.target.value })}
      />
      <div className="heading-tools">
        <Slider min={14} max={32} value={p.size} onChange={(v) => replace((pl) => { pl.size = v })} />
        <span className="heading-size">{p.size}px</span>
      </div>
    </CardShell>
  )
}

// ---------- 降级占位（契约向前兼容：未知 type 不崩不丢） ----------
function FallbackBlock({ comp, index, total }: { comp: Component; index: number; total: number }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <CardShell kind={comp.type} componentId={comp.id} index={index} total={total} extraClass="note">
      <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{t('cards.unknownComponent', { type: comp.type })}</div>
    </CardShell>
  )
}

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
        {components.map((c, i) => {
          switch (c.type) {
            case 'single_plan':
              return <SinglePlanCard key={c.id} comp={c} index={i} total={components.length} />
            case 'multi_plan':
              return <MultiPlanCard key={c.id} comp={c} index={i} total={components.length} />
            case 'task_list':
              return <TaskListCard key={c.id} comp={c} index={i} total={components.length} today={today} />
            case 'task_detail':
              return <TaskDetailCard key={c.id} comp={c} index={i} total={components.length} today={today} />
            case 'note':
              return <NoteCard key={c.id} comp={c} index={i} total={components.length} />
            case 'mood':
              return <MoodCard key={c.id} comp={c} index={i} total={components.length} />
            case 'heading':
              return <HeadingCard key={c.id} comp={c} index={i} total={components.length} />
            // case 'custom': CustomCard 属 Task 5（MdContent 抽取后）；此前 custom 走 default 降级占位（数据不丢）
            default:
              return <FallbackBlock key={c.id} comp={c} index={i} total={components.length} />
          }
        })}
      </SortableContext>
    </DndContext>
  )
}
