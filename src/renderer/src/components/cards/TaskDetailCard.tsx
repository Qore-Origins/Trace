import { Checkbox, Input } from 'antd'
import type { TaskDetailPayload } from '@shared/plan-types'
import { isOverdue } from '@shared/task-state'
import { validateNoteText } from '@shared/validation'
import { useTranslation } from '../../i18n'
import { usePlanMutations } from '../../stores/plan-store'
import { CardShell, type CardRenderProps } from './CardShell'

export function TaskDetailCard({ comp, index, total, today }: CardRenderProps): React.JSX.Element {
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
        {p.status === 'done' && p.completed_at && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{p.completed_at.slice(0, 10)}</span>}
      </div>
    </CardShell>
  )
}
