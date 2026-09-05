// 计划单片组件卡（前端详细设计 §3.3-3.5 / LLD §2.3）：渲染即编辑；payload 直改 + 防抖保存
import { Input, Checkbox } from 'antd'
import { ArrowUpOutlined, ArrowDownOutlined, DeleteOutlined } from '@ant-design/icons'
import type { Component, MultiPlanPayload, NotePayload, SinglePlanPayload, TaskDetailPayload, TaskItem, TaskListPayload } from '@shared/plan-types'
import { uuid32, validateNoteText } from '@shared/validation'
import { isOverdue } from '@shared/task-state'
import { usePlanMutations } from '../stores/plan-store'

const KIND_LABEL: Record<string, string> = {
  single_plan: '单选计划',
  multi_plan: '多选计划',
  task_list: '任务列表',
  task_detail: '任务详情',
  note: '注释（旁批）'
}

function CardShell(props: {
  kind: string
  componentId: string
  index: number
  total: number
  extraClass?: string
  head?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  const { moveComponent, removeComponent } = usePlanMutations()
  return (
    <div className={`card ${props.extraClass ?? ''}`} data-component-id={props.componentId}>
      <div className="kind">{KIND_LABEL[props.kind] ?? props.kind}</div>
      {props.head}
      {props.children}
      <div className="actions" style={{ display: undefined }}>
        <button
          type="button"
          aria-label="上移"
          onClick={() => moveComponent(props.componentId, props.index - 1)}
          style={{ visibility: props.index > 0 ? 'visible' : 'hidden' }}
        >
          <ArrowUpOutlined />
        </button>
        <button
          type="button"
          aria-label="下移"
          onClick={() => moveComponent(props.componentId, props.index + 1)}
          style={{ visibility: props.index < props.total - 1 ? 'visible' : 'hidden' }}
        >
          <ArrowDownOutlined />
        </button>
        <button type="button" className="danger" aria-label="删除组件" onClick={() => removeComponent(props.componentId)}>
          <DeleteOutlined />
        </button>
      </div>
    </div>
  )
}

// ---------- 单选计划（§3.3 有重量的卡） ----------
function SinglePlanCard({ comp, index, total }: { comp: Component; index: number; total: number }): React.JSX.Element {
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
            placeholder="本期唯一主线…"
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
          placeholder="摘要（可选）"
          autoSize
          value={p.summary ?? ''}
          onChange={(e) =>
            patchComponent(comp.id, (payload) => {
              ;(payload as SinglePlanPayload).summary = e.target.value
            })
          }
        />
      </div>
    </CardShell>
  )
}

// ---------- 多选计划（§3.4 岔路口；已选 x/n 常显） ----------
function MultiPlanCard({ comp, index, total }: { comp: Component; index: number; total: number }): React.JSX.Element {
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
            placeholder="并列可选项…"
            onChange={(e) =>
              patchComponent(comp.id, (payload) => {
                ;(payload as MultiPlanPayload).title = e.target.value
              })
            }
          />
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
            已选 {selected}/{p.options.length}
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
              className="task-del"
              onClick={() =>
                patchComponent(comp.id, (payload) => {
                  const mp = payload as MultiPlanPayload
                  mp.options = mp.options.filter((x) => x.id !== o.id)
                })
              }
            >
              删除
            </button>
          </div>
        ))}
        <button
          type="button"
          style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}
          onClick={() =>
            patchComponent(comp.id, (payload) => {
              ;(payload as MultiPlanPayload).options.push({ id: uuid32(), text: '', checked: false })
            })
          }
        >
          ＋ 选项
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
            placeholder="任务列表…"
            onChange={(e) =>
              patchComponent(comp.id, (payload) => {
                ;(payload as TaskListPayload).title = e.target.value
              })
            }
          />
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
            {doneCount}/{p.items.length} 已抵达
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
            {isOverdue(item.status, item.planned_at, today) && <span className="tag-overdue">逾期</span>}
            <button
              type="button"
              className="task-del"
              onClick={() =>
                patchComponent(comp.id, (payload) => {
                  const tl = payload as TaskListPayload
                  tl.items = tl.items.filter((x) => x.id !== item.id)
                })
              }
            >
              删除
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
          ＋ 任务
        </button>
      </div>
    </CardShell>
  )
}

// ---------- 任务详情（单任务完整卡） ----------
function TaskDetailCard({ comp, index, total, today }: { comp: Component; index: number; total: number; today: Date }): React.JSX.Element {
  const { patchComponent } = usePlanMutations()
  const p = comp.payload as TaskDetailPayload
  const patch = (fn: (payload: TaskDetailPayload) => void): void => patchComponent(comp.id, (payload) => fn(payload as TaskDetailPayload))
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
            placeholder="任务…"
            onChange={(e) => patch((pl) => (pl.title = e.target.value))}
          />
          {isOverdue(p.status, p.planned_at, today) && <span className="tag-overdue">逾期</span>}
        </div>
      }
    >
      <Input.TextArea
        variant="borderless"
        placeholder="描述…"
        autoSize
        value={p.description ?? ''}
        onChange={(e) => {
          validateNoteText(e.target.value, '描述')
          patch((pl) => (pl.description = e.target.value))
        }}
      />
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 4 }}>
        <input type="date" className="task-date" value={p.planned_at ?? ''} onChange={(e) => patch((pl) => (pl.planned_at = e.target.value || undefined))} />
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>状态：{p.status === 'done' ? '已抵达' : p.status === 'in_progress' ? '在途' : '未出发'}</span>
        {p.status === 'done' && p.completed_at && <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{p.completed_at.slice(0, 10)}</span>}
      </div>
    </CardShell>
  )
}

// ---------- 注释旁批（§3.5） ----------
function NoteCard({ comp, index, total }: { comp: Component; index: number; total: number }): React.JSX.Element {
  const { patchComponent } = usePlanMutations()
  const p = comp.payload as NotePayload
  return (
    <CardShell kind="note" componentId={comp.id} index={index} total={total} extraClass="note">
      <Input.TextArea
        variant="borderless"
        placeholder="旁批：复盘、心得、补充…"
        autoSize
        value={p.content}
        onChange={(e) => {
          validateNoteText(e.target.value, '注释')
          patchComponent(comp.id, (payload) => {
            ;(payload as NotePayload).content = e.target.value
          })
        }}
      />
      <div className="note-time">{p.created_at.slice(0, 10)}</div>
    </CardShell>
  )
}

// ---------- 降级占位（契约向前兼容：未知 type 不崩不丢） ----------
function FallbackBlock({ comp, index, total }: { comp: Component; index: number; total: number }): React.JSX.Element {
  return (
    <CardShell kind={comp.type} componentId={comp.id} index={index} total={total} extraClass="note">
      <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
        ⚠ 未知组件类型「{comp.type}」——内容已原样保留，等待新版本应用读取。
      </div>
    </CardShell>
  )
}

export function ComponentRenderer({ components, today }: { components: Component[]; today: Date }): React.JSX.Element {
  return (
    <>
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
          default:
            return <FallbackBlock key={c.id} comp={c} index={i} total={components.length} />
        }
      })}
    </>
  )
}
