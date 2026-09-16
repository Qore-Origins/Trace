import { Checkbox, Input } from 'antd'
import type { SinglePlanPayload } from '@shared/plan-types'
import { todayDateStr, validateDueDate } from '@shared/validation'
import { useTranslation } from '../../i18n'
import { usePlanMutations } from '../../stores/plan-store'
import { CardShell, type CardRenderProps } from './CardShell'

export function SinglePlanCard({ comp, index, total }: CardRenderProps): React.JSX.Element {
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
