import { useEffect, useRef, useState } from 'react'
import { Button, Input, Modal, Select, Switch } from 'antd'
import type { WorkflowAssignedTask, WorkflowBatchConfirmation, WorkflowBatchResult, WorkflowBatchSummary, WorkflowContentComponentTemplate, WorkflowDraftInput, WorkflowPreview } from '@shared/plan-workflow-types'
import { invoke } from '../ipc-client'
import { useTranslation } from '../i18n'
import { useAppStore } from '../stores/app-store'
import { useTreeStore } from '../stores/tree-store'

function localDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function initialWorkflowDraft(selectedPath: string, title: string): WorkflowDraftInput {
  const today = new Date()
  const nextMonday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + (8 - ((today.getDay() + 6) % 7 + 1)))
  const sunday = new Date(nextMonday.getFullYear(), nextMonday.getMonth(), nextMonday.getDate() + 6)
  return {
    selected_path: selectedPath,
    title: title.trim() || undefined,
    target_date: localDate(today),
    period: { start_date: localDate(nextMonday), end_date: localDate(sunday) },
    tasks: []
  }
}

interface Props {
  rootDir: string
  libraryId: string
  initialDraft: WorkflowDraftInput
  initialPreview: WorkflowPreview
  availablePresets: Array<{ id: string; name: string }>
  onClose: () => void
}

export default function PlanWorkflowCreateModal({ rootDir, libraryId, initialDraft, initialPreview, availablePresets, onClose }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<WorkflowDraftInput>(initialDraft)
  const [preview, setPreview] = useState<WorkflowPreview>(initialPreview)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmations, setConfirmations] = useState<Record<string, WorkflowBatchConfirmation>>({})
  const [batchResult, setBatchResult] = useState<WorkflowBatchResult | null>(null)
  const [pendingBatches, setPendingBatches] = useState<WorkflowBatchSummary[]>([])
  const requestRef = useRef(0)

  const hasWeek = preview.outputs.some((output) => output.workflow_kind === 'week')
  useEffect(() => {
    if (!hasWeek) return
    let active = true
    void invoke('plan-workflow:listBatches', { library_id: libraryId }).then((batches) => {
      if (active && useAppStore.getState().rootDir === rootDir) setPendingBatches(batches)
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : t('errors.opFailed'))
    })
    return () => { active = false }
  }, [hasWeek, libraryId, rootDir, t])

  const change = (next: WorkflowDraftInput): void => {
    if (batchResult) return
    requestRef.current += 1
    setDraft(next)
    setDirty(true)
    setError(null)
  }

  const refresh = async (): Promise<void> => {
    if (busy) return
    const sequence = ++requestRef.current
    const currentDraft = structuredClone(draft)
    setBusy(true)
    setError(null)
    try {
      const next = await invoke('plan-workflow:preview', { library_id: libraryId, draft: currentDraft })
      if (sequence !== requestRef.current || useAppStore.getState().rootDir !== rootDir) return
      setPreview(next)
      setConfirmations({})
      setDirty(false)
    } catch (cause) {
      if (sequence === requestRef.current) setError(cause instanceof Error ? cause.message : t('errors.opFailed'))
    } finally {
      if (sequence === requestRef.current) setBusy(false)
    }
  }

  const create = async (): Promise<void> => {
    if (dirty || busy || preview.state !== 'ready' || preview.outputs.length === 0 ||
      preview.outputs.some((output) => output.name === null ||
        (preview.outputs.length === 1 && output.conflicts.length > 0))) return
    const sequence = ++requestRef.current
    setBusy(true)
    setError(null)
    try {
      if (preview.outputs.length > 1) {
        const result = await invoke('plan-workflow:commitBatch', { library_id: libraryId, draft,
          revision_token: preview.revision_token, confirmations: Object.values(confirmations) })
        if (sequence !== requestRef.current || useAppStore.getState().rootDir !== rootDir) return
        setBatchResult(result)
        for (const item of result.items.filter((entry) => entry.status === 'created')) {
          await useTreeStore.getState().registerWorkflowCreated({ path: item.path,
            name: item.path.split('/').at(-1) ?? item.path, kind: 'plan', has_children: false, order: Number.MAX_SAFE_INTEGER })
        }
        if (result.status === 'complete') onClose()
        return
      }
      const node = await invoke('plan-workflow:commit', { library_id: libraryId, draft, revision_token: preview.revision_token })
      if (sequence !== requestRef.current || useAppStore.getState().rootDir !== rootDir) return
      await useTreeStore.getState().registerWorkflowCreated(node)
      onClose()
    } catch (cause) {
      if (sequence === requestRef.current) {
        setError(cause instanceof Error ? cause.message : t('errors.opFailed'))
        setDirty(true)
      }
    } finally {
      if (sequence === requestRef.current) setBusy(false)
    }
  }

  const resume = async (operationId: string): Promise<void> => {
    if (!operationId || busy) return
    const sequence = ++requestRef.current
    setBusy(true)
    setError(null)
    try {
      const result = await invoke('plan-workflow:resumeBatch', { library_id: libraryId, operation_id: operationId })
      if (sequence !== requestRef.current || useAppStore.getState().rootDir !== rootDir) return
      setBatchResult(result)
      if (result.status === 'complete') setPendingBatches((items) => items.filter((item) => item.operation_id !== operationId))
      for (const item of result.items.filter((entry) => entry.status === 'created')) {
        await useTreeStore.getState().registerWorkflowCreated({ path: item.path,
          name: item.path.split('/').at(-1) ?? item.path, kind: 'plan', has_children: false, order: Number.MAX_SAFE_INTEGER })
      }
      if (result.status === 'complete') onClose()
    } catch (cause) {
      if (sequence === requestRef.current) setError(cause instanceof Error ? cause.message : t('errors.opFailed'))
    } finally {
      if (sequence === requestRef.current) setBusy(false)
    }
  }

  const setTask = (id: string, patch: Partial<WorkflowAssignedTask>): void => {
    change({ ...draft, tasks: (draft.tasks ?? []).map((task) => task.id === id ? { ...task, ...patch } : task) })
  }
  const setComponents = (key: string, components: WorkflowContentComponentTemplate[]): void => {
    change({ ...draft, component_overrides: { ...draft.component_overrides, [key]: components } })
  }

  const canCreate = !dirty && !busy && !batchResult && preview.state === 'ready' && preview.outputs.length > 0 &&
    preview.outputs.every((output) => output.name !== null && output.conflicts.every((conflict) =>
      conflict.code !== 'duplicate_output' && conflict.code !== 'missing_name' &&
      (preview.outputs.length > 1 ? Boolean(confirmations[output.key]) &&
        (confirmations[output.key].action !== 'reuse' || output.assigned_tasks.length === 0 || confirmations[output.key].merge_tasks === true) : false)))

  return <Modal title={t('workflow.createTitle')} open onCancel={onClose} footer={null} width="min(860px, calc(100vw - 32px))" centered>
    <div className="plan-workflow-create">
      {pendingBatches.length > 0 && <section role="status"><h3>{t('workflow.pendingBatches')}</h3>
        {pendingBatches.map((item) => <div className="plan-workflow-create__confirm" key={item.operation_id}>
          <span>{item.period.start_date} – {item.period.end_date} · {item.completed_count}/{item.total_count}</span>
          <Button size="small" disabled={busy} onClick={() => void resume(item.operation_id)}>{t('workflow.resume')}</Button>
        </div>)}
      </section>}
      {availablePresets.length > 0 && <label>{t('workflow.preset')}
        <Select aria-label={t('workflow.preset')} value={draft.preset_id ?? preview.preset_id}
          placeholder={t('workflow.preset')} options={availablePresets.map((item) => ({ value: item.id, label: item.name }))}
          onChange={(preset_id: string) => change({ ...draft, preset_id })} />
      </label>}
      <div className="plan-workflow-create__fields">
        <label>{t('workflow.title')}<Input value={draft.title ?? ''} onChange={(event) => change({ ...draft, title: event.target.value })} /></label>
        <label>{t('workflow.targetDate')}<Input type="date" value={draft.target_date ?? ''} onChange={(event) => change({ ...draft, target_date: event.target.value })} /></label>
        <label>{t('workflow.periodStart')}<Input type="date" value={draft.period?.start_date ?? ''}
          onChange={(event) => change({ ...draft, period: { start_date: event.target.value, end_date: draft.period?.end_date ?? '' } })} /></label>
        <label>{t('workflow.periodEnd')}<Input type="date" value={draft.period?.end_date ?? ''}
          onChange={(event) => change({ ...draft, period: { start_date: draft.period?.start_date ?? '', end_date: event.target.value } })} /></label>
      </div>
      <section>
        <h3>{t('workflow.taskTitle')}</h3>
        {(draft.tasks ?? []).map((task) => <div className="plan-workflow-create__task" key={task.id}>
          <Input aria-label={t('workflow.taskTitle')} value={task.title} onChange={(event) => setTask(task.id, { title: event.target.value })} />
          <Input type="date" aria-label={t('workflow.taskDate')} value={task.target_date ?? ''} onChange={(event) => setTask(task.id, { target_date: event.target.value || undefined })} />
          <Button danger onClick={() => change({ ...draft, tasks: draft.tasks?.filter((item) => item.id !== task.id) })}>{t('workflow.remove')}</Button>
        </div>)}
        <Button size="small" onClick={() => change({ ...draft, tasks: [...(draft.tasks ?? []), { id: `task_${crypto.randomUUID().slice(0, 8)}`, title: '' }] })}>{t('workflow.addTask')}</Button>
      </section>
      <section aria-label={t('workflow.createTitle')}>
        <h3>{t('workflow.createTitle')}</h3>
        {preview.outputs.map((output) => <div className="plan-workflow-create__output" key={output.key}>
          <strong>{output.relative_path ?? output.destination_path}</strong>
          <div>{t('workflow.source')}: {output.name_rule_source} · {t('workflow.targetDate')}: {output.target_date ?? t('workflow.noDate')}</div>
          <label>{t('workflow.destinationPath')}<Input aria-label={`${t('workflow.destinationPath')} ${output.key}`}
            value={draft.destination_overrides?.[output.key] ?? output.destination_path}
            onChange={(event) => change({ ...draft, destination_overrides: { ...draft.destination_overrides, [output.key]: event.target.value } })} /></label>
          <label>{t('workflow.finalName')}<Input aria-label={`${t('workflow.finalName')} ${output.key}`}
            value={draft.manual_names?.[output.key] ?? output.name ?? ''} placeholder={t('workflow.path')}
            onChange={(event) => change({ ...draft, manual_names: { ...draft.manual_names, [output.key]: event.target.value } })} /></label>
          <div>{t('workflow.components')}</div>
          {(draft.component_overrides?.[output.key] ?? output.components).map((component, index, components) =>
            <div className="plan-workflow-create__component" key={`${output.key}:${index}`}><div className="plan-workflow-create__task">
              <Select aria-label={`${t('workflow.componentType')} ${output.key} ${index}`} value={component.type}
                options={['heading', 'note', 'task_list', 'mood', 'plan_reference'].map((type) => ({ value: type, label: t(`workflow.component_${type}`) }))}
                onChange={(type: WorkflowContentComponentTemplate['type']) => setComponents(output.key, components.map((item, position) => position === index
                  ? { type, title: item.title, ...(type === 'plan_reference' ? { reference_output_key: '' } : {}) } : item))} />
              <Input aria-label={`${t('workflow.componentTitle')} ${output.key} ${index}`} value={component.title}
                onChange={(event) => setComponents(output.key, components.map((item, position) => position === index ? { ...item, title: event.target.value } : item))} />
              <Button size="small" danger onClick={() => setComponents(output.key, components.filter((_item, position) => position !== index))}>{t('workflow.remove')}</Button>
            </div>
              {(component.type === 'note' || component.type === 'mood') && <Input.TextArea aria-label={`${t('workflow.componentPrompt')} ${output.key} ${index}`}
                value={component.prompt ?? ''} onChange={(event) => setComponents(output.key, components.map((item, position) => position === index ? { ...item, prompt: event.target.value } : item))} />}
            </div>)}
          <Button size="small" onClick={() => setComponents(output.key, [...(draft.component_overrides?.[output.key] ?? output.components), { type: 'note', title: '记录' }])}>{t('workflow.addComponent')}</Button>
          {output.conflicts.map((conflict, index) => <div role="alert" key={`${conflict.code}:${index}`}>
            {conflict.message}{conflict.existing_paths?.length ? `: ${conflict.existing_paths.join(', ')}` : ''}
          </div>)}
          {preview.outputs.length > 1 && output.conflicts.some((conflict) => conflict.code === 'same_date_candidate' || conflict.code === 'name_exists') &&
            <div className="plan-workflow-create__confirm">
              <Select aria-label={`${t('workflow.candidateDecision')} ${output.key}`} value={confirmations[output.key]?.action}
                placeholder={t('workflow.candidateDecision')} options={[
                  ...(output.conflicts.some((conflict) => conflict.code === 'name_exists') ? [] : [{ value: 'create', label: t('workflow.createSeparate') }]),
                  { value: 'reuse', label: t('workflow.reuse') }
                ]} onChange={(action: 'create' | 'reuse') => setConfirmations((current) => ({ ...current,
                  [output.key]: { output_key: output.key, action, ...(action === 'reuse' ? { existing_path: output.conflicts.flatMap((conflict) => conflict.existing_paths ?? [])[0] } : {}) } }))} />
              {confirmations[output.key]?.action === 'reuse' && <>
                <Select aria-label={`${t('workflow.reusePath')} ${output.key}`} value={confirmations[output.key].existing_path}
                  options={output.conflicts.flatMap((conflict) => conflict.existing_paths ?? []).map((path) => ({ value: path, label: path }))}
                  onChange={(existing_path: string) => setConfirmations((current) => ({ ...current,
                    [output.key]: { ...current[output.key], existing_path } }))} />
                {output.assigned_tasks.length > 0 && <label>{t('workflow.mergeTasks')}
                  <Switch checked={confirmations[output.key].merge_tasks === true}
                    onChange={(merge_tasks) => setConfirmations((current) => ({ ...current,
                      [output.key]: { ...current[output.key], merge_tasks } }))} /></label>}
              </>}
            </div>}
        </div>)}
      </section>
      {batchResult && <section role="status"><h3>{batchResult.status === 'existing_draft' ? t('workflow.existingDraft') : t('workflow.batchResult')}</h3>
        {batchResult.items.map((item) => <div key={item.output_key}>{item.status}: {item.path}{item.error ? ` · ${item.error}` : ''}</div>)}
        {batchResult.status === 'partial' && <Button onClick={() => void resume(batchResult.operation_id)} disabled={busy} loading={busy}>{t('workflow.resume')}</Button>}
      </section>}
      {dirty && <p role="status">{t('workflow.previewDirty')}</p>}
      {error && <p role="alert">{error}</p>}
      <div className="plan-workflow-create__actions">
        <Button onClick={() => void refresh()} disabled={busy} loading={busy}>{t('workflow.refreshPreview')}</Button>
        <Button type="primary" disabled={!canCreate} onClick={() => void create()}>{t('workflow.create')}</Button>
      </div>
    </div>
  </Modal>
}
