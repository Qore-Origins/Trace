import { useEffect, useRef, useState } from 'react'
import { Button, Modal } from 'antd'
import { isReferenceTargetType } from '@shared/plan-reference-validation'
import type { AgentContextEntry, AgentOperationBatch, AgentOperationDecision, AgentOperationAuditItem } from '@shared/agent-types'
import type { PlanTreeNode } from '@shared/ipc-contract'
import { invoke } from '../../ipc-client'
import { useTranslation } from '../../i18n'
import { useTreeStore } from '../../stores/tree-store'
import { useWorkspaceTabsStore } from '../../stores/workspace-tabs-store'
import type { AgentChatController } from './types'

type OperationChat = Pick<AgentChatController, 'session' | 'busy' | 'readSession' | 'operate'>
type Stage = 'preflight' | 'execute' | 'recovery'
interface ReplacementPlanChoice {
  path: string
  updatedAt: string
  planId: string | null
  components: Array<{ id: string; label: string; targetable: boolean }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseReplacementPlan(entry: AgentContextEntry): ReplacementPlanChoice | null {
  if (entry.kind !== 'plan' || !entry.path || typeof entry.updatedAt !== 'string') return null
  let candidate: unknown
  try { candidate = JSON.parse(entry.content) as unknown } catch { return null }
  if (!isRecord(candidate) || candidate.updated_at !== entry.updatedAt || !Array.isArray(candidate.components)) return null
  const components = candidate.components.flatMap((value) => {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.type !== 'string') return []
    const payload = isRecord(value.payload) ? value.payload : {}
    const title = typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : value.id
    return [{ id: value.id, label: title, targetable: isReferenceTargetType(value.type) }]
  })
  return {
    path: entry.path,
    updatedAt: entry.updatedAt,
    planId: typeof candidate.plan_id === 'string' ? candidate.plan_id : null,
    components
  }
}

async function revisionForAuditedTarget(item: AgentOperationAuditItem, planUpdatedAt?: string): Promise<string> {
  const { targetKind, targetPath, targetDirectoryIdentity, targetPlanId, libraryId, rootHash, rootGeneration } = item
  if (!targetKind || !targetPath || !targetDirectoryIdentity || targetKind === 'trash') throw new Error('Target identity is incomplete')
  const identity: unknown[] = targetKind === 'plan'
    ? [targetPath, targetDirectoryIdentity, targetPlanId ?? null, planUpdatedAt]
    : [targetPath, targetDirectoryIdentity]
  if (targetKind === 'plan' && !planUpdatedAt) throw new Error('Plan revision is unavailable')
  const fields = [targetKind, ...identity, libraryId, rootHash, rootGeneration]
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(fields))))
  return `sha256:${Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('')}`
}

export default function AgentOperationView({ chat, requestId }: { chat: OperationChat; requestId: string }): React.JSX.Element {
  const { t } = useTranslation()
  const [stage, setStage] = useState<Stage>('preflight')
  const batches = chat.session?.operationBatches.filter((batch) => batch.requestId === requestId) ?? []
  return <div className="agent-operation-flow">
    <nav className="agent-stage-nav" aria-label={t('agentChat.taskFlow')}>
      {(['preflight', 'execute', 'recovery'] as const).map((value, index) => <button type="button" key={value}
        aria-label={t(`agentChat.${value}`)} aria-current={stage === value ? 'step' : undefined} onClick={() => setStage(value)}>
        <small>{String(index + 1).padStart(2, '0')}</small>{t(`agentChat.${value}`)}</button>)}
    </nav>
    <div className="agent-operation-scroll">
      {!batches.length && <p className="agent-hint">{t('agentChat.noOperations')}</p>}
      {batches.filter((batch) => !batch.attemptOf).map((batch) => <OperationBatch key={batch.id} chat={chat} audit={batch} stage={stage}
        attempts={batches.filter((candidate) => {
          let parent = candidate.attemptOf
          const seen = new Set<string>()
          while (parent && !seen.has(parent)) {
            if (parent === batch.id) return true
            seen.add(parent)
            parent = batches.find((item) => item.id === parent)?.attemptOf
          }
          return false
        })} />)}
    </div>
  </div>
}

function OperationBatch({ chat, audit, attempts, stage, inheritedUncertainty = false }: {
  chat: OperationChat; audit: AgentOperationBatch; attempts: AgentOperationBatch[]; stage: Stage; inheritedUncertainty?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const [batch, setBatch] = useState(audit)
  const [approved, setApproved] = useState(false)
  const [decisions, setDecisions] = useState<AgentOperationDecision[]>([])
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const epoch = useRef(0)
  const navigationLock = useRef(false)
  const sessionId = chat.session?.id
  useEffect(() => {
    const current = ++epoch.current
    setBatch(audit); setApproved(false); setDecisions([]); setWorking(false)
    if (sessionId) void invoke('agent:operation:read', { sessionId, batchId: audit.id }).then((result) => {
      if (current === epoch.current) setBatch(result)
    }).catch(() => { if (current === epoch.current) setError(t('agentChat.failed')) })
    return () => { epoch.current += 1 }
  }, [sessionId, audit.id, audit.updatedAt, attempts.map((attempt) => `${attempt.id}:${attempt.updatedAt}`).join('|')])
  const uncertain = inheritedUncertainty || batch.status === 'reconciliation-required' || batch.operations.some((item) => item.status === 'outcome-unknown')
    || attempts.some((attempt) => attempt.status === 'reconciliation-required' || attempt.operations.some((item) => item.status === 'outcome-unknown'))
  const blocked = chat.busy || working || uncertain || batch.status === 'executing'
    || attempts.some((attempt) => attempt.status === 'pending-confirmation' || attempt.status === 'executing')
  const updateDecision = (callId: string, patch: Partial<AgentOperationDecision>): void => {
    setDecisions((items) => [...items.filter((item) => item.callId !== callId), { ...items.find((item) => item.callId === callId), callId, ...patch }])
  }
  const run = async (action: () => Promise<AgentOperationBatch | null | unknown>): Promise<void> => {
    if (blocked || !sessionId) return
    const current = epoch.current
    setWorking(true); setError('')
    try {
      await chat.operate(async () => {
        try {
          const result = await action()
          if (current === epoch.current && result && typeof result === 'object' && 'operations' in result && 'id' in result && result.id === audit.id) {
            const nextBatch = result as AgentOperationBatch
            setBatch(nextBatch)
            if (nextBatch.status !== 'pending-confirmation') {
              setApproved(false); setDecisions([])
            }
          }
        } catch {
          if (current === epoch.current) setError(t('agentChat.operationFailed'))
        } finally {
          await chat.readSession(sessionId)
        }
      })
    } catch {
      if (current === epoch.current) setError(t('agentChat.operationFailed'))
      await chat.readSession(sessionId).catch(() => undefined)
    } finally {
      if (current === epoch.current) setWorking(false)
    }
  }
  const navigateToTarget = async (item: AgentOperationAuditItem): Promise<void> => {
    const path = item.targetPath
    const targetKind = item.targetKind
    if (navigationLock.current || !path || !item.targetDirectoryIdentity || !targetKind || targetKind === 'trash') return
    navigationLock.current = true
    setError('')
    let grantSetId: string | undefined
    try {
      let plan: ReplacementPlanChoice | null = null
      if (targetKind === 'plan') {
        const entry = await invoke('agent:context:read', { kind: 'plan', path })
        plan = parseReplacementPlan(entry)
        const expectedPlanId = item.targetPlanId ?? null
        if (!plan || plan.path !== path || plan.planId !== expectedPlanId ||
          (item.targetStableId && item.targetStableId !== (plan.planId ?? `path:${path}`)) ||
          (item.componentId && plan.components.filter((component) => component.id === item.componentId).length !== 1) ||
          plan.updatedAt !== entry.updatedAt) throw new Error('Plan identity changed')
      } else if (item.targetStableId && item.targetStableId !== item.targetDirectoryIdentity) {
        throw new Error('Folder identity changed')
      }

      const grants = await invoke('agent:target:grant', { targets: [{ kind: targetKind, path }] })
      grantSetId = grants.id
      const target = grants.targets.find((candidate) => candidate.kind === targetKind && candidate.path === path)
      if (!target) throw new Error('Target grant unavailable')
      const current = await invoke('agent:target:validate', { setId: grants.id, ref: target.ref })
      const expectedRevision = await revisionForAuditedTarget(item, plan?.updatedAt)
      if (current.kind !== targetKind || current.path !== path || current.revision !== expectedRevision) {
        throw new Error('Target identity changed')
      }

      if (targetKind === 'plan') {
        if (!(await useWorkspaceTabsStore.getState().openPlan(path, item.componentId))) throw new Error('Plan could not be opened')
      } else {
        await useTreeStore.getState().expandTo(path)
        useTreeStore.getState().select(path, 'folder')
      }
    } catch {
      setError(t('agentChat.targetIdentityChanged'))
    } finally {
      if (grantSetId) await invoke('agent:target:release', { setId: grantSetId }).catch(() => undefined)
      navigationLock.current = false
    }
  }
  const failed = batch.operations.filter((item) => item.status === 'failed' && !item.resolvedByAttempt).map((item) => item.callId)
  const pending = batch.operations.filter((item) => item.status === 'not-executed' && !item.resolvedByAttempt).map((item) => item.callId)
  const validDecisions = batch.operations.every((item) => {
    const decision = decisions.find((value) => value.callId === item.callId)
    if (item.operation === 'trash.purge' && !decision?.strongConfirmation) return false
    const refs = batch.confirmationPreview?.references.filter((ref) => ref.callId === item.callId) ?? []
    if (!refs.length) return true
    if (item.operation.endsWith('.rename')) return !!decision?.renameAction
    return refs.every((ref) => {
      const choice = decision?.referenceDecisions?.find((value) => value.sourcePath === ref.sourcePath
        && value.sourceComponentId === ref.sourceComponentId)
      return choice?.action === 'keep' || (choice?.action === 'replace' && !!choice.replacement?.path &&
        (ref.mode === 'link' || !!choice.replacement.componentId))
    })
  })
  return <article className="agent-operation-batch" data-agent-batch={audit.id}>
    <header><h2>{t('agentChat.batch')} · {audit.createdAt}</h2><span role="status" aria-live="polite" aria-atomic="true">{t(`agentChat.batchStatus.${batch.status}`)}</span></header>
    <p className="agent-hint">{t('agentChat.permission')}: {t(`agentChat.permissionMode.${batch.policyMode}`)}</p>
    {uncertain && <p className="agent-verification" role="alert">{t('agentChat.manualVerification')}</p>}
    {error && <p role="alert">{error}</p>}
    {stage !== 'recovery' && <>
      {batch.operations.map((item) => <OperationItem key={item.callId} item={item} onNavigate={navigateToTarget} />)}
      {batch.confirmationPreview?.affectedSubtrees?.map((subtree) => <details key={subtree.callId}><summary>{t('agentChat.affectedSubtree')} · {subtree.targetPath}</summary>
        {subtree.entries.map((entry) => <p key={entry.relativePath}>{entry.relativePath || '.'} · {t(`agentChat.${entry.kind === 'folder' ? 'targetFolder' : 'plan'}`)}</p>)}</details>)}
      {batch.confirmationPreview?.trashOperations?.map((item) => <div className="agent-source" key={item.callId}>
        <strong>{t(`agentChat.${item.operation}`)} · {item.name}</strong>
        <p>{t('agentChat.originalLocation')}: {item.originalRelativePath}</p>
        {item.restoreRelativePath && <p>{t('agentChat.restoreLocation')}: {item.restoreRelativePath}</p>}
        <p>{t('agentChat.impactCounts', { plans: item.planCount, references: item.referenceCount })}</p>
      </div>)}
      {batch.operations.map((item) => <ReferenceDecisions key={item.callId} batch={batch} item={item}
        decision={decisions.find((value) => value.callId === item.callId)} update={(patch) => updateDecision(item.callId, patch)} disabled={blocked || stage !== 'execute'} />)}
      {stage === 'execute' && batch.status === 'pending-confirmation' && <div className="agent-operation-actions">
        <label><input type="checkbox" checked={approved} disabled={blocked} onChange={(event) => setApproved(event.target.checked)} />{t('agentChat.approveWrites')}</label>
        <Button disabled={blocked || !approved || !validDecisions} onClick={() => void run(() => invoke('agent:operation:confirm', {
          sessionId: sessionId!, batchId: batch.id, decisions
        }))}>{t('agentChat.confirmOperations')}</Button>
        <Button disabled={blocked} onClick={() => void run(() => invoke('agent:operation:cancel', {
          sessionId: sessionId!, batchId: batch.id
        }))}>{t('agentChat.declineOperations')}</Button>
      </div>}
    </>}
    {stage === 'recovery' && <div className="agent-operation-actions">
      {batch.operations.map((item) => <OperationItem key={item.callId} item={item} onNavigate={navigateToTarget} />)}
      <Button data-agent-recovery disabled={blocked || !failed.length} onClick={() => void run(() => invoke('agent:operation:retry', { sessionId: sessionId!, batchId: batch.id, callIds: failed }))}>{t('agentChat.retryFailed')}</Button>
      <Button data-agent-recovery disabled={blocked || !pending.length} onClick={() => void run(() => invoke('agent:operation:continue', { sessionId: sessionId!, batchId: batch.id, callIds: pending }))}>{t('agentChat.continuePending')}</Button>
      {batch.operations.filter((item) => item.status === 'succeeded' && item.reversible && item.undoStatus === 'available').map((item) => <Button key={item.callId} data-agent-recovery disabled={blocked}
        aria-label={t('agentChat.undoItem', { path: item.targetPath ?? item.operation })}
        onClick={() => void run(() => invoke('agent:operation:undo', { sessionId: sessionId!, batchId: batch.id, callId: item.callId }))}>{t('agentChat.undoItem', { path: item.targetPath ?? item.operation })}</Button>)}
    </div>}
    {batch.status === 'awaiting-outbound-preview' && <Button disabled={blocked}
      onClick={() => void run(() => invoke('agent:request:continue', { sessionId: sessionId!, batchId: batch.id }))}>{t('agentChat.repreview')}</Button>}
    {attempts.filter((attempt) => attempt.status === 'pending-confirmation' || attempt.status === 'executing').map((attempt) =>
      <OperationBatch key={attempt.id} chat={chat} audit={attempt} attempts={[]} stage={stage} inheritedUncertainty={uncertain} />)}
    <details className="agent-attempt-ledger"><summary>{t('agentChat.attempts')} ({attempts.length + 1})</summary>
      {[audit, ...attempts].map((attempt) => <section key={attempt.id}><h3>{attempt.createdAt} · {attempt.attemptKind ? t(`agentChat.attemptKind.${attempt.attemptKind}`) : t('agentChat.initialAttempt')}</h3>
        <p>{t(`agentChat.batchStatus.${attempt.status}`)}</p>
        {attempt.operations.map((item) => <OperationItem key={item.callId} item={item} onNavigate={navigateToTarget} />)}
        {stage === 'recovery' && attempt.id !== audit.id && attempt.operations
          .filter((item) => item.status === 'succeeded' && item.reversible && item.undoStatus === 'available')
          .map((item) => <Button key={item.callId} data-agent-recovery disabled={blocked}
            aria-label={t('agentChat.undoItem', { path: item.targetPath ?? item.operation })}
            onClick={() => void run(() => invoke('agent:operation:undo', {
              sessionId: sessionId!, batchId: attempt.id, callId: item.callId
            }))}>{t('agentChat.undoItem', { path: item.targetPath ?? item.operation })}</Button>)}
      </section>)}
    </details>
  </article>
}

function operationErrorKey(item: AgentOperationAuditItem): string {
  if (item.errorCategory === 'name-conflict' && (item.operation === 'plan.create' || item.operation === 'folder.create')) {
    return 'agentChat.operationErrors.nameConflictCreate'
  }
  return `agentChat.operationErrors.${item.errorCategory}`
}

function OperationItem({ item, onNavigate }: {
  item: AgentOperationAuditItem; onNavigate?: (item: AgentOperationAuditItem) => Promise<void>
}): React.JSX.Element {
  const { t } = useTranslation()
  return <div className="agent-operation-item">
    <strong>{t(`agentChat.operationNames.${item.operation}`, { defaultValue: item.operation })} · {item.targetPath ?? item.trashEntryId ?? ''}</strong>
    {onNavigate && item.targetPath && item.targetKind && item.targetKind !== 'trash' && item.targetDirectoryIdentity && <Button type="link"
      aria-label={t('agentChat.openTarget', { path: item.targetPath })} onClick={() => void onNavigate(item)}>
      {t('agentChat.openTarget', { path: item.targetPath })}
    </Button>}
    <span role="status" aria-live="polite" aria-atomic="true" className={`agent-operation-status agent-operation-status--${item.status}`}>
      {t(`agentChat.itemStatus.${item.status}`)}
    </span>
    {item.errorCategory && <p>{t(operationErrorKey(item))}</p>}
    {!!item.changes.length && <details><summary>{t('agentChat.changes')}</summary>{item.changes.map((change, index) => <div className="agent-operation-diff" key={`${change.field}-${index}`}>
      <strong>{change.field}</strong><div><small>{t('agentChat.before')}</small><pre>{change.before ?? t('agentChat.none')}</pre></div><div><small>{t('agentChat.after')}</small><pre>{change.after ?? t('agentChat.none')}</pre></div>
    </div>)}</details>}
  </div>
}

function ReferenceDecisions({ batch, item, decision, update, disabled }: {
  batch: AgentOperationBatch; item: AgentOperationAuditItem; decision?: AgentOperationDecision;
  update: (patch: Partial<AgentOperationDecision>) => void; disabled: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const references = batch.confirmationPreview?.references.filter((ref) => ref.callId === item.callId) ?? []
  const [replacementPlans, setReplacementPlans] = useState<Record<string, ReplacementPlanChoice>>({})
  const [pickerReferenceKey, setPickerReferenceKey] = useState<string | null>(null)
  return <div className="agent-reference-decisions">
    {!!references.length && <h3>{t('agentChat.references')} · {item.targetPath}</h3>}
    {item.operation.endsWith('.rename') && !!references.length && <label>{t('agentChat.renameReferences')}<select disabled={disabled} value={decision?.renameAction ?? ''}
      onChange={(event) => update({ renameAction: event.target.value as 'update' | 'keep' })}>
      <option value="">{t('agentChat.chooseDecision')}</option><option value="update">{t('agentChat.updateReferences')}</option><option value="keep">{t('agentChat.keepReferences')}</option></select></label>}
    {references.map((ref) => {
      const key = `${ref.sourcePath}\0${ref.sourceComponentId}`
      const choice = decision?.referenceDecisions?.find((value) => value.sourcePath === ref.sourcePath && value.sourceComponentId === ref.sourceComponentId)
      const replacementPlan = replacementPlans[key]
      const selectedReplacementPlan = replacementPlan?.path === choice?.replacement?.path ? replacementPlan : null
      const change = (patch: Partial<NonNullable<AgentOperationDecision['referenceDecisions']>[number]>): void => update({ referenceDecisions: [
        ...(decision?.referenceDecisions ?? []).filter((value) => value.sourcePath !== ref.sourcePath || value.sourceComponentId !== ref.sourceComponentId),
        { sourcePath: ref.sourcePath, sourceComponentId: ref.sourceComponentId, action: 'keep', ...choice, ...patch }
      ] })
      return <div key={`${ref.sourcePath}:${ref.sourceComponentId}`}><p>{ref.sourcePath} · {ref.sourceComponentId} · {ref.targetNameSnapshot}</p>
        {!item.operation.endsWith('.rename') && <label>{t('agentChat.referenceAction')}<select disabled={disabled} value={choice?.action ?? ''}
          onChange={(event) => change({ action: event.target.value as 'keep' | 'replace' })}>
          <option value="">{t('agentChat.chooseDecision')}</option>{ref.allowedActions.filter((action) => action !== 'update').map((action) => <option key={action} value={action}>{t(`agentChat.referenceActions.${action}`)}</option>)}</select></label>}
        {choice?.action === 'replace' && <>
          <Button disabled={disabled} onClick={() => setPickerReferenceKey(key)}>
            {t('agentChat.chooseReplacementPlan', { path: ref.sourcePath })}
          </Button>
          {choice.replacement?.path && <p>{t('agentChat.selectedReplacementPlan', { path: choice.replacement.path })}</p>}
          {ref.mode === 'embed' && choice.replacement?.path && selectedReplacementPlan && <>
            {selectedReplacementPlan.components.some((component) => component.targetable)
              ? <label>{t('agentChat.replacementComponent')}<select data-replacement-component aria-label={t('agentChat.replacementComponent')}
                disabled={disabled} value={choice.replacement.componentId ?? ''}
                onChange={(event) => change({ action: 'replace', replacement: {
                  path: selectedReplacementPlan.path, componentId: event.target.value
                } })}>
                <option value="">{t('agentChat.chooseDecision')}</option>
                {selectedReplacementPlan.components.filter((component) => component.targetable).map((component) =>
                  <option key={component.id} value={component.id}>{component.label}</option>)}
              </select></label>
              : <p role="status">{t('agentChat.noNativeComponents')}</p>}
          </>}
          {pickerReferenceKey === key && <ReplacementPlanPicker
            onClose={() => setPickerReferenceKey(null)}
            onSelect={(plan) => {
              setReplacementPlans((current) => ({ ...current, [key]: plan }))
              change({ action: 'replace', replacement: { path: plan.path } })
              setPickerReferenceKey(null)
            }}
          />}
        </>}
      </div>
    })}
    {item.operation === 'trash.purge' && <label className="agent-verification"><input type="checkbox" checked={decision?.strongConfirmation ?? false} disabled={disabled}
      onChange={(event) => update({ strongConfirmation: event.target.checked })} />{t('agentChat.strongPurge', { path: item.targetPath ?? item.trashEntryId ?? item.callId })}</label>}
  </div>
}

function ReplacementPlanPicker({ onSelect, onClose }: {
  onSelect: (plan: ReplacementPlanChoice) => void
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [path, setPath] = useState('')
  const [nodes, setNodes] = useState<PlanTreeNode[]>([])
  const [loading, setLoading] = useState(true)
  const [readingPath, setReadingPath] = useState('')
  const [error, setError] = useState('')
  const epoch = useRef(0)
  const live = useRef(true)
  const browse = async (parentPath: string): Promise<void> => {
    const current = ++epoch.current
    setPath(parentPath); setNodes([]); setLoading(true); setError('')
    try {
      const result = await invoke('agent:context:browse', { parentPath })
      if (live.current && current === epoch.current) setNodes(result.filter((node) => node.path.split('/')[0]?.toLocaleLowerCase() !== 'diary'))
    } catch {
      if (live.current && current === epoch.current) setError(t('agentChat.contextFailed'))
    } finally {
      if (live.current && current === epoch.current) setLoading(false)
    }
  }
  const selectPlan = async (planPath: string): Promise<void> => {
    if (readingPath) return
    const current = ++epoch.current
    setReadingPath(planPath); setError('')
    try {
      const entry = await invoke('agent:context:read', { kind: 'plan', path: planPath })
      const plan = parseReplacementPlan(entry)
      if (!plan || plan.path !== planPath) throw new Error('Selected plan changed')
      if (live.current && current === epoch.current) onSelect(plan)
    } catch {
      if (live.current && current === epoch.current) setError(t('agentChat.contextFailed'))
    } finally {
      if (live.current && current === epoch.current) setReadingPath('')
    }
  }
  useEffect(() => {
    live.current = true
    void browse('')
    return () => { live.current = false; epoch.current += 1 }
  }, [])
  const selectableNodes = nodes
  return <Modal open title={t('agentChat.replacementPlanTitle')} onCancel={onClose}
    footer={<Button disabled={!!readingPath} onClick={onClose}>{t('agentChat.done')}</Button>}>
    <div className="agent-context-picker">
      <header>
        <Button disabled={loading || !!readingPath} onClick={() => void browse('')}>{t('agentChat.browseRoot')}</Button>
        <Button disabled={!path || loading || !!readingPath} onClick={() => void browse(path.split('/').slice(0, -1).join('/'))}>{t('agentChat.up')}</Button>
      </header>
      <p>{path || t('agentChat.browseRoot')}</p>
      {loading && <p role="status">{t('common.loading')}</p>}
      {readingPath && <p role="status">{t('common.loading')}</p>}
      {error && <p role="alert">{error}<Button onClick={() => void browse(path)}>{t('agentChat.retry')}</Button></p>}
      {!loading && !error && <ul className="agent-context-list">
        {selectableNodes.map((node) => <li key={node.path}>
          {node.kind === 'folder'
            ? <Button disabled={!!readingPath} onClick={() => void browse(node.path)}>{t('agentChat.browseReplacementFolder', { path: node.name })}</Button>
            : <Button disabled={!!readingPath} onClick={() => void selectPlan(node.path)}>{t('agentChat.selectReplacementPlan', { path: node.name })}</Button>}
        </li>)}
        {selectableNodes.length === 0 && <li>{t('agentChat.noReplacementPlans')}</li>}
      </ul>}
    </div>
  </Modal>
}
