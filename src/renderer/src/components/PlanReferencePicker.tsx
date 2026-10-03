import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input, Modal } from 'antd'
import type { PlanReferenceCandidate, PlanReferenceTarget } from '@shared/ipc-contract'
import type { PlanReferenceMode, PlanReferencePayload } from '@shared/plan-reference-types'
import { isPlanReferencePayload, isReferenceTargetType } from '@shared/plan-reference-validation'
import type { Component } from '@shared/plan-types'
import { uuid32 } from '@shared/validation'
import { invoke } from '../ipc-client'
import { useTranslation } from '../i18n'
import { usePlanMutations, usePlanStore } from '../stores/plan-store'
import { useWorkspaceTabsStore } from '../stores/workspace-tabs-store'

export interface PlanReferencePickerSource {
  path: string
  rootKey: string
  libraryId: string
  sessionRevision: number
}

interface PlanReferencePickerProps {
  open: boolean
  source: PlanReferencePickerSource
  onClose: () => void
  replacement?: { componentId: string; payload: PlanReferencePayload }
}

function targetName(target: PlanReferenceCandidate): string {
  return target.component_name ?? target.plan_name
}

function isComponentTarget(target: PlanReferenceCandidate): target is PlanReferenceCandidate & {
  component_id: string
  component_type: Exclude<Component['type'], 'plan_reference'>
  component_name: string
} {
  return Boolean(
    target.component_id &&
    isReferenceTargetType(target.component_type) &&
    typeof target.component_name === 'string'
  )
}

export function PlanReferencePicker({ open, source, onClose, replacement }: PlanReferencePickerProps): React.JSX.Element {
  const { t } = useTranslation()
  const { appendComponent } = usePlanMutations()
  const currentPath = usePlanStore((state) => state.currentPath)
  const sessionRevision = usePlanStore((state) => state.sessionRevision)
  const rootKey = useWorkspaceTabsStore((state) => state.rootKey)
  const libraryId = useWorkspaceTabsStore((state) => state.library_id)
  const activePath = useWorkspaceTabsStore((state) => state.active_path)
  const requestRevision = useRef(0)
  const [query, setQuery] = useState('')
  const [targets, setTargets] = useState<PlanReferenceCandidate[]>([])
  const [selected, setSelected] = useState<PlanReferenceCandidate | null>(null)
  const [mode, setMode] = useState<PlanReferenceMode>(replacement?.payload.mode ?? 'link')
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isCurrentSource = useCallback((): boolean => {
    const plan = usePlanStore.getState()
    const tabs = useWorkspaceTabsStore.getState()
    return Boolean(
      source.path && source.rootKey && source.libraryId &&
      plan.currentPath === source.path && plan.sessionRevision === source.sessionRevision &&
      tabs.rootKey === source.rootKey && tabs.library_id === source.libraryId && tabs.active_path === source.path
    )
  }, [source.libraryId, source.path, source.rootKey, source.sessionRevision])

  useEffect(() => {
    if (open && !isCurrentSource()) onClose()
  }, [activePath, currentPath, isCurrentSource, libraryId, onClose, open, rootKey, sessionRevision])

  useEffect(() => {
    if (!open) {
      requestRevision.current += 1
      setTargets([])
      setSelected(null)
      setMode(replacement?.payload.mode ?? 'link')
      setDisplayName('')
      setQuery('')
      setError(null)
      setLoading(false)
      setSubmitting(false)
      return
    }

    const revision = ++requestRevision.current
    if (!isCurrentSource()) {
      onClose()
      return
    }

    setTargets([])
    setError(null)
    setLoading(true)
    void invoke('plan-reference:search', { library_id: source.libraryId, query: query.trim() })
      .then((result) => {
        if (requestRevision.current !== revision) return
        if (!isCurrentSource()) {
          onClose()
          return
        }
        setTargets(result.targets)
      })
      .catch(() => {
        if (requestRevision.current === revision && isCurrentSource()) setError(t('references.searchFailed'))
      })
      .finally(() => {
        if (requestRevision.current === revision && isCurrentSource()) setLoading(false)
      })

    return () => {
      if (requestRevision.current === revision) requestRevision.current += 1
    }
  }, [isCurrentSource, onClose, open, query, replacement?.payload.mode, source.libraryId, t])

  const visibleTargets = mode === 'embed' ? targets.filter(isComponentTarget) : targets

  const chooseTarget = (target: PlanReferenceCandidate): void => {
    if (mode === 'embed' && !isComponentTarget(target)) return
    setSelected(target)
    setDisplayName(targetName(target))
    setError(null)
  }

  const chooseMode = (nextMode: PlanReferenceMode): void => {
    if (replacement) return
    setMode(nextMode)
    if (nextMode === 'embed' && selected && !isComponentTarget(selected)) {
      setSelected(null)
      setDisplayName('')
    }
  }

  const insertReference = async (): Promise<void> => {
    const target = selected
    const name = displayName.trim()
    if (!target || !name || submitting || !isCurrentSource()) return
    if (mode === 'embed' && !isComponentTarget(target)) return

    const replacementStillCurrent = (): boolean => {
      if (!replacement) return true
      const matches = usePlanStore.getState().document?.components.filter((component) => component.id === replacement.componentId) ?? []
      return matches.length === 1 && matches[0].type === 'plan_reference' &&
        isPlanReferencePayload(matches[0].payload) && JSON.stringify(matches[0].payload) === JSON.stringify(replacement.payload)
    }
    if (!replacementStillCurrent()) { setError(t('references.replaceFailed')); return }

    const requestRevisionAtStart = requestRevision.current
    setSubmitting(true)
    setError(null)
    try {
      const committedTarget: PlanReferenceTarget = await invoke('plan-reference:commitTarget', {
        library_id: source.libraryId,
        path: target.path,
        ...(target.component_id ? { component_id: target.component_id } : {}),
        mode
      })
      if (
        requestRevision.current !== requestRevisionAtStart ||
        !isCurrentSource()
      ) {
        onClose()
        return
      }

      const payload: PlanReferencePayload = {
        mode,
        target_plan_id: committedTarget.plan_id,
        ...(committedTarget.component_id ? { target_component_id: committedTarget.component_id } : {}),
        target_path_snapshot: committedTarget.path,
        target_name_snapshot: name
      }
      if (replacement) {
        if (!replacementStillCurrent()) { setError(t('references.replaceFailed')); return }
        usePlanStore.getState().patchComponent(replacement.componentId, (component) => {
          const updatedPayload = { ...component.payload, ...payload } as PlanReferencePayload
          if (!payload.target_component_id) delete updatedPayload.target_component_id
          return { ...component, payload: updatedPayload }
        })
      } else {
        const component: Component = { id: uuid32(), type: 'plan_reference', payload }
        appendComponent(component)
      }
      onClose()
    } catch {
      if (isCurrentSource()) setError(t(replacement ? 'references.replaceFailed' : 'references.insertFailed'))
    } finally {
      if (requestRevision.current === requestRevisionAtStart && isCurrentSource()) setSubmitting(false)
    }
  }

  return (
    <Modal
      className="plan-reference-picker"
      open={open}
      title={t(replacement ? 'references.replaceTitle' : 'references.pickerTitle')}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
    >
      <div className="plan-reference-picker__body">
        <Input
          aria-label={t('references.searchLabel')}
          placeholder={t('references.searchPlaceholder')}
          value={query}
          allowClear
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="plan-reference-picker__modes" role="group" aria-label={t('references.modeLabel')}>
          <Button
            aria-pressed={mode === 'link'}
            disabled={Boolean(replacement && mode !== 'link')}
            type={mode === 'link' ? 'primary' : 'default'}
            onClick={() => chooseMode('link')}
          >
            {t('references.linkMode')}
          </Button>
          <Button
            aria-pressed={mode === 'embed'}
            disabled={Boolean(replacement && mode !== 'embed')}
            type={mode === 'embed' ? 'primary' : 'default'}
            onClick={() => chooseMode('embed')}
          >
            {t('references.embedMode')}
          </Button>
        </div>
        <div className="plan-reference-picker__results" role="listbox" aria-label={t('references.targetsLabel')}>
          {visibleTargets.map((target) => {
            const isComponent = isComponentTarget(target)
            const value = isComponent ? target.component_id : target.plan_id ?? target.path
            const selectedValue = selected
              ? isComponentTarget(selected) ? selected.component_id : selected.plan_id ?? selected.path
              : null
            const isSelected = value === selectedValue
            return (
              <Button
                key={`${target.path}:${isComponent ? target.component_id : 'plan'}`}
                className={`plan-reference-picker__target${isSelected ? ' is-selected' : ''}`}
                role="option"
                aria-selected={isSelected}
                data-target-kind={isComponent ? 'component' : 'plan'}
                type="text"
                block
                onClick={() => chooseTarget(target)}
              >
                <span className="plan-reference-picker__target-name">{targetName(target)}</span>
                <span className="plan-reference-picker__target-path">{target.path}</span>
              </Button>
            )
          })}
          {loading && <div className="plan-reference-picker__status" role="status">{t('references.searching')}</div>}
          {!loading && !error && visibleTargets.length === 0 && (
            <div className="plan-reference-picker__status" role="status">{t('references.noTargets')}</div>
          )}
        </div>
        {selected && (
          <label className="plan-reference-picker__name">
            <span>{t('references.displayName')}</span>
            <Input
              aria-label={t('references.displayName')}
              maxLength={200}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
        )}
        {error && <div className="plan-reference-picker__error" role="alert">{error}</div>}
        <div className="plan-reference-picker__actions">
          <Button aria-label={t('common.cancel')} onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            type="primary"
            loading={submitting}
            disabled={!selected || !displayName.trim() || (mode === 'embed' && !isComponentTarget(selected))}
            onClick={() => void insertReference()}
          >
            {t(replacement ? 'references.replace' : 'references.insert')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
