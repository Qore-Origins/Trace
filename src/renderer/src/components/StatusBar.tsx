// StatusBar（§3.8）：系统脉搏——索引/保存/根目录
import { useEffect, useState } from 'react'
import type { DiaryAutomationStatus } from '@shared/event-types'
import { onEvent } from '../ipc-client'
import { useAppStore } from '../stores/app-store'
import { usePlanStore } from '../stores/plan-store'
import { useTranslation } from '../i18n'

export default function StatusBar(): React.JSX.Element {
  const { t } = useTranslation()
  const indexState = useAppStore((s) => s.indexState)
  const rootDir = useAppStore((s) => s.rootDir)
  const saveState = usePlanStore((s) => s.saveState)
  const lastError = usePlanStore((s) => s.lastError)
  const [diaryStatus, setDiaryStatus] = useState<DiaryAutomationStatus | null>(null)

  useEffect(() => onEvent('trace:diary-automation-status', setDiaryStatus), [])

  const saveText =
    saveState === 'editing'
      ? t('status.editing')
      : saveState === 'saved'
        ? t('status.saved')
        : saveState === 'error'
          ? t('status.saveFailed', { error: lastError ?? '' })
          : t('status.idle')

  return (
    <div className="ws-status" role="status" aria-live="polite" aria-atomic="true">
      <span>
        <span className={`dot-ok ${indexState === 'building' ? 'dot-building' : ''} ${indexState === 'error' ? 'dot-error' : ''}`} />
        {indexState === 'building' ? t('status.indexBuilding') : indexState === 'error' ? t('status.indexError') : t('status.indexReady')}
      </span>
      <span className={saveState === 'saved' ? 'status-saved' : ''}>{saveText}</span>
      {diaryStatus?.state === 'running' && <span>{t('status.diaryPreparing')}</span>}
      {diaryStatus?.state === 'error' && (
        <span title={t('status.diaryRetry')}>
          <span className="dot-ok dot-error" />
          {t('status.diaryFailed')} · {t('status.diaryRetry')}
        </span>
      )}
      <span style={{ flex: 1 }} />
      <span title={rootDir ?? undefined} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {t('status.rootDir', { dir: rootDir ?? '-' })}
      </span>
    </div>
  )
}
