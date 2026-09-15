import { useEffect, useRef } from 'react'
import { useUndoStore } from '../../stores/undo-store'
import { usePlanStore } from '../../stores/plan-store'
import { useAppStore } from '../../stores/app-store'
import { useTranslation } from '../../i18n'
import { ActionButton } from './ActionButton'

export function UndoNotice(): React.JSX.Element | null {
  const { t } = useTranslation()
  const entry = useUndoStore(state => state.entry)
  const notice = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // 切计划、重载/CAS 刷新、外部变更与切库均使旧撤销失效，防止污染新文档。
    const offPlan = usePlanStore.subscribe((next, previous) => {
      if (next.currentPath !== previous.currentPath || !next.document || next.externalAlert ||
        (next.document !== previous.document && next.saveState === 'idle')) useUndoStore.getState().clear()
    })
    const offApp = useAppStore.subscribe((next, previous) => {
      if (next.rootDir !== previous.rootDir) useUndoStore.getState().clear()
    })
    const offUndo = useUndoStore.subscribe((next, previous) => {
      if (!next.entry && previous.entry && notice.current?.contains(document.activeElement)) previous.entry.restoreFocus?.()
    })
    return () => { offPlan(); offApp(); offUndo(); useUndoStore.getState().clear() }
  }, [])
  if (!entry) return null
  return (
    <div ref={notice} className="trace-undo" aria-label={t('actions.undoNotice')}>
      <span role="status" aria-live="polite">{t('actions.deleted', { name: entry.description })}</span>
      <ActionButton intent="secondary" label={t('actions.undo')} onClick={() => useUndoStore.getState().undo()} />
      <ActionButton intent="icon" label={t('common.close')} icon="×" onClick={() => useUndoStore.getState().clear()} />
    </div>
  )
}
