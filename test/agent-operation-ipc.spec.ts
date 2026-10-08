import { promises as fs } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 全量并发负载下批次交互可能超默认 5s——放宽至 20s（负载型超时 flaky）
vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 })
import type { AgentApprovalRequestSnapshot, AgentOutboundPreview, AgentRequestEvent, AgentRequestIdentity } from '../src/shared/agent-types'
import type { TraceBridge, TraceResult } from '../src/shared/ipc-contract'
import type { TrashOperationPreview } from '../src/shared/trash-types'

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>()
  const listeners = new Map<string, Set<(event: unknown, payload: unknown) => void>>()
  return {
    handlers, listeners,
    ipcMain: { handle: (name: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => handlers.set(name, handler), removeHandler: (name: string) => handlers.delete(name) },
    ipcRenderer: {
      invoke: (name: string, payload: unknown) => handlers.get(name)?.({}, payload),
      on: (name: string, listener: (event: unknown, payload: unknown) => void) => { const group = listeners.get(name) ?? new Set(); group.add(listener); listeners.set(name, group) },
      removeListener: (name: string, listener: (event: unknown, payload: unknown) => void) => listeners.get(name)?.delete(listener)
    },
    contextBridge: { exposeInMainWorld: (_key: string, value: unknown) => Reflect.set(window, 'trace', value) },
    dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
    safeStorage: { isAsyncEncryptionAvailable: vi.fn(async () => false), encryptStringAsync: vi.fn(async () => Buffer.from('encrypted-only')), decryptStringAsync: vi.fn(async () => ({ result: 'loopback-test-key', shouldReEncrypt: false })) }
  }
})
vi.mock('electron', () => electron)

let directory: string
let root: string
let libraryId: string
let profileId: string
let bridge: TraceBridge
let rawBridge: TraceBridge
let storage: import('../src/main/services/storage-service').StorageService
let planReferences: import('../src/main/services/plan-reference-service').PlanReferenceService
let agentTargets: import('../src/main/services/agent-target-service').AgentTargetService
let server: Server
let dispose: (() => void) | undefined
let responses: ServerResponse[]
let events: AgentRequestEvent[]
let windowAvailable: boolean
let allowTrustedConfirmation: boolean
let trustedConfirmationDisplayFails: boolean
let trustedConfirmationSnapshots: unknown[]
let trustedTrashConfirmationSnapshots: unknown[]

function data<T>(result: TraceResult<T>): T {
  if (!result.ok) throw new Error(result.message)
  return result.data
}

function frame(toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: toolCalls.map((call, index) => ({ index, id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`
}

async function until(predicate: () => boolean): Promise<void> {
  await vi.waitFor(() => expect(predicate()).toBe(true), { timeout: 5000, interval: 10 })
}

async function writePlan(): Promise<{ updatedAt: string; taskListId: string }> {
  const updatedAt = '2026-10-04T00:00:00.000Z'
  const taskListId = 'a'.repeat(32)
  await fs.mkdir(join(root, 'one'), { recursive: true })
  await fs.writeFile(join(root, 'one', 'plan.json'), JSON.stringify({
    format_version: '1', created_at: updatedAt, updated_at: updatedAt,
    components: [{ id: taskListId, type: 'task_list', payload: { title: 'Tasks', items: [] } }]
  }))
  return { updatedAt, taskListId }
}

async function startBatch(input: {
  title: string
  message: string
  targetSetId?: string
  targetRefs: string[]
  calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
  requestBodies?: string[]
}): Promise<{ sessionId: string; requestId: string; batchId: string; getRequestCount: () => number }> {
  server.removeAllListeners('request')
  let requestCount = 0
  server.on('request', (request, response) => {
    if (input.requestBodies) {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => input.requestBodies?.push(Buffer.concat(chunks).toString('utf8')))
    }
    response.setHeader('content-type', 'text/event-stream')
    if (requestCount++ === 0) response.end(frame(input.calls))
    else response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'The operation result was reviewed.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
  })
  const session = data(await bridge.invoke('agent:session:create', { title: input.title, profileId }))
  const preview = data(await bridge.invoke('agent:preview:create', {
    sessionId: session.id, message: input.message, selections: [],
    ...(input.targetSetId && input.targetRefs.length > 0 ? { targetGrantSetId: input.targetSetId, targetRefs: input.targetRefs } : {})
  })) as AgentOutboundPreview
  const identity = data(await bridge.invoke('agent:request:send', { token: preview.token, sessionId: session.id })) as AgentRequestIdentity
  await until(() => events.some((event) => event.requestId === identity.requestId && event.type === 'terminal'))
  const saved = data(await bridge.invoke('agent:session:read', { id: session.id }))
  const batch = saved.operationBatches.find((item) => item.requestId === identity.requestId)
  if (!batch) throw new Error('operation batch was not persisted')
  return { sessionId: session.id, requestId: identity.requestId, batchId: batch.id, getRequestCount: () => requestCount }
}

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  electron.handlers.clear()
  electron.listeners.clear()
  vi.stubGlobal('window', {})
  windowAvailable = true
  allowTrustedConfirmation = true
  trustedConfirmationDisplayFails = false
  trustedConfirmationSnapshots = []
  trustedTrashConfirmationSnapshots = []
  responses = []
  events = []
  server = createServer(async (_request, response) => {
    responses.push(response)
    response.setHeader('content-type', 'text/event-stream')
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('loopback listener did not start')
  directory = await fs.mkdtemp(join(tmpdir(), 'trace-agent-operation-'))
  root = join(directory, 'library')
  await fs.mkdir(root)

  const [{ registerIpc }, { StorageService }, { PlanRepository }, { AgentProfileService }, { AgentTargetService }] = await Promise.all([
    import('../src/main/ipc/register'), import('../src/main/services/storage-service'),
    import('../src/main/services/plan-repository'), import('../src/main/services/agent-profile-service'),
    import('../src/main/services/agent-target-service')
  ])
  const repository = new PlanRepository()
  libraryId = (await repository.ensureLibraryRoot(root)).library_id
  storage = new StorageService(repository)
  storage.setRoot(root)
  const profiles = new AgentProfileService(directory)
  const [{ PlanReferenceService }, { PlanNameTemplateService }, { getAgentToolDefinitions }] = await Promise.all([
    import('../src/main/services/plan-reference-service'), import('../src/main/services/plan-name-template-service'),
    import('../src/main/services/agent-tool-registry')
  ])
  planReferences = new PlanReferenceService(repository, () => root)
  planReferences.activateRoot(root)
  agentTargets = new AgentTargetService(storage)
  storage.setTrashReferenceImpactReader(async (targetLibraryId, planIds) => {
    const references = (await Promise.all(planIds.map(async (planId) =>
      (await planReferences.inbound({ library_id: targetLibraryId, plan_id: planId })).references
    ))).flat()
    references.sort((left, right) =>
      `${left.target_plan_id}\0${left.target_component_id ?? ''}\0${left.source_path}\0${left.source_component_id}`
        .localeCompare(`${right.target_plan_id}\0${right.target_component_id ?? ''}\0${right.source_path}\0${right.source_component_id}`)
    )
    return {
      signature: createHash('sha256').update(JSON.stringify(references)).digest('hex'),
      reference_count: references.length
    }
  })
  dispose = registerIpc({
    storage,
    agentUserDataDir: directory,
    agentProfiles: profiles,
    agentTargetService: agentTargets,
    planReferences,
    planNameTemplates: new PlanNameTemplateService(repository),
    agentToolDefinitions: getAgentToolDefinitions,
    requestAgentApproval: async (_snapshot: AgentApprovalRequestSnapshot) => true,
    requestTrustedOperationConfirmation: async (snapshot: unknown, accept: () => Promise<unknown>) => {
      trustedConfirmationSnapshots.push(snapshot)
      if (trustedConfirmationDisplayFails) throw new Error('isolated confirmation window did not load')
      return allowTrustedConfirmation ? accept() : null
    },
    requestTrustedTrashPurgeConfirmation: async (snapshot: unknown, accept: () => Promise<unknown>) => {
      trustedTrashConfirmationSnapshots.push(snapshot)
      if (trustedConfirmationDisplayFails) throw new Error('isolated purge confirmation window did not load')
      if (allowTrustedConfirmation) await accept()
    },
    getWindow: () => windowAvailable
      ? ({ isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (name: string, payload: unknown) => electron.listeners.get(name)?.forEach((listener) => listener({}, payload)) } } as unknown as import('electron').BrowserWindow)
      : null,
    log: vi.fn()
  } as unknown as Parameters<typeof registerIpc>[0])
  await import('../src/preload/index')
  bridge = window.trace
  rawBridge = window.trace
  bridge.on('trace:agent-request', (event) => events.push(event))
  profileId = data(await bridge.invoke('agent:profile:create', { name: 'Local test', endpoint: `http://127.0.0.1:${address.port}/v1`, model: 'loopback' })).id
  data(await bridge.invoke('agent:key:set', { id: profileId, key: 'loopback-test-key' }))
  await profiles.recordCapability(profileId, { status: 'passed', testedAt: new Date().toISOString(), errorCategory: null })
})

afterEach(async () => {
  dispose?.()
  responses.forEach((response) => response.destroy())
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  // Windows 句柄/索引器偶发延迟会让递归 rm 报 ENOTEMPTY——短退避重试（测试基建稳定性）
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rm(directory, { recursive: true, force: true })
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOTEMPTY' || attempt >= 2) throw error
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
  }
})

describe('agent operation batch typed IPC and loopback provider', () => {
  it.each(['component.update', 'component.delete'] as const)(
    'rejects %s for an unknown legacy component without changing it', async (operation) => {
      const { updatedAt } = await writePlan()
      const planPath = join(root, 'one', 'plan.json')
      const document = JSON.parse(await fs.readFile(planPath, 'utf8')) as {
        components: Array<Record<string, unknown>>
      }
      const unknownComponent = { id: 'b'.repeat(32), type: 'future_widget', payload: { source: 'keep as-is' } }
      document.components.push(unknownComponent)
      await fs.writeFile(planPath, JSON.stringify(document))

      const grant = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'plan', path: 'one' }] }))
      const started = await startBatch({ title: 'Unknown component protection', message: '@one update its historical component',
        targetSetId: grant.id, targetRefs: [grant.targets[0].ref], calls: [{
          id: `unknown_${operation.replace('.', '_')}`, name: operation, arguments: {
            plan_ref: grant.targets[0].ref, component_id: unknownComponent.id, expected_updated_at: updatedAt,
            ...(operation === 'component.update' ? { patch: { content: 'must not change' } } : {})
          }
        }] })
      let batch = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
      if (batch.status === 'pending-confirmation') {
        batch = data(await bridge.invoke('agent:operation:confirm', { sessionId: started.sessionId, batchId: started.batchId }))
      }

      expect(batch.operations[0]).toMatchObject({ status: 'failed', errorCategory: 'not-found' })
      await expect(fs.readFile(planPath, 'utf8').then((text) => JSON.parse(text).components.at(-1)))
        .resolves.toEqual(unknownComponent)
    }, 15000
  )

  it('defaults a newly added single-plan component to not done', async () => {
    const { updatedAt } = await writePlan()
    const grant = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'plan', path: 'one' }] }))
    const targetRef = grant.targets[0].ref
    const started = await startBatch({ title: 'Single plan default state', message: '@one add an unfinished single plan',
      targetSetId: grant.id, targetRefs: [targetRef], calls: [{
        id: 'add_single_plan', name: 'component.add', arguments: {
          plan_ref: targetRef, expected_updated_at: updatedAt, type: 'single_plan', payload: { title: 'Unfinished item' }
        }
      }] })
    const pending = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    expect(pending.status).toBe('pending-confirmation')
    const accepted = data(await bridge.invoke('agent:operation:confirm', { sessionId: started.sessionId, batchId: started.batchId }))

    expect(accepted.operations).toMatchObject([{ status: 'succeeded' }])
    const saved = await storage.readPlan('one')
    expect(saved.components.find((component) => component.type === 'single_plan')?.payload).toMatchObject({ title: 'Unfinished item', done: false })
  }, 15000)

  it('keeps operation confirmation authority in main and leaves cancelled modal batches pending', async () => {
    const { updatedAt, taskListId } = await writePlan()
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'plan', path: 'one' }] }))
    const targetRef = targetSet.targets[0].ref
    const started = await startBatch({ title: 'Trusted operation confirmation', message: '@one update its task list',
      targetSetId: targetSet.id, targetRefs: [targetRef], calls: [{
        id: 'trusted_confirm', name: 'component.update', arguments: {
          plan_ref: targetRef, component_id: taskListId, expected_updated_at: updatedAt, patch: { title: 'Confirmed update' }
        }
      }] })
    const pending = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    expect(pending).not.toHaveProperty('confirmationToken')

    const forged = await rawBridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId, confirmationToken: 'renderer-forged-token'
    } as never)
    expect(forged).toMatchObject({ ok: false })
    expect(trustedConfirmationSnapshots).toHaveLength(0)

    allowTrustedConfirmation = false
    const cancelled = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    }))
    expect(cancelled).toMatchObject({ status: 'pending-confirmation', operations: [{ status: 'ready' }] })
    expect(cancelled).not.toHaveProperty('confirmationToken')
    expect(started.getRequestCount()).toBe(1)
    expect(JSON.stringify(trustedConfirmationSnapshots[0])).toContain('Confirmed update')
    expect(JSON.stringify(trustedConfirmationSnapshots[0])).toContain('one')
    expect(JSON.stringify(trustedConfirmationSnapshots[0])).not.toContain('renderer-forged-token')
    expect(JSON.parse(await fs.readFile(join(root, 'one', 'plan.json'), 'utf8')).components[0].payload.title).toBe('Tasks')

    allowTrustedConfirmation = true
    const accepted = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    }))
    expect(accepted.operations[0].status).toBe('succeeded')
    await until(() => started.getRequestCount() === 2)
    expect(JSON.parse(await fs.readFile(join(root, 'one', 'plan.json'), 'utf8')).components[0].payload.title).toBe('Confirmed update')
  }, 20000)

  it('forces writes through an @ read grant into pending confirmation under unrestricted policy', async () => {
    const { updatedAt, taskListId } = await writePlan()
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'plan', path: 'one' }] }))
    const targetRef = targetSet.targets[0].ref
    data(await bridge.invoke('agent:policy:set', { mode: 'unrestricted' }))

    const started = await startBatch({ title: 'Read-only @ grant', message: '@one update its task list',
      targetSetId: targetSet.id, targetRefs: [targetRef], calls: [{
        id: 'read_only_grant_write', name: 'component.update', arguments: {
          plan_ref: targetRef, component_id: taskListId, expected_updated_at: updatedAt, patch: { title: 'Trusted-only update' }
        }
      }] })
    const pending = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    expect(pending).toMatchObject({ status: 'pending-confirmation', requiredConfirmation: true, policyMode: 'unrestricted' })
    expect(pending.operations[0]).toMatchObject({ requiredConfirmation: true, status: 'ready' })
    expect(trustedConfirmationSnapshots).toEqual([])
    expect(JSON.parse(await fs.readFile(join(root, 'one', 'plan.json'), 'utf8')).components[0].payload.title).toBe('Tasks')
  }, 15000)

  it('requires confirmation for creation under an @ folder while root creation stays policy-controlled', async () => {
    await fs.mkdir(join(root, 'authorized-parent'))
    data(await bridge.invoke('agent:policy:set', { mode: 'unrestricted' }))
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'folder', path: 'authorized-parent' }] }))
    const parentRef = targetSet.targets[0].ref
    const scoped = await startBatch({ title: 'Scoped creation', message: '@authorized-parent create a plan here',
      targetSetId: targetSet.id, targetRefs: [parentRef], calls: [{
        id: 'scoped_create', name: 'plan.create', arguments: { parent_ref: parentRef, name_part: 'Scoped child' }
      }] })
    const scopedBatch = data(await bridge.invoke('agent:operation:read', { sessionId: scoped.sessionId, batchId: scoped.batchId }))
    expect(scopedBatch).toMatchObject({ status: 'pending-confirmation', requiredConfirmation: true,
      operations: [{ requiredConfirmation: true, status: 'ready' }] })
    await expect(fs.stat(join(root, 'authorized-parent', 'Scoped child'))).rejects.toMatchObject({ code: 'ENOENT' })

    const unscoped = await startBatch({ title: 'Root creation policy', message: 'Create a root plan', targetRefs: [], calls: [{
      id: 'unscoped_create', name: 'plan.create', arguments: { name_part: 'Unscoped root plan' }
    }] })
    const unscopedBatch = data(await bridge.invoke('agent:operation:read', { sessionId: unscoped.sessionId, batchId: unscoped.batchId }))
    expect(unscopedBatch.requiredConfirmation).toBe(false)
    expect(unscopedBatch.operations[0].requiredConfirmation).toBe(false)
    expect(await fs.stat(join(root, 'Unscoped root plan'))).toBeTruthy()
  }, 20000)

  it('requires a trusted main-process preview before committing a trash purge token', async () => {
    const plan = await storage.createPlan('', 'Confirm before purge')
    const entry = await storage.trashPlan(plan.path)
    const preview = data(await bridge.invoke('trash:purge-preview', { entry_id: entry.id })) as TrashOperationPreview

    allowTrustedConfirmation = false
    const cancelled = await bridge.invoke('trash:purge-commit', { confirmation_token: preview.confirmation_token })
    expect(cancelled).toMatchObject({ ok: false })
    expect(trustedTrashConfirmationSnapshots).toHaveLength(1)
    expect(JSON.stringify(trustedTrashConfirmationSnapshots[0])).toContain('Confirm before purge')
    expect(JSON.stringify(trustedTrashConfirmationSnapshots[0])).toContain(plan.path)
    expect(JSON.stringify(trustedTrashConfirmationSnapshots[0])).not.toContain(preview.confirmation_token)
    expect((await storage.listTrashEntries()).some((item) => item.id === entry.id)).toBe(true)

    windowAvailable = false
    allowTrustedConfirmation = true
    const noParent = await bridge.invoke('trash:purge-commit', { confirmation_token: preview.confirmation_token })
    expect(noParent).toMatchObject({ ok: false })
    expect((await storage.listTrashEntries()).some((item) => item.id === entry.id)).toBe(true)
    windowAvailable = true

    const confirmed = await bridge.invoke('trash:purge-commit', { confirmation_token: preview.confirmation_token })
    expect(confirmed).toMatchObject({ ok: true })
    expect((await storage.listTrashEntries()).some((item) => item.id === entry.id)).toBe(false)
  }, 15000)

  it('returns only the exact message-bound trash entry named by trash.list', async () => {
    const firstPlan = await storage.createPlan('', 'Agent trash first')
    const secondPlan = await storage.createPlan('', 'Agent trash second')
    const firstEntry = await storage.trashPlan(firstPlan.path)
    const secondEntry = await storage.trashPlan(secondPlan.path)
    const fullEnumeration = vi.spyOn(storage, 'listTrashEntries').mockRejectedValue(new Error('full trash enumeration must not run'))
    const serializedRead = vi.spyOn(planReferences, 'readTrashEntry')
    const grantSet = data(await bridge.invoke('agent:target:grant', { targets: [
      { kind: 'trash', entryId: firstEntry.id }, { kind: 'trash', entryId: secondEntry.id }
    ] }))
    const firstGrant = grantSet.targets.find((item) => item.name === firstEntry.name)!
    const started = await startBatch({ title: 'Exact trash read', message: '@Agent trash first show this one only',
      targetSetId: grantSet.id, targetRefs: [firstGrant.ref], calls: [{
        id: 'read_one_trash_entry', name: 'trash.list', arguments: { trash_entry_ref: firstGrant.ref }
      }] })
    const session = data(await bridge.invoke('agent:session:read', { id: started.sessionId }))
    const toolResult = session.messages.find((message) => message.role === 'tool' && message.toolCallId === 'read_one_trash_entry')
    expect(toolResult).toBeDefined()
    expect(JSON.parse(toolResult!.content)).toMatchObject({ ok: true, entries: [{ id: firstEntry.id, name: firstEntry.name }] })
    expect(toolResult!.content).not.toContain(secondEntry.id)
    expect(toolResult!.content).not.toContain(secondEntry.name)
    expect(serializedRead).toHaveBeenCalledExactlyOnceWith(storage, firstEntry.id, firstEntry.manifest_revision)
    expect(fullEnumeration).not.toHaveBeenCalled()
  }, 15000)

  it('shows frozen folder subtree metadata only in transient confirmation preview', async () => {
    const planId = 'b'.repeat(32)
    const bodyMarker = 'LOCAL_COMPONENT_BODY_MUST_NOT_LEAK_2604'
    await fs.mkdir(join(root, 'folder-root', 'empty-only-local-marker'), { recursive: true })
    await fs.mkdir(join(root, 'folder-root', 'nested', 'nested-empty'), { recursive: true })
    await fs.writeFile(join(root, 'folder-root', 'nested', 'plan.json'), JSON.stringify({
      format_version: '1', created_at: '2026-10-04T00:00:00.000Z', updated_at: '2026-10-04T00:00:00.000Z',
      plan_id: planId, components: [{ id: 'c'.repeat(32), type: 'note', payload: { content: bodyMarker } }]
    }))
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'folder', path: 'folder-root' }] }))
    const target = targetSet.targets[0]
    const requestBodies: string[] = []
    const started = await startBatch({ title: 'Folder subtree confirmation', message: '@folder-root rename it',
      targetSetId: targetSet.id, targetRefs: [target.ref], requestBodies, calls: [
        { id: 'local_subtree_preview', name: 'folder.rename', arguments: {
          target_ref: target.ref, expected_revision: target.revision, new_name: 'renamed-root'
        } }
      ] })
    const pending = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    const preview = pending.confirmationPreview as unknown as { affectedSubtrees?: Array<{
      callId: string; targetPath: string; entries: Array<{ relativePath: string; kind: 'folder' | 'plan'; planId?: string }>
    }> }
    expect(preview.affectedSubtrees).toEqual([{
      callId: 'local_subtree_preview', targetPath: 'folder-root', entries: [
        { relativePath: '', kind: 'folder' },
        { relativePath: 'empty-only-local-marker', kind: 'folder' },
        { relativePath: 'nested', kind: 'plan', planId },
        { relativePath: 'nested/nested-empty', kind: 'folder' },
      ]
    }])
    expect(JSON.stringify(preview)).not.toContain(root)
    expect(JSON.stringify(preview)).not.toContain(bodyMarker)
    expect(pending).not.toHaveProperty('confirmationToken')
    expect(JSON.stringify(pending)).not.toContain('confirmationToken')
    expect(JSON.stringify(preview)).not.toContain('snapshot_digest')
    expect(JSON.stringify(preview)).not.toContain('expires_at')

    const sessionPath = join(directory, 'agent-sessions', `${started.sessionId}.json`)
    const persisted = JSON.parse(await fs.readFile(sessionPath, 'utf8')) as {
      operationBatches: Array<Record<string, unknown>>
    }
    expect(persisted.operationBatches[0]).not.toHaveProperty('confirmationPreview')
    expect(persisted.operationBatches[0]).not.toHaveProperty('confirmationToken')
    expect(JSON.stringify(persisted.operationBatches[0])).not.toContain('empty-only-local-marker')
    expect(JSON.stringify(persisted.operationBatches[0])).not.toContain(planId)

    const initialAssistantId = events.find((event) => event.requestId === started.requestId && event.type === 'terminal')?.assistantId
    const confirmed = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    }))
    expect(confirmed.operations[0].status).toBe('succeeded')
    await until(() => requestBodies.length >= 2)
    await until(() => events.some((event) => event.requestId === started.requestId && event.type === 'terminal' && event.assistantId !== initialAssistantId))
    expect(requestBodies[1]).not.toContain('empty-only-local-marker')
    expect(requestBodies[1]).not.toContain(planId)
    expect(requestBodies[1]).not.toContain(bodyMarker)
    const completed = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    expect(completed).not.toHaveProperty('confirmationPreview')
    expect(completed).not.toHaveProperty('confirmationToken')

    await fs.mkdir(join(root, 'cancel-root', 'cancel-only-local-marker'), { recursive: true })
    const cancelTargetSet = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'folder', path: 'cancel-root' }] }))
    const cancelTarget = cancelTargetSet.targets[0]
    const cancelledBatch = await startBatch({ title: 'Folder subtree cancel', message: '@cancel-root delete it',
      targetSetId: cancelTargetSet.id, targetRefs: [cancelTarget.ref], calls: [
        { id: 'cancel_local_subtree_preview', name: 'folder.trash', arguments: {
          target_ref: cancelTarget.ref, expected_revision: cancelTarget.revision
        } }
      ] })
    const cancelPending = data(await bridge.invoke('agent:operation:read', { sessionId: cancelledBatch.sessionId, batchId: cancelledBatch.batchId }))
    expect((cancelPending.confirmationPreview as unknown as { affectedSubtrees?: unknown[] }).affectedSubtrees).toHaveLength(1)
    const cancelInitialAssistantId = events.find((event) => event.requestId === cancelledBatch.requestId && event.type === 'terminal')?.assistantId
    await bridge.invoke('agent:operation:cancel', {
      sessionId: cancelledBatch.sessionId, batchId: cancelledBatch.batchId
    })
    await until(() => events.some((event) => event.requestId === cancelledBatch.requestId && event.type === 'terminal' && event.assistantId !== cancelInitialAssistantId))
    const cancelled = data(await bridge.invoke('agent:operation:read', { sessionId: cancelledBatch.sessionId, batchId: cancelledBatch.batchId }))
    expect(cancelled).not.toHaveProperty('confirmationPreview')
    expect(cancelled).not.toHaveProperty('confirmationToken')
    await expect(fs.stat(join(root, 'cancel-root', 'cancel-only-local-marker'))).resolves.toBeTruthy()
  }, 15000)

  it('returns ordered safe trash impact summaries for restore and purge over typed IPC', async () => {
    const restorePlanId = 'a'.repeat(32)
    const purgePlanId = 'b'.repeat(32)
    const sourcePlanId = 'c'.repeat(32)
    const restoreBody = 'LOCAL_RESTORE_PLAN_BODY_MUST_NOT_LEAK'
    const purgeBody = 'LOCAL_PURGE_PLAN_BODY_MUST_NOT_LEAK'
    const referenceDate = '2026-10-05T00:00:00.000Z'

    for (const [path, planId, body] of [
      ['restore-target', restorePlanId, restoreBody],
      ['purge-target', purgePlanId, purgeBody]
    ] as const) {
      await fs.mkdir(join(root, path))
      await fs.writeFile(join(root, path, 'plan.json'), JSON.stringify({
        format_version: '1', created_at: referenceDate, updated_at: referenceDate, plan_id: planId,
        components: [{ id: 'd'.repeat(32), type: 'note', payload: { content: body } }]
      }))
    }
    await fs.mkdir(join(root, 'reference-source'))
    await fs.writeFile(join(root, 'reference-source', 'plan.json'), JSON.stringify({
      format_version: '1', created_at: referenceDate, updated_at: referenceDate, plan_id: sourcePlanId,
      components: [
        { id: 'e'.repeat(32), type: 'plan_reference', payload: {
          mode: 'link', target_plan_id: restorePlanId, target_path_snapshot: 'restore-target', target_name_snapshot: 'restore-target'
        } },
        { id: 'f'.repeat(32), type: 'plan_reference', payload: {
          mode: 'link', target_plan_id: purgePlanId, target_path_snapshot: 'purge-target', target_name_snapshot: 'purge-target'
        } }
      ]
    }))

    const restoreEntry = await storage.trashPlan('restore-target')
    const purgeEntry = await storage.trashPlan('purge-target')
    const entryGrantTokens: string[] = []
    const issueEntryTarget = storage.issueTrashEntryTarget.bind(storage)
    vi.spyOn(storage, 'issueTrashEntryTarget').mockImplementation(async (entryId) => {
      const grant = await issueEntryTarget(entryId)
      entryGrantTokens.push(grant.token)
      return grant
    })
    const listedEntries = data(await bridge.invoke('trash:list', undefined))
    const visibleRestoreEntry = listedEntries.find((entry) => entry.id === restoreEntry.id)!
    const visiblePurgeEntry = listedEntries.find((entry) => entry.id === purgeEntry.id)!
    const frozenTrashPreviews: TrashOperationPreview[] = []
    const previewTrashRestore = storage.previewTrashRestore.bind(storage)
    vi.spyOn(storage, 'previewTrashRestore').mockImplementation(async (...args) => {
      const preview = await previewTrashRestore(...args)
      frozenTrashPreviews.push(preview)
      return preview
    })
    const previewTrashPurge = storage.previewTrashPurge.bind(storage)
    vi.spyOn(storage, 'previewTrashPurge').mockImplementation(async (...args) => {
      const preview = await previewTrashPurge(...args)
      frozenTrashPreviews.push(preview)
      return preview
    })

    const restoreTargetSet = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'trash', entryId: visibleRestoreEntry.id }] }))
    const restoreTarget = restoreTargetSet.targets[0]
    const restoreStarted = await startBatch({ title: 'Trash restore impact preview', message: 'Restore @restore-target',
      targetSetId: restoreTargetSet.id, targetRefs: [restoreTarget.ref], calls: [
        { id: 'restore_target_call', name: 'trash.restore', arguments: {
          trash_entry_ref: restoreTarget.ref, manifest_revision: visibleRestoreEntry.manifest_revision
        } }
      ] })
    const restoreBatchRead = data(await bridge.invoke('agent:operation:read', { sessionId: restoreStarted.sessionId, batchId: restoreStarted.batchId }))
    expect(restoreBatchRead.status).toBe('pending-confirmation')
    const restorePreview = restoreBatchRead.confirmationPreview
    expect(restorePreview).toBeDefined()
    if (!restorePreview) return
    expect(restorePreview.trashOperations).toEqual([{
      callId: 'restore_target_call', operation: 'restore', entryId: restoreEntry.id, name: 'restore-target',
      originalRelativePath: 'restore-target', restoreRelativePath: 'restore-target', planCount: 1, referenceCount: 1
    }])
    expect(restoreBatchRead).not.toHaveProperty('confirmationToken')

    const purgeTargetSet = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'trash', entryId: visiblePurgeEntry.id }] }))
    const purgeTarget = purgeTargetSet.targets[0]
    const purgeStarted = await startBatch({ title: 'Trash purge impact preview', message: 'Purge @purge-target',
      targetSetId: purgeTargetSet.id, targetRefs: [purgeTarget.ref], calls: [
        { id: 'purge_target_call', name: 'trash.purge', arguments: {
          trash_entry_ref: purgeTarget.ref, manifest_revision: visiblePurgeEntry.manifest_revision
        } }
      ] })
    const purgeBatchRead = data(await bridge.invoke('agent:operation:read', { sessionId: purgeStarted.sessionId, batchId: purgeStarted.batchId }))
    expect(purgeBatchRead.status).toBe('pending-confirmation')
    const purgePreview = purgeBatchRead.confirmationPreview
    expect(purgePreview).toBeDefined()
    if (!purgePreview) return
    expect(purgePreview.trashOperations).toEqual([{
      callId: 'purge_target_call', operation: 'purge', entryId: purgeEntry.id, name: 'purge-target',
      originalRelativePath: 'purge-target', restoreRelativePath: null, planCount: 1, referenceCount: 1
    }])
    expect(purgeBatchRead).not.toHaveProperty('confirmationToken')
    expect(frozenTrashPreviews.map((item) => item.operation)).toEqual(['restore', 'purge'])

    for (const [batchRead, confirmationPreview, marker] of [
      [restoreBatchRead, restorePreview, restoreBody],
      [purgeBatchRead, purgePreview, purgeBody]
    ] as const) {
      const previewJson = JSON.stringify(confirmationPreview)
      const batchJson = JSON.stringify(batchRead)
      expect(batchRead).not.toHaveProperty('confirmationToken')
      expect(batchJson).not.toContain('confirmationToken')
      for (const field of ['confirmation_token', 'trash_entry_token', 'preview_digest', 'reference_impact_signature']) {
        expect(previewJson).not.toContain(field)
        expect(batchJson).not.toContain(field)
      }
      expect(batchJson).not.toContain(root)
      expect(batchJson).not.toContain(marker)
      for (const token of entryGrantTokens) {
        expect(previewJson).not.toContain(token)
        expect(batchJson).not.toContain(token)
      }
      for (const frozen of frozenTrashPreviews) {
        for (const secret of [frozen.confirmation_token, frozen.preview_digest, frozen.reference_impact_signature]) {
          expect(previewJson).not.toContain(secret)
          expect(batchJson).not.toContain(secret)
        }
      }
    }
  }, 15000)

  it.each([
    { kind: 'plan' as const, path: 'one', toolName: 'plan.rename' },
    { kind: 'folder' as const, path: 'folder-source', toolName: 'folder.rename' }
  ])('rejects a hidden destination before $toolName writes', async ({ kind, path, toolName }) => {
    if (kind === 'plan') await writePlan()
    else await fs.mkdir(join(root, path))
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [{ kind, path }] }))
    const target = targetSet.targets[0]
    const started = await startBatch({ title: `Hidden destination ${toolName}`, message: 'Rename this target',
      targetSetId: targetSet.id, targetRefs: [target.ref], calls: [
        { id: `hidden_${kind}_rename`, name: toolName, arguments: {
          target_ref: target.ref, expected_revision: target.revision, new_name: '.hidden-destination'
        } }
      ] })
    const batch = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    expect(batch).toMatchObject({ status: 'preflight-failed', operations: [{ status: 'failed', errorCategory: 'authorization' }] })
    await expect(fs.stat(join(root, path))).resolves.toBeTruthy()
    await expect(fs.stat(join(root, '.hidden-destination'))).rejects.toMatchObject({ code: 'ENOENT' })
  }, 15000)

  it.each([
    { kind: 'plan' as const, path: 'one', toolName: 'plan.move' },
    { kind: 'folder' as const, path: 'move-source', toolName: 'folder.move' }
  ])('rejects a hidden $toolName destination before moving the source', async ({ kind, path, toolName }) => {
    if (kind === 'plan') await writePlan()
    else await fs.mkdir(join(root, path))
    await fs.mkdir(join(root, 'destination'))
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [
      { kind, path }, { kind: 'folder', path: 'destination' }
    ] }))
    const source = targetSet.targets.find((target) => target.path === path)!
    const destination = targetSet.targets.find((target) => target.path === 'destination')!
    const { PlanReferenceService } = await import('../src/main/services/plan-reference-service')
    const originalPreviewAgentMove = PlanReferenceService.prototype.previewAgentMove
    vi.spyOn(PlanReferenceService.prototype, 'previewAgentMove').mockImplementationOnce(async function (request, storageService) {
      const preview = await originalPreviewAgentMove.call(this, request, storageService)
      return { ...preview, destination_path: 'destination/.hidden-generated' }
    })
    const started = await startBatch({ title: `Hidden move destination ${toolName}`, message: 'Move this target',
      targetSetId: targetSet.id, targetRefs: [source.ref, destination.ref], calls: [
        { id: `hidden_${kind}_move`, name: toolName, arguments: {
          target_ref: source.ref, expected_revision: source.revision, parent_ref: destination.ref
        } }
      ] })
    const batch = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    expect(batch).toMatchObject({ status: 'preflight-failed', operations: [{ status: 'failed', errorCategory: 'authorization' }] })
    await expect(fs.stat(join(root, path))).resolves.toBeTruthy()
    await expect(fs.stat(join(root, 'destination', '.hidden-generated'))).rejects.toMatchObject({ code: 'ENOENT' })
  }, 15000)

  it('rejects a hidden trash restore name before consuming the trash entry', async () => {
    await fs.mkdir(join(root, 'restore-source'))
    await fs.writeFile(join(root, 'restore-source', 'plan.json'), JSON.stringify({
      format_version: '1', created_at: '2026-10-04T00:00:00.000Z', updated_at: '2026-10-04T00:00:00.000Z', components: []
    }))
    const trashed = await storage.trashPlan('restore-source')
    await fs.mkdir(join(root, 'destination'))
    const listed = data(await bridge.invoke('trash:list', undefined))
    const trashEntry = listed.find((entry) => entry.id === trashed.id)!
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [
      { kind: 'trash', entryId: trashEntry.id }, { kind: 'folder', path: 'destination' }
    ] }))
    const trashTarget = targetSet.targets.find((target) => target.kind === 'trash')!
    const destination = targetSet.targets.find((target) => target.path === 'destination')!
    const started = await startBatch({ title: 'Hidden trash restore name', message: 'Restore this item',
      targetSetId: targetSet.id, targetRefs: [trashTarget.ref, destination.ref], calls: [
        { id: 'hidden_restore_name', name: 'trash.restore', arguments: {
          trash_entry_ref: trashTarget.ref, manifest_revision: trashEntry.manifest_revision,
          destination_parent_ref: destination.ref, new_name: '.hidden-restored'
        } }
      ] })
    const batch = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    expect(batch).toMatchObject({ status: 'preflight-failed', operations: [{ status: 'failed', errorCategory: 'authorization' }] })
    const remainingEntries = data(await bridge.invoke('trash:list', undefined))
    expect(remainingEntries).toEqual([expect.objectContaining({ id: trashEntry.id, status: 'trashed', manifest_revision: trashEntry.manifest_revision })])
    await expect(fs.stat(join(root, 'destination', '.hidden-restored'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(join(root, '.trace', 'trash', trashEntry.id, 'payload'))).resolves.toBeTruthy()
  }, 15000)

  it('preflights the entire tool batch before writes and leaves every item untouched when one intent is invalid', async () => {
    const { updatedAt, taskListId } = await writePlan()
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'plan', path: 'one' }] }))
    const targetRef = targetSet.targets[0].ref
    const noteId = 'b'.repeat(32)
    server.removeAllListeners('request')
    let requestCount = 0
    server.on('request', (_request, response) => {
      response.setHeader('content-type', 'text/event-stream')
      if (requestCount++ === 0) {
        response.end(frame([
          { id: 'call_add', name: 'component.add', arguments: { plan_ref: targetRef, expected_updated_at: updatedAt, type: 'note', payload: { content: 'must not be written' } } },
          { id: 'call_bad_task', name: 'task.delete', arguments: { plan_ref: targetRef, list_component_id: taskListId, task_id: noteId, expected_updated_at: updatedAt } }
        ]))
      } else {
        response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'No changes were applied.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
      }
    })
    const session = data(await bridge.invoke('agent:session:create', { title: 'Preflight', profileId }))
    const preview = data(await bridge.invoke('agent:preview:create', {
      sessionId: session.id, message: 'Add then invalidate this batch', selections: [],
      targetGrantSetId: targetSet.id, targetRefs: [targetRef]
    })) as AgentOutboundPreview
    const identity = data(await bridge.invoke('agent:request:send', { token: preview.token, sessionId: session.id })) as AgentRequestIdentity
    await until(() => events.some((event) => event.requestId === identity.requestId && event.type === 'terminal'))

    const persisted = JSON.parse(await fs.readFile(join(directory, 'agent-sessions', `${session.id}.json`), 'utf8')) as Record<string, unknown>
    expect(persisted).toHaveProperty('operationBatches')
    const batches = persisted.operationBatches as Array<Record<string, unknown>>
    expect(batches).toHaveLength(1)
    expect(batches[0]).toMatchObject({ status: 'preflight-failed', operations: [{ status: 'not-executed' }, { status: 'failed' }] })
    const savedPlan = JSON.parse(await fs.readFile(join(root, 'one', 'plan.json'), 'utf8')) as { components: Array<{ type: string }> }
    expect(savedPlan.components.map((component) => component.type)).toEqual(['task_list'])
    expect(JSON.stringify(persisted) + JSON.stringify(events)).not.toContain(root)
  })

  it('executes in provider order, stops after the first failed write, and never replays the successful prefix', async () => {
    const { updatedAt, taskListId } = await writePlan()
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'plan', path: 'one' }] }))
    const targetRef = targetSet.targets[0].ref
    await bridge.invoke('agent:policy:set', { mode: 'unrestricted' })
    server.removeAllListeners('request')
    let requestCount = 0
    server.on('request', (_request, response) => {
      response.setHeader('content-type', 'text/event-stream')
      if (requestCount++ === 0) {
        response.end(frame([
          { id: 'call_a1', name: 'component.update', arguments: { plan_ref: targetRef, component_id: taskListId, expected_updated_at: updatedAt, patch: { title: 'A1' } } },
          { id: 'call_b1', name: 'component.update', arguments: { plan_ref: targetRef, component_id: taskListId, expected_updated_at: updatedAt, patch: { title: 'B1' } } },
          { id: 'call_a2', name: 'component.update', arguments: { plan_ref: targetRef, component_id: taskListId, expected_updated_at: updatedAt, patch: { title: 'A2' } } }
        ]))
      } else {
        response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Stopped after B1.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
      }
    })
    const { ERR, TraceError } = await import('../src/shared/errors')
    const originalSave = storage.savePlan.bind(storage)
    let saveCount = 0
    const saveSpy = vi.spyOn(storage, 'savePlan').mockImplementation(async (...args) => {
      saveCount += 1
      if (saveCount === 2) throw new TraceError(ERR.SAVE_FAILED, 'isolated second write failure')
      return originalSave(...args)
    })
    const session = data(await bridge.invoke('agent:session:create', { title: 'Ordered failure', profileId }))
    const preview = data(await bridge.invoke('agent:preview:create', {
      sessionId: session.id, message: 'Apply these changes in order', selections: [],
      targetGrantSetId: targetSet.id, targetRefs: [targetRef]
    })) as AgentOutboundPreview
    const identity = data(await bridge.invoke('agent:request:send', { token: preview.token, sessionId: session.id })) as AgentRequestIdentity
    await until(() => events.some((event) => event.requestId === identity.requestId && event.type === 'terminal'))
    const initialSession = data(await bridge.invoke('agent:session:read', { id: session.id }))
    const pendingBatch = data(await bridge.invoke('agent:operation:read', { sessionId: session.id, batchId: initialSession.operationBatches[0].id }))
    expect(pendingBatch.status).toBe('pending-confirmation')
    expect(pendingBatch).not.toHaveProperty('confirmationToken')
    const confirmResult = await bridge.invoke('agent:operation:confirm', {
      sessionId: session.id, batchId: pendingBatch.id
    })
    expect(confirmResult.ok).toBe(true)
    await until(() => events.some((event) => event.requestId === identity.requestId && event.type === 'terminal' && event.assistantId !== identity.assistantId))

    const completedBatch = data(await bridge.invoke('agent:operation:read', { sessionId: session.id, batchId: pendingBatch.id }))
    const savedPlan = JSON.parse(await fs.readFile(join(root, 'one', 'plan.json'), 'utf8')) as { components: Array<{ type: string; payload: { title?: string } }> }
    expect(completedBatch.status).toBe('execution-failed')
    expect(completedBatch.operations.map((item) => item.status)).toEqual(['succeeded', 'failed', 'not-executed'])
    expect(completedBatch.operations[1].errorCategory).toBe('storage')
    expect(savedPlan.components[0].payload.title).toBe('A1')
    expect(saveSpy).toHaveBeenCalledTimes(2)
    expect(requestCount).toBe(2)

    await expect(bridge.invoke('agent:operation:undo', {
      sessionId: session.id, batchId: pendingBatch.id, callId: 'call_b1'
    })).resolves.toMatchObject({ ok: false })
    await expect(bridge.invoke('agent:operation:undo', {
      sessionId: session.id, batchId: pendingBatch.id, callId: 'call_a2'
    })).resolves.toMatchObject({ ok: false })
    const undo = data(await bridge.invoke('agent:operation:undo', {
      sessionId: session.id, batchId: pendingBatch.id, callId: 'call_a1'
    }))
    expect(undo).toMatchObject({ status: 'pending-confirmation', attemptKind: 'undo' })
    const undone = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: session.id, batchId: undo.id
    }))
    expect(undone.operations[0].status).toBe('succeeded')
    const restoredPlan = JSON.parse(await fs.readFile(join(root, 'one', 'plan.json'), 'utf8')) as {
      components: Array<{ payload: { title?: string } }>
    }
    expect(restoredPlan.components[0].payload.title).toBe('Tasks')
    expect(saveSpy).toHaveBeenCalledTimes(3)
    expect(requestCount).toBe(2)
  }, 15000)

  it('reserves pending capacity before audit persistence across concurrent creates and undo', async () => {
    const initialTime = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(initialTime)
    server.removeAllListeners('request')
    server.on('request', (_request, response) => {
      response.setHeader('content-type', 'text/event-stream')
      response.end(frame([{ id: 'capacity_audit_store_failure', name: 'folder.create', arguments: { name: 'Audit store failure' } }]))
    })
    const [{ AgentSessionRepository }] = await Promise.all([import('../src/main/services/agent-session-repository')])
    const originalMutate = AgentSessionRepository.prototype.mutate
    const failedAuditSession = data(await bridge.invoke('agent:session:create', { title: 'Pending capacity store failure', profileId }))
    const failedAuditPreview = data(await bridge.invoke('agent:preview:create', {
      sessionId: failedAuditSession.id, message: 'Create a pending folder', selections: []
    })) as AgentOutboundPreview
    let failNextAudit = true
    const mutateSpy = vi.spyOn(AgentSessionRepository.prototype, 'mutate').mockImplementation(function (
      this: InstanceType<typeof AgentSessionRepository>, id, operation
    ) {
      return originalMutate.call(this, id, (session) => {
        const initialBatchCount = session.operationBatches.length
        operation(session)
        if (id === failedAuditSession.id && failNextAudit && session.operationBatches.length > initialBatchCount) {
          failNextAudit = false
          throw new Error('isolated pending audit persistence failure')
        }
      })
    })
    const failedAuditRequest = data(await bridge.invoke('agent:request:send', {
      token: failedAuditPreview.token, sessionId: failedAuditSession.id
    })) as AgentRequestIdentity
    await until(() => events.some((event) => event.requestId === failedAuditRequest.requestId && event.type === 'terminal'))
    mutateSpy.mockRestore()
    expect(data(await bridge.invoke('agent:session:read', { id: failedAuditSession.id })).operationBatches).toHaveLength(0)

    const source = await startBatch({ title: 'Pending capacity undo source', message: 'Create an undo source', targetRefs: [], calls: [
      { id: 'capacity_undo_source', name: 'plan.create', arguments: { name_part: 'Capacity undo source' } }
    ] })
    const sourcePending = data(await bridge.invoke('agent:operation:read', { sessionId: source.sessionId, batchId: source.batchId }))
    const initialAssistantId = events.find((event) => event.requestId === source.requestId && event.type === 'terminal')?.assistantId
    const sourceCreated = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: source.sessionId, batchId: source.batchId
    }))
    expect(sourceCreated.operations[0].undoStatus).toBe('available')
    await until(() => events.some((event) => event.requestId === source.requestId && event.type === 'terminal' && event.assistantId !== initialAssistantId))

    const fillers: Array<{ sessionId: string; batchId: string }> = []
    for (let index = 0; index < 63; index += 1) {
      const filler = await startBatch({ title: `Pending capacity filler ${index}`, message: 'Create a pending folder', targetRefs: [], calls: [
        { id: `capacity_filler_${index}`, name: 'folder.create', arguments: { name: `Capacity filler ${index}` } }
      ] })
      fillers.push(filler)
    }
    server.removeAllListeners('request')
    let requestCount = 0
    server.on('request', (_request, response) => {
      response.setHeader('content-type', 'text/event-stream')
      if (requestCount++ === 0) response.end(frame([
        { id: 'capacity_race_create', name: 'folder.create', arguments: { name: 'Capacity race create' } }
      ]))
      else response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'The operation result was reviewed.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
    })
    const candidateSession = data(await bridge.invoke('agent:session:create', { title: 'Pending capacity race create', profileId }))
    const candidatePreview = data(await bridge.invoke('agent:preview:create', {
      sessionId: candidateSession.id, message: 'Create another pending folder', selections: []
    })) as AgentOutboundPreview
    const candidateRequest = data(await bridge.invoke('agent:request:send', {
      token: candidatePreview.token, sessionId: candidateSession.id
    })) as AgentRequestIdentity
    const candidateTerminal = until(() => events.some((event) => event.requestId === candidateRequest.requestId && event.type === 'terminal'))
    const undoAttempt = bridge.invoke('agent:operation:undo', {
      sessionId: source.sessionId, batchId: source.batchId, callId: 'capacity_undo_source'
    })
    const [, undoResult] = await Promise.all([candidateTerminal, undoAttempt])
    const candidateSessionAfterRace = data(await bridge.invoke('agent:session:read', { id: candidateSession.id }))
    const candidateBatch = candidateSessionAfterRace.operationBatches.find((item) => item.requestId === candidateRequest.requestId)
    const undoPending = undoResult.ok ? undoResult.data : undefined
    expect(Number(Boolean(candidateBatch)) + Number(Boolean(undoPending))).toBe(1)
    if (candidateBatch) {
      expect(candidateBatch.status).toBe('pending-confirmation')
      const persistedCandidate = data(await bridge.invoke('agent:operation:read', {
        sessionId: candidateSession.id, batchId: candidateBatch.id
      }))
      expect(persistedCandidate).not.toHaveProperty('confirmationToken')
    }
    if (undoPending) {
      expect(undoPending.status).toBe('pending-confirmation')
      expect(undoPending).not.toHaveProperty('confirmationToken')
    } else {
      expect(data(await bridge.invoke('agent:operation:read', { sessionId: source.sessionId, batchId: source.batchId }))
        .operations[0].undoStatus).toBe('available')
    }

    const winningBatch = candidateBatch
      ? { sessionId: candidateSession.id, batchId: candidateBatch.id }
      : { sessionId: source.sessionId, batchId: undoPending!.id }
    const cancelled = await bridge.invoke('agent:operation:cancel', winningBatch)
    expect(cancelled.ok).toBe(true)
    expect(data(await bridge.invoke('agent:operation:read', {
      sessionId: winningBatch.sessionId, batchId: winningBatch.batchId
    })).status).toBe('cancelled')

    const afterCancel = await startBatch({ title: 'Pending capacity after cancel', message: 'Create after cancel', targetRefs: [], calls: [
      { id: 'capacity_after_cancel', name: 'folder.create', arguments: { name: 'Capacity after cancel' } }
    ] })
    const afterCancelPending = data(await bridge.invoke('agent:operation:read', {
      sessionId: afterCancel.sessionId, batchId: afterCancel.batchId
    }))
    expect(afterCancelPending).not.toHaveProperty('confirmationToken')
    const afterCancelAssistantId = events.find((event) => event.requestId === afterCancel.requestId && event.type === 'terminal')?.assistantId
    const afterCancelConfirmed = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: afterCancel.sessionId, batchId: afterCancel.batchId
    }))
    expect(afterCancelConfirmed.operations[0].status).toBe('succeeded')
    await until(() => events.some((event) => event.requestId === afterCancel.requestId && event.type === 'terminal' && event.assistantId !== afterCancelAssistantId))

    const afterTerminal = await startBatch({ title: 'Pending capacity after terminal', message: 'Create after terminal', targetRefs: [], calls: [
      { id: 'capacity_after_terminal', name: 'folder.create', arguments: { name: 'Capacity after terminal' } }
    ] })
    const afterTerminalPending = data(await bridge.invoke('agent:operation:read', {
      sessionId: afterTerminal.sessionId, batchId: afterTerminal.batchId
    }))
    expect(afterTerminalPending).not.toHaveProperty('confirmationToken')
    const createFolderSpy = vi.spyOn(storage, 'createFolder').mockImplementationOnce(async () => {
      throw new Error('isolated operation execution failure')
    })
    const afterTerminalAssistantId = events.find((event) => event.requestId === afterTerminal.requestId && event.type === 'terminal')?.assistantId
    const failedExecution = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: afterTerminal.sessionId, batchId: afterTerminal.batchId
    }))
    expect(failedExecution).toMatchObject({ status: 'execution-failed', operations: [{ status: 'failed' }] })
    await until(() => events.some((event) => event.requestId === afterTerminal.requestId && event.type === 'terminal' && event.assistantId !== afterTerminalAssistantId))
    createFolderSpy.mockRestore()

    const afterFailure = await startBatch({ title: 'Pending capacity after operation failure', message: 'Create after failure', targetRefs: [], calls: [
      { id: 'capacity_after_failure', name: 'folder.create', arguments: { name: 'Capacity after failure' } }
    ] })
    const afterFailurePending = data(await bridge.invoke('agent:operation:read', {
      sessionId: afterFailure.sessionId, batchId: afterFailure.batchId
    }))
    expect(afterFailurePending).not.toHaveProperty('confirmationToken')

    clock.mockReturnValue(initialTime + 6 * 60 * 1000)
    const afterExpiry = await startBatch({ title: 'Pending capacity after expiry', message: 'Create after expiry', targetRefs: [], calls: [
      { id: 'capacity_after_expiry', name: 'folder.create', arguments: { name: 'Capacity after expiry' } }
    ] })
    const afterExpiryPending = data(await bridge.invoke('agent:operation:read', {
      sessionId: afterExpiry.sessionId, batchId: afterExpiry.batchId
    }))
    expect(afterExpiryPending).not.toHaveProperty('confirmationToken')
    const expiredFiller = data(await bridge.invoke('agent:operation:read', {
      sessionId: fillers[0].sessionId, batchId: fillers[0].batchId
    }))
    expect(expiredFiller.status).toBe('pending-confirmation')
    expect(expiredFiller).not.toHaveProperty('confirmationToken')
    await expect(bridge.invoke('agent:operation:cancel', {
      sessionId: fillers[0].sessionId, batchId: fillers[0].batchId
    })).resolves.toMatchObject({ ok: false })

    for (const filler of fillers) {
      const stillPending = data(await bridge.invoke('agent:operation:read', {
        sessionId: filler.sessionId, batchId: filler.batchId
      }))
      expect(stillPending.status).toBe('pending-confirmation')
      expect(stillPending).not.toHaveProperty('confirmationToken')
    }
    expect(fillers.length).toBe(63)
    expect(afterExpiryPending).not.toHaveProperty('confirmationToken')
  }, 120000)

  it('executes a valid same-plan sequence in order using each preceding write revision', async () => {
    const { updatedAt, taskListId } = await writePlan()
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'plan', path: 'one' }] }))
    const targetRef = targetSet.targets[0].ref
    data(await bridge.invoke('agent:policy:set', { mode: 'unrestricted' }))
    server.removeAllListeners('request')
    let requestCount = 0
    server.on('request', (_request, response) => {
      response.setHeader('content-type', 'text/event-stream')
      if (requestCount++ === 0) {
        response.end(frame([
          { id: 'call_first', name: 'component.update', arguments: { plan_ref: targetRef, component_id: taskListId, expected_updated_at: updatedAt, patch: { title: 'First title' } } },
          { id: 'call_second', name: 'component.update', arguments: { plan_ref: targetRef, component_id: taskListId, expected_updated_at: updatedAt, patch: { title: 'Second title' } } }
        ]))
      } else {
        response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Both ordered changes were applied.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
      }
    })
    const session = data(await bridge.invoke('agent:session:create', { title: 'Ordered success', profileId }))
    const preview = data(await bridge.invoke('agent:preview:create', {
      sessionId: session.id, message: 'Apply both changes in order', selections: [],
      targetGrantSetId: targetSet.id, targetRefs: [targetRef]
    })) as AgentOutboundPreview
    const identity = data(await bridge.invoke('agent:request:send', { token: preview.token, sessionId: session.id })) as AgentRequestIdentity
    await until(() => events.some((event) => event.requestId === identity.requestId && event.type === 'terminal'))
    const initialSession = data(await bridge.invoke('agent:session:read', { id: session.id }))
    const pendingBatch = data(await bridge.invoke('agent:operation:read', { sessionId: session.id, batchId: initialSession.operationBatches[0].id }))
    expect(pendingBatch).toMatchObject({ status: 'pending-confirmation', policyMode: 'unrestricted', requiredConfirmation: true })
    const confirmResult = await bridge.invoke('agent:operation:confirm', {
      sessionId: session.id, batchId: pendingBatch.id
    })
    expect(confirmResult.ok).toBe(true)
    await until(() => events.some((event) => event.requestId === identity.requestId && event.type === 'terminal' && event.assistantId !== identity.assistantId))

    const completedBatch = data(await bridge.invoke('agent:operation:read', { sessionId: session.id, batchId: pendingBatch.id }))
    const savedPlan = JSON.parse(await fs.readFile(join(root, 'one', 'plan.json'), 'utf8')) as { components: Array<{ payload: { title?: string } }> }
    expect(completedBatch.status).toBe('awaiting-outbound-preview')
    expect(completedBatch.operations.map((item) => item.status)).toEqual(['succeeded', 'succeeded'])
    expect(completedBatch.operations.every((item) => item.confirmationSource === 'user')).toBe(true)
    expect(completedBatch.operations[0].afterUpdatedAt).toBeTruthy()
    expect(completedBatch.operations[1].beforeUpdatedAt).toBe(updatedAt)
    expect(savedPlan.components[0].payload.title).toBe('Second title')
    expect(requestCount).toBe(2)
  }, 15000)

  it('requires explicit confirmation for a single safe edit under confirm policy', async () => {
    const { updatedAt, taskListId } = await writePlan()
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'plan', path: 'one' }] }))
    const targetRef = targetSet.targets[0].ref
    server.removeAllListeners('request')
    let requestCount = 0
    server.on('request', (_request, response) => {
      response.setHeader('content-type', 'text/event-stream')
      if (requestCount++ === 0) {
        response.end(frame([
          { id: 'call_confirm', name: 'component.update', arguments: { plan_ref: targetRef, component_id: taskListId, expected_updated_at: updatedAt, patch: { title: 'Confirmed edit' } } }
        ]))
      } else {
        response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'The edit was confirmed.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
      }
    })
    const session = data(await bridge.invoke('agent:session:create', { title: 'Policy confirmation', profileId }))
    const preview = data(await bridge.invoke('agent:preview:create', {
      sessionId: session.id, message: 'Change this title', selections: [],
      targetGrantSetId: targetSet.id, targetRefs: [targetRef]
    })) as AgentOutboundPreview
    const identity = data(await bridge.invoke('agent:request:send', { token: preview.token, sessionId: session.id })) as AgentRequestIdentity
    await until(() => events.some((event) => event.requestId === identity.requestId && event.type === 'terminal'))
    const initialSession = data(await bridge.invoke('agent:session:read', { id: session.id }))
    const pendingBatch = data(await bridge.invoke('agent:operation:read', { sessionId: session.id, batchId: initialSession.operationBatches[0].id }))
    expect(pendingBatch).toMatchObject({ status: 'pending-confirmation', policyMode: 'confirm', requiredConfirmation: true })
    const unchanged = JSON.parse(await fs.readFile(join(root, 'one', 'plan.json'), 'utf8')) as { components: Array<{ payload: { title?: string } }> }
    expect(unchanged.components[0].payload.title).toBe('Tasks')

    const confirmResult = await bridge.invoke('agent:operation:confirm', {
      sessionId: session.id, batchId: pendingBatch.id
    })
    expect(confirmResult.ok).toBe(true)
    await until(() => events.some((event) => event.requestId === identity.requestId && event.type === 'terminal' && event.assistantId !== identity.assistantId))
    const completedBatch = data(await bridge.invoke('agent:operation:read', { sessionId: session.id, batchId: pendingBatch.id }))
    const savedPlan = JSON.parse(await fs.readFile(join(root, 'one', 'plan.json'), 'utf8')) as { components: Array<{ payload: { title?: string } }> }
    expect(completedBatch.operations[0]).toMatchObject({ status: 'succeeded', confirmationSource: 'user', requiredConfirmation: true })
    expect(savedPlan.components[0].payload.title).toBe('Confirmed edit')
  }, 15000)

  it('preserves an external plan edit made while an operation waits for confirmation', async () => {
    const { updatedAt, taskListId } = await writePlan()
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'plan', path: 'one' }] }))
    const targetRef = targetSet.targets[0].ref
    const started = await startBatch({
      title: 'Concurrent edit', message: 'Change this title after confirmation', targetSetId: targetSet.id,
      targetRefs: [targetRef], calls: [{ id: 'call_confirmed_edit', name: 'component.update', arguments: {
        plan_ref: targetRef, component_id: taskListId, expected_updated_at: updatedAt, patch: { title: 'Confirmed edit' }
      } }]
    })
    const initialAssistantId = events.find((event) => event.requestId === started.requestId && event.type === 'terminal')?.assistantId
    const pending = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    expect(pending.status).toBe('pending-confirmation')

    const externalEdit = await storage.readPlan('one')
    externalEdit.components[0].payload.title = 'External edit'
    await storage.savePlan('one', externalEdit, updatedAt)

    const result = await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    })
    expect(result.ok).toBe(true)
    await until(() => events.some((event) => event.requestId === started.requestId && event.type === 'terminal' && event.assistantId !== initialAssistantId))

    const completed = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    const saved = await storage.readPlan('one')
    expect(completed.status).toBe('execution-failed')
    expect(completed.operations[0]).toMatchObject({ status: 'failed', errorCategory: 'conflict' })
    expect(saved.components[0]).toMatchObject({ payload: { title: 'External edit' } })
  }, 15000)

  it('rejects component deletion when the message-bound plan directory was replaced after preflight', async () => {
    const { updatedAt, taskListId } = await writePlan()
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'plan', path: 'one' }] }))
    const targetRef = targetSet.targets[0].ref
    const started = await startBatch({
      title: 'Replaced component delete target', message: 'Delete this component', targetSetId: targetSet.id,
      targetRefs: [targetRef], calls: [{ id: 'delete_replaced_target', name: 'component.delete', arguments: {
        plan_ref: targetRef, component_id: taskListId, expected_updated_at: updatedAt
      } }]
    })
    const pending = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    expect(pending.status).toBe('pending-confirmation')

    await fs.rename(join(root, 'one'), join(root, 'one-before-swap'))
    await fs.mkdir(join(root, 'one'))
    await fs.copyFile(join(root, 'one-before-swap', 'plan.json'), join(root, 'one', 'plan.json'))

    const result = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    }))
    expect(result).toMatchObject({ status: 'execution-failed', operations: [{ status: 'failed', errorCategory: 'conflict' }] })
    const replacement = JSON.parse(await fs.readFile(join(root, 'one', 'plan.json'), 'utf8')) as { components: Array<{ id: string }> }
    expect(replacement.components.map((component) => component.id)).toEqual([taskListId])
  }, 15000)

  it('rejects component deletion when its target directory is replaced while waiting in the commit queue', async () => {
    const { updatedAt, taskListId } = await writePlan()
    await fs.mkdir(join(root, 'queue-source'))
    await fs.mkdir(join(root, 'queue-destination'))
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'plan', path: 'one' }] }))
    const targetRef = targetSet.targets[0].ref
    const started = await startBatch({
      title: 'Queue replacement before component delete', message: 'Delete this component', targetSetId: targetSet.id,
      targetRefs: [targetRef], calls: [{ id: 'delete_while_waiting', name: 'component.delete', arguments: {
        plan_ref: targetRef, component_id: taskListId, expected_updated_at: updatedAt
      } }]
    })
    const pending = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    expect(pending.status).toBe('pending-confirmation')

    let releaseMove!: () => void
    let markMoveStarted!: () => void
    let markImpactQueued!: () => void
    let impactWasQueued = false
    const moveGate = new Promise<void>((resolve) => { releaseMove = resolve })
    const moveStarted = new Promise<void>((resolve) => { markMoveStarted = resolve })
    const impactQueued = new Promise<void>((resolve) => { markImpactQueued = () => { impactWasQueued = true; resolve() } })
    const { PlanReferenceService } = await import('../src/main/services/plan-reference-service')
    const originalMovePlanRaw = storage.movePlanRaw.bind(storage)
    vi.spyOn(storage, 'movePlanRaw').mockImplementationOnce(async (snapshot, storageRootGeneration) => {
      markMoveStarted()
      await moveGate
      return originalMovePlanRaw(snapshot, storageRootGeneration)
    })
    const originalCommitAgentImpact = PlanReferenceService.prototype.commitAgentImpact
    vi.spyOn(PlanReferenceService.prototype, 'commitAgentImpact').mockImplementation(function (request, storageService, binding) {
      const queued = originalCommitAgentImpact.call(this, request, storageService, binding)
      markImpactQueued()
      return queued
    })

    const blocker = bridge.invoke('storage:movePlan', { path: 'queue-source', target_parent_path: 'queue-destination' })
    await moveStarted
    const initialAssistantId = events.find((event) => event.requestId === started.requestId && event.type === 'terminal')?.assistantId
    const confirmation = bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    })
    try {
      await impactQueued
      expect(impactWasQueued).toBe(true)
      await fs.rename(join(root, 'one'), join(root, 'one-before-queue-swap'))
      await fs.mkdir(join(root, 'one'))
      await fs.copyFile(join(root, 'one-before-queue-swap', 'plan.json'), join(root, 'one', 'plan.json'))
    } finally {
      releaseMove()
    }

    await expect(blocker).resolves.toMatchObject({ ok: true })
    const result = data(await confirmation)
    await until(() => events.some((event) => event.requestId === started.requestId && event.type === 'terminal' && event.assistantId !== initialAssistantId))
    expect(result).toMatchObject({ status: 'execution-failed', operations: [{ status: 'failed', errorCategory: 'conflict' }] })
    const replacement = JSON.parse(await fs.readFile(join(root, 'one', 'plan.json'), 'utf8')) as { components: Array<{ id: string }> }
    expect(replacement.components.map((component) => component.id)).toEqual([taskListId])
    const original = JSON.parse(await fs.readFile(join(root, 'one-before-queue-swap', 'plan.json'), 'utf8')) as { components: Array<{ id: string }> }
    expect(original.components.map((component) => component.id)).toEqual([taskListId])
  }, 15000)

  it('does not apply an old Agent plan edit to a cloned library switched in before queued commit', async () => {
    const { updatedAt, taskListId } = await writePlan()
    const originalRoot = root
    const replacementRoot = join(directory, 'cloned-library')
    await fs.cp(originalRoot, replacementRoot, { recursive: true })
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'plan', path: 'one' }] }))
    const targetRef = targetSet.targets[0].ref
    const started = await startBatch({
      title: 'Old library edit after root switch', message: 'Add a note to @target',
      targetSetId: targetSet.id, targetRefs: [targetRef], calls: [{
        id: 'edit_after_root_switch', name: 'component.add', arguments: {
          plan_ref: targetRef, expected_updated_at: updatedAt, type: 'note', payload: { content: 'OLD_AUTHORIZATION_MUST_NOT_WRITE' }
        }
      }]
    })

    let releaseRefresh!: () => void
    let markRefreshReturned!: () => void
    const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve })
    const refreshReturned = new Promise<void>((resolve) => { markRefreshReturned = resolve })
    const originalRefresh = agentTargets.refreshGrantForMessage.bind(agentTargets)
    let paused = false
    vi.spyOn(agentTargets, 'refreshGrantForMessage').mockImplementation(async (input, messageId, snapshot) => {
      const resolution = await originalRefresh(input, messageId, snapshot)
      if (!paused) {
        paused = true
        markRefreshReturned()
        await refreshGate
      }
      return resolution
    })

    const confirmation = bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    })
    await refreshReturned
    const finishRootSwitch = await planReferences.beginRootSwitch()
    root = replacementRoot
    storage.setRoot(replacementRoot)
    planReferences.activateRoot(replacementRoot)
    agentTargets.invalidateRoot()
    finishRootSwitch()
    releaseRefresh()

    const result = data(await confirmation)
    await until(() => events.some((event) => event.requestId === started.requestId && event.type === 'terminal' &&
      event.assistantId !== events.find((item) => item.requestId === started.requestId && item.type === 'terminal')?.assistantId))
    expect(result).toMatchObject({ status: 'execution-failed', operations: [{ status: 'failed', errorCategory: 'conflict' }] })

    for (const libraryRoot of [originalRoot, replacementRoot]) {
      const current = JSON.parse(await fs.readFile(join(libraryRoot, 'one', 'plan.json'), 'utf8')) as {
        components: Array<{ id: string; payload?: { content?: string } }>
      }
      expect(current.components.map((component) => component.id)).toContain(taskListId)
      expect(current.components.some((component) => component.payload?.content === 'OLD_AUTHORIZATION_MUST_NOT_WRITE')).toBe(false)
    }
  }, 15000)

  it('does not create an Agent plan in a new library after the frozen root changes before commit', async () => {
    const originalRoot = root
    const replacementRoot = join(directory, 'cloned-create-library')
    await fs.cp(originalRoot, replacementRoot, { recursive: true })
    const started = await startBatch({
      title: 'Old library plan creation', message: 'Create a new plan', targetRefs: [],
      calls: [{ id: 'create_after_root_switch', name: 'plan.create', arguments: { name_part: 'Unauthorized plan' } }]
    })

    let assertionCount = 0
    let releaseAssertion!: () => void
    let markAssertionStarted!: () => void
    const assertionGate = new Promise<void>((resolve) => { releaseAssertion = resolve })
    const assertionStarted = new Promise<void>((resolve) => { markAssertionStarted = resolve })
    const originalAssert = agentTargets.assertActiveLibrarySnapshot.bind(agentTargets)
    vi.spyOn(agentTargets, 'assertActiveLibrarySnapshot').mockImplementation(async (snapshot) => {
      await originalAssert(snapshot)
      assertionCount += 1
      if (assertionCount === 3) {
        markAssertionStarted()
        await assertionGate
      }
    })

    const confirmation = bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    })
    await assertionStarted
    const finishRootSwitch = await planReferences.beginRootSwitch()
    root = replacementRoot
    storage.setRoot(replacementRoot)
    planReferences.activateRoot(replacementRoot)
    agentTargets.invalidateRoot()
    finishRootSwitch()
    releaseAssertion()

    const result = data(await confirmation)
    await until(() => events.some((event) => event.requestId === started.requestId && event.type === 'terminal' &&
      event.assistantId !== events.find((item) => item.requestId === started.requestId && item.type === 'terminal')?.assistantId))
    expect(result).toMatchObject({ status: 'execution-failed', operations: [{ status: 'failed', errorCategory: 'conflict' }] })
    for (const libraryRoot of [originalRoot, replacementRoot]) {
      await expect(fs.access(join(libraryRoot, 'Unauthorized plan'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  }, 15000)

  it.each([
    { toolName: 'folder.create', targetName: 'Created folder', arguments: { name: 'Created folder' } },
    { toolName: 'plan.create', targetName: 'Created plan', arguments: { name_part: 'Created plan' } }
  ])('rejects $toolName when its message-bound parent directory was replaced after preflight', async ({ toolName, targetName, arguments: callArguments }) => {
    await fs.mkdir(join(root, 'parent'))
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'folder', path: 'parent' }] }))
    const parentRef = targetSet.targets[0].ref
    const started = await startBatch({
      title: `Replaced parent for ${toolName}`, message: '@parent create under this folder', targetSetId: targetSet.id,
      targetRefs: [parentRef], calls: [{ id: `create_under_replaced_parent_${toolName.replace('.', '_')}`, name: toolName, arguments: {
        parent_ref: parentRef, ...callArguments
      } }]
    })
    const pending = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    expect(pending.status).toBe('pending-confirmation')

    await fs.rename(join(root, 'parent'), join(root, 'parent-before-swap'))
    await fs.mkdir(join(root, 'parent'))

    const result = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    }))
    expect(result).toMatchObject({ status: 'execution-failed', operations: [{ status: 'failed', errorCategory: 'conflict' }] })
    await expect(fs.stat(join(root, 'parent', targetName))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(join(root, 'parent-before-swap', targetName))).rejects.toMatchObject({ code: 'ENOENT' })
  }, 15000)

  it('rejects renaming a referenced plan together with renaming its reference source before any write', async () => {
    const timestamp = '2026-10-04T00:00:00.000Z'
    const xPlanId = 'b'.repeat(32)
    const yPlanId = 'c'.repeat(32)
    const referenceComponentId = 'd'.repeat(32)
    await fs.mkdir(join(root, 'X'))
    await fs.mkdir(join(root, 'Y'))
    await fs.writeFile(join(root, 'X', 'plan.json'), JSON.stringify({
      format_version: '1', plan_id: xPlanId, created_at: timestamp, updated_at: timestamp, components: []
    }))
    await fs.writeFile(join(root, 'Y', 'plan.json'), JSON.stringify({
      format_version: '1', plan_id: yPlanId, created_at: timestamp, updated_at: timestamp,
      components: [{ id: referenceComponentId, type: 'plan_reference', payload: {
        mode: 'link', target_plan_id: xPlanId, target_path_snapshot: 'X', target_name_snapshot: 'X'
      } }]
    }))
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [
      { kind: 'plan', path: 'X' }, { kind: 'plan', path: 'Y' }
    ] }))
    const xTarget = targetSet.targets.find((target) => target.path === 'X')!
    const yTarget = targetSet.targets.find((target) => target.path === 'Y')!
    const beforeX = await fs.readFile(join(root, 'X', 'plan.json'), 'utf8')
    const beforeY = await fs.readFile(join(root, 'Y', 'plan.json'), 'utf8')

    const started = await startBatch({ title: 'Conflicting reference rename', message: '@X @Y rename both plans', targetSetId: targetSet.id,
      targetRefs: [xTarget.ref, yTarget.ref], calls: [
        { id: 'rename_referenced_x', name: 'plan.rename', arguments: {
          target_ref: xTarget.ref, expected_revision: xTarget.revision, new_name: 'X-renamed'
        } },
        { id: 'rename_reference_source_y', name: 'plan.rename', arguments: {
          target_ref: yTarget.ref, expected_revision: yTarget.revision, new_name: 'Y-renamed'
        } }
      ] })
    const failed = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))

    expect(failed).toMatchObject({ status: 'preflight-failed', operations: [
      { status: 'not-executed' }, { status: 'failed', errorCategory: 'conflict' }
    ] })
    expect(await fs.readFile(join(root, 'X', 'plan.json'), 'utf8')).toBe(beforeX)
    expect(await fs.readFile(join(root, 'Y', 'plan.json'), 'utf8')).toBe(beforeY)
    await expect(fs.stat(join(root, 'X-renamed'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(join(root, 'Y-renamed'))).rejects.toMatchObject({ code: 'ENOENT' })
  }, 15000)

  it('allows only one decision when confirmation races with cancellation', async () => {
    const { updatedAt, taskListId } = await writePlan()
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'plan', path: 'one' }] }))
    const targetRef = targetSet.targets[0].ref
    const started = await startBatch({
      title: 'Decision race', message: 'Change this title', targetSetId: targetSet.id, targetRefs: [targetRef],
      calls: [{ id: 'call_decision_race', name: 'component.update', arguments: {
        plan_ref: targetRef, component_id: taskListId, expected_updated_at: updatedAt, patch: { title: 'Confirmed edit' }
      } }]
    })
    const initialAssistantId = events.find((event) => event.requestId === started.requestId && event.type === 'terminal')?.assistantId
    const pending = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    expect(pending.status).toBe('pending-confirmation')

    const confirmation = bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    })
    const cancellation = bridge.invoke('agent:operation:cancel', {
      sessionId: started.sessionId, batchId: started.batchId
    })
    const [confirmed, cancelled] = await Promise.all([confirmation, cancellation])
    expect(confirmed.ok).toBe(true)
    expect(cancelled.ok).toBe(false)
    await until(() => events.some((event) => event.requestId === started.requestId && event.type === 'terminal' && event.assistantId !== initialAssistantId))

    const completed = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    expect(completed.status).toBe('awaiting-outbound-preview')
    expect(completed.operations[0].status).toBe('succeeded')
  }, 15000)

  it('keeps a claimed retry reservation through expiry, cancellation, and pending-batch pruning', async () => {
    const initialTime = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(initialTime)
    await bridge.invoke('agent:policy:set', { mode: 'unrestricted' })
    const originalCreatePlan = storage.createPlan.bind(storage)
    let createAttempts = 0
    vi.spyOn(storage, 'createPlan').mockImplementation(async (...args) => {
      createAttempts += 1
      if (createAttempts === 1) throw new Error('isolated first create failure')
      return originalCreatePlan(...args)
    })
    const started = await startBatch({ title: 'Retry reservation expiry', message: 'Create two objects', targetRefs: [], calls: [
      { id: 'claimed_retry_source', name: 'plan.create', arguments: { name_part: 'Claimed retry source' } },
      { id: 'prune_trigger_source', name: 'folder.create', arguments: { name: 'Prune trigger source' } }
    ] })
    const initial = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    const initialAssistantId = events.find((event) => event.requestId === started.requestId && event.type === 'terminal')?.assistantId
    const failed = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    }))
    expect(failed).toMatchObject({ status: 'execution-failed', operations: [
      { callId: 'claimed_retry_source', status: 'failed' }, { callId: 'prune_trigger_source', status: 'not-executed' }
    ] })
    await until(() => events.some((event) => event.requestId === started.requestId && event.type === 'terminal' && event.assistantId !== initialAssistantId))

    const retry = data(await bridge.invoke('agent:operation:retry', {
      sessionId: started.sessionId, batchId: started.batchId, callIds: ['claimed_retry_source']
    }))
    expect(retry.status).toBe('pending-confirmation')

    const [{ AgentSessionRepository }, { ERR }] = await Promise.all([
      import('../src/main/services/agent-session-repository'), import('../src/shared/errors')
    ])
    const originalRead = AgentSessionRepository.prototype.read
    let blockNextRead = true
    let markReadEntered!: () => void
    let releaseRead!: () => void
    const readEntered = new Promise<void>((resolve) => { markReadEntered = resolve })
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve })
    vi.spyOn(AgentSessionRepository.prototype, 'read').mockImplementation(function (this: InstanceType<typeof AgentSessionRepository>, id: string) {
      if (id === started.sessionId && blockNextRead) {
        blockNextRead = false
        markReadEntered()
        return readGate.then(() => originalRead.call(this, id))
      }
      return originalRead.call(this, id)
    })

    const confirmation = bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: retry.id
    })
    try {
      await readEntered
      clock.mockReturnValue(initialTime + 20 * 60 * 1000)

      await expect(bridge.invoke('agent:operation:confirm', {
        sessionId: started.sessionId, batchId: retry.id
      })).resolves.toMatchObject({ ok: false, code: ERR.CONFLICT })
      await expect(bridge.invoke('agent:operation:cancel', {
        sessionId: started.sessionId, batchId: retry.id
      })).resolves.toMatchObject({ ok: false, code: ERR.CONFLICT })

      const continued = data(await bridge.invoke('agent:operation:continue', {
        sessionId: started.sessionId, batchId: started.batchId, callIds: ['prune_trigger_source']
      }))
      expect(continued.status).toBe('pending-confirmation')
      await expect(bridge.invoke('agent:operation:retry', {
        sessionId: started.sessionId, batchId: started.batchId, callIds: ['claimed_retry_source']
      })).resolves.toMatchObject({ ok: false, code: ERR.CONFLICT })
    } finally {
      releaseRead()
      await confirmation
    }

    await expect(confirmation).resolves.toMatchObject({ ok: false, code: ERR.CONFLICT })
    await expect(fs.stat(join(root, 'Claimed retry source'))).rejects.toMatchObject({ code: 'ENOENT' })
  }, 15000)

  it('prunes expired unclaimed retry and continue reservations before the next same-source request', async () => {
    const initialTime = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(initialTime)
    await bridge.invoke('agent:policy:set', { mode: 'unrestricted' })
    const originalCreatePlan = storage.createPlan.bind(storage)
    let createAttempts = 0
    vi.spyOn(storage, 'createPlan').mockImplementation(async (...args) => {
      createAttempts += 1
      if (createAttempts === 1) throw new Error('isolated first create failure')
      return originalCreatePlan(...args)
    })
    const started = await startBatch({ title: 'Expired retry and continue', message: 'Create two objects', targetRefs: [], calls: [
      { id: 'expired_retry_source', name: 'plan.create', arguments: { name_part: 'Expired retry source' } },
      { id: 'expired_continue_source', name: 'folder.create', arguments: { name: 'Expired continue source' } }
    ] })
    const original = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    const failed = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    }))
    expect(failed).toMatchObject({ status: 'execution-failed', operations: [
      { callId: 'expired_retry_source', status: 'failed' }, { callId: 'expired_continue_source', status: 'not-executed' }
    ] })

    const retry = data(await bridge.invoke('agent:operation:retry', {
      sessionId: started.sessionId, batchId: started.batchId, callIds: ['expired_retry_source']
    }))
    clock.mockReturnValue(initialTime + 6 * 60 * 1000)
    const retriedAgain = data(await bridge.invoke('agent:operation:retry', {
      sessionId: started.sessionId, batchId: started.batchId, callIds: ['expired_retry_source']
    }))
    expect(retriedAgain).toMatchObject({ attemptKind: 'retry', status: 'pending-confirmation' })
    expect(retriedAgain.id).not.toBe(retry.id)

    const continued = data(await bridge.invoke('agent:operation:continue', {
      sessionId: started.sessionId, batchId: started.batchId, callIds: ['expired_continue_source']
    }))
    clock.mockReturnValue(initialTime + 12 * 60 * 1000)
    const continuedAgain = data(await bridge.invoke('agent:operation:continue', {
      sessionId: started.sessionId, batchId: started.batchId, callIds: ['expired_continue_source']
    }))
    expect(continuedAgain).toMatchObject({ attemptKind: 'continue', status: 'pending-confirmation' })
    expect(continuedAgain.id).not.toBe(continued.id)
  }, 15000)

  it('prunes expired unclaimed content and structural undo reservations before repeating undo', async () => {
    const initialTime = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(initialTime)
    const { updatedAt, taskListId } = await writePlan()
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'plan', path: 'one' }] }))
    const targetRef = targetSet.targets[0].ref
    const content = await startBatch({ title: 'Expired content undo', message: 'Edit the plan', targetSetId: targetSet.id,
      targetRefs: [targetRef], calls: [
        { id: 'expired_content_undo', name: 'component.update', arguments: {
          plan_ref: targetRef, component_id: taskListId, expected_updated_at: updatedAt, patch: { title: 'Changed' }
        } }
      ] })
    const contentPending = data(await bridge.invoke('agent:operation:read', { sessionId: content.sessionId, batchId: content.batchId }))
    data(await bridge.invoke('agent:operation:confirm', {
      sessionId: content.sessionId, batchId: content.batchId
    }))
    const contentUndo = data(await bridge.invoke('agent:operation:undo', {
      sessionId: content.sessionId, batchId: content.batchId, callId: 'expired_content_undo'
    }))
    clock.mockReturnValue(initialTime + 6 * 60 * 1000)
    const contentUndoAgain = data(await bridge.invoke('agent:operation:undo', {
      sessionId: content.sessionId, batchId: content.batchId, callId: 'expired_content_undo'
    }))
    expect(contentUndoAgain).toMatchObject({ attemptKind: 'undo', status: 'pending-confirmation' })
    expect(contentUndoAgain.id).not.toBe(contentUndo.id)

    clock.mockReturnValue(initialTime + 12 * 60 * 1000)
    const structural = await startBatch({ title: 'Expired structural undo', message: 'Create a plan', targetRefs: [], calls: [
      { id: 'expired_structural_undo', name: 'plan.create', arguments: { name_part: 'Expired structural undo' } }
    ] })
    const structuralPending = data(await bridge.invoke('agent:operation:read', { sessionId: structural.sessionId, batchId: structural.batchId }))
    data(await bridge.invoke('agent:operation:confirm', {
      sessionId: structural.sessionId, batchId: structural.batchId
    }))
    const structuralUndo = data(await bridge.invoke('agent:operation:undo', {
      sessionId: structural.sessionId, batchId: structural.batchId, callId: 'expired_structural_undo'
    }))
    clock.mockReturnValue(initialTime + 18 * 60 * 1000)
    const structuralUndoAgain = data(await bridge.invoke('agent:operation:undo', {
      sessionId: structural.sessionId, batchId: structural.batchId, callId: 'expired_structural_undo'
    }))
    expect(structuralUndoAgain).toMatchObject({ attemptKind: 'undo', status: 'pending-confirmation' })
    expect(structuralUndoAgain.id).not.toBe(structuralUndo.id)
  }, 15000)

  it('keeps a component undo available after a transient plan read failure', async () => {
    const { updatedAt, taskListId } = await writePlan()
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'plan', path: 'one' }] }))
    const targetRef = targetSet.targets[0].ref
    const started = await startBatch({ title: 'Transient content undo read', message: 'Edit the plan', targetSetId: targetSet.id,
      targetRefs: [targetRef], calls: [
        { id: 'transient_content_undo', name: 'component.update', arguments: {
          plan_ref: targetRef, component_id: taskListId, expected_updated_at: updatedAt, patch: { title: 'Changed' }
        } }
      ] })
    const pending = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    }))

    vi.spyOn(storage, 'readPlan').mockRejectedValueOnce(new Error('isolated transient read failure'))
    await expect(bridge.invoke('agent:operation:undo', {
      sessionId: started.sessionId, batchId: started.batchId, callId: 'transient_content_undo'
    })).resolves.toMatchObject({ ok: false })
    expect(data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
      .operations[0].undoStatus).toBe('available')

    const undo = data(await bridge.invoke('agent:operation:undo', {
      sessionId: started.sessionId, batchId: started.batchId, callId: 'transient_content_undo'
    }))
    expect(undo).toMatchObject({ attemptKind: 'undo', status: 'pending-confirmation' })
  }, 15000)

  it('keeps structural undo available when persisting its preview audit transiently fails', async () => {
    const started = await startBatch({ title: 'Transient structural undo audit', message: 'Create a plan', targetRefs: [], calls: [
      { id: 'transient_structural_undo', name: 'plan.create', arguments: { name_part: 'Transient structural undo' } }
    ] })
    const pending = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    }))
    const [{ AgentSessionRepository }] = await Promise.all([import('../src/main/services/agent-session-repository')])
    const originalMutate = AgentSessionRepository.prototype.mutate
    let failPendingAudit = true
    vi.spyOn(AgentSessionRepository.prototype, 'mutate').mockImplementation(function (
      this: InstanceType<typeof AgentSessionRepository>, id, operation
    ) {
      return originalMutate.call(this, id, (session) => {
        const previousBatchCount = session.operationBatches.length
        operation(session)
        if (id === started.sessionId && failPendingAudit && session.operationBatches.length > previousBatchCount) {
          failPendingAudit = false
          throw new Error('isolated transient undo audit failure')
        }
      })
    })

    await expect(bridge.invoke('agent:operation:undo', {
      sessionId: started.sessionId, batchId: started.batchId, callId: 'transient_structural_undo'
    })).resolves.toMatchObject({ ok: false })
    const afterFailure = data(await bridge.invoke('agent:session:read', { id: started.sessionId }))
    expect(afterFailure.operationBatches).toHaveLength(1)
    expect(afterFailure.operationBatches[0].operations[0].undoStatus).toBe('available')

    vi.restoreAllMocks()
    const undo = data(await bridge.invoke('agent:operation:undo', {
      sessionId: started.sessionId, batchId: started.batchId, callId: 'transient_structural_undo'
    }))
    expect(undo).toMatchObject({ attemptKind: 'undo', status: 'pending-confirmation' })
  }, 15000)

  it('records a human-verification outcome when the plan changed but success audit persistence fails', async () => {
    const { updatedAt, taskListId } = await writePlan()
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'plan', path: 'one' }] }))
    const targetRef = targetSet.targets[0].ref
    const started = await startBatch({ title: 'Unknown operation outcome', message: 'Update a plan safely', targetSetId: targetSet.id,
      targetRefs: [targetRef], calls: [
        { id: 'outcome_unknown_update', name: 'component.update', arguments: {
          plan_ref: targetRef, component_id: taskListId, expected_updated_at: updatedAt, patch: { title: 'Changed before audit error' }
        } }
      ] })
    const pending = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    const [{ AgentSessionRepository }] = await Promise.all([import('../src/main/services/agent-session-repository')])
    const originalMutate = AgentSessionRepository.prototype.mutate
    let mutationCount = 0
    const mutateSpy = vi.spyOn(AgentSessionRepository.prototype, 'mutate').mockImplementation(function (
      this: InstanceType<typeof AgentSessionRepository>, id, operation
    ) {
      mutationCount += 1
      if (id === started.sessionId && mutationCount === 2) return Promise.reject(new Error('isolated success audit failure'))
      return originalMutate.call(this, id, operation)
    })

    const completed = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    }))
    mutateSpy.mockRestore()
    expect(completed).toMatchObject({ status: 'reconciliation-required', operations: [{
      callId: 'outcome_unknown_update', status: 'outcome-unknown', undoStatus: 'unavailable',
      reconciliationReason: 'success-audit-persistence-failed', changes: []
    }] })
    expect(JSON.stringify(completed)).not.toContain(root)
    const changed = JSON.parse(await fs.readFile(join(root, 'one', 'plan.json'), 'utf8')) as { components: Array<{ payload: { title?: string } }> }
    expect(changed.components[0].payload.title).toBe('Changed before audit error')
    const session = data(await bridge.invoke('agent:session:read', { id: started.sessionId }))
    const toolResult = session.messages.find((message) => message.role === 'tool' && message.toolCallId === 'outcome_unknown_update')
    expect(toolResult?.content).toContain('reconciliation-required')
    expect(toolResult?.content).not.toContain(root)
    await expect(bridge.invoke('agent:operation:retry', {
      sessionId: started.sessionId, batchId: started.batchId, callIds: ['outcome_unknown_update']
    })).resolves.toMatchObject({ ok: false })
    await expect(bridge.invoke('agent:operation:undo', {
      sessionId: started.sessionId, batchId: started.batchId, callId: 'outcome_unknown_update'
    })).resolves.toMatchObject({ ok: false })
  }, 15000)

  it('blocks a repeated undo when both success and reconciliation audits fail', async () => {
    const { updatedAt, taskListId } = await writePlan()
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'plan', path: 'one' }] }))
    const targetRef = targetSet.targets[0].ref
    const started = await startBatch({ title: 'Unresolved undo attempt', message: 'Edit a plan', targetSetId: targetSet.id,
      targetRefs: [targetRef], calls: [
        { id: 'unresolved_undo_source', name: 'component.update', arguments: {
          plan_ref: targetRef, component_id: taskListId, expected_updated_at: updatedAt, patch: { title: 'Changed' }
        } }
      ] })
    const initial = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    }))
    const undo = data(await bridge.invoke('agent:operation:undo', {
      sessionId: started.sessionId, batchId: started.batchId, callId: 'unresolved_undo_source'
    }))
    const [{ AgentSessionRepository }] = await Promise.all([import('../src/main/services/agent-session-repository')])
    const originalMutate = AgentSessionRepository.prototype.mutate
    let mutationCount = 0
    const mutateSpy = vi.spyOn(AgentSessionRepository.prototype, 'mutate').mockImplementation(function (
      this: InstanceType<typeof AgentSessionRepository>, id, operation
    ) {
      mutationCount += 1
      if (id === started.sessionId && (mutationCount === 2 || mutationCount === 3)) {
        return Promise.reject(new Error('isolated attempt audit persistence failure'))
      }
      return originalMutate.call(this, id, operation)
    })

    const returned = await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: undo.id
    })
    mutateSpy.mockRestore()
    expect(returned).toMatchObject({ ok: true, data: { status: 'reconciliation-required', operations: [{ status: 'outcome-unknown' }] } })
    const persisted = data(await bridge.invoke('agent:session:read', { id: started.sessionId }))
    const attempt = persisted.operationBatches.find((batch) => batch.id === undo.id)
    const source = persisted.operationBatches.find((batch) => batch.id === started.batchId)
    expect(attempt?.status).toBe('executing')
    expect(source?.operations[0].undoStatus).toBe('available')
    const savedPlan = JSON.parse(await fs.readFile(join(root, 'one', 'plan.json'), 'utf8')) as { components: Array<{ payload: { title?: string } }> }
    expect(savedPlan.components[0].payload.title).toBe('Tasks')
    await expect(bridge.invoke('agent:operation:undo', {
      sessionId: started.sessionId, batchId: started.batchId, callId: 'unresolved_undo_source'
    })).resolves.toMatchObject({ ok: false })
  }, 15000)

  it('blocks retry after reopening a persisted unresolved attempt audit', async () => {
    await bridge.invoke('agent:policy:set', { mode: 'unrestricted' })
    const originalCreatePlan = storage.createPlan.bind(storage)
    let createAttempts = 0
    vi.spyOn(storage, 'createPlan').mockImplementation(async (...args) => {
      createAttempts += 1
      if (createAttempts === 1) throw new Error('isolated first create failure')
      return originalCreatePlan(...args)
    })
    const started = await startBatch({ title: 'Unresolved retry attempt', message: 'Create two objects', targetRefs: [], calls: [
      { id: 'unresolved_retry_source', name: 'plan.create', arguments: { name_part: 'Unresolved retry source' } },
      { id: 'unresolved_continue_source', name: 'folder.create', arguments: { name: 'Unresolved continue source' } }
    ] })
    const initial = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    }))
    const retry = data(await bridge.invoke('agent:operation:retry', {
      sessionId: started.sessionId, batchId: started.batchId, callIds: ['unresolved_retry_source']
    }))
    const [{ AgentSessionRepository }] = await Promise.all([import('../src/main/services/agent-session-repository')])
    const originalMutate = AgentSessionRepository.prototype.mutate
    let mutationCount = 0
    const mutateSpy = vi.spyOn(AgentSessionRepository.prototype, 'mutate').mockImplementation(function (
      this: InstanceType<typeof AgentSessionRepository>, id, operation
    ) {
      mutationCount += 1
      if (id === started.sessionId && (mutationCount === 2 || mutationCount === 3)) {
        return Promise.reject(new Error('isolated retry audit persistence failure'))
      }
      return originalMutate.call(this, id, operation)
    })

    const returned = await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: retry.id
    })
    mutateSpy.mockRestore()
    expect(returned).toMatchObject({ ok: true, data: { status: 'reconciliation-required', operations: [{ status: 'outcome-unknown' }] } })
    const reopened = await new AgentSessionRepository(directory).read(started.sessionId)
    expect(reopened.operationBatches.find((batch) => batch.id === retry.id)?.status).toBe('reconciliation-required')
    await expect(bridge.invoke('agent:operation:retry', {
      sessionId: started.sessionId, batchId: started.batchId, callIds: ['unresolved_retry_source']
    })).resolves.toMatchObject({ ok: false })
    await expect(fs.stat(join(root, 'Unresolved retry source'))).resolves.toBeTruthy()
  }, 15000)

  it('blocks a root retry when a reopened grandchild attempt has an unknown outcome', async () => {
    await bridge.invoke('agent:policy:set', { mode: 'unrestricted' })
    const originalCreatePlan = storage.createPlan.bind(storage)
    let createAttempts = 0
    vi.spyOn(storage, 'createPlan').mockImplementation(async (...args) => {
      createAttempts += 1
      if (createAttempts <= 2) throw new Error('isolated nested attempt failure')
      return originalCreatePlan(...args)
    })
    const started = await startBatch({ title: 'Nested unknown attempt', message: 'Create an object safely', targetRefs: [], calls: [
      { id: 'nested_unknown_source', name: 'plan.create', arguments: { name_part: 'Nested unknown source' } },
      { id: 'nested_unknown_tail', name: 'folder.create', arguments: { name: 'Nested unknown tail' } }
    ] })
    const source = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: source.id
    }))
    const child = data(await bridge.invoke('agent:operation:retry', {
      sessionId: started.sessionId, batchId: started.batchId, callIds: ['nested_unknown_source']
    }))
    const childPending = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: child.id }))
    data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: child.id
    }))
    const grandchild = data(await bridge.invoke('agent:operation:retry', {
      sessionId: started.sessionId, batchId: child.id, callIds: ['nested_unknown_source']
    }))
    const grandchildPending = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: grandchild.id }))
    const [{ AgentSessionRepository }] = await Promise.all([import('../src/main/services/agent-session-repository')])
    const originalMutate = AgentSessionRepository.prototype.mutate
    let mutationCount = 0
    const mutateSpy = vi.spyOn(AgentSessionRepository.prototype, 'mutate').mockImplementation(function (
      this: InstanceType<typeof AgentSessionRepository>, id, operation
    ) {
      mutationCount += 1
      if (id === started.sessionId && mutationCount === 2) return Promise.reject(new Error('isolated grandchild success audit failure'))
      return originalMutate.call(this, id, operation)
    })
    const uncertain = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: grandchild.id
    }))
    mutateSpy.mockRestore()
    expect(uncertain).toMatchObject({ status: 'reconciliation-required', operations: [{ status: 'outcome-unknown' }] })
    const reopened = await new AgentSessionRepository(directory).read(started.sessionId)
    expect(reopened.operationBatches.find((batch) => batch.id === grandchild.id)?.status).toBe('reconciliation-required')
    await expect(bridge.invoke('agent:operation:retry', {
      sessionId: started.sessionId, batchId: started.batchId, callIds: ['nested_unknown_source']
    })).resolves.toMatchObject({ ok: false })
    await expect(fs.stat(join(root, 'Nested unknown source'))).resolves.toBeTruthy()
  }, 15000)

  it('reserves one source operation across retry branches before a competing preview can be confirmed', async () => {
    await bridge.invoke('agent:policy:set', { mode: 'unrestricted' })
    const originalCreatePlan = storage.createPlan.bind(storage)
    let createAttempts = 0
    vi.spyOn(storage, 'createPlan').mockImplementation(async (...args) => {
      createAttempts += 1
      if (createAttempts <= 2) {
        const { ERR, TraceError } = await import('../src/shared/errors')
        throw new TraceError(ERR.SAVE_FAILED, 'isolated create failure')
      }
      return originalCreatePlan(...args)
    })
    const started = await startBatch({ title: 'Canonical retry reservation', message: 'Create a plan', targetRefs: [], calls: [
      { id: 'canonical_retry_source', name: 'plan.create', arguments: { name_part: 'Canonical retry source' } }
    ] })
    const failedRoot = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    expect(failedRoot).toMatchObject({ status: 'execution-failed', operations: [{ status: 'failed' }] })

    const child = data(await bridge.invoke('agent:operation:retry', {
      sessionId: started.sessionId, batchId: started.batchId, callIds: ['canonical_retry_source']
    }))
    const failedChild = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: child.id
    }))
    expect(failedChild).toMatchObject({ status: 'execution-failed', operations: [{ status: 'failed' }] })

    const grandchild = data(await bridge.invoke('agent:operation:retry', {
      sessionId: started.sessionId, batchId: child.id, callIds: ['canonical_retry_source']
    }))
    expect(grandchild).toMatchObject({ attemptOf: child.id, attemptKind: 'retry', status: 'pending-confirmation' })

    const competingRootRetry = await bridge.invoke('agent:operation:retry', {
      sessionId: started.sessionId, batchId: started.batchId, callIds: ['canonical_retry_source']
    })
    expect(competingRootRetry).toMatchObject({ ok: false })
    expect(createAttempts).toBe(2)

    const confirmedGrandchild = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: grandchild.id
    }))
    expect(confirmedGrandchild).toMatchObject({ status: 'awaiting-outbound-preview', operations: [{ status: 'succeeded' }] })
    expect(createAttempts).toBe(3)
    await expect(fs.stat(join(root, 'Canonical retry source'))).resolves.toBeTruthy()
  }, 15000)

  it('rejects a retry preview after a sibling attempt resolves its source before confirmation', async () => {
    await bridge.invoke('agent:policy:set', { mode: 'unrestricted' })
    const originalCreatePlan = storage.createPlan.bind(storage)
    let createAttempts = 0
    vi.spyOn(storage, 'createPlan').mockImplementation(async (...args) => {
      createAttempts += 1
      if (createAttempts === 1) {
        const { ERR, TraceError } = await import('../src/shared/errors')
        throw new TraceError(ERR.SAVE_FAILED, 'isolated initial create failure')
      }
      return originalCreatePlan(...args)
    })
    const started = await startBatch({ title: 'Stale retry confirmation', message: 'Create a plan', targetRefs: [], calls: [
      { id: 'stale_retry_source', name: 'plan.create', arguments: { name_part: 'Stale retry source' } }
    ] })
    const retry = data(await bridge.invoke('agent:operation:retry', {
      sessionId: started.sessionId, batchId: started.batchId, callIds: ['stale_retry_source']
    }))
    expect(retry.status).toBe('pending-confirmation')

    const [{ AgentSessionRepository }] = await Promise.all([import('../src/main/services/agent-session-repository')])
    await new AgentSessionRepository(directory).mutate(started.sessionId, (session) => {
      const source = session.operationBatches.find((batch) => batch.id === started.batchId)!
      const sourceOperation = source.operations.find((operation) => operation.callId === 'stale_retry_source')!
      const siblingId = randomUUID()
      const completedAt = new Date().toISOString()
      sourceOperation.resolvedByAttempt = siblingId
      source.updatedAt = completedAt
      session.operationBatches.push({
        ...source, id: siblingId, attemptOf: source.id, attemptKind: 'retry',
        status: 'awaiting-outbound-preview', confirmationSource: 'user', createdAt: completedAt, updatedAt: completedAt,
        operations: [{
          ...sourceOperation, status: 'succeeded', confirmationSource: 'user', reversible: true, undoStatus: 'available',
          errorCategory: undefined, reconciliationReason: undefined, resolvedByAttempt: undefined, completedAt
        }]
      })
    })

    await expect(bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: retry.id
    })).resolves.toMatchObject({ ok: false })
    expect(createAttempts).toBe(1)
    const persisted = data(await bridge.invoke('agent:session:read', { id: started.sessionId }))
    expect(persisted.operationBatches.find((batch) => batch.id === retry.id)?.status).toBe('cancelled')
    expect(persisted.operationBatches.find((batch) => batch.id === started.batchId)?.operations[0].resolvedByAttempt).toBeTruthy()
    await expect(fs.stat(join(root, 'Stale retry source'))).rejects.toMatchObject({ code: 'ENOENT' })
  }, 15000)

  it('never retries a failed undo by replaying the original forward operation', async () => {
    await writePlan()
    const originalCreatePlan = storage.createPlan.bind(storage)
    let createPlanAttempts = 0
    vi.spyOn(storage, 'createPlan').mockImplementation(async (...args) => {
      createPlanAttempts += 1
      return originalCreatePlan(...args)
    })
    const started = await startBatch({ title: 'Undo intent retry', message: 'Create a plan', targetRefs: [], calls: [
      { id: 'undo_intent_source', name: 'plan.create', arguments: { name_part: 'Undo intent source' } }
    ] })
    const createPreview = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    const created = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    }))
    expect(created.operations[0]).toMatchObject({ status: 'succeeded', undoStatus: 'available', targetKind: 'plan' })
    const createdPathChange = created.operations[0].changes.find((item) => item.field === 'created_path')
    const createdPath = createdPathChange?.after ? JSON.parse(createdPathChange.after) as string : ''
    const originalPlanContents = await fs.readFile(join(root, createdPath, 'plan.json'), 'utf8')
    expect(createPlanAttempts).toBe(1)

    const undo = data(await bridge.invoke('agent:operation:undo', {
      sessionId: started.sessionId, batchId: started.batchId, callId: 'undo_intent_source'
    }))
    expect(undo).toMatchObject({ attemptKind: 'undo', status: 'pending-confirmation' })

    const grant = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'plan', path: createdPath }] }))
    const target = grant.targets[0]
    const renameStarted = await startBatch({ title: 'Move undo target before confirmation', message: 'Rename the plan',
      targetSetId: grant.id, targetRefs: [target.ref], calls: [{
        id: 'rename_undo_target_before_confirm', name: 'plan.rename', arguments: {
          target_ref: target.ref, expected_revision: target.revision, new_name: 'Moved undo intent source'
        }
      }] })
    const renamePreview = data(await bridge.invoke('agent:operation:read', {
      sessionId: renameStarted.sessionId, batchId: renameStarted.batchId
    }))
    const renamed = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: renameStarted.sessionId, batchId: renameStarted.batchId
    }))
    expect(renamed.operations[0].status).toBe('succeeded')

    const failedUndo = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: undo.id
    }))
    expect(failedUndo).toMatchObject({ status: 'execution-failed', attemptKind: 'undo', operations: [{ status: 'failed' }] })
    await expect(fs.stat(join(root, 'Moved undo intent source', 'plan.json'))).resolves.toBeTruthy()
    await expect(fs.stat(join(root, createdPath))).rejects.toMatchObject({ code: 'ENOENT' })
    const operationCountBeforeRetry = data(await bridge.invoke('agent:session:read', { id: started.sessionId })).operationBatches.length

    const retryUndo = await bridge.invoke('agent:operation:retry', {
      sessionId: started.sessionId, batchId: undo.id, callIds: ['undo_intent_source']
    })
    if (retryUndo.ok) {
      const replayPreview = retryUndo.data
      await bridge.invoke('agent:operation:confirm', {
        sessionId: started.sessionId, batchId: replayPreview.id
      })
    }
    expect(retryUndo).toMatchObject({ ok: false })
    const afterRetry = data(await bridge.invoke('agent:session:read', { id: started.sessionId }))
    expect(afterRetry.operationBatches).toHaveLength(operationCountBeforeRetry)
    expect(afterRetry.operationBatches.find((batch) => batch.id === started.batchId)?.operations[0].undoStatus).toBe('available')
    expect(afterRetry.operationBatches.find((batch) => batch.id === undo.id)?.status).toBe('execution-failed')
    expect(afterRetry.operationBatches.find((batch) => batch.id === undo.id)?.attemptKind).toBe('undo')
    const movedPlan = JSON.parse(await fs.readFile(join(root, 'Moved undo intent source', 'plan.json'), 'utf8')) as { plan_id?: string }
    expect(JSON.stringify(movedPlan)).toBe(JSON.stringify(JSON.parse(originalPlanContents)))
    expect(createPlanAttempts).toBe(1)
    await expect(fs.stat(join(root, createdPath))).rejects.toMatchObject({ code: 'ENOENT' })
  }, 15000)

  it('resolves every retry ancestor when a grandchild attempt succeeds', async () => {
    await bridge.invoke('agent:policy:set', { mode: 'unrestricted' })
    const originalCreatePlan = storage.createPlan.bind(storage)
    let createAttempts = 0
    vi.spyOn(storage, 'createPlan').mockImplementation(async (...args) => {
      createAttempts += 1
      if (createAttempts <= 2) throw new Error('isolated nested attempt failure')
      return originalCreatePlan(...args)
    })
    const started = await startBatch({ title: 'Nested successful attempt', message: 'Create an object safely', targetRefs: [], calls: [
      { id: 'nested_success_source', name: 'plan.create', arguments: { name_part: 'Nested success source' } },
      { id: 'nested_success_tail', name: 'folder.create', arguments: { name: 'Nested success tail' } }
    ] })
    const source = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: source.id
    }))
    const child = data(await bridge.invoke('agent:operation:retry', {
      sessionId: started.sessionId, batchId: started.batchId, callIds: ['nested_success_source']
    }))
    const childPending = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: child.id }))
    data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: child.id
    }))
    const grandchild = data(await bridge.invoke('agent:operation:retry', {
      sessionId: started.sessionId, batchId: child.id, callIds: ['nested_success_source']
    }))
    const grandchildPending = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: grandchild.id }))
    const succeeded = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: grandchild.id
    }))
    expect(succeeded.operations[0].status).toBe('succeeded')
    const { AgentSessionRepository } = await import('../src/main/services/agent-session-repository')
    const reopened = await new AgentSessionRepository(directory).read(started.sessionId)
    for (const ancestorId of [started.batchId, child.id]) {
      expect(reopened.operationBatches.find((batch) => batch.id === ancestorId)?.operations[0].resolvedByAttempt).toBe(grandchild.id)
    }
    await expect(bridge.invoke('agent:operation:retry', {
      sessionId: started.sessionId, batchId: started.batchId, callIds: ['nested_success_source']
    })).resolves.toMatchObject({ ok: false })
    await expect(fs.stat(join(root, 'Nested success source'))).resolves.toBeTruthy()
  }, 15000)

  it('marks a successful create as reconciliation-required when post-write identity capture fails', async () => {
    const started = await startBatch({ title: 'Post-write capture failure', message: 'Create a plan', targetRefs: [], calls: [
      { id: 'post_write_capture', name: 'plan.create', arguments: { name_part: 'Post write capture' } }
    ] })
    const pending = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    const [{ AgentTargetService }] = await Promise.all([import('../src/main/services/agent-target-service')])
    vi.spyOn(AgentTargetService.prototype, 'captureAuditedTarget').mockRejectedValueOnce(new Error('isolated identity read failure'))

    const result = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    }))

    expect(await fs.stat(join(root, 'Post write capture'))).toBeTruthy()
    expect(result).toMatchObject({ status: 'reconciliation-required', operations: [{
      callId: 'post_write_capture', status: 'outcome-unknown', undoStatus: 'unavailable',
      reconciliationReason: 'post-side-effect-verification-failed'
    }] })
    expect(JSON.stringify(result)).not.toContain(root)
    const session = data(await bridge.invoke('agent:session:read', { id: started.sessionId }))
    const toolResult = session.messages.find((message) => message.role === 'tool' && message.toolCallId === 'post_write_capture')
    expect(toolResult?.content).toContain('post-side-effect-verification-failed')
    expect(toolResult?.content).toContain('人工核对')
    expect(toolResult?.content).toContain('不要重试或撤销')
    expect(toolResult?.content).not.toContain(root)
    await expect(bridge.invoke('agent:operation:retry', {
      sessionId: started.sessionId, batchId: started.batchId, callIds: ['post_write_capture']
    })).resolves.toMatchObject({ ok: false })
    await expect(bridge.invoke('agent:operation:continue', {
      sessionId: started.sessionId, batchId: started.batchId, callIds: ['post_write_capture']
    })).resolves.toMatchObject({ ok: false })
    await expect(bridge.invoke('agent:operation:undo', {
      sessionId: started.sessionId, batchId: started.batchId, callId: 'post_write_capture'
    })).resolves.toMatchObject({ ok: false })
    const persistedBatch = data(await bridge.invoke('agent:operation:read', {
      sessionId: started.sessionId, batchId: started.batchId
    }))
    expect(persistedBatch).toMatchObject({ status: 'reconciliation-required', operations: [{
      callId: 'post_write_capture', status: 'outcome-unknown', undoStatus: 'unavailable',
      reconciliationReason: 'post-side-effect-verification-failed'
    }] })
  }, 15000)

  it('marks a committed plan rename as reconciliation-required when target capture fails', async () => {
    const { updatedAt } = await writePlan()
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'plan', path: 'one' }] }))
    const target = targetSet.targets[0]
    const started = await startBatch({ title: 'Rename capture failure', message: '@one rename it', targetSetId: targetSet.id,
      targetRefs: [target.ref], calls: [{ id: 'rename_capture_failure', name: 'plan.rename', arguments: {
        target_ref: target.ref, expected_revision: target.revision, new_name: 'renamed-after-commit'
      } }] })
    const pending = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    const { AgentTargetService } = await import('../src/main/services/agent-target-service')
    vi.spyOn(AgentTargetService.prototype, 'captureAuditedTarget').mockRejectedValueOnce(new Error('isolated post-rename capture failure'))

    const result = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    }))

    await expect(fs.stat(join(root, 'renamed-after-commit', 'plan.json'))).resolves.toBeTruthy()
    expect(result).toMatchObject({ status: 'reconciliation-required', operations: [{
      status: 'outcome-unknown', reconciliationReason: 'post-side-effect-verification-failed'
    }] })
  }, 15000)

  it('marks a committed plan move as reconciliation-required when target capture fails', async () => {
    await writePlan()
    await fs.mkdir(join(root, 'destination'))
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [
      { kind: 'plan', path: 'one' }, { kind: 'folder', path: 'destination' }
    ] }))
    const source = targetSet.targets.find((target) => target.path === 'one')!
    const destination = targetSet.targets.find((target) => target.path === 'destination')!
    const started = await startBatch({ title: 'Move capture failure', message: '@one move to @destination', targetSetId: targetSet.id,
      targetRefs: [source.ref, destination.ref], calls: [{ id: 'move_capture_failure', name: 'plan.move', arguments: {
        target_ref: source.ref, expected_revision: source.revision, parent_ref: destination.ref
      } }] })
    const pending = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    const { AgentTargetService } = await import('../src/main/services/agent-target-service')
    vi.spyOn(AgentTargetService.prototype, 'captureAuditedTarget').mockRejectedValueOnce(new Error('isolated post-move capture failure'))

    const result = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    }))

    await expect(fs.stat(join(root, 'destination', 'one', 'plan.json'))).resolves.toBeTruthy()
    expect(result).toMatchObject({ status: 'reconciliation-required', operations: [{
      status: 'outcome-unknown', reconciliationReason: 'post-side-effect-verification-failed'
    }] })
  }, 15000)

  it('marks a committed component deletion as reconciliation-required when read-back fails', async () => {
    const { updatedAt, taskListId } = await writePlan()
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'plan', path: 'one' }] }))
    const target = targetSet.targets[0]
    const started = await startBatch({ title: 'Delete read-back failure', message: '@one delete the component', targetSetId: targetSet.id,
      targetRefs: [target.ref], calls: [{ id: 'delete_readback_failure', name: 'component.delete', arguments: {
        plan_ref: target.ref, component_id: taskListId, expected_updated_at: updatedAt
      } }] })
    const pending = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    const originalReadPlan = storage.readPlan.bind(storage)
    vi.spyOn(storage, 'readPlan').mockImplementation(async (...args) => {
      const document = await originalReadPlan(...args)
      if (args[0] === 'one' && !document.components.some((component) => component.id === taskListId)) {
        throw new Error('isolated post-delete read-back failure')
      }
      return document
    })

    const result = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    }))

    const disk = JSON.parse(await fs.readFile(join(root, 'one', 'plan.json'), 'utf8')) as { components: Array<{ id: string }> }
    expect(disk.components.some((component) => component.id === taskListId)).toBe(false)
    expect(result).toMatchObject({ status: 'reconciliation-required', operations: [{
      status: 'outcome-unknown', reconciliationReason: 'post-side-effect-verification-failed'
    }] })
  }, 15000)

  it('does not consume one confirmation token twice concurrently', async () => {
    const { updatedAt, taskListId } = await writePlan()
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'plan', path: 'one' }] }))
    const targetRef = targetSet.targets[0].ref
    const started = await startBatch({
      title: 'Double confirmation', message: 'Change this title', targetSetId: targetSet.id, targetRefs: [targetRef],
      calls: [{ id: 'call_double_confirm', name: 'component.update', arguments: {
        plan_ref: targetRef, component_id: taskListId, expected_updated_at: updatedAt, patch: { title: 'Confirmed edit' }
      } }]
    })
    const initialAssistantId = events.find((event) => event.requestId === started.requestId && event.type === 'terminal')?.assistantId
    const pending = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    const confirmation = { sessionId: started.sessionId, batchId: started.batchId }

    const [first, second] = await Promise.all([
      bridge.invoke('agent:operation:confirm', confirmation), bridge.invoke('agent:operation:confirm', confirmation)
    ])
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1)
    await until(() => events.some((event) => event.requestId === started.requestId && event.type === 'terminal' && event.assistantId !== initialAssistantId))
    const completed = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    expect(completed.operations[0].status).toBe('succeeded')
  }, 15000)

  it.each([
    { toolName: 'plan.create', callId: 'call_plan_create', arguments: { name_part: '.hidden' } },
    { toolName: 'folder.create', callId: 'call_folder_create', arguments: { name: '.hidden' } }
  ] as const)('rejects hidden path creation for $toolName before writing to disk', async ({ toolName, callId, arguments: args }) => {
    const started = await startBatch({
      title: 'Hidden path', message: 'Create a hidden child', targetRefs: [],
      calls: [{ id: callId, name: toolName, arguments: args }]
    })
    const initialAssistantId = events.find((event) => event.requestId === started.requestId && event.type === 'terminal')?.assistantId
    let batch = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    if (batch.status === 'pending-confirmation') {
      const confirmation = await bridge.invoke('agent:operation:confirm', {
        sessionId: started.sessionId, batchId: started.batchId
      })
      expect(confirmation.ok).toBe(true)
      await until(() => events.some((event) => event.requestId === started.requestId && event.type === 'terminal' && event.assistantId !== initialAssistantId))
      batch = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    }

    const pathExists = await fs.stat(join(root, '.hidden')).then(() => true, () => false)
    expect(batch.status).toBe('preflight-failed')
    expect(batch.operations[0].status).toBe('failed')
    expect(pathExists).toBe(false)
  }, 15000)

  it('allows a structural operation and an independent component edit in one ordered batch', async () => {
    const { taskListId } = await writePlan()
    const secondPlanId = 'c'.repeat(32)
    const secondRevision = '2026-10-04T00:00:00.000Z'
    await fs.mkdir(join(root, 'two'), { recursive: true })
    await fs.mkdir(join(root, 'destination'), { recursive: true })
    await fs.writeFile(join(root, 'two', 'plan.json'), JSON.stringify({
      format_version: '1', created_at: secondRevision, updated_at: secondRevision,
      components: [{ id: secondPlanId, type: 'task_list', payload: { title: 'Independent', items: [] } }]
    }))
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [
      { kind: 'plan', path: 'one' }, { kind: 'plan', path: 'two' }, { kind: 'folder', path: 'destination' }
    ] }))
    const source = targetSet.targets.find((target) => target.path === 'one')!
    const independentPlan = targetSet.targets.find((target) => target.path === 'two')!
    const destination = targetSet.targets.find((target) => target.path === 'destination')!
    data(await bridge.invoke('agent:policy:set', { mode: 'unrestricted' }))
    server.removeAllListeners('request')
    let requestCount = 0
    server.on('request', (_request, response) => {
      response.setHeader('content-type', 'text/event-stream')
      if (requestCount++ === 0) {
        response.end(frame([
          { id: 'call_move', name: 'plan.move', arguments: { target_ref: source.ref, expected_revision: source.revision, parent_ref: destination.ref } },
          { id: 'call_edit', name: 'component.update', arguments: { plan_ref: independentPlan.ref, component_id: secondPlanId, expected_updated_at: '2026-10-04T00:00:00.000Z', patch: { title: 'Independent edit' } } }
        ]))
      } else {
        response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Independent operations completed.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
      }
    })
    const session = data(await bridge.invoke('agent:session:create', { title: 'Independent operations', profileId }))
    const preview = data(await bridge.invoke('agent:preview:create', {
      sessionId: session.id, message: 'Move one plan and edit another', selections: [],
      targetGrantSetId: targetSet.id, targetRefs: [source.ref, independentPlan.ref, destination.ref]
    })) as AgentOutboundPreview
    const identity = data(await bridge.invoke('agent:request:send', { token: preview.token, sessionId: session.id })) as AgentRequestIdentity
    await until(() => events.some((event) => event.requestId === identity.requestId && event.type === 'terminal'))
    const initialSession = data(await bridge.invoke('agent:session:read', { id: session.id }))
    const pendingBatch = data(await bridge.invoke('agent:operation:read', { sessionId: session.id, batchId: initialSession.operationBatches[0].id }))
    expect(pendingBatch).toMatchObject({ status: 'pending-confirmation', requiredConfirmation: true })
    expect(pendingBatch.operations.map((item) => item.status)).toEqual(['ready', 'ready'])
    const confirmResult = await bridge.invoke('agent:operation:confirm', {
      sessionId: session.id, batchId: pendingBatch.id
    })
    expect(confirmResult.ok).toBe(true)
    await until(() => events.some((event) => event.requestId === identity.requestId && event.type === 'terminal' && event.assistantId !== identity.assistantId))

    const completedBatch = data(await bridge.invoke('agent:operation:read', { sessionId: session.id, batchId: pendingBatch.id }))
    const movedPlan = JSON.parse(await fs.readFile(join(root, 'destination', 'one', 'plan.json'), 'utf8')) as { components: Array<{ id: string }> }
    const editedPlan = JSON.parse(await fs.readFile(join(root, 'two', 'plan.json'), 'utf8')) as { components: Array<{ payload: { title?: string } }> }
    expect(completedBatch.operations.map((item) => item.status)).toEqual(['succeeded', 'succeeded'])
    expect(movedPlan.components[0].id).toBe(taskListId)
    expect(editedPlan.components[0].payload.title).toBe('Independent edit')
    expect(requestCount).toBe(2)
  }, 15000)

  it('continues only selected not-executed calls after a source-batch successful prefix', async () => {
    const { updatedAt, taskListId } = await writePlan()
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'plan', path: 'one' }] }))
    const targetRef = targetSet.targets[0].ref
    data(await bridge.invoke('agent:policy:set', { mode: 'unrestricted' }))
    const originalSave = storage.savePlan.bind(storage)
    let saveCount = 0
    vi.spyOn(storage, 'savePlan').mockImplementation(async (...args) => {
      saveCount += 1
      if (saveCount === 2) {
        const { ERR, TraceError } = await import('../src/shared/errors')
        throw new TraceError(ERR.SAVE_FAILED, 'isolated middle write failure')
      }
      return originalSave(...args)
    })
    const started = await startBatch({ title: 'Continue unexecuted', message: 'Apply in order', targetSetId: targetSet.id, targetRefs: [targetRef], calls: [
      { id: 'continue_a1', name: 'component.update', arguments: { plan_ref: targetRef, component_id: taskListId, expected_updated_at: updatedAt, patch: { title: 'Prefix' } } },
      { id: 'continue_b1', name: 'component.update', arguments: { plan_ref: targetRef, component_id: taskListId, expected_updated_at: updatedAt, patch: { title: 'Failed middle' } } },
      { id: 'continue_a2', name: 'component.update', arguments: { plan_ref: targetRef, component_id: taskListId, expected_updated_at: updatedAt, patch: { title: 'Continued tail' } } }
    ] })
    const original = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    const sourceConfirmed = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    }))
    expect(sourceConfirmed.operations.map((item) => item.status)).toEqual(['succeeded', 'failed', 'not-executed'])
    const sourceRevision = sourceConfirmed.operations[0].afterUpdatedAt
    expect(sourceRevision).toBeTruthy()

    const continued = data(await bridge.invoke('agent:operation:continue', {
      sessionId: started.sessionId, batchId: started.batchId, callIds: ['continue_a2']
    }))
    expect(continued).toMatchObject({ attemptOf: started.batchId, attemptKind: 'continue', status: 'pending-confirmation', requiredConfirmation: true })
    expect(continued.operations.map((item) => item.callId)).toEqual(['continue_a2'])
    expect(continued.operations[0].beforeUpdatedAt).toBe(sourceRevision)
    expect(saveCount).toBe(2)
    const requestCountBeforeAttemptConfirm = started.getRequestCount()
    const attempt = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: continued.id
    }))
    expect(attempt.operations.map((item) => item.status)).toEqual(['succeeded'])
    expect(saveCount).toBe(3)
    expect(started.getRequestCount()).toBe(requestCountBeforeAttemptConfirm)
    const savedPlan = JSON.parse(await fs.readFile(join(root, 'one', 'plan.json'), 'utf8')) as { components: Array<{ payload: { title: string } }> }
    expect(savedPlan.components[0].payload.title).toBe('Continued tail')
    const session = data(await bridge.invoke('agent:session:read', { id: started.sessionId }))
    const callResults = session.messages.filter((message) => message.role === 'tool' && message.toolCallId?.startsWith('continue_'))
    expect(callResults.map((message) => message.toolCallId)).toEqual(['continue_a1', 'continue_b1', 'continue_a2'])
  }, 15000)

  it('retries only failed calls and refuses to replay or reauthorize successful calls', async () => {
    const { updatedAt, taskListId } = await writePlan()
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'plan', path: 'one' }] }))
    const targetRef = targetSet.targets[0].ref
    data(await bridge.invoke('agent:policy:set', { mode: 'unrestricted' }))
    const originalSave = storage.savePlan.bind(storage)
    let saveCount = 0
    vi.spyOn(storage, 'savePlan').mockImplementation(async (...args) => {
      saveCount += 1
      if (saveCount === 1) {
        const { ERR, TraceError } = await import('../src/shared/errors')
        throw new TraceError(ERR.SAVE_FAILED, 'isolated first write failure')
      }
      return originalSave(...args)
    })
    const started = await startBatch({ title: 'Retry failed', message: '@one update the title', targetSetId: targetSet.id, targetRefs: [targetRef], calls: [
      { id: 'retry_one', name: 'component.update', arguments: { plan_ref: targetRef, component_id: taskListId, expected_updated_at: updatedAt, patch: { title: 'Retried title' } } }
    ] })
    const original = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    expect(original.status).toBe('pending-confirmation')
    const initialFailure = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    }))
    expect(initialFailure.status).toBe('execution-failed')
    const failedOriginal = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    expect(failedOriginal.operations[0].status).toBe('failed')

    const oversizedRetry = await bridge.invoke('agent:operation:retry', {
      sessionId: started.sessionId,
      batchId: started.batchId,
      callIds: Array.from({ length: 21 }, (_, index) => `retry_${index}`)
    })
    const { ERR } = await import('../src/shared/errors')
    expect(oversizedRetry).toMatchObject({ ok: false, code: ERR.VALIDATION, message: '操作批次重试请求无效' })

    const retried = data(await bridge.invoke('agent:operation:retry', {
      sessionId: started.sessionId, batchId: started.batchId, callIds: ['retry_one']
    }))
    expect(retried).toMatchObject({ attemptOf: started.batchId, attemptKind: 'retry', status: 'pending-confirmation', requiredConfirmation: true })
    expect(retried.operations.map((item) => item.callId)).toEqual(['retry_one'])
    expect(saveCount).toBe(1)
    const attempt = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: retried.id
    }))
    expect(attempt.operations[0].status).toBe('succeeded')
    expect(saveCount).toBe(2)
    const savedPlan = JSON.parse(await fs.readFile(join(root, 'one', 'plan.json'), 'utf8')) as { components: Array<{ payload: { title: string } }> }
    expect(savedPlan.components[0].payload.title).toBe('Retried title')
    const session = data(await bridge.invoke('agent:session:read', { id: started.sessionId }))
    expect(session.messages.filter((message) => message.role === 'tool' && message.toolCallId === 'retry_one')).toHaveLength(1)
    await expect(bridge.invoke('agent:operation:retry', { sessionId: started.sessionId, batchId: started.batchId, callIds: ['retry_one'] }))
      .resolves.toMatchObject({ ok: false })
  }, 15000)

  it('undoes a supported component edit only after a new local confirmation', async () => {
    const { updatedAt, taskListId } = await writePlan()
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'plan', path: 'one' }] }))
    const targetRef = targetSet.targets[0].ref
    const started = await startBatch({ title: 'Undo component edit', message: 'Change the title', targetSetId: targetSet.id, targetRefs: [targetRef], calls: [
      { id: 'undo_source', name: 'component.update', arguments: { plan_ref: targetRef, component_id: taskListId, expected_updated_at: updatedAt, patch: { title: 'Changed title' } } }
    ] })
    const original = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    const source = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    }))
    expect(source.operations[0]).toMatchObject({ status: 'succeeded', undoStatus: 'available' })
    const changed = JSON.parse(await fs.readFile(join(root, 'one', 'plan.json'), 'utf8')) as { components: Array<{ payload: { title: string } }> }
    expect(changed.components[0].payload.title).toBe('Changed title')

    const undo = data(await bridge.invoke('agent:operation:undo', { sessionId: started.sessionId, batchId: started.batchId, callId: 'undo_source' }))
    expect(undo).toMatchObject({ attemptOf: started.batchId, attemptKind: 'undo', status: 'pending-confirmation', requiredConfirmation: true })
    expect(JSON.parse(await fs.readFile(join(root, 'one', 'plan.json'), 'utf8')).components[0].payload.title).toBe('Changed title')
    const undone = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: undo.id
    }))
    expect(undone.operations[0].status).toBe('succeeded')
    const savedPlan = JSON.parse(await fs.readFile(join(root, 'one', 'plan.json'), 'utf8')) as { components: Array<{ payload: { title: string } }> }
    expect(savedPlan.components[0].payload.title).toBe('Tasks')
    const finalSession = data(await bridge.invoke('agent:session:read', { id: started.sessionId }))
    const sourceBatch = finalSession.operationBatches.find((batch) => batch.id === started.batchId)
    expect(sourceBatch?.operations[0].undoStatus).toBe('undone')
    expect(finalSession.messages.filter((message) => message.role === 'tool' && message.toolCallId === 'undo_source')).toHaveLength(1)
  }, 15000)

  it('undoes a plan creation by moving only the created plan into the recycle bin', async () => {
    await writePlan()
    const started = await startBatch({ title: 'Undo plan creation', message: 'Create a plan', targetRefs: [], calls: [
      { id: 'create_undo_source', name: 'plan.create', arguments: { name_part: 'Created by Xiaoyuan' } }
    ] })
    const pending = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    const created = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    }))
    expect(created.operations[0]).toMatchObject({ status: 'succeeded', undoStatus: 'available', targetKind: 'plan' })
    const createdPathChange = created.operations[0].changes.find((item) => item.field === 'created_path')
    expect(createdPathChange?.after ? JSON.parse(createdPathChange.after) : null).toBe('Created by Xiaoyuan')
    const createdPlan = JSON.parse(await fs.readFile(join(root, 'Created by Xiaoyuan', 'plan.json'), 'utf8')) as { updated_at: string }
    expect(createdPlan.updated_at).toBeTruthy()

    const duplicateRequests = await Promise.all([
      bridge.invoke('agent:operation:undo', { sessionId: started.sessionId, batchId: started.batchId, callId: 'create_undo_source' }),
      bridge.invoke('agent:operation:undo', { sessionId: started.sessionId, batchId: started.batchId, callId: 'create_undo_source' })
    ])
    const acceptedUndo = duplicateRequests.find((result) => result.ok)
    const rejectedUndo = duplicateRequests.find((result) => !result.ok)
    expect(acceptedUndo).toBeTruthy()
    expect(rejectedUndo).toMatchObject({ ok: false })
    const undo = data(acceptedUndo!)
    expect(undo).toMatchObject({ attemptOf: started.batchId, attemptKind: 'undo', status: 'pending-confirmation', requiredConfirmation: true })
    await expect(bridge.invoke('agent:operation:undo', { sessionId: started.sessionId, batchId: started.batchId, callId: 'create_undo_source' }))
      .resolves.toMatchObject({ ok: false })
    const pendingUndoBatches = data(await bridge.invoke('agent:session:read', { id: started.sessionId })).operationBatches
      .filter((batch) => batch.attemptOf === started.batchId && batch.attemptKind === 'undo' && batch.status === 'pending-confirmation')
    expect(pendingUndoBatches).toHaveLength(1)
    await expect(fs.stat(join(root, 'Created by Xiaoyuan'))).resolves.toBeTruthy()
    const undone = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: undo.id
    }))
    expect(undone.operations[0].status).toBe('succeeded')
    await expect(fs.stat(join(root, 'Created by Xiaoyuan'))).rejects.toMatchObject({ code: 'ENOENT' })
    const entries = await storage.listTrashEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ kind: 'plan', original_relative_path: 'Created by Xiaoyuan', can_restore: true })
    expect(created.operations[0].targetStableId).toBeTruthy()
  }, 15000)

  it('requires a decision for every reference before undoing a created plan', async () => {
    await writePlan()
    const started = await startBatch({ title: 'Undo referenced creation', message: 'Create a plan', targetRefs: [], calls: [
      { id: 'referenced_create_source', name: 'plan.create', arguments: { name_part: 'Referenced creation' } }
    ] })
    const pending = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    const created = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    }))
    const targetPlan = data(await bridge.invoke('plan-reference:commitTarget', {
      library_id: libraryId, path: 'Referenced creation', mode: 'link'
    }))
    const referenceComponentId = 'c'.repeat(32)
    const referencePath = 'Reference source'
    const timestamp = '2026-10-04T00:00:00.000Z'
    await fs.mkdir(join(root, referencePath))
    await fs.writeFile(join(root, referencePath, 'plan.json'), JSON.stringify({
      format_version: '1', created_at: timestamp, updated_at: timestamp,
      components: [{ id: referenceComponentId, type: 'plan_reference', payload: {
        mode: 'link', target_plan_id: targetPlan.plan_id,
        target_path_snapshot: 'Referenced creation', target_name_snapshot: 'Referenced creation'
      } }]
    }))
    const deniedUndo = data(await bridge.invoke('agent:operation:undo', {
      sessionId: started.sessionId, batchId: started.batchId, callId: 'referenced_create_source'
    }))
    await expect(bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: deniedUndo.id
    })).resolves.toMatchObject({ ok: false })
    await expect(fs.stat(join(root, 'Referenced creation'))).resolves.toBeTruthy()

    const preview = deniedUndo.confirmationPreview
    expect(preview?.references).toEqual([{
      callId: 'referenced_create_source', sourcePath: referencePath, sourceComponentId: referenceComponentId,
      mode: 'link', targetNameSnapshot: 'Referenced creation', allowedActions: ['keep', 'replace']
    }])
    const persistedUndo = data(await bridge.invoke('agent:session:read', { id: started.sessionId })).operationBatches
      .find((batch) => batch.id === deniedUndo.id)
    expect(persistedUndo).not.toHaveProperty('confirmationPreview')
    expect(data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: deniedUndo.id }))
      .confirmationPreview).toEqual(preview)
    const undone = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: deniedUndo.id, decisions: [{
        callId: 'referenced_create_source',
        referenceDecisions: [{ sourcePath: referencePath, sourceComponentId: referenceComponentId, action: 'keep' }]
      }]
    }))
    expect(undone.operations[0].status).toBe('succeeded')
    await expect(fs.stat(join(root, 'Referenced creation'))).rejects.toMatchObject({ code: 'ENOENT' })
    const savedReference = JSON.parse(await fs.readFile(join(root, referencePath, 'plan.json'), 'utf8')) as {
      components: Array<{ payload: { target_plan_id: string } }>
    }
    expect(savedReference.components[0].payload.target_plan_id).toBe(targetPlan.plan_id)
    expect(created.operations[0].undoStatus).toBe('available')
    expect(data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: deniedUndo.id })))
      .not.toHaveProperty('confirmationPreview')
  }, 15000)

  it('rejects a create undo when the frozen target snapshot changed before confirmation', async () => {
    await writePlan()
    const started = await startBatch({ title: 'Stale create undo', message: 'Create a plan', targetRefs: [], calls: [
      { id: 'stale_create_source', name: 'plan.create', arguments: { name_part: 'Stale creation' } }
    ] })
    const pending = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    const created = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    }))
    const undo = data(await bridge.invoke('agent:operation:undo', {
      sessionId: started.sessionId, batchId: started.batchId, callId: 'stale_create_source'
    }))

    const currentPlan = JSON.parse(await fs.readFile(join(root, 'Stale creation', 'plan.json'), 'utf8')) as {
      updated_at: string; components: Array<Record<string, unknown>>
    }
    currentPlan.components.push({ id: 'd'.repeat(32), type: 'note', payload: { content: 'Retained user edit' } })
    await storage.savePlan('Stale creation', currentPlan, currentPlan.updated_at)

    const stale = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: undo.id
    }))
    expect(stale).toMatchObject({ status: 'execution-failed', operations: [{ status: 'failed', errorCategory: 'conflict' }] })
    await expect(fs.stat(join(root, 'Stale creation'))).resolves.toBeTruthy()
    expect(await storage.listTrashEntries()).toHaveLength(0)
    expect(created.operations[0].undoStatus).toBe('available')
  }, 15000)

  it('undoes a plan rename using a fresh inverse preview and queue commit', async () => {
    const { updatedAt } = await writePlan()
    const targetPlan = data(await bridge.invoke('plan-reference:commitTarget', {
      library_id: libraryId, path: 'one', mode: 'link'
    }))
    const referenceSourcePath = 'plan-rename-reference-source'
    const referenceComponentId = 'e'.repeat(32)
    await fs.mkdir(join(root, referenceSourcePath))
    await fs.writeFile(join(root, referenceSourcePath, 'plan.json'), JSON.stringify({
      format_version: '1', plan_id: 'f'.repeat(32), created_at: updatedAt, updated_at: updatedAt,
      components: [{ id: referenceComponentId, type: 'plan_reference', payload: {
        mode: 'link', target_plan_id: targetPlan.plan_id,
        target_path_snapshot: 'one', target_name_snapshot: 'one'
      } }]
    }))
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'plan', path: 'one' }] }))
    const target = targetSet.targets[0]
    const started = await startBatch({ title: 'Undo plan rename', message: '@one rename it', targetSetId: targetSet.id,
      targetRefs: [target.ref], calls: [
        { id: 'rename_undo_source', name: 'plan.rename', arguments: {
          target_ref: target.ref, expected_revision: target.revision, new_name: 'renamed'
        } }
      ] })
    const pending = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    expect(pending.confirmationPreview?.references).toEqual([{
      callId: 'rename_undo_source', sourcePath: referenceSourcePath,
      sourceComponentId: referenceComponentId, mode: 'link', targetNameSnapshot: 'one', allowedActions: ['update', 'keep']
    }])
    const renamed = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId,
      decisions: [{ callId: 'rename_undo_source', renameAction: 'update' }]
    }))
    expect(renamed.operations[0]).toMatchObject({ status: 'succeeded', undoStatus: 'available', targetPath: 'renamed' })

    const undo = data(await bridge.invoke('agent:operation:undo', {
      sessionId: started.sessionId, batchId: started.batchId, callId: 'rename_undo_source'
    }))
    expect(undo).toMatchObject({ attemptKind: 'undo', status: 'pending-confirmation', requiredConfirmation: true })
    expect(undo.confirmationPreview?.references).toEqual([{
      callId: 'rename_undo_source', sourcePath: referenceSourcePath,
      sourceComponentId: referenceComponentId, mode: 'link', targetNameSnapshot: 'renamed', allowedActions: ['update', 'keep']
    }])
    const undone = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: undo.id,
      decisions: [{ callId: 'rename_undo_source', renameAction: 'update' }]
    }))
    expect(undone.operations[0].status).toBe('succeeded')
    await expect(fs.stat(join(root, 'one', 'plan.json'))).resolves.toBeTruthy()
    await expect(fs.stat(join(root, 'renamed'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
      .operations[0].undoStatus).toBe('undone')
    const restoredReference = JSON.parse(await fs.readFile(join(root, referenceSourcePath, 'plan.json'), 'utf8')) as {
      components: Array<{ payload: { target_path_snapshot: string; target_name_snapshot: string } }>
    }
    expect(restoredReference.components[0].payload).toMatchObject({ target_path_snapshot: 'one', target_name_snapshot: 'one' })
  }, 15000)

  it('undoes a plan move to its original parent using a fresh inverse preview and queue commit', async () => {
    const { updatedAt, taskListId } = await writePlan()
    await fs.mkdir(join(root, 'destination'))
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [
      { kind: 'plan', path: 'one' }, { kind: 'folder', path: 'destination' }
    ] }))
    const source = targetSet.targets.find((target) => target.path === 'one')!
    const destination = targetSet.targets.find((target) => target.path === 'destination')!
    const started = await startBatch({ title: 'Undo plan move', message: '@one move it', targetSetId: targetSet.id,
      targetRefs: [source.ref, destination.ref], calls: [
        { id: 'move_undo_source', name: 'plan.move', arguments: {
          target_ref: source.ref, expected_revision: source.revision, parent_ref: destination.ref
        } }
      ] })
    const pending = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    const moved = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    }))
    expect(moved.operations[0]).toMatchObject({ status: 'succeeded', undoStatus: 'available', targetPath: 'destination/one' })
    expect(JSON.parse(await fs.readFile(join(root, 'destination', 'one', 'plan.json'), 'utf8')).components[0].id).toBe(taskListId)

    const undo = data(await bridge.invoke('agent:operation:undo', {
      sessionId: started.sessionId, batchId: started.batchId, callId: 'move_undo_source'
    }))
    expect(undo).toMatchObject({ attemptKind: 'undo', status: 'pending-confirmation', requiredConfirmation: true })
    const undone = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: undo.id
    }))
    expect(undone.operations[0].status).toBe('succeeded')
    const restored = JSON.parse(await fs.readFile(join(root, 'one', 'plan.json'), 'utf8')) as {
      updated_at: string; components: Array<{ id: string }>
    }
    expect(restored.components[0].id).toBe(taskListId)
    expect(restored.updated_at).toBe(updatedAt)
    await expect(fs.stat(join(root, 'destination', 'one'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
      .operations[0].undoStatus).toBe('undone')
  }, 15000)

  it('undoes a plan deletion by restoring the exact originating trash entry', async () => {
    const { taskListId } = await writePlan()
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'plan', path: 'one' }] }))
    const target = targetSet.targets[0]
    const started = await startBatch({ title: 'Undo plan deletion', message: '@one delete it', targetSetId: targetSet.id,
      targetRefs: [target.ref], calls: [
        { id: 'trash_undo_source', name: 'plan.trash', arguments: { target_ref: target.ref, expected_revision: target.revision } }
      ] })
    const pending = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    const trashed = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    }))
    expect(trashed.operations[0]).toMatchObject({ status: 'succeeded', undoStatus: 'available', trashEntryId: expect.any(String) })
    await expect(fs.stat(join(root, 'one'))).rejects.toMatchObject({ code: 'ENOENT' })
    await fs.mkdir(join(root, 'two'))
    await fs.writeFile(join(root, 'two', 'plan.json'), JSON.stringify({
      format_version: '1', created_at: '2026-10-04T00:00:00.000Z', updated_at: '2026-10-04T00:00:00.000Z',
      components: [{ id: 'e'.repeat(32), type: 'task_list', payload: { title: 'Other plan', items: [] } }]
    }))
    const unrelatedEntry = await storage.trashPlan('two')
    expect(await storage.listTrashEntries()).toHaveLength(2)

    const undo = data(await bridge.invoke('agent:operation:undo', {
      sessionId: started.sessionId, batchId: started.batchId, callId: 'trash_undo_source'
    }))
    expect(undo).toMatchObject({ attemptKind: 'undo', status: 'pending-confirmation', requiredConfirmation: true })
    const undone = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: undo.id
    }))
    expect(undone.operations[0].status).toBe('succeeded')
    expect(JSON.parse(await fs.readFile(join(root, 'one', 'plan.json'), 'utf8')).components[0].id).toBe(taskListId)
    expect(data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
      .operations[0].undoStatus).toBe('undone')
    const entries = await storage.listTrashEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe(unrelatedEntry.id)
    expect(entries.some((entry) => entry.id === trashed.operations[0].trashEntryId)).toBe(false)
  }, 15000)

  it('undoes a folder rename with aggregate reference preview and queue commit', async () => {
    await fs.mkdir(join(root, 'source-folder', 'inside'), { recursive: true })
    await fs.writeFile(join(root, 'source-folder', 'inside', 'plan.json'), JSON.stringify({
      format_version: '1', created_at: '2026-10-04T00:00:00.000Z', updated_at: '2026-10-04T00:00:00.000Z', components: []
    }))
    const targetPlan = data(await bridge.invoke('plan-reference:commitTarget', {
      library_id: libraryId, path: 'source-folder/inside', mode: 'link'
    }))
    const referenceSourcePath = 'reference-source'
    const referenceComponentId = 'f'.repeat(32)
    await fs.mkdir(join(root, referenceSourcePath))
    await fs.writeFile(join(root, referenceSourcePath, 'plan.json'), JSON.stringify({
      format_version: '1', created_at: '2026-10-04T00:00:00.000Z', updated_at: '2026-10-04T00:00:00.000Z',
      components: [{ id: referenceComponentId, type: 'plan_reference', payload: {
        mode: 'link', target_plan_id: targetPlan.plan_id,
        target_path_snapshot: 'source-folder/inside', target_name_snapshot: 'inside'
      } }]
    }))
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'folder', path: 'source-folder' }] }))
    const target = targetSet.targets[0]
    const started = await startBatch({ title: 'Undo folder rename', message: '@source-folder rename it', targetSetId: targetSet.id,
      targetRefs: [target.ref], calls: [
        { id: 'folder_rename_undo_source', name: 'folder.rename', arguments: {
          target_ref: target.ref, expected_revision: target.revision, new_name: 'renamed-folder'
        } }
      ] })
    const pending = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    expect(pending.confirmationPreview?.references).toEqual([{
      callId: 'folder_rename_undo_source', sourcePath: referenceSourcePath,
      sourceComponentId: referenceComponentId, mode: 'link', targetNameSnapshot: 'inside', allowedActions: ['update', 'keep']
    }])
    await expect(bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: pending.id,
      decisions: [{ callId: 'folder_rename_undo_source', renameAction: 'invalid' as 'keep' }]
    })).resolves.toMatchObject({ ok: false })
    await expect(bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: pending.id
    })).resolves.toMatchObject({ ok: false })
    expect(data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: pending.id })).status)
      .toBe('pending-confirmation')
    await expect(fs.stat(join(root, 'source-folder'))).resolves.toBeTruthy()
    const renamed = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId,
      decisions: [{ callId: 'folder_rename_undo_source', renameAction: 'keep' }]
    }))
    expect(renamed.operations[0].status, JSON.stringify(renamed.operations[0])).toBe('succeeded')
    expect(renamed.operations[0]).toMatchObject({ undoStatus: 'available', targetPath: 'renamed-folder' })
    const undo = data(await bridge.invoke('agent:operation:undo', {
      sessionId: started.sessionId, batchId: started.batchId, callId: 'folder_rename_undo_source'
    }))
    expect(undo.confirmationPreview?.references).toEqual([{
      callId: 'folder_rename_undo_source', sourcePath: referenceSourcePath,
      sourceComponentId: referenceComponentId, mode: 'link', targetNameSnapshot: 'inside', allowedActions: ['update', 'keep']
    }])
    await expect(bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: undo.id
    })).resolves.toMatchObject({ ok: false })
    await expect(fs.stat(join(root, 'renamed-folder'))).resolves.toBeTruthy()
    const undone = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: undo.id,
      decisions: [{ callId: 'folder_rename_undo_source', renameAction: 'update' }]
    }))
    expect(undone.operations[0].status).toBe('succeeded')
    await expect(fs.stat(join(root, 'source-folder', 'inside', 'plan.json'))).resolves.toBeTruthy()
    await expect(fs.stat(join(root, 'renamed-folder'))).rejects.toMatchObject({ code: 'ENOENT' })
    const restoredReference = JSON.parse(await fs.readFile(join(root, referenceSourcePath, 'plan.json'), 'utf8')) as {
      components: Array<{ payload: { target_path_snapshot: string; target_name_snapshot: string } }>
    }
    expect(restoredReference.components[0].payload).toMatchObject({
      target_path_snapshot: 'source-folder/inside', target_name_snapshot: 'inside'
    })
    expect(data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
      .operations[0].undoStatus).toBe('undone')
  }, 15000)

  it('undoes a folder move to its original parent with a fresh preview and queue commit', async () => {
    await fs.mkdir(join(root, 'source-folder', 'inside'), { recursive: true })
    await fs.mkdir(join(root, 'destination'))
    await fs.writeFile(join(root, 'source-folder', 'inside', 'plan.json'), JSON.stringify({
      format_version: '1', created_at: '2026-10-04T00:00:00.000Z', updated_at: '2026-10-04T00:00:00.000Z', components: []
    }))
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [
      { kind: 'folder', path: 'source-folder' }, { kind: 'folder', path: 'destination' }
    ] }))
    const source = targetSet.targets.find((target) => target.path === 'source-folder')!
    const destination = targetSet.targets.find((target) => target.path === 'destination')!
    const started = await startBatch({ title: 'Undo folder move', message: '@source-folder move it', targetSetId: targetSet.id,
      targetRefs: [source.ref, destination.ref], calls: [
        { id: 'folder_move_undo_source', name: 'folder.move', arguments: {
          target_ref: source.ref, expected_revision: source.revision, parent_ref: destination.ref
        } }
      ] })
    const pending = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    const moved = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    }))
    expect(moved.operations[0]).toMatchObject({ status: 'succeeded', undoStatus: 'available', targetPath: 'destination/source-folder' })
    const undo = data(await bridge.invoke('agent:operation:undo', {
      sessionId: started.sessionId, batchId: started.batchId, callId: 'folder_move_undo_source'
    }))
    const undone = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: undo.id
    }))
    expect(undone.operations[0].status).toBe('succeeded')
    await expect(fs.stat(join(root, 'source-folder', 'inside', 'plan.json'))).resolves.toBeTruthy()
    await expect(fs.stat(join(root, 'destination', 'source-folder'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
      .operations[0].undoStatus).toBe('undone')
  }, 15000)

  it('rejects a folder move undo when a descendant plan changes after the frozen preview', async () => {
    await fs.mkdir(join(root, 'source-folder', 'inside'), { recursive: true })
    await fs.mkdir(join(root, 'destination'))
    await fs.writeFile(join(root, 'source-folder', 'inside', 'plan.json'), JSON.stringify({
      format_version: '1', created_at: '2026-10-04T00:00:00.000Z', updated_at: '2026-10-04T00:00:00.000Z', components: []
    }))
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [
      { kind: 'folder', path: 'source-folder' }, { kind: 'folder', path: 'destination' }
    ] }))
    const source = targetSet.targets.find((target) => target.path === 'source-folder')!
    const destination = targetSet.targets.find((target) => target.path === 'destination')!
    const started = await startBatch({ title: 'Stale folder move undo', message: '@source-folder move it', targetSetId: targetSet.id,
      targetRefs: [source.ref, destination.ref], calls: [
        { id: 'stale_folder_move_source', name: 'folder.move', arguments: {
          target_ref: source.ref, expected_revision: source.revision, parent_ref: destination.ref
        } }
      ] })
    const pending = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    const moved = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    }))
    expect(moved.operations[0].status).toBe('succeeded')
    const undo = data(await bridge.invoke('agent:operation:undo', {
      sessionId: started.sessionId, batchId: started.batchId, callId: 'stale_folder_move_source'
    }))

    const descendant = await storage.readPlan('destination/source-folder/inside')
    descendant.components.push({ id: '1'.repeat(32), type: 'note', payload: { content: 'Preserve concurrent edit' } })
    await storage.savePlan('destination/source-folder/inside', descendant, descendant.updated_at)
    const stale = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: undo.id
    }))
    expect(stale).toMatchObject({ status: 'execution-failed', operations: [{ status: 'failed', errorCategory: 'conflict' }] })
    await expect(fs.stat(join(root, 'destination', 'source-folder', 'inside', 'plan.json'))).resolves.toBeTruthy()
    await expect(fs.stat(join(root, 'source-folder'))).rejects.toMatchObject({ code: 'ENOENT' })
    const retained = await storage.readPlan('destination/source-folder/inside')
    expect(retained.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '1'.repeat(32), payload: { content: 'Preserve concurrent edit' } })
    ]))
    expect(data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
      .operations[0].undoStatus).toBe('available')
  }, 15000)

  it('rejects a plan move undo when its original destination becomes occupied', async () => {
    const { taskListId } = await writePlan()
    await fs.mkdir(join(root, 'destination'))
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [
      { kind: 'plan', path: 'one' }, { kind: 'folder', path: 'destination' }
    ] }))
    const source = targetSet.targets.find((target) => target.path === 'one')!
    const destination = targetSet.targets.find((target) => target.path === 'destination')!
    const started = await startBatch({ title: 'Conflicting plan move undo', message: '@one move it', targetSetId: targetSet.id,
      targetRefs: [source.ref, destination.ref], calls: [
        { id: 'conflicting_plan_move_source', name: 'plan.move', arguments: {
          target_ref: source.ref, expected_revision: source.revision, parent_ref: destination.ref
        } }
      ] })
    const pending = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    const moved = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    }))
    expect(moved.operations[0].status).toBe('succeeded')
    const undo = data(await bridge.invoke('agent:operation:undo', {
      sessionId: started.sessionId, batchId: started.batchId, callId: 'conflicting_plan_move_source'
    }))

    await writePlan()
    const conflict = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: undo.id
    }))
    expect(conflict).toMatchObject({ status: 'execution-failed', operations: [{ status: 'failed', errorCategory: 'name-conflict' }] })
    const keptAtDestination = await storage.readPlan('destination/one')
    expect(keptAtDestination.components[0].id).toBe(taskListId)
    expect(await storage.readPlan('one')).toBeTruthy()
    expect(data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
      .operations[0].undoStatus).toBe('available')
  }, 15000)

  it('undoes a folder deletion by restoring its exact originating trash entry', async () => {
    await fs.mkdir(join(root, 'source-folder', 'inside'), { recursive: true })
    await fs.writeFile(join(root, 'source-folder', 'inside', 'plan.json'), JSON.stringify({
      format_version: '1', created_at: '2026-10-04T00:00:00.000Z', updated_at: '2026-10-04T00:00:00.000Z', components: []
    }))
    const targetSet = data(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'folder', path: 'source-folder' }] }))
    const target = targetSet.targets[0]
    const started = await startBatch({ title: 'Undo folder deletion', message: '@source-folder delete it', targetSetId: targetSet.id,
      targetRefs: [target.ref], calls: [
        { id: 'folder_trash_undo_source', name: 'folder.trash', arguments: {
          target_ref: target.ref, expected_revision: target.revision
        } }
      ] })
    const pending = data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
    const trashed = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: started.batchId
    }))
    expect(trashed.operations[0]).toMatchObject({ status: 'succeeded', undoStatus: 'available', trashEntryId: expect.any(String) })
    await expect(fs.stat(join(root, 'source-folder'))).rejects.toMatchObject({ code: 'ENOENT' })
    await fs.mkdir(join(root, 'other'))
    await fs.writeFile(join(root, 'other', 'plan.json'), JSON.stringify({
      format_version: '1', created_at: '2026-10-04T00:00:00.000Z', updated_at: '2026-10-04T00:00:00.000Z', components: []
    }))
    const unrelatedEntry = await storage.trashPlan('other')

    const undo = data(await bridge.invoke('agent:operation:undo', {
      sessionId: started.sessionId, batchId: started.batchId, callId: 'folder_trash_undo_source'
    }))
    const undone = data(await bridge.invoke('agent:operation:confirm', {
      sessionId: started.sessionId, batchId: undo.id
    }))
    expect(undone.operations[0].status).toBe('succeeded')
    await expect(fs.stat(join(root, 'source-folder', 'inside', 'plan.json'))).resolves.toBeTruthy()
    const entries = await storage.listTrashEntries()
    expect(entries.map((entry) => entry.id)).toEqual([unrelatedEntry.id])
    expect(entries[0].kind).toBe('plan')
    expect(data(await bridge.invoke('agent:operation:read', { sessionId: started.sessionId, batchId: started.batchId }))
      .operations[0].undoStatus).toBe('undone')
  }, 15000)
})
