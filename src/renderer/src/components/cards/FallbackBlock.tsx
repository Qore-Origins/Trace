import { useTranslation } from '../../i18n'
import { CardShell, type CardRenderProps } from './CardShell'

export function FallbackBlock({ comp, index, total }: CardRenderProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <CardShell kind={comp.type} componentId={comp.id} index={index} total={total} extraClass="note">
      <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{t('cards.unknownComponent', { type: comp.type })}</div>
    </CardShell>
  )
}
