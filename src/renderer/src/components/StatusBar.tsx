// StatusBar（§3.8）：系统脉搏——索引/保存/根目录
import { useAppStore } from '../stores/app-store'
import { usePlanStore } from '../stores/plan-store'
import { useTranslation } from '../i18n'

export default function StatusBar(): React.JSX.Element {
  const { t } = useTranslation()
  const indexState = useAppStore((s) => s.indexState)
  const rootDir = useAppStore((s) => s.rootDir)
  const saveState = usePlanStore((s) => s.saveState)
  const lastError = usePlanStore((s) => s.lastError)

  const saveText =
    saveState === 'editing'
      ? t('status.editing')
      : saveState === 'saved'
        ? t('status.saved')
        : saveState === 'error'
          ? t('status.saveFailed', { error: lastError ?? '' })
          : t('status.idle')

  return (
    <div className="ws-status">
      <span>
        <span className={`dot-ok ${indexState === 'building' ? 'dot-building' : ''} ${indexState === 'error' ? 'dot-error' : ''}`} />
        {indexState === 'building' ? t('status.indexBuilding') : indexState === 'error' ? t('status.indexError') : t('status.indexReady')}
      </span>
      <span className={saveState === 'saved' ? 'status-saved' : ''}>{saveText}</span>
      <span style={{ flex: 1 }} />
      <span>{t('status.rootDir', { dir: rootDir ?? '-' })}</span>
    </div>
  )
}
