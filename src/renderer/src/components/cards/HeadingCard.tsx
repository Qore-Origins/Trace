import { Input, Slider } from 'antd'
import type { HeadingPayload } from '@shared/plan-types'
import { useTranslation } from '../../i18n'
import { usePlanMutations, useReferenceAwareTitle } from '../../stores/plan-store'
import { CardShell, type CardRenderProps } from './CardShell'

export function HeadingCard({ comp, index, total }: CardRenderProps): React.JSX.Element {
  const { t } = useTranslation()
  const { patchComponent } = usePlanMutations()
  const p = comp.payload as HeadingPayload
  const title = useReferenceAwareTitle(comp)
  // 与 TaskDetailCard.patch 同款包装：patchComponent 收 ComponentPayload 宽类型，此处夹窄为 HeadingPayload
  const replace = (fn: (pl: HeadingPayload) => void): void => patchComponent(comp.id, (payload) => fn(payload as HeadingPayload))
  return (
    <CardShell kind="heading" componentId={comp.id} index={index} total={total} extraClass="heading">
      <Input variant="borderless" placeholder={t('cards.headingPlaceholder')} className="heading-input"
        style={{ fontSize: p.size }}
        maxLength={200}
        value={title.value}
        onChange={(e) => title.setValue(e.target.value)}
        onBlur={() => { void title.commit() }}
        onPressEnter={(e) => e.currentTarget.blur()}
      />
      <div className="heading-tools">
        <Slider min={14} max={32} value={p.size} onChange={(v) => replace((pl) => { pl.size = v })} />
        <span className="heading-size">{p.size}px</span>
      </div>
    </CardShell>
  )
}
