import { Checkbox } from 'antd'
import type { MultiPlanPayload } from '@shared/plan-types'
import { uuid32 } from '@shared/validation'
import { useTranslation } from '../../i18n'
import { usePlanMutations } from '../../stores/plan-store'
import { ActionButton } from '../ui/ActionButton'
import { removePlanRow } from '../ui/plan-row-actions'
import { CardShell, type CardRenderProps } from './CardShell'

export function MultiPlanCard({ comp, index, total }: CardRenderProps): React.JSX.Element {
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
            <ActionButton intent="quiet" danger className="task-del" label={t('cards.deleteRow')}
              aria-label={`${t('common.delete')} ${o.text || t('cards.addOption')}`}
              onClick={() => removePlanRow(comp.id, 'option', o.id, o.text || t('cards.addOption'))} />
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
