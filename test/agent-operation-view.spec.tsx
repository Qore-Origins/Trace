// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import type { AgentOperationBatch, AgentSession } from '../src/shared/agent-types'
import { i18n } from '../src/renderer/src/i18n'
import { useWorkspaceTabsStore } from '../src/renderer/src/stores/workspace-tabs-store'
import { host, root, click, settle } from './agent-view-test-support'

const batch: AgentOperationBatch = {
  id: 'batch', requestId: 'request', assistantMessageId: 'assistant', userMessageId: 'user',
  createdAt: '2026-10-05', updatedAt: '2026-10-05', policyMode: 'restricted',
  status: 'execution-failed', confirmationSource: 'user', requiredConfirmation: true,
  operations: ['succeeded', 'failed', 'not-executed'].map((status, index) => ({
    callId: `call-${index}`, operation: 'plan.edit', status: status as 'succeeded' | 'failed' | 'not-executed',
    targetPath: `plan-${index}`, libraryId: 'library', rootHash: 'root', rootGeneration: 1,
    changes: [], requiredConfirmation: true, confirmationSource: 'user', reversible: true,
    undoStatus: index === 0 ? 'available' : 'unavailable', createdAt: '2026-10-05'
  }))
}
const session: AgentSession = {
  id: 'session', title: 'session', profileId: 'profile', createdAt: '', updatedAt: '', revision: 1,
  messages: [], requests: [], operationBatches: [batch]
}

async function mount(current: AgentOperationBatch, attempts: AgentOperationBatch[] = []): Promise<ReturnType<typeof vi.spyOn>> {
  await import('../src/renderer/src/views/AgentView')
  const view = (await import('../src/renderer/src/views/agent-chat/AgentOperationView')).default
  const spy = vi.spyOn(window.trace, 'invoke').mockImplementation(async (channel, payload) => {
    const batchId = channel === 'agent:operation:read' && payload && typeof payload === 'object' && 'batchId' in payload
      ? payload.batchId : current.id
    return { ok: true, data: [current, ...attempts].find((item) => item.id === batchId) ?? current }
  })
  await act(async () => root.render(createElement(view, {
    chat: { session: { ...session, operationBatches: [current, ...attempts] }, busy: false,
      readSession: async () => {}, operate: async (action: () => Promise<void>) => { await action() } },
    requestId: 'request'
  })))
  await settle()
  return spy
}

it('sends failed-only retry and pending-only continuation, preserving successful receipts', async () => {
  const spy = await mount(batch)
  await click('恢复')
  await click('只重试失败项')
  expect(spy).toHaveBeenCalledWith('agent:operation:retry', { sessionId: 'session', batchId: 'batch', callIds: ['call-1'] })
  await click('继续未执行项')
  expect(spy).toHaveBeenCalledWith('agent:operation:continue', { sessionId: 'session', batchId: 'batch', callIds: ['call-2'] })
  await click('撤销安全项 plan-0')
  expect(spy).toHaveBeenCalledWith('agent:operation:undo', { sessionId: 'session', batchId: 'batch', callId: 'call-0' })
  spy.mockRestore()
})

it('locks all recovery actions when main reports uncertain outcomes', async () => {
  const spy = await mount({ ...batch, status: 'reconciliation-required', operations: batch.operations.map((item, index) => index === 1 ? { ...item, status: 'outcome-unknown' } : item) })
  await click('恢复')
  expect(host.textContent).toContain('需要人工核验')
  expect(Array.from(host.querySelectorAll<HTMLButtonElement>('[data-agent-recovery]')).every((control) => control.disabled)).toBe(true)
  const calls = spy.mock.calls.length
  await click('只重试失败项')
  expect(spy.mock.calls.length).toBe(calls)
  spy.mockRestore()
})

it.each(['retry', 'continue'] as const)('undoes a safe successful %s attempt using its own batch and call identities', async (attemptKind) => {
  const attempt: AgentOperationBatch = { ...batch, id: `${attemptKind}-batch`, attemptOf: batch.id, attemptKind,
    status: 'completed', operations: [{ ...batch.operations[0], callId: `${attemptKind}-call`, targetPath: `${attemptKind}-plan` }] }
  const spy = await mount(batch, [attempt])
  await click('恢复')
  const ledger = host.querySelector<HTMLDetailsElement>('.agent-attempt-ledger')!
  await act(async () => ledger.querySelector('summary')!.click())
  expect(ledger.open).toBe(true)
  await click(`撤销安全项 ${attemptKind}-plan`)
  expect(spy).toHaveBeenCalledWith('agent:operation:undo', {
    sessionId: 'session', batchId: `${attemptKind}-batch`, callId: `${attemptKind}-call`
  })
  spy.mockRestore()
})

it.each(['root-reconciliation', 'root-unknown', 'attempt-reconciliation', 'attempt-unknown'] as const)(
  'locks successful attempt undo when main reports %s', async (uncertainty) => {
    const rootBatch: AgentOperationBatch = { ...batch,
      status: uncertainty === 'root-reconciliation' ? 'reconciliation-required' : batch.status,
      operations: batch.operations.map((item, index) => uncertainty === 'root-unknown' && index === 1
        ? { ...item, status: 'outcome-unknown' } : item) }
    const attempt: AgentOperationBatch = { ...batch, id: 'retry-batch', attemptOf: batch.id, attemptKind: 'retry',
      status: uncertainty === 'attempt-reconciliation' ? 'reconciliation-required' : 'completed',
      operations: [{ ...batch.operations[0], callId: 'retry-call', targetPath: 'retry-plan' },
        { ...batch.operations[1], status: uncertainty === 'attempt-unknown' ? 'outcome-unknown' : 'failed' }] }
    const spy = await mount(rootBatch, [attempt])
    await click('恢复')
    const ledger = host.querySelector<HTMLDetailsElement>('.agent-attempt-ledger')!
    await act(async () => ledger.querySelector('summary')!.click())
    const undo = ledger.querySelector<HTMLButtonElement>('button[aria-label="撤销安全项 retry-plan"]')!
    expect(undo).not.toBeNull()
    expect(undo.disabled).toBe(true)
    await click('撤销安全项 retry-plan', ledger)
    expect(spy.mock.calls.some(([channel]) => channel === 'agent:operation:undo')).toBe(false)
    spy.mockRestore()
  }
)

it('does not offer attempt undo for unsuccessful, irreversible or unavailable receipts', async () => {
  const attempt: AgentOperationBatch = { ...batch, id: 'continue-batch', attemptOf: batch.id, attemptKind: 'continue', status: 'completed',
    operations: [
      { ...batch.operations[0], callId: 'failed-call', targetPath: 'failed-plan', status: 'failed' },
      { ...batch.operations[0], callId: 'irreversible-call', targetPath: 'irreversible-plan', reversible: false },
      { ...batch.operations[0], callId: 'unavailable-call', targetPath: 'unavailable-plan', undoStatus: 'unavailable' }
    ] }
  const spy = await mount(batch, [attempt])
  await click('恢复')
  const ledger = host.querySelector<HTMLDetailsElement>('.agent-attempt-ledger')!
  await act(async () => ledger.querySelector('summary')!.click())
  expect(ledger.querySelectorAll('[data-agent-recovery]')).toHaveLength(0)
  expect(spy.mock.calls.some(([channel]) => channel === 'agent:operation:undo')).toBe(false)
  spy.mockRestore()
})

it.each(['reconciliation-required', 'outcome-unknown'] as const)('locks pending sibling mutations when another attempt is %s', async (uncertainty) => {
  const uncertainAttempt: AgentOperationBatch = { ...batch, id: 'uncertain-attempt', attemptOf: batch.id, attemptKind: 'retry',
    status: uncertainty === 'reconciliation-required' ? uncertainty : 'execution-failed',
    operations: [{ ...batch.operations[1], status: uncertainty === 'outcome-unknown' ? uncertainty : 'failed' }] }
  const pendingAttempt: AgentOperationBatch = { ...batch, id: 'pending-attempt', attemptOf: batch.id, attemptKind: 'continue',
    status: 'pending-confirmation', operations: [{ ...batch.operations[2], status: 'ready' }] }
  const spy = await mount(batch, [uncertainAttempt, pendingAttempt])
  await click('执行')
  const child = host.querySelector<HTMLElement>('[data-agent-batch="pending-attempt"]')!
  expect(child.textContent).toContain(i18n.t('agentChat.manualVerification'))
  const approval = child.querySelector<HTMLInputElement>('input[type="checkbox"]')!
  expect(approval.disabled).toBe(true)
  await act(async () => approval.click())
  const controls = Array.from(child.querySelectorAll<HTMLButtonElement>('button'))
  expect(controls.length).toBeGreaterThan(0)
  expect(controls.every((control) => control.disabled)).toBe(true)
  await click(i18n.t('agentChat.confirmOperations'), child)
  await click(i18n.t('agentChat.declineOperations'), child)
  await click('恢复')
  expect(Array.from(child.querySelectorAll<HTMLButtonElement>('[data-agent-recovery]')).every((control) => control.disabled)).toBe(true)
  await click(i18n.t('agentChat.continuePending'), child)
  expect(spy.mock.calls.filter(([channel]) => channel.startsWith('agent:operation:') && channel !== 'agent:operation:read')).toEqual([])
  spy.mockRestore()
})

it.each(['zh-CN', 'en-US'])('requires local approval and per-item strong purge confirmation in %s', async (language) => {
  await i18n.changeLanguage(language)
  const pending: AgentOperationBatch = { ...batch, status: 'pending-confirmation', operations: [
    { ...batch.operations[0], operation: 'trash.purge', status: 'ready', targetPath: 'old plan', targetKind: 'trash', undoStatus: 'unavailable' }
  ], confirmationPreview: { references: [], trashOperations: [{
    callId: 'call-0', operation: 'purge', entryId: 'entry', name: 'old plan', originalRelativePath: 'Folder/old plan', restoreRelativePath: null, planCount: 1, referenceCount: 2
  }] } }
  const spy = await mount(pending)
  await click(i18n.t('agentChat.execute'))
  const confirm = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((control) => control.textContent === i18n.t('agentChat.confirmOperations'))!
  expect(confirm.disabled).toBe(true)
  const labels = Array.from(host.querySelectorAll('label'))
  const approval = labels.find((label) => label.textContent?.includes(i18n.t('agentChat.approveWrites')))!.querySelector<HTMLInputElement>('input')!
  await act(async () => approval.click())
  expect(confirm.disabled).toBe(true)
  const purge = labels.find((label) => label.textContent?.includes(i18n.t('agentChat.strongPurge', { path: 'old plan' })))!.querySelector<HTMLInputElement>('input')!
  await act(async () => purge.click())
  expect(confirm.disabled).toBe(false)
  expect(host.textContent).toContain('Folder/old plan')
  await click(i18n.t('agentChat.confirmOperations'))
  expect(spy).toHaveBeenCalledWith('agent:operation:confirm', {
    sessionId: 'session', batchId: 'batch', decisions: [{ callId: 'call-0', strongConfirmation: true }]
  })
  spy.mockRestore()
})

it('declines local writes separately from outbound continuation and never dispatches a write approval', async () => {
  const spy = await mount({ ...batch, status: 'pending-confirmation' })
  await click('执行')
  await click('不同意本地执行')
  expect(spy).toHaveBeenCalledWith('agent:operation:cancel', { sessionId: 'session', batchId: 'batch' })
  expect(spy.mock.calls.some(([channel]) => channel === 'agent:operation:confirm')).toBe(false)
  spy.mockRestore()
})

it('re-previews a declined continuation only through the existing guarded main route', async () => {
  const spy = await mount({ ...batch, status: 'awaiting-outbound-preview', operations: [batch.operations[0]] })
  await click('再次预览续轮外发')
  expect(spy).toHaveBeenCalledWith('agent:request:continue', { sessionId: 'session', batchId: 'batch' })
  expect(spy.mock.calls.some(([channel]) => channel === 'agent:request:send' || channel === 'agent:operation:confirm')).toBe(false)
  spy.mockRestore()
})

it.each(['confirm', 'restricted', 'unrestricted'] as const)('displays main permission mode %s without granting writes in the renderer', async (mode) => {
  const spy = await mount({ ...batch, policyMode: mode })
  expect(host.textContent).toContain(i18n.t(`agentChat.permissionMode.${mode}`))
  expect(spy.mock.calls.some(([channel]) => channel === 'agent:policy:set' || channel === 'agent:operation:confirm')).toBe(false)
  spy.mockRestore()
})

function pendingReferenceBatch(mode: 'link' | 'embed', errorCategory?: AgentOperationBatch['operations'][number]['errorCategory']): AgentOperationBatch {
  return {
    ...batch,
    status: 'pending-confirmation',
    operations: [{ ...batch.operations[0], callId: 'reference-call', operation: 'component.delete', status: 'ready',
      targetKind: 'plan', targetPath: 'Source Plan', componentId: 'source-component', errorCategory }],
    confirmationPreview: { references: [{ callId: 'reference-call', sourcePath: 'Source Plan',
      sourceComponentId: 'source-reference', mode, targetNameSnapshot: 'Former Target', allowedActions: ['keep', 'replace'] }] }
  }
}

async function chooseReferenceAction(action: 'keep' | 'replace'): Promise<void> {
  const referenceAction = host.querySelector<HTMLSelectElement>('.agent-reference-decisions select')!
  await act(async () => {
    referenceAction.value = action
    referenceAction.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await settle()
}

async function approveOperations(): Promise<void> {
  const label = Array.from(host.querySelectorAll('label')).find((item) => item.textContent?.includes(i18n.t('agentChat.approveWrites')))
  const input = label?.querySelector<HTMLInputElement>('input[type="checkbox"]')
  if (!input) throw new Error('The local approval checkbox was not rendered')
  await act(async () => input.click())
  await settle()
}

function mockReplacementPlan(spy: Awaited<ReturnType<typeof mount>>, componentType = 'note', confirmation?: Promise<AgentOperationBatch>): void {
  spy.mockImplementation(async (channel, payload) => {
    if (channel === 'agent:context:browse') return { ok: true, data: [{ path: 'Replacement Plan', name: 'Replacement Plan',
      has_children: false, order: 0, kind: 'plan' }] } as never
    if (channel === 'agent:context:read') {
      const path = payload && typeof payload === 'object' && 'path' in payload ? payload.path : ''
      return { ok: true, data: { kind: 'plan', path, libraryId: 'library', version: 'version', updatedAt: '2026-10-05T00:00:00Z',
        content: JSON.stringify({ format_version: '1', created_at: '2026-10-05T00:00:00Z', updated_at: '2026-10-05T00:00:00Z',
          components: [{ id: 'replacement-component', type: componentType, payload: { title: 'Native replacement' } }] }) } } as never
    }
    if (channel === 'agent:operation:read') return { ok: true, data: pendingReferenceBatch('embed') } as never
    if (channel === 'agent:operation:confirm' && confirmation) return { ok: true, data: await confirmation } as never
    return { ok: true, data: pendingReferenceBatch('embed') } as never
  })
}

const targetPlan = {
  path: 'Target Plan', directoryIdentity: 'directory-identity', planId: 'stable-plan-id', updatedAt: '2026-10-05T00:00:00Z',
  libraryId: 'stable-library-id', rootHash: 'stable-root-hash', rootGeneration: 4
}
function targetPlanRevision(identity: typeof targetPlan): string {
  const fields = ['plan', identity.path, identity.directoryIdentity, identity.planId, identity.updatedAt,
    identity.libraryId, identity.rootHash, identity.rootGeneration]
  return `sha256:${createHash('sha256').update(JSON.stringify(fields)).digest('hex')}`
}
function navigableBatch(): AgentOperationBatch {
  return { ...batch, status: 'completed', operations: [{ ...batch.operations[0], status: 'succeeded', operation: 'plan.update',
    targetKind: 'plan', targetPath: targetPlan.path, targetStableId: targetPlan.planId, targetDirectoryIdentity: targetPlan.directoryIdentity,
    targetPlanId: targetPlan.planId, libraryId: targetPlan.libraryId, rootHash: targetPlan.rootHash, rootGeneration: targetPlan.rootGeneration,
    componentId: 'target-component', afterUpdatedAt: targetPlan.updatedAt }] }
}
function mockNavigableTarget(spy: Awaited<ReturnType<typeof mount>>, revision: string): void {
  spy.mockImplementation(async (channel, payload) => {
    if (channel === 'agent:context:read') return { ok: true, data: { kind: 'plan', path: targetPlan.path, libraryId: 'path-hash',
      version: 'version', updatedAt: targetPlan.updatedAt, content: JSON.stringify({ plan_id: targetPlan.planId, updated_at: targetPlan.updatedAt,
        components: [{ id: 'target-component', type: 'note', payload: { title: 'Target' } }] }) } } as never
    if (channel === 'agent:target:grant') return { ok: true, data: { id: 'grant-set', expiresAt: '2026-10-06T00:00:00Z', targets: [
      { ref: 'target-ref', kind: 'plan', path: targetPlan.path, name: targetPlan.path, revision, expiresAt: '2026-10-06T00:00:00Z' }
    ] } } as never
    if (channel === 'agent:target:validate') return { ok: true, data: { ref: 'target-ref', kind: 'plan', path: targetPlan.path,
      name: targetPlan.path, revision, expiresAt: '2026-10-06T00:00:00Z' } } as never
    if (channel === 'agent:operation:read') return { ok: true, data: navigableBatch() } as never
    if (channel === 'agent:target:release') return { ok: true, data: null } as never
    return { ok: true, data: null } as never
  })
}

it('requires an explicitly selected plan and a native component for embed replacement', async () => {
  const pending = pendingReferenceBatch('embed')
  const spy = await mount(pending)
  mockReplacementPlan(spy)
  await click(i18n.t('agentChat.execute'))
  await chooseReferenceAction('replace')
  await click(i18n.t('agentChat.chooseReplacementPlan', { path: 'Source Plan' }))
  await click(i18n.t('agentChat.selectReplacementPlan', { path: 'Replacement Plan' }))
  const component = document.querySelector<HTMLSelectElement>('.agent-reference-decisions select[data-replacement-component]')
  expect(component).not.toBeNull()
  if (!component) throw new Error('The embed replacement component selector was not rendered')
  expect(Array.from(component.options).some((option) => option.value === 'replacement-component')).toBe(true)
  await act(async () => {
    component.value = 'replacement-component'
    component.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await approveOperations()
  const confirm = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === i18n.t('agentChat.confirmOperations'))!
  expect(confirm.disabled).toBe(false)
  expect(component.value).toBe('replacement-component')
  spy.mockRestore()
})

it('sends the frozen replacement decisions to main confirmation without a renderer token', async () => {
  const pending = pendingReferenceBatch('embed')
  const spy = await mount(pending)
  let resolveConfirmation: ((batch: AgentOperationBatch) => void) | undefined
  const modalDecision = new Promise<AgentOperationBatch>((resolve) => { resolveConfirmation = resolve })
  mockReplacementPlan(spy, 'note', modalDecision)
  await click(i18n.t('agentChat.execute'))
  await chooseReferenceAction('replace')
  await click(i18n.t('agentChat.chooseReplacementPlan', { path: 'Source Plan' }))
  await click(i18n.t('agentChat.selectReplacementPlan', { path: 'Replacement Plan' }))
  const component = document.querySelector<HTMLSelectElement>('.agent-reference-decisions select[data-replacement-component]')!
  await act(async () => {
    component.value = 'replacement-component'
    component.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await approveOperations()
  const confirm = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === i18n.t('agentChat.confirmOperations'))!
  expect(confirm.disabled).toBe(false)
  await click(i18n.t('agentChat.confirmOperations'))
  expect(spy).toHaveBeenCalledWith('agent:operation:confirm', {
    sessionId: 'session', batchId: 'batch', decisions: [{ callId: 'reference-call', referenceDecisions: [{
      sourcePath: 'Source Plan', sourceComponentId: 'source-reference', action: 'replace',
      replacement: { path: 'Replacement Plan', componentId: 'replacement-component' }
    }] }]
  })
  expect(confirm.disabled).toBe(true)
  expect(component.disabled).toBe(true)
  expect(host.querySelector('[data-agent-batch] header [role="status"]')?.textContent).toBe(i18n.t('agentChat.batchStatus.pending-confirmation'))
  if (!resolveConfirmation) throw new Error('The main-process confirmation response was not captured')
  await act(async () => { resolveConfirmation!(pending) })
  await settle()
  expect(host.querySelector('[data-agent-batch] header [role="status"]')?.textContent).toBe(i18n.t('agentChat.batchStatus.pending-confirmation'))
  expect(document.querySelector<HTMLSelectElement>('.agent-reference-decisions select[data-replacement-component]')?.value).toBe('replacement-component')
  expect(Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === i18n.t('agentChat.confirmOperations'))?.disabled).toBe(false)
  expect(host.querySelector('[data-agent-batch] header [role="status"]')?.textContent).not.toBe(i18n.t('agentChat.batchStatus.completed'))
  spy.mockRestore()
})

it('sends explicit cancellation without a renderer token or reporting execution success', async () => {
  const pending = pendingReferenceBatch('link')
  const spy = await mount(pending)
  spy.mockImplementation(async (channel) => {
    if (channel === 'agent:operation:cancel') return { ok: true, data: null } as never
    return { ok: true, data: pending } as never
  })
  await click(i18n.t('agentChat.execute'))
  const decline = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === i18n.t('agentChat.declineOperations'))!
  expect(decline.disabled).toBe(false)
  await click(i18n.t('agentChat.declineOperations'))
  expect(spy).toHaveBeenCalledWith('agent:operation:cancel', { sessionId: 'session', batchId: 'batch' })
  expect(spy.mock.calls.some(([channel]) => channel === 'agent:operation:confirm')).toBe(false)
  expect(host.querySelector('[data-agent-batch] header [role="status"]')?.textContent).toBe(i18n.t('agentChat.batchStatus.pending-confirmation'))
  expect(host.querySelector('[data-agent-batch] header [role="status"]')?.textContent).not.toBe(i18n.t('agentChat.batchStatus.completed'))
  spy.mockRestore()
})

it('does not submit an embed replacement when the chosen plan has no native target component', async () => {
  const spy = await mount(pendingReferenceBatch('embed'))
  mockReplacementPlan(spy, 'plan_reference')
  await click(i18n.t('agentChat.execute'))
  await chooseReferenceAction('replace')
  await click(i18n.t('agentChat.chooseReplacementPlan', { path: 'Source Plan' }))
  await click(i18n.t('agentChat.selectReplacementPlan', { path: 'Replacement Plan' }))
  await approveOperations()
  const confirm = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === i18n.t('agentChat.confirmOperations'))!
  expect(confirm.disabled).toBe(true)
  expect(document.querySelector('.agent-reference-decisions select[data-replacement-component]')).toBeNull()
  expect(document.body.textContent).toContain(i18n.t('agentChat.noNativeComponents'))
  expect(spy.mock.calls.some(([channel]) => channel === 'agent:operation:confirm')).toBe(false)
  spy.mockRestore()
})

it('keeps link replacement path-only while exposing a live region for changing batch and operation states', async () => {
  const spy = await mount(pendingReferenceBatch('link'))
  const batchStatus = host.querySelector('[data-agent-batch] header [role="status"]')
  const operationStatus = host.querySelector('.agent-operation-status[role="status"]')
  expect(batchStatus?.getAttribute('aria-live')).toBe('polite')
  expect(operationStatus?.getAttribute('aria-live')).toBe('polite')
  mockReplacementPlan(spy)
  await click(i18n.t('agentChat.execute'))
  await chooseReferenceAction('replace')
  await click(i18n.t('agentChat.chooseReplacementPlan', { path: 'Source Plan' }))
  await click(i18n.t('agentChat.selectReplacementPlan', { path: 'Replacement Plan' }))
  await approveOperations()
  const confirm = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === i18n.t('agentChat.confirmOperations'))!
  expect(confirm.disabled).toBe(false)
  expect(document.querySelector('.agent-reference-decisions select[data-replacement-component]')).toBeNull()
  spy.mockRestore()
})

it('ignores a replacement plan read that resolves after its picker has closed', async () => {
  const pending = pendingReferenceBatch('embed')
  const spy = await mount(pending)
  let finishRead: ((response: never) => void) | undefined
  spy.mockImplementation(async (channel) => {
    if (channel === 'agent:context:browse') return { ok: true, data: [{ path: 'Replacement Plan', name: 'Replacement Plan',
      has_children: false, order: 0, kind: 'plan' }] } as never
    if (channel === 'agent:context:read') return await new Promise((resolve) => { finishRead = resolve as (response: never) => void }) as never
    if (channel === 'agent:operation:read') return { ok: true, data: pending } as never
    return { ok: true, data: pending } as never
  })
  await click(i18n.t('agentChat.execute'))
  await chooseReferenceAction('replace')
  await click(i18n.t('agentChat.chooseReplacementPlan', { path: 'Source Plan' }))
  await click(i18n.t('agentChat.selectReplacementPlan', { path: 'Replacement Plan' }))
  expect(finishRead).toBeTypeOf('function')
  const closePicker = document.querySelector<HTMLButtonElement>('.ant-modal-close')
  if (!closePicker) throw new Error('The replacement picker close button was not rendered')
  await act(async () => closePicker.click())
  await settle()
  finishRead!({ ok: true, data: { kind: 'plan', path: 'Replacement Plan', libraryId: 'library', version: 'version',
    updatedAt: '2026-10-05T00:00:00Z', content: JSON.stringify({ updated_at: '2026-10-05T00:00:00Z', components: [
      { id: 'replacement-component', type: 'note', payload: { title: 'Native replacement' } }
    ] }) } } as never)
  await settle()
  expect(host.querySelector('.agent-reference-decisions')?.textContent).not.toContain('替代计划：Replacement Plan')
  expect(spy.mock.calls.some(([channel]) => channel === 'agent:operation:confirm')).toBe(false)
  spy.mockRestore()
})

it('uses a create-specific name conflict message rather than recovery instructions', async () => {
  const conflict: AgentOperationBatch = { ...pendingReferenceBatch('link', 'name-conflict'),
    operations: [{ ...pendingReferenceBatch('link', 'name-conflict').operations[0], operation: 'plan.create', targetPath: 'New Plan' }],
    confirmationPreview: undefined }
  const spy = await mount(conflict)
  expect(host.textContent).toContain(i18n.t('agentChat.operationErrors.nameConflictCreate'))
  expect(host.textContent).not.toContain('恢复名称')
  spy.mockRestore()
})

it('opens a plan target only after main-process identity validation matches the operation audit', async () => {
  const spy = await mount(navigableBatch())
  mockNavigableTarget(spy, targetPlanRevision(targetPlan))
  const openPlan = vi.spyOn(useWorkspaceTabsStore.getState(), 'openPlan').mockResolvedValue(true)
  await click(i18n.t('agentChat.openTarget', { path: targetPlan.path }))
  expect(spy).toHaveBeenCalledWith('agent:target:grant', { targets: [{ kind: 'plan', path: targetPlan.path }] })
  expect(spy).toHaveBeenCalledWith('agent:target:validate', { setId: 'grant-set', ref: 'target-ref' })
  expect(spy).toHaveBeenCalledWith('agent:target:release', { setId: 'grant-set' })
  expect(openPlan).toHaveBeenCalledWith(targetPlan.path, 'target-component')
  openPlan.mockRestore()
  spy.mockRestore()
})

it('does not navigate to a target when its current directory identity differs from the audit', async () => {
  const spy = await mount(navigableBatch())
  mockNavigableTarget(spy, targetPlanRevision({ ...targetPlan, directoryIdentity: 'replacement-directory' }))
  const openPlan = vi.spyOn(useWorkspaceTabsStore.getState(), 'openPlan').mockResolvedValue(true)
  await click(i18n.t('agentChat.openTarget', { path: targetPlan.path }))
  expect(openPlan).not.toHaveBeenCalled()
  expect(spy).toHaveBeenCalledWith('agent:target:release', { setId: 'grant-set' })
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(i18n.t('agentChat.targetIdentityChanged'))
  openPlan.mockRestore()
  spy.mockRestore()
})
