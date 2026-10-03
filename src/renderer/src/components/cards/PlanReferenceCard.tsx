import { useCallback, useEffect, useMemo, useState } from 'react'
import { Input } from 'antd'
import { EditOutlined } from '@ant-design/icons'
import type {
  Component,
  CustomPayload,
  HeadingPayload,
  MoodPayload,
  MultiPlanPayload,
  NotePayload,
  SinglePlanPayload,
  TaskDetailPayload,
  TaskListPayload,
  TaskStatus
} from '@shared/plan-types'
import type { PlanReferenceResolution } from '@shared/ipc-contract'
import type { PlanReferencePayload } from '@shared/plan-reference-types'
import { isPlanReferencePayload } from '@shared/plan-reference-validation'
import { usePlanMutations, usePlanStore } from '../../stores/plan-store'
import { usePlanReferenceStore } from '../../stores/plan-reference-store'
import { useWorkspaceTabsStore } from '../../stores/workspace-tabs-store'
import { usePrefStore } from '../../stores/pref-store'
import { usePlantumlStatusStore } from '../../stores/plantuml-status-store'
import { resolvePlantumlRenderConfig } from '../muya-note/muya-config'
import { NoteMarkdown } from '../note-md'
import { onEvent } from '../../ipc-client'
import { getMessage } from '../../antd-host'
import { useTranslation } from '../../i18n'
import { ActionButton } from '../ui/ActionButton'
import { CardShell, type CardRenderProps } from './CardShell'
import { PlanReferencePicker } from '../PlanReferencePicker'

type PayloadRecord = Record<string, unknown>

function record(value: unknown): PayloadRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as PayloadRecord
    : null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function taskStatus(value: unknown): TaskStatus | null {
  return value === 'done' || value === 'in_progress' || value === 'not_started' ? value : null
}

function statusLabel(status: TaskStatus, t: ReturnType<typeof useTranslation>['t']): string {
  if (status === 'done') return t('cards.statusDone')
  if (status === 'in_progress') return t('cards.statusInProgress')
  return t('cards.statusNotStarted')
}

function ReadOnlyTargetPreview({ component }: { component: Component }): React.JSX.Element {
  const { t } = useTranslation()
  const { noteWrap, plantumlHydrated, plantumlMode, plantumlPort, plantumlServer } = usePrefStore()
  const plantumlStatus = usePlantumlStatusStore((state) => state.status)
  const plantumlConfig = useMemo(
    () => resolvePlantumlRenderConfig(
      { plantumlHydrated, plantumlMode, plantumlPort, plantumlServer },
      plantumlStatus
    ),
    [plantumlHydrated, plantumlMode, plantumlPort, plantumlServer, plantumlStatus.state, plantumlStatus.port, plantumlStatus.errorCode]
  )
  const payload = record(component.payload)
  if (!payload) return <div className="plan-reference__unavailable">{t('references.previewUnavailable')}</div>

  const externalLink = (url: string): void => {
    if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer')
  }

  switch (component.type) {
    case 'single_plan': {
      const value = payload as unknown as SinglePlanPayload
      if (typeof value.title !== 'string' || typeof value.done !== 'boolean') break
      return (
        <div className="plan-reference__native plan-reference__single">
          <div className="plan-reference__native-title">{value.title || t('cards.singlePlaceholder')}</div>
          <span className="plan-reference__status">{value.done ? t('cards.statusDone') : t('cards.statusNotStarted')}</span>
          {typeof value.summary === 'string' && value.summary && <div className="plan-reference__description">{value.summary}</div>}
          {typeof value.due_date === 'string' && <div className="plan-reference__meta">{value.due_date}</div>}
        </div>
      )
    }
    case 'multi_plan': {
      const value = payload as unknown as MultiPlanPayload
      if (typeof value.title !== 'string' || !Array.isArray(value.options)) break
      return (
        <div className="plan-reference__native">
          <div className="plan-reference__native-title">{value.title || t('cards.multiPlaceholder')}</div>
          <ul className="plan-reference__list">
            {value.options.map((option, index) => {
              const item = record(option)
              if (!item || typeof item.text !== 'string' || typeof item.checked !== 'boolean') return null
              return <li key={typeof item.id === 'string' ? item.id : index}>
                <span className="plan-reference__status">{item.checked ? t('references.selected') : t('references.notSelected')}</span>
                <span>{item.text}</span>
              </li>
            })}
          </ul>
        </div>
      )
    }
    case 'task_list': {
      const value = payload as unknown as TaskListPayload
      if (typeof value.title !== 'string' || !Array.isArray(value.items)) break
      return (
        <div className="plan-reference__native">
          <div className="plan-reference__native-title">{value.title || t('cards.taskListPlaceholder')}</div>
          <ul className="plan-reference__list">
            {value.items.map((item, index) => {
              const task = record(item)
              const status = taskStatus(task?.status)
              if (!task || typeof task.title !== 'string' || !status) return null
              return <li key={typeof task.id === 'string' ? task.id : index}>
                <span className="plan-reference__status">{statusLabel(status, t)}</span>
                <span>{task.title}</span>
                {typeof task.planned_at === 'string' && <span className="plan-reference__meta">{task.planned_at}</span>}
              </li>
            })}
          </ul>
        </div>
      )
    }
    case 'task_detail': {
      const value = payload as unknown as TaskDetailPayload
      const status = taskStatus(value.status)
      if (typeof value.title !== 'string' || !status) break
      return (
        <div className="plan-reference__native">
          <div className="plan-reference__native-title">{value.title || t('cards.taskPlaceholder')}</div>
          {typeof value.description === 'string' && value.description && <div className="plan-reference__description">{value.description}</div>}
          <div className="plan-reference__meta">
            <span className="plan-reference__status">{statusLabel(status, t)}</span>
            {typeof value.planned_at === 'string' && <span>{value.planned_at}</span>}
            {typeof value.completed_at === 'string' && <span>{value.completed_at.slice(0, 10)}</span>}
          </div>
        </div>
      )
    }
    case 'note':
    case 'custom': {
      const content = stringValue((payload as unknown as NotePayload | CustomPayload).content)
      if (content === null) break
      return content.trim()
        ? <NoteMarkdown content={content} onLink={externalLink} wrap={noteWrap} plantumlConfig={plantumlConfig} />
        : <div className="plan-reference__description">{t('references.emptyPreview')}</div>
    }
    case 'mood': {
      const value = payload as unknown as MoodPayload
      if (value.score !== null && (typeof value.score !== 'number' || !Number.isFinite(value.score))) break
      if (typeof value.text !== 'string') break
      return (
        <div className="plan-reference__native">
          <div className="plan-reference__native-title">{value.score === null ? t('references.noScore') : String(value.score)}</div>
          {value.text && <div className="plan-reference__description">{value.text}</div>}
          {typeof value.mood_date === 'string' && <div className="plan-reference__meta">{value.mood_date}</div>}
        </div>
      )
    }
    case 'heading': {
      const value = payload as unknown as HeadingPayload
      if (typeof value.title !== 'string' || typeof value.size !== 'number' || !Number.isFinite(value.size)) break
      return <div className="plan-reference__native-title" style={{ fontSize: `${Math.min(32, Math.max(14, value.size))}px` }}>{value.title}</div>
    }
  }

  return <div className="plan-reference__unavailable">{t('references.previewUnavailable')}</div>
}

export function PlanReferenceCard({ comp, index, total }: CardRenderProps): React.JSX.Element {
  const { t } = useTranslation()
  const currentPath = usePlanStore((state) => state.currentPath)
  const sourceSessionRevision = usePlanStore((state) => state.sessionRevision)
  const rootKey = useWorkspaceTabsStore((state) => state.rootKey)
  const libraryId = useWorkspaceTabsStore((state) => state.library_id)
  const activePath = useWorkspaceTabsStore((state) => state.active_path)
  const openPlan = useWorkspaceTabsStore((state) => state.openPlan)
  const { patchComponent } = usePlanMutations()
  const payload: PlanReferencePayload | null = isPlanReferencePayload(comp.payload) ? comp.payload : null
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState(payload?.target_name_snapshot ?? '')
  const [opening, setOpening] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const closeRepair = useCallback(() => setRepairing(false), [])
  const entryKey = useMemo(
    () => JSON.stringify([rootKey, libraryId, currentPath, sourceSessionRevision, comp.id]),
    [rootKey, libraryId, currentPath, sourceSessionRevision, comp.id]
  )
  const entry = usePlanReferenceStore((state) => state.resolutions[entryKey])
  const resolve = usePlanReferenceStore((state) => state.resolve)
  const forget = usePlanReferenceStore((state) => state.forget)

  const isCurrentSource = useCallback((): boolean => {
    const plan = usePlanStore.getState()
    const tabs = useWorkspaceTabsStore.getState()
    return Boolean(
      currentPath && libraryId && rootKey &&
      plan.currentPath === currentPath && plan.sessionRevision === sourceSessionRevision &&
      tabs.rootKey === rootKey && tabs.library_id === libraryId && tabs.active_path === currentPath
    )
  }, [currentPath, libraryId, rootKey, sourceSessionRevision])

  useEffect(() => {
    if (!payload || !libraryId || !isCurrentSource()) return
    let mounted = true
    let changeWhileLoading = false
    const request = {
      library_id: libraryId,
      plan_id: payload.target_plan_id,
      ...(payload.target_component_id ? { component_id: payload.target_component_id } : {})
    }
    const load = async (force = false): Promise<PlanReferenceResolution | undefined> => {
      if (!mounted || !isCurrentSource()) return undefined
      const result = await resolve(entryKey, request, isCurrentSource, force)
      if (!mounted || !isCurrentSource()) return undefined
      if (changeWhileLoading) {
        changeWhileLoading = false
        void load(true)
      }
      return result
    }

    const refresh = (): void => {
      const current = usePlanReferenceStore.getState().resolutions[entryKey]
      if (current?.status === 'loading' || !current) changeWhileLoading = true
      else void load(true)
    }
    const unsubscribeTargetChanges = onEvent('trace:reference-target-changed', ({ plan_ids }) => {
      if (!plan_ids.includes(payload.target_plan_id)) return
      refresh()
    })
    const unsubscribePlanChanges = onEvent('trace:plan-changed', () => {
      const current = usePlanReferenceStore.getState().resolutions[entryKey]
      if (current?.status === 'loading' || !current) changeWhileLoading = true
    })
    // 外部移动/删除没有可靠的旧 ID 通知；以身份重新解析所有当前挂载引用。
    const unsubscribeExternalChanges = onEvent('trace:fs-external-change', refresh)

    void load()
    return () => {
      mounted = false
      unsubscribeTargetChanges()
      unsubscribePlanChanges()
      unsubscribeExternalChanges()
      forget(entryKey)
    }
  }, [activePath, entryKey, forget, isCurrentSource, libraryId, payload?.mode, payload?.target_component_id, payload?.target_plan_id, resolve])

  useEffect(() => {
    if (!editingName && payload) setDraftName(payload.target_name_snapshot)
  }, [editingName, payload?.target_name_snapshot])

  const commitName = (): void => {
    const name = draftName.trim()
    if (!payload || !name || !isCurrentSource()) return
    patchComponent(comp.id, (componentPayload) => {
      const referencePayload = componentPayload as PlanReferencePayload
      referencePayload.target_name_snapshot = name
    })
    setEditingName(false)
  }

  const openTarget = async (): Promise<void> => {
    if (!payload || !libraryId || opening || !isCurrentSource()) return
    setOpening(true)
    const result = await resolve(entryKey, {
      library_id: libraryId,
      plan_id: payload.target_plan_id,
      ...(payload.target_component_id ? { component_id: payload.target_component_id } : {})
    }, isCurrentSource, true)
    if (!isCurrentSource()) {
      setOpening(false)
      return
    }
    if (result?.status !== 'found') {
      setOpening(false)
      return
    }
    const opened = payload.target_component_id
      ? await openPlan(result.target.path, payload.target_component_id)
      : await openPlan(result.target.path)
    if (!opened && isCurrentSource()) getMessage().warning(t('references.openFailed'))
    setOpening(false)
  }

  const resolved = entry?.status === 'found' ? entry.resolution : null
  const resolvedComponent = resolved?.component
  const currentSource = isCurrentSource()
  const referenceContent = !payload
    ? <div className="plan-reference__missing" data-reference-status="broken">{t('references.broken')}</div>
    : !currentSource
      ? <div className="plan-reference__missing" data-reference-status="stale">{t('references.stale')}</div>
      : entry?.status === 'loading' || !entry
        ? <div className="plan-reference__loading" data-reference-status="loading" role="status">{t('references.loading')}</div>
        : entry.status === 'error'
          ? <div className="plan-reference__missing" data-reference-status="error">{t('references.unavailable')}</div>
          : entry.status === 'conflict'
            ? <div className="plan-reference__missing" data-reference-status="conflict">{t('references.targetConflict')}</div>
            : entry.status === 'missing'
              ? <div className="plan-reference__missing" data-reference-status="missing">{t('references.targetMissing')}</div>
              : payload.mode === 'embed'
                ? !payload.target_component_id || !resolvedComponent || resolvedComponent.id !== payload.target_component_id
                  ? <div className="plan-reference__missing" data-reference-status="missing">{t('references.componentMissing')}</div>
                  : <div className="plan-reference__preview" aria-label={t('references.previewLabel')}>
                    <ReadOnlyTargetPreview component={resolvedComponent} />
                  </div>
                : <div className="plan-reference__link-note" data-reference-status="found">{t('references.linkHint')}</div>

  return (
    <CardShell kind="plan_reference" componentId={comp.id} index={index} total={total} extraClass="plan-reference">
      <div className="plan-reference__heading">
        {editingName ? (
          <div className="plan-reference__name-editor">
            <Input
              aria-label={t('references.displayName')}
              maxLength={200}
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onPressEnter={commitName}
            />
            <ActionButton intent="quiet" label={t('references.saveName')} disabled={!draftName.trim()} onClick={commitName} />
            <ActionButton intent="quiet" label={t('references.cancelName')} onClick={() => {
              setDraftName(payload?.target_name_snapshot ?? '')
              setEditingName(false)
            }} />
          </div>
        ) : (
          <div className="plan-reference__name-row">
            <strong>{payload?.target_name_snapshot ?? t('references.broken')}</strong>
            {payload && <ActionButton intent="icon" label={t('references.editDisplayName')} icon={<EditOutlined />} onClick={() => {
              setDraftName(payload.target_name_snapshot)
              setEditingName(true)
            }} />}
          </div>
        )}
        {payload && <span className="plan-reference__mode">{payload.mode === 'embed' ? t('references.embedMode') : t('references.linkMode')}</span>}
      </div>
      {referenceContent}
      {payload && (
        <div className="plan-reference__actions">
          <ActionButton
            intent="secondary"
            label={payload.mode === 'embed' ? t('references.openOriginal') : t('references.openTarget')}
            loading={opening}
            disabled={!currentSource || entry?.status === 'loading'}
            onClick={() => { void openTarget() }}
          />
          {currentSource && (entry?.status === 'missing' || entry?.status === 'conflict') && (
            <ActionButton intent="secondary" label={t('references.repair')} onClick={() => setRepairing(true)} />
          )}
        </div>
      )}
      {payload && currentPath && rootKey && libraryId && repairing && (
        <PlanReferencePicker
          open={repairing}
          source={{ path: currentPath, rootKey, libraryId, sessionRevision: sourceSessionRevision }}
          replacement={{ componentId: comp.id, payload }}
          onClose={closeRepair}
        />
      )}
    </CardShell>
  )
}
