import type { TaskItem, TaskListPayload } from '@shared/plan-types'
import { isOverdue } from '@shared/task-state'
import { uuid32 } from '@shared/validation'
import { useTranslation } from '../../i18n'
import { usePlanMutations } from '../../stores/plan-store'
import { ActionButton } from '../ui/ActionButton'
import { removePlanRow } from '../ui/plan-row-actions'
import { CardShell, type CardRenderProps } from './CardShell'

function nextStatus(s: TaskItem['status']): TaskItem['status'] {
  // 状态机（shared/task-state）：唯一不可达 = not_started→done
  if (s === 'not_started') return 'in_progress'
  if (s === 'in_progress') return 'done'
  return 'in_progress' // done → in_progress（回退）
}

export function TaskListCard({ comp, index, total, today }: CardRenderProps): React.JSX.Element {
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
            <ActionButton intent="quiet" danger className="task-del" label={t('cards.deleteRow')}
              aria-label={`${t('common.delete')} ${item.title || t('cards.addTask')}`}
              onClick={() => removePlanRow(comp.id, 'task', item.id, item.title || t('cards.addTask'))} />
          </div>
        ))}
        <button
          type="button"
          className="lite-btn" style={{ marginTop: 4 }}
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
