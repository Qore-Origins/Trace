import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Modal } from 'antd'
import { ERR } from '@shared/errors'
import { parentRel } from '@shared/path-utils'
import type { TrashEntry, TrashOperation, TrashOperationPreview } from '@shared/trash-types'
import { getMessage } from '../antd-host'
import { useAppStore } from '../stores/app-store'
import { useTreeStore } from '../stores/tree-store'
import { i18n, useTranslation } from '../i18n'
import { invoke, ClientError } from '../ipc-client'

interface TrashDialogProps {
  open: boolean
  onClose: () => void
}

interface BoundTrashPreview {
  operation: TrashOperation
  entryId: string
  requestSequence: number
  rootDir: string | null
  result: TrashOperationPreview
}

interface PendingTrashFocus {
  entryId: string
  operation: 'restore' | 'purge'
  element: HTMLElement | null
  rootDir: string | null
}

type TrashRefreshResult = 'refreshed' | 'failed' | 'stale'

function formatDeletedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function trashIssueTranslationKey(issue: unknown): string {
  switch (issue) {
    case 'manifest_invalid': return 'trash.issue.manifestInvalid'
    case 'entry_incomplete': return 'trash.issue.entryIncomplete'
    case 'identity_mismatch': return 'trash.issue.identityMismatch'
    case 'purge_interrupted': return 'trash.issue.purgeInterrupted'
    default: return 'trash.issue.unknown'
  }
}

export default function TrashDialog({ open, onClose }: TrashDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const rootDir = useAppStore((state) => state.rootDir)
  const [entries, setEntries] = useState<TrashEntry[]>([])
  const [entriesRootDir, setEntriesRootDir] = useState(rootDir)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [restoreEntry, setRestoreEntry] = useState<TrashEntry | null>(null)
  const [restoreName, setRestoreName] = useState('')
  const [restoreParent, setRestoreParent] = useState('')
  const [browsePath, setBrowsePath] = useState('')
  const [browseFolders, setBrowseFolders] = useState<Array<{ path: string; name: string }>>([])
  const [browseError, setBrowseError] = useState<string | null>(null)
  const [browseBusy, setBrowseBusy] = useState(false)
  const [browseRetrySequence, setBrowseRetrySequence] = useState(0)
  const [restorePreview, setRestorePreview] = useState<BoundTrashPreview | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [purgeEntry, setPurgeEntry] = useState<TrashEntry | null>(null)
  const [purgePreview, setPurgePreview] = useState<BoundTrashPreview | null>(null)
  const [purgeInput, setPurgeInput] = useState('')
  const [purgeError, setPurgeError] = useState<string | null>(null)
  const [purgeBusy, setPurgeBusy] = useState(false)
  const [commitOperation, setCommitOperation] = useState<TrashOperation | null>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const refreshButton = useRef<HTMLButtonElement | null>(null)
  const restoreTrigger = useRef<HTMLElement | null>(null)
  const purgeTrigger = useRef<HTMLElement | null>(null)
  const requestId = useRef(0)
  const restorePreviewSequence = useRef(0)
  const purgePreviewSequence = useRef(0)
  const browseSequence = useRef(0)
  const restoreEntryRef = useRef<TrashEntry | null>(null)
  const purgeEntryRef = useRef<TrashEntry | null>(null)
  const pendingModeReturnFocus = useRef<PendingTrashFocus | null>(null)
  const commitInFlightRef = useRef(false)
  const openRef = useRef(open)
  openRef.current = open

  const invalidateRestorePreview = (): void => {
    restorePreviewSequence.current += 1
    setRestorePreview(null)
    setRestoreBusy(false)
  }

  const invalidatePurgePreview = (): void => {
    purgePreviewSequence.current += 1
    setPurgePreview(null)
    setPurgeBusy(false)
  }

  const cancelRestore = (returnFocusToEntry = true): void => {
    if (commitInFlightRef.current) return
    const entry = restoreEntryRef.current
    if (returnFocusToEntry && entry) {
      pendingModeReturnFocus.current = {
        entryId: entry.id, operation: 'restore', element: restoreTrigger.current,
        rootDir: useAppStore.getState().rootDir
      }
    }
    invalidateRestorePreview()
    restoreEntryRef.current = null
    setRestoreEntry(null)
    setRestoreError(null)
    browseSequence.current += 1
    setBrowseError(null)
    setBrowseBusy(false)
  }

  const cancelPurge = (returnFocusToEntry = true): void => {
    if (commitInFlightRef.current) return
    const entry = purgeEntryRef.current
    if (returnFocusToEntry && entry) {
      pendingModeReturnFocus.current = {
        entryId: entry.id, operation: 'purge', element: purgeTrigger.current,
        rootDir: useAppStore.getState().rootDir
      }
    }
    invalidatePurgePreview()
    purgeEntryRef.current = null
    setPurgeEntry(null)
    setPurgeInput('')
    setPurgeError(null)
  }

  const isRestoreRequestCurrent = (sequence: number, entryId: string, expectedRoot: string | null): boolean =>
    sequence === restorePreviewSequence.current &&
    restoreEntryRef.current?.id === entryId &&
    useAppStore.getState().rootDir === expectedRoot &&
    openRef.current

  const isPurgeRequestCurrent = (sequence: number, entryId: string, expectedRoot: string | null): boolean =>
    sequence === purgePreviewSequence.current &&
    purgeEntryRef.current?.id === entryId &&
    useAppStore.getState().rootDir === expectedRoot &&
    openRef.current

  const refresh = useCallback(async (): Promise<TrashRefreshResult> => {
    const currentRequest = ++requestId.current
    const expectedRoot = useAppStore.getState().rootDir
    setLoading(true)
    setError(null)
    try {
      const result = await invoke('trash:list')
      if (currentRequest === requestId.current && useAppStore.getState().rootDir === expectedRoot) {
        setEntries(result)
        setEntriesRootDir(expectedRoot)
        return 'refreshed'
      }
      return 'stale'
    } catch (cause) {
      if (currentRequest === requestId.current && useAppStore.getState().rootDir === expectedRoot) {
        setEntries([])
        setEntriesRootDir(expectedRoot)
        setError(i18n.t('trash.loadFailed'))
        return 'failed'
      }
      return 'stale'
    } finally {
      if (currentRequest === requestId.current && useAppStore.getState().rootDir === expectedRoot) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) {
      requestId.current += 1
      restorePreviewSequence.current += 1
      purgePreviewSequence.current += 1
      browseSequence.current += 1
      restoreEntryRef.current = null
      purgeEntryRef.current = null
      setRestoreEntry(null)
      setRestorePreview(null)
      setRestoreError(null)
      setRestoreBusy(false)
      setPurgeEntry(null)
      setPurgePreview(null)
      setPurgeError(null)
      setPurgeBusy(false)
      setBrowseError(null)
      setBrowseBusy(false)
      return
    }
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => { requestId.current += 1 }
  }, [open])

  useEffect(() => {
    if (open) void refresh()
  }, [open, rootDir, refresh])

  useEffect(() => {
    const currentEntry = restoreEntry
    if (!open || !currentEntry) {
      browseSequence.current += 1
      setBrowseBusy(false)
      return
    }
    const sequence = ++browseSequence.current
    const expectedRoot = rootDir
    const entryId = currentEntry.id
    const isCurrent = (): boolean =>
      sequence === browseSequence.current &&
      restoreEntryRef.current?.id === entryId &&
      useAppStore.getState().rootDir === expectedRoot &&
      openRef.current
    setBrowseFolders([])
    setBrowseBusy(true)
    void invoke('storage:treeGetChildren', { parent_path: browsePath })
      .then((children) => {
        if (isCurrent()) {
          setBrowseFolders(children.filter((child) => child.kind === 'folder'))
          setBrowseError(null)
        }
      })
      .catch(() => {
        if (!isCurrent()) return
        setBrowseFolders([])
        setBrowseError(i18n.t('trash.operationFailed'))
      })
      .finally(() => {
        if (isCurrent()) setBrowseBusy(false)
      })
    return () => {
      if (sequence === browseSequence.current) browseSequence.current += 1
    }
  }, [browsePath, browseRetrySequence, open, restoreEntry, rootDir])

  useEffect(() => {
    setEntries([])
    setError(null)
    restorePreviewSequence.current += 1
    purgePreviewSequence.current += 1
    browseSequence.current += 1
    restoreEntryRef.current = null
    purgeEntryRef.current = null
    setRestoreEntry(null)
    setRestorePreview(null)
    setRestoreError(null)
    setRestoreBusy(false)
    setPurgeEntry(null)
    setPurgePreview(null)
    setPurgeInput('')
    setPurgeError(null)
    setPurgeBusy(false)
    setBrowseFolders([])
    setBrowseError(null)
    setBrowseBusy(false)
  }, [rootDir])

  const errorText = (cause: unknown): string => {
    if (!(cause instanceof ClientError)) return t('trash.operationFailed')
    if (cause.code === ERR.NAME_CONFLICT) return t('trash.nameConflict')
    if (cause.code === ERR.PATH_NOT_FOUND) return t('trash.parentUnavailable')
    if (cause.code === ERR.CONFLICT || cause.code === ERR.CONFIRMATION_REQUIRED) return t('trash.stalePreview')
    return t('trash.operationFailed')
  }

  const returnFocus = (target: { current: HTMLElement | null }): void => {
    const element = target.current
    target.current = null
    if (element?.isConnected) element.focus()
    else refreshButton.current?.focus()
  }

  useEffect(() => {
    if (!open) {
      pendingModeReturnFocus.current = null
      return
    }
    if (restoreEntry || purgeEntry) return
    const pending = pendingModeReturnFocus.current
    if (!pending) return
    pendingModeReturnFocus.current = null
    if (pending.rootDir !== useAppStore.getState().rootDir) {
      refreshButton.current?.focus()
      return
    }
    if (pending.element?.isConnected) {
      pending.element.focus()
      return
    }
    const article = Array.from(document.querySelectorAll<HTMLElement>('[data-trash-entry-id]'))
      .find((element) => element.dataset.trashEntryId === pending.entryId)
    const action = article?.querySelector<HTMLButtonElement>(`button[data-trash-action="${pending.operation}"]`)
    if (action) action.focus()
    else refreshButton.current?.focus()
  }, [open, purgeEntry, restoreEntry])

  const previewRestore = async (entry: TrashEntry, destination?: { parent_path: string; name: string }): Promise<void> => {
    if (commitInFlightRef.current || restoreEntryRef.current?.id !== entry.id || !openRef.current) return
    const sequence = ++restorePreviewSequence.current
    const expectedRoot = useAppStore.getState().rootDir
    setRestoreBusy(true)
    setRestorePreview(null)
    setRestoreError(null)
    try {
      const result = await invoke('trash:restore-preview', {
        entry_id: entry.id,
        ...(destination ? { destination } : {})
      })
      if (!isRestoreRequestCurrent(sequence, entry.id, expectedRoot)) return
      if (result.operation !== 'restore' || result.entry_id !== entry.id) {
        setRestoreError(t('trash.stalePreview'))
        return
      }
      setRestorePreview({
        operation: 'restore', entryId: entry.id, requestSequence: sequence, rootDir: expectedRoot, result
      })
    } catch (cause) {
      if (isRestoreRequestCurrent(sequence, entry.id, expectedRoot)) setRestoreError(errorText(cause))
    } finally {
      if (isRestoreRequestCurrent(sequence, entry.id, expectedRoot)) setRestoreBusy(false)
    }
  }

  const beginRestore = (entry: TrashEntry, returnTarget: HTMLElement): void => {
    if (commitInFlightRef.current) return
    cancelPurge(false)
    invalidateRestorePreview()
    restoreTrigger.current = returnTarget
    restoreEntryRef.current = entry
    setRestoreEntry(entry)
    setRestoreName(entry.name)
    setRestoreParent(parentRel(entry.original_relative_path))
    setBrowsePath('')
    setBrowseFolders([])
    setBrowseError(null)
    void previewRestore(entry)
  }

  const cancelTrashDialog = (): void => {
    if (commitInFlightRef.current) return
    cancelRestore(false)
    cancelPurge(false)
    onClose()
  }

  const commitRestore = async (): Promise<void> => {
    if (commitInFlightRef.current) return
    const preview = restorePreview
    const currentEntry = restoreEntry
    if (!preview || !currentEntry) return
    if (
      preview.operation !== 'restore' ||
      preview.entryId !== currentEntry.id ||
      preview.requestSequence !== restorePreviewSequence.current ||
      preview.rootDir !== useAppStore.getState().rootDir ||
      preview.result.operation !== 'restore' ||
      preview.result.entry_id !== currentEntry.id ||
      restoreEntryRef.current?.id !== currentEntry.id
    ) {
      invalidateRestorePreview()
      setRestoreError(t('trash.stalePreview'))
      return
    }
    const expectedRoot = preview.rootDir
    const isCurrentUi = (): boolean =>
      useAppStore.getState().rootDir === expectedRoot &&
      restoreEntryRef.current?.id === currentEntry.id &&
      openRef.current
    commitInFlightRef.current = true
    setCommitOperation('restore')
    setRestoreError(null)
    try {
      try {
        await invoke('trash:restore-commit', { confirmation_token: preview.result.confirmation_token })
      } catch (cause) {
        getMessage().error(errorText(cause))
        if (isCurrentUi()) {
          setRestorePreview(null)
          setRestoreError(errorText(cause))
        }
        return
      }
      if (useAppStore.getState().rootDir !== expectedRoot) {
        getMessage().success(t('trash.restored'))
        return
      }
      const refreshed = await Promise.allSettled([refresh(), useTreeStore.getState().refreshAll()])
      const listRefresh = refreshed[0].status === 'fulfilled' ? refreshed[0].value : 'failed'
      const listRefreshFailed = listRefresh === 'failed'
      const treeRefreshFailed = refreshed[1].status === 'rejected'
      if (listRefreshFailed || treeRefreshFailed) {
        getMessage().warning(t('trash.restoredRefreshFailed'))
      } else {
        getMessage().success(t('trash.restored'))
      }
      if (isCurrentUi()) {
        pendingModeReturnFocus.current = {
          entryId: currentEntry.id, operation: 'restore', element: restoreTrigger.current,
          rootDir: expectedRoot
        }
        restoreEntryRef.current = null
        setRestoreEntry(null)
        setRestorePreview(null)
        setRestoreBusy(false)
      }
    } finally {
      commitInFlightRef.current = false
      setCommitOperation(null)
    }
  }

  const previewPurge = async (entry: TrashEntry): Promise<void> => {
    if (commitInFlightRef.current || purgeEntryRef.current?.id !== entry.id || !openRef.current) return
    const sequence = ++purgePreviewSequence.current
    const expectedRoot = useAppStore.getState().rootDir
    setPurgePreview(null)
    setPurgeError(null)
    setPurgeBusy(true)
    try {
      const result = await invoke('trash:purge-preview', { entry_id: entry.id })
      if (!isPurgeRequestCurrent(sequence, entry.id, expectedRoot)) return
      if (result.operation !== 'purge' || result.entry_id !== entry.id) {
        setPurgeError(t('trash.stalePreview'))
        return
      }
      setPurgePreview({
        operation: 'purge', entryId: entry.id, requestSequence: sequence, rootDir: expectedRoot, result
      })
    } catch (cause) {
      if (isPurgeRequestCurrent(sequence, entry.id, expectedRoot)) setPurgeError(errorText(cause))
    } finally {
      if (isPurgeRequestCurrent(sequence, entry.id, expectedRoot)) setPurgeBusy(false)
    }
  }

  const beginPurge = (entry: TrashEntry, returnTarget: HTMLElement): void => {
    if (commitInFlightRef.current) return
    cancelRestore(false)
    invalidatePurgePreview()
    purgeTrigger.current = returnTarget
    purgeEntryRef.current = entry
    setPurgeEntry(entry)
    setPurgeInput('')
    setPurgeError(null)
    void previewPurge(entry)
  }

  const commitPurge = async (): Promise<void> => {
    if (commitInFlightRef.current) return
    const preview = purgePreview
    const currentEntry = purgeEntry
    if (!currentEntry || !preview || purgeInput !== currentEntry.name) return
    if (
      preview.operation !== 'purge' ||
      preview.entryId !== currentEntry.id ||
      preview.requestSequence !== purgePreviewSequence.current ||
      preview.rootDir !== useAppStore.getState().rootDir ||
      preview.result.operation !== 'purge' ||
      preview.result.entry_id !== currentEntry.id ||
      purgeEntryRef.current?.id !== currentEntry.id
    ) {
      invalidatePurgePreview()
      setPurgeError(t('trash.stalePreview'))
      return
    }
    const expectedRoot = preview.rootDir
    const isCurrentUi = (): boolean =>
      useAppStore.getState().rootDir === expectedRoot &&
      purgeEntryRef.current?.id === currentEntry.id &&
      openRef.current
    commitInFlightRef.current = true
    setCommitOperation('purge')
    setPurgeError(null)
    try {
      try {
        await invoke('trash:purge-commit', { confirmation_token: preview.result.confirmation_token })
      } catch (cause) {
        getMessage().error(errorText(cause))
        if (isCurrentUi()) {
          setPurgePreview(null)
          setPurgeInput('')
          setPurgeError(errorText(cause))
        }
        return
      }
      if (useAppStore.getState().rootDir !== expectedRoot) {
        getMessage().success(t('trash.purged'))
        return
      }
      const refreshed = await Promise.allSettled([refresh(), useTreeStore.getState().refreshAll()])
      const listRefresh = refreshed[0].status === 'fulfilled' ? refreshed[0].value : 'failed'
      const listRefreshFailed = listRefresh === 'failed'
      const treeRefreshFailed = refreshed[1].status === 'rejected'
      if (listRefreshFailed || treeRefreshFailed) {
        getMessage().warning(t('trash.purgedRefreshFailed'))
      } else {
        getMessage().success(t('trash.purged'))
      }
      if (isCurrentUi()) {
        pendingModeReturnFocus.current = {
          entryId: currentEntry.id, operation: 'purge', element: purgeTrigger.current,
          rootDir: expectedRoot
        }
        purgeEntryRef.current = null
        setPurgeEntry(null)
        setPurgePreview(null)
        setPurgeBusy(false)
      }
    } finally {
      commitInFlightRef.current = false
      setCommitOperation(null)
    }
  }

  const commitBusy = commitOperation !== null
  const restoreCommitBusy = commitOperation === 'restore'
  const purgeCommitBusy = commitOperation === 'purge'
  const entriesAreCurrent = entriesRootDir === rootDir

  return <Modal
    className="trash-dialog"
    title={restoreEntry
      ? t('trash.restoreTitle', { name: restoreEntry.name })
      : purgeEntry ? t('trash.purgeTitle', { name: purgeEntry.name }) : t('trash.title')}
    open={open}
    onCancel={() => {
      if (restoreEntry) {
        cancelRestore()
        return
      }
      if (purgeEntry) {
        cancelPurge()
        return
      }
      cancelTrashDialog()
    }}
    closable={!commitBusy}
    keyboard={!commitBusy}
    maskClosable={!commitBusy}
    afterClose={() => returnFocus(trigger)}
    footer={restoreEntry ? <>
      <Button disabled={commitBusy} onClick={() => cancelRestore()}>{t('common.cancel')}</Button>
      {restorePreview
        ? <Button type="primary" loading={restoreBusy || restoreCommitBusy} disabled={commitBusy} onClick={() => void commitRestore()}>{t('trash.confirmRestore')}</Button>
        : <Button type="primary" loading={restoreBusy} disabled={commitBusy || !restoreName.trim()} onClick={() => {
          if (restoreEntry) void previewRestore(restoreEntry, { parent_path: restoreParent, name: restoreName.trim() })
        }}>{t('trash.previewRestore')}</Button>}
    </> : purgeEntry ? <>
      <Button disabled={commitBusy} onClick={() => cancelPurge()}>{t('common.cancel')}</Button>
      {purgeError && !purgePreview && <Button loading={purgeBusy} disabled={commitBusy} onClick={() => {
        if (purgeEntry) void previewPurge(purgeEntry)
      }}>{t('trash.retry')}</Button>}
      <Button danger type="primary" loading={purgeBusy || purgeCommitBusy}
        disabled={commitBusy || !purgePreview || purgeInput !== purgeEntry.name}
        onClick={() => void commitPurge()}>{t('trash.confirmPurge')}</Button>
    </> : null}
    width={720}
    destroyOnHidden
  >
    {restoreEntry ? <div className="trash-restore-form">
      <p>{t('trash.originalLocation')}: {restoreEntry.original_relative_path}</p>
      <label htmlFor="trash-restore-name">{t('trash.restoreName')}</label>
      <input id="trash-restore-name" aria-label={t('trash.restoreName')} value={restoreName}
        disabled={commitBusy}
        onChange={(event) => {
          invalidateRestorePreview()
          setRestoreError(null)
          setRestoreName(event.target.value)
        }} />
      <label htmlFor="trash-restore-parent">{t('trash.restoreParent')}</label>
      <div className="trash-parent-picker">
        <Button onClick={() => {
          setBrowseError(null)
          setBrowsePath(parentRel(browsePath))
        }} disabled={commitBusy || !browsePath}>{t('trash.upFolder')}</Button>
        <select id="trash-restore-parent" aria-label={t('trash.restoreParent')} value={restoreParent}
          disabled={commitBusy}
          onChange={(event) => {
            invalidateRestorePreview()
            setRestoreError(null)
            setBrowseError(null)
            setRestoreParent(event.target.value)
            setBrowsePath(event.target.value)
          }}>
          <option value="">{t('trash.libraryRoot')}</option>
          {restoreParent && restoreParent !== browsePath && <option value={restoreParent}>{restoreParent}</option>}
          {browsePath && <option value={browsePath}>{browsePath}</option>}
          {browseFolders.map((folder) => <option value={folder.path} key={folder.path}>{folder.name}</option>)}
        </select>
      </div>
      {browseError && <div role="alert" className="trash-error">
        {browseError} <Button loading={browseBusy} disabled={commitBusy} onClick={() => setBrowseRetrySequence((value) => value + 1)}>
          {t('trash.retry')}
        </Button>
      </div>}
      {restoreError && <p role="alert" className="trash-error">{restoreError}</p>}
      {restorePreview && <div className="trash-preview">
        <strong>{t('trash.previewReady')}</strong>
        <span>{t('trash.restoreDestination')}: {restorePreview.result.restore_relative_path}</span>
        <span>{t('trash.planCount', { count: restorePreview.result.plan_count })}</span>
        <span>{t('trash.referenceCount', { count: restorePreview.result.reference_count })}</span>
      </div>}
    </div> : purgeEntry ? <div className="trash-purge-confirmation">
      <p role="alert">{t('trash.purgeWarning')}</p>
      {purgePreview && <div className="trash-preview">
        <span>{t('trash.originalLocation')}: {purgePreview.result.original_relative_path}</span>
        <span>{t('trash.planCount', { count: purgePreview.result.plan_count })}</span>
        <span>{t('trash.purgeReferenceCount', { count: purgePreview.result.reference_count })}</span>
      </div>}
      {purgeError && <p role="alert" className="trash-error">{purgeError}</p>}
      <label htmlFor="trash-purge-name">{t('trash.typeNameToPurge', { name: purgeEntry.name })}</label>
      <input id="trash-purge-name" aria-label={t('trash.purgeNameInput')} value={purgeInput}
        disabled={commitBusy}
        onChange={(event) => setPurgeInput(event.target.value)} />
    </div> : <>
      <div className="trash-toolbar">
        <p>{t('trash.description')}</p>
        <Button ref={refreshButton} onClick={() => void refresh()} loading={loading || !entriesAreCurrent} disabled={commitBusy}>{t('trash.refresh')}</Button>
      </div>
      {error && <div role="alert" className="trash-error">
        {error} <Button disabled={commitBusy} onClick={() => void refresh()}>{t('trash.retry')}</Button>
      </div>}
      {entriesAreCurrent && !loading && !error && entries.length === 0 && <p className="trash-empty">{t('trash.empty')}</p>}
      <div className="trash-entries">
        {entriesAreCurrent && entries.map((entry) => <article className="trash-entry" data-trash-entry data-trash-entry-id={entry.id} key={entry.id}>
          <div className="trash-entry-main">
            <strong>{entry.name}</strong>
            <span>{t(entry.kind === 'plan' ? 'common.plan' : 'common.folder')}</span>
          </div>
          <div className="trash-entry-meta">
            <span>{t('trash.originalLocation')}: {entry.original_relative_path}</span>
            <time dateTime={entry.deleted_at}>{t('trash.deletedAt')}: {formatDeletedAt(entry.deleted_at)}</time>
            <span>{t(`trash.status.${entry.status}`)}</span>
            {entry.issue && <span>{t(trashIssueTranslationKey(entry.issue))}</span>}
          </div>
          <div className="trash-entry-actions">
            <Button data-trash-action="restore" disabled={commitBusy || !entriesAreCurrent || !entry.can_restore} onClick={(event) => beginRestore(entry, event.currentTarget)}>
              {t('trash.restore')}
            </Button>
            <Button data-trash-action="purge" danger disabled={commitBusy || !entriesAreCurrent || !entry.can_purge} onClick={(event) => void beginPurge(entry, event.currentTarget)}>
              {t('trash.purge')}
            </Button>
          </div>
        </article>)}
      </div>
    </>}
  </Modal>
}
