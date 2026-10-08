import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ERR, TraceError } from '../src/shared/errors'

const electronMocks = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>()
  return {
    handlers,
    ipcMain: {
      handle: vi.fn((channel: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => {
        handlers.set(channel, handler)
      }),
      removeHandler: vi.fn((channel: string) => handlers.delete(channel))
    },
    ipcRenderer: {
      invoke: vi.fn(async (channel: string, payload?: unknown) => {
        const handler = handlers.get(channel)
        return handler ? handler({}, payload) : { ok: false, code: 50, message: '通道未注册', data: null }
      }),
      on: vi.fn(), removeListener: vi.fn()
    },
    contextBridge: { exposeInMainWorld: vi.fn<(key: string, value: unknown) => void>() },
    dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() }
  }
})

vi.mock('electron', () => ({
  ipcMain: electronMocks.ipcMain,
  ipcRenderer: electronMocks.ipcRenderer,
  contextBridge: electronMocks.contextBridge,
  dialog: electronMocks.dialog
}))

type Bridge = {
  invoke(channel: string, payload?: unknown): Promise<unknown>
  on(event: string, callback: (payload: unknown) => void): () => void
}

type AgentRootCommitBinding = {
  rootSnapshot: {
    rootHash: string
    libraryId: string
    rootGeneration: number
    rootDirectoryIdentity: string
  }
  validateRootSnapshot: () => Promise<void>
}

type TestStorageService = import('../src/main/services/storage-service').StorageService
type TestPlanReferenceService = import('../src/main/services/plan-reference-service').PlanReferenceService

async function captureAgentRootCommitBinding(storage: TestStorageService, references: TestPlanReferenceService): Promise<AgentRootCommitBinding> {
  const { AgentTargetService } = await import('../src/main/services/agent-target-service')
  const targets = new AgentTargetService(storage)
  const activeRoot = await targets.captureActiveLibrarySnapshot()
  const rootSnapshot = await references.captureAgentRootSnapshot(storage, activeRoot,
    () => targets.assertActiveLibrarySnapshot(activeRoot))
  return {
    rootSnapshot,
    validateRootSnapshot: () => targets.assertActiveLibrarySnapshot(activeRoot)
  }
}

describe('plan reference IPC boundary', () => {
  const roots: string[] = []
  let dispose: (() => void) | undefined
  let disposeService: (() => void) | undefined

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    electronMocks.handlers.clear()
  })

  afterEach(async () => {
    dispose?.()
    disposeService?.()
    dispose = undefined
    disposeService = undefined
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
    vi.restoreAllMocks()
  })

  it.each(['restore', 'purge'] as const)(
    'serializes a single trash-entry read behind a queued %s commit', async (operation) => {
      const [{ PlanRepository }, { StorageService }, { PlanReferenceService }] = await Promise.all([
        import('../src/main/services/plan-repository'),
        import('../src/main/services/storage-service'),
        import('../src/main/services/plan-reference-service')
      ])
      const directory = await fs.mkdtemp(join(tmpdir(), `trace-trash-read-${operation}-queue-`))
      roots.push(directory)
      const root = join(directory, 'library')
      await fs.mkdir(root)
      const repo = new PlanRepository()
      await repo.ensureLibraryRoot(root)
      const storage = new StorageService(repo)
      storage.setRoot(root)
      const references = new PlanReferenceService(repo, () => storage.getRootAbs())
      references.activateRoot(root)
      disposeService = () => references.dispose()

      const plan = await storage.createPlan('', `Queued ${operation}`)
      const entry = await storage.trashPlan(plan.path)
      const preview = operation === 'restore'
        ? await storage.previewTrashRestore(entry.id)
        : await storage.previewTrashPurge(entry.id)
      const originalCommit = operation === 'restore'
        ? storage.commitTrashRestore.bind(storage)
        : storage.commitTrashPurge.bind(storage)
      let releaseCommit!: () => void
      let signalCommit!: () => void
      let commitFinished = false
      const commitGate = new Promise<void>((resolve) => { releaseCommit = resolve })
      const commitStarted = new Promise<void>((resolve) => { signalCommit = resolve })
      const commitSpy = vi.spyOn(storage, operation === 'restore' ? 'commitTrashRestore' : 'commitTrashPurge')
        .mockImplementation(async (token, guard) => {
          signalCommit()
          await commitGate
          try {
            return await originalCommit(token, guard)
          } finally {
            commitFinished = true
          }
        })
      const pendingCommit = operation === 'restore'
        ? references.commitTrashRestore(storage, preview.confirmation_token)
        : references.commitTrashPurge(storage, preview.confirmation_token)

      let queuedRead: Promise<unknown> | undefined
      const readSpy = vi.spyOn(storage, 'readTrashEntry')
      try {
        await commitStarted
        const service = references as unknown as {
          readTrashEntry(storageService: typeof storage, entryId: string, expectedManifestRevision: number): Promise<unknown>
        }
        const readOutcome = Promise.resolve()
          .then(() => service.readTrashEntry(storage, entry.id, entry.manifest_revision))
          .then((value) => ({ value }), (error: unknown) => ({ error }))
        queuedRead = readOutcome.then((outcome) => outcome)
        await Promise.resolve()
        expect(commitSpy).toHaveBeenCalledTimes(1)
        expect(readSpy).not.toHaveBeenCalled()
      } finally {
        releaseCommit()
        await pendingCommit.catch(() => undefined)
      }

      expect(commitFinished).toBe(true)
      await expect(pendingCommit).resolves.toMatchObject({ changed_plan_ids: [] })
      await expect(queuedRead).resolves.toMatchObject({ error: { code: ERR.CONFLICT } })
      expect(readSpy).toHaveBeenCalledTimes(1)
    }
  )

  it('exposes only allowed reference channels and keeps absolute roots out of request and response DTOs', async () => {
    const [{ registerIpc }, { PlanRepository }, { StorageService }, { PlanReferenceService }, { bus }] = await Promise.all([
      import('../src/main/ipc/register'),
      import('../src/main/services/plan-repository'),
      import('../src/main/services/storage-service'),
      import('../src/main/services/plan-reference-service'),
      import('../src/main/services/event-bus')
    ])
    await import('../src/preload/index')
    const bridge = electronMocks.contextBridge.exposeInMainWorld.mock.calls.at(-1)?.[1] as Bridge
    const root = await fs.mkdtemp(join(tmpdir(), 'trace-reference-ipc-'))
    roots.push(root)
    const repo = new PlanRepository()
    const libraryId = (await repo.ensureLibraryRoot(root)).library_id
    await fs.mkdir(join(root, 'Target'))
    await repo.writePlanAtomic(root, 'Target', {
      format_version: '1', created_at: '2026-09-30T00:00:00.000Z', updated_at: '2026-09-30T00:00:00.000Z', components: []
    })
    const storage = new StorageService(repo)
    storage.setRoot(root)
    const referenceService = new PlanReferenceService(repo, () => storage.getRootAbs())
    referenceService.activateRoot(root)
    disposeService = () => referenceService.dispose()
    const binding = await captureAgentRootCommitBinding(storage, referenceService)
    await storage.createPlan('', 'AgentMovePreviewSource')
    await storage.createFolder('', 'AgentMovePreviewTarget')
    const frozenMove = await referenceService.previewAgentMove({
      path: 'AgentMovePreviewSource', target_parent_path: 'AgentMovePreviewTarget'
    }, storage)
    expect(frozenMove).toMatchObject({ source_path: 'AgentMovePreviewSource', target_parent_path: 'AgentMovePreviewTarget' })
    expect(JSON.stringify(frozenMove)).not.toContain(root)
    await expect(fs.access(join(root, 'AgentMovePreviewSource', 'plan.json'))).resolves.toBeUndefined()
    const frozenMoveSource = await storage.readPlan('AgentMovePreviewSource')
    await storage.appendComponent('AgentMovePreviewSource', {
      id: '12121212121212121212121212121212', type: 'note', payload: { content: 'changed after preview' }
    })
    await expect(referenceService.commitAgentMove(frozenMove.token, storage, binding)).rejects.toMatchObject({ code: ERR.CONFLICT })
    await expect(fs.access(join(root, 'AgentMovePreviewSource', 'plan.json'))).resolves.toBeUndefined()
    await expect(referenceService.commitAgentMove(frozenMove.token, storage, binding)).rejects.toThrow()
    const freshMove = await referenceService.previewAgentMove({
      path: 'AgentMovePreviewSource', target_parent_path: 'AgentMovePreviewTarget'
    }, storage)
    expect(await referenceService.commitAgentMove(freshMove.token, storage, binding)).toEqual({ path: 'AgentMovePreviewTarget/AgentMovePreviewSource' })
    await expect(fs.access(join(root, 'AgentMovePreviewTarget', 'AgentMovePreviewSource', 'plan.json'))).resolves.toBeUndefined()
    expect(frozenMoveSource.components).toEqual([])
    const startup = {
      waitForRootActivation: async () => undefined,
      waitForBootstrap: async () => undefined,
      getRootActivationStatus: () => 'active',
      runAfterRootActivation: (operation: () => unknown) => Promise.resolve().then(operation),
      markRootActivated: vi.fn(), onWindowShown: vi.fn()
    }
    const send = vi.fn()
    const importPlan = vi.fn().mockResolvedValue({
      imported: [{ path: 'Imported' }], plans: 1, components: 1, tasks: 0, notes: 0, skipped: []
    })
    dispose = registerIpc({
      app: {}, storage, config: {}, transfer: { importPlan }, export: {}, search: {},
      planReferences: referenceService,
      startup,
      getWindow: () => ({ isDestroyed: () => false, webContents: { isDestroyed: () => false, send } }),
      requestTrustedTrashPurgeConfirmation: async (_snapshot, accept) => { await accept() },
      log: vi.fn()
    } as unknown as Parameters<typeof registerIpc>[0])

    let releaseMutation!: () => void
    let markMutationStarted!: () => void
    const mutationStarted = new Promise<void>((resolve) => { markMutationStarted = resolve })
    const mutationGate = new Promise<void>((resolve) => { releaseMutation = resolve })
    const queuedMutation = referenceService.runRendererMutation(async () => {
      markMutationStarted()
      await mutationGate
    })
    await mutationStarted
    const listSpy = vi.spyOn(storage, 'listTrashEntries').mockResolvedValue([])
    const queuedTrashList = bridge.invoke('trash:list', undefined)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(listSpy).not.toHaveBeenCalled()
    releaseMutation()
    await queuedMutation
    await expect(queuedTrashList).resolves.toMatchObject({ ok: true, data: [] })
    listSpy.mockRestore()

    const search = await bridge.invoke('plan-reference:search', { library_id: libraryId, query: 'Tar' })
    expect(search).toMatchObject({ ok: true, data: { targets: [{ path: 'Target', plan_name: 'Target' }] } })
    expect(JSON.stringify(search)).not.toContain(root)
    expect(electronMocks.ipcRenderer.invoke.mock.calls.at(-1)).toEqual([
      'plan-reference:search', { library_id: libraryId, query: 'Tar' }
    ])
    const committed = await bridge.invoke('plan-reference:commitTarget', { library_id: libraryId, path: 'Target', mode: 'link' })
    expect(committed).toMatchObject({ ok: true, data: { path: 'Target', plan_name: 'Target' } })
    expect(JSON.stringify(committed)).not.toContain(root)
    const planId = (committed as { data: { plan_id: string } }).data.plan_id
    expect(await bridge.invoke('plan-reference:resolve', { library_id: libraryId, plan_id: planId }))
      .toMatchObject({ ok: true, data: { status: 'found', target: { path: 'Target' } } })
    expect(await bridge.invoke('plan-reference:inbound', { library_id: libraryId, plan_id: planId }))
      .toEqual({ ok: true, code: 0, message: 'ok', data: { references: [] } })

    const componentId = '22222222222222222222222222222222'
    await storage.appendComponent('Target', {
      id: componentId, type: 'heading', payload: { title: 'Protected title', size: 18 }
    })
    await fs.mkdir(join(root, 'Source'))
    await repo.writePlanAtomic(root, 'Source', {
      format_version: '1', plan_id: '33333333333333333333333333333333',
      created_at: '2026-09-30T00:00:00.000Z', updated_at: '2026-09-30T00:00:00.000Z',
      components: [{ id: '44444444444444444444444444444444', type: 'plan_reference', payload: {
        mode: 'embed', target_plan_id: planId, target_component_id: componentId,
        target_path_snapshot: 'Target', target_name_snapshot: 'Protected title'
      } }]
    })
    bus.emit('trace:plan-changed', { path: 'Source' })
    const targetBefore = await storage.readPlan('Target')

    const removedComponent = structuredClone(targetBefore)
    removedComponent.components = []
    expect(await bridge.invoke('storage:savePlan', {
      path: 'Target', document: removedComponent, expected_updated_at: targetBefore.updated_at
    })).toMatchObject({ ok: false, code: ERR.CONFIRMATION_REQUIRED })

    const renamedComponent = structuredClone(targetBefore)
    ;(renamedComponent.components[0].payload as { title: string }).title = 'Unconfirmed title'
    expect(await bridge.invoke('storage:savePlan', {
      path: 'Target', document: renamedComponent, expected_updated_at: targetBefore.updated_at
    })).toMatchObject({ ok: false, code: ERR.CONFIRMATION_REQUIRED })
    expect((await storage.readPlan('Target')).components[0].payload).toMatchObject({ title: 'Protected title' })

    const contentEdit = structuredClone(targetBefore)
    ;(contentEdit.components[0].payload as { size: number }).size = 22
    contentEdit.components.push({
      id: '99999999999999999999999999999999', type: 'custom', payload: { content: 'New ordinary component' }
    })
    expect(await bridge.invoke('storage:savePlan', {
      path: 'Target', document: contentEdit, expected_updated_at: targetBefore.updated_at
    })).toMatchObject({ ok: true, data: { updated_at: expect.any(String) } })
    expect((await storage.readPlan('Target')).components[0].payload).toMatchObject({
      title: 'Protected title', size: 22
    })
    expect((await storage.readPlan('Target')).components[1].payload).toMatchObject({ content: 'New ordinary component' })

    const replacementId = '55555555555555555555555555555555'
    await fs.mkdir(join(root, 'Replacement'))
    await repo.writePlanAtomic(root, 'Replacement', {
      format_version: '1', plan_id: '66666666666666666666666666666666',
      created_at: '2026-09-30T00:00:00.000Z', updated_at: '2026-09-30T00:00:00.000Z',
      components: [{ id: replacementId, type: 'heading', payload: { title: 'Replacement', size: 18 } }]
    })
    await fs.mkdir(join(root, 'Late'))
    await repo.writePlanAtomic(root, 'Late', {
      format_version: '1', plan_id: '77777777777777777777777777777777',
      created_at: '2026-09-30T00:00:00.000Z', updated_at: '2026-09-30T00:00:00.000Z', components: []
    })
    bus.emit('trace:plan-changed', { path: 'Replacement' })
    bus.emit('trace:plan-changed', { path: 'Late' })
    const deletionPreview = await referenceService.previewImpact({
      library_id: libraryId, operation: 'delete-plan', path: 'Target'
    })
    const saveSource = storage.savePlan.bind(storage)
    let notifySourceSave!: () => void
    let releaseSourceSave!: () => void
    const sourceSaveStarted = new Promise<void>((resolve) => { notifySourceSave = resolve })
    const sourceSaveGate = new Promise<void>((resolve) => { releaseSourceSave = resolve })
    vi.spyOn(storage, 'savePlan').mockImplementation(async (path, document, expected) => {
      if (path === 'Source') {
        notifySourceSave()
        await sourceSaveGate
      }
      return saveSource(path, document, expected)
    })
    const deletionPromise = bridge.invoke('plan-reference:commitImpact', {
      library_id: libraryId, preview: deletionPreview, decisions: [{
        source_path: 'Source', source_component_id: '44444444444444444444444444444444',
        action: 'replace', replacement: { path: 'Replacement', component_id: replacementId }
      }]
    })
    await sourceSaveStarted
    const waitingAppendPromise = bridge.invoke('storage:appendComponent', {
      path: 'Late', component: { id: '88888888888888888888888888888888', type: 'plan_reference', payload: {
        mode: 'embed', target_plan_id: planId, target_component_id: componentId,
        target_path_snapshot: 'Target', target_name_snapshot: 'Protected title'
      } }
    })
    const waitingImportPromise = bridge.invoke('transfer:importPlan', {
      target_parent_path: '', filePath: 'fixture.plan'
    })
    expect(importPlan).not.toHaveBeenCalled()
    releaseSourceSave()
    expect(await deletionPromise).toMatchObject({ ok: true })
    expect(await waitingAppendPromise).toMatchObject({ ok: false, code: ERR.PATH_NOT_FOUND })
    expect(await waitingImportPromise).toMatchObject({ ok: true, data: { imported: [{ path: 'Imported' }] } })
    expect(importPlan).toHaveBeenCalledExactlyOnceWith('', 'fixture.plan')
    expect((await storage.readPlan('Late')).components).toEqual([])

    const legacyDelete = electronMocks.handlers.get('storage:deletePlan')
    const trashBeforeLegacyDelete = await storage.listTrashEntries()
    expect(legacyDelete).toBeDefined()
    expect(await legacyDelete?.({}, { path: 'Replacement', confirmed: true }))
      .toMatchObject({ ok: false, code: ERR.CONFIRMATION_REQUIRED })
    await expect(fs.access(join(root, 'Replacement', 'plan.json'))).resolves.toBeUndefined()
    expect(await storage.listTrashEntries()).toEqual(trashBeforeLegacyDelete)

    await storage.createFolder('', 'MoveSource')
    await storage.createPlan('MoveSource', 'Inside')
    await storage.createFolder('', 'MoveTarget')
    const moveDocument = await storage.readPlan('MoveSource/Inside')
    moveDocument.plan_id = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    await storage.savePlan('MoveSource/Inside', moveDocument, moveDocument.updated_at)
    const planChanges: string[] = []
    const targetChanges: string[][] = []
    const offPlanChanges = bus.on('trace:plan-changed', ({ path }) => planChanges.push(path))
    const offTargetChanges = bus.on('trace:reference-target-changed', ({ plan_ids }) => targetChanges.push(plan_ids))
    const rawMove = storage.movePlanRaw.bind(storage)
    let failRawMove = true
    vi.spyOn(storage, 'movePlanRaw').mockImplementation(async (...args) => {
      if (failRawMove) {
        failRawMove = false
        throw new TraceError(ERR.CONFLICT, 'injected disk move failure')
      }
      return rawMove(...args)
    })
    try {
      expect(await bridge.invoke('storage:movePlan', { path: 'MoveSource', target_parent_path: 'MoveTarget' }))
        .toMatchObject({ ok: false })
      expect(planChanges).toEqual([])
      expect(targetChanges).toEqual([])
      await expect(fs.access(join(root, 'MoveSource', 'Inside', 'plan.json'))).resolves.toBeUndefined()

      let releaseMove!: () => void
      let signalMove!: () => void
      const moveGate = new Promise<void>((resolve) => { releaseMove = resolve })
      const rawStarted = new Promise<void>((resolve) => { signalMove = resolve })
      vi.spyOn(storage, 'movePlanRaw').mockImplementationOnce(async (...args) => {
        signalMove()
        await moveGate
        return rawMove(...args)
      })
      const pendingMove = bridge.invoke('storage:movePlan', { path: 'MoveSource', target_parent_path: 'MoveTarget' })
      await rawStarted
      const append = vi.spyOn(storage, 'appendComponent')
      const waitingWrite = bridge.invoke('storage:appendComponent', {
        path: 'MoveTarget/MoveSource/Inside',
        component: { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', type: 'note', payload: { content: 'after move' } }
      })
      await Promise.resolve()
      expect(append).not.toHaveBeenCalled()
      expect(planChanges).toEqual([])
      releaseMove()
      expect(await pendingMove).toMatchObject({ ok: true })
      expect(await waitingWrite).toMatchObject({ ok: true })
      expect(append).toHaveBeenCalledTimes(1)
      expect(planChanges).toEqual(['MoveTarget/MoveSource', 'MoveTarget/MoveSource/Inside'])
      expect(targetChanges).toEqual([
        ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
        ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']
      ])
      expect((await storage.readPlan('MoveTarget/MoveSource/Inside')).components)
        .toContainEqual(expect.objectContaining({ id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }))

      await storage.createPlan('', 'QueuedRestore')
      const restorePlan = await storage.readPlan('QueuedRestore')
      restorePlan.plan_id = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      await storage.savePlan('QueuedRestore', restorePlan, restorePlan.updated_at)
      await storage.trashPlan('QueuedRestore', restorePlan.updated_at)
      const restoreEntry = (await storage.listTrashEntries()).find((entry) => entry.name === 'QueuedRestore')!
      const restorePreview = await storage.previewTrashRestore(restoreEntry.id)
      await storage.createFolder('', 'RestoreQueueMove')
      await storage.createFolder('', 'RestoreQueueTarget')
      let releaseRestoreGate!: () => void
      let signalRestoreMove!: () => void
      const restoreMoveGate = new Promise<void>((resolve) => { releaseRestoreGate = resolve })
      const restoreMoveStarted = new Promise<void>((resolve) => { signalRestoreMove = resolve })
      vi.spyOn(storage, 'movePlanRaw').mockImplementationOnce(async (...args) => {
        signalRestoreMove()
        await restoreMoveGate
        return rawMove(...args)
      })
      const restoreBlockingMove = bridge.invoke('storage:movePlan', {
        path: 'RestoreQueueMove', target_parent_path: 'RestoreQueueTarget'
      })
      await restoreMoveStarted
      const commitRestore = vi.spyOn(storage, 'commitTrashRestore')
      const queuedRestore = bridge.invoke('trash:restore-commit', {
        confirmation_token: restorePreview.confirmation_token
      })
      await Promise.resolve()
      expect(commitRestore).not.toHaveBeenCalled()
      releaseRestoreGate()
      expect(await restoreBlockingMove).toMatchObject({ ok: true })
      expect(await queuedRestore).toMatchObject({ ok: true })
      expect(commitRestore).toHaveBeenCalledTimes(1)
      await expect(fs.access(join(root, 'QueuedRestore', 'plan.json'))).resolves.toBeUndefined()

      await storage.createPlan('', 'QueuedPurge')
      const purgePlan = await storage.readPlan('QueuedPurge')
      await storage.trashPlan('QueuedPurge', purgePlan.updated_at)
      const purgeEntry = (await storage.listTrashEntries()).find((entry) => entry.name === 'QueuedPurge')!
      const purgePreview = await storage.previewTrashPurge(purgeEntry.id)
      await storage.createFolder('', 'PurgeQueueMove')
      await storage.createFolder('', 'PurgeQueueTarget')
      let releasePurgeGate!: () => void
      let signalPurgeMove!: () => void
      const purgeMoveGate = new Promise<void>((resolve) => { releasePurgeGate = resolve })
      const purgeMoveStarted = new Promise<void>((resolve) => { signalPurgeMove = resolve })
      vi.spyOn(storage, 'movePlanRaw').mockImplementationOnce(async (...args) => {
        signalPurgeMove()
        await purgeMoveGate
        return rawMove(...args)
      })
      const purgeBlockingMove = bridge.invoke('storage:movePlan', {
        path: 'PurgeQueueMove', target_parent_path: 'PurgeQueueTarget'
      })
      await purgeMoveStarted
      const commitPurge = vi.spyOn(storage, 'commitTrashPurge')
      const queuedPurge = bridge.invoke('trash:purge-commit', {
        confirmation_token: purgePreview.confirmation_token
      })
      await Promise.resolve()
      expect(commitPurge).not.toHaveBeenCalled()
      releasePurgeGate()
      expect(await purgeBlockingMove).toMatchObject({ ok: true })
      expect(await queuedPurge).toMatchObject({ ok: true })
      expect(commitPurge).toHaveBeenCalledTimes(1)
      expect((await storage.listTrashEntries()).map((entry) => entry.id)).not.toContain(purgeEntry.id)
    } finally {
      offPlanChanges()
      offTargetChanges()
    }

    const referenceEvent = { plan_ids: [planId] }
    const received = vi.fn()
    const unsubscribe = bridge.on('trace:reference-target-changed', received)
    const preloadListener = electronMocks.ipcRenderer.on.mock.calls
      .find(([channel]) => channel === 'trace:reference-target-changed')?.[1] as
      | ((event: unknown, payload: unknown) => void)
      | undefined
    expect(preloadListener).toBeDefined()
    preloadListener?.({}, referenceEvent)
    expect(received).toHaveBeenCalledExactlyOnceWith(referenceEvent)
    bus.emit('trace:reference-target-changed', referenceEvent)
    expect(send).toHaveBeenCalledWith('trace:reference-target-changed', referenceEvent)
    const sentReferenceEventCount = (): number => send.mock.calls
      .filter(([channel]) => channel === 'trace:reference-target-changed').length
    const referenceEventsBeforeDispose = sentReferenceEventCount()
    expect(referenceEventsBeforeDispose).toBeGreaterThan(0)
    unsubscribe()
    expect(electronMocks.ipcRenderer.removeListener).toHaveBeenCalledWith(
      'trace:reference-target-changed', preloadListener
    )

    expect(await bridge.invoke('plan-reference:eraseLibrary', { library_id: libraryId }))
      .toEqual({ ok: false, code: 50, message: '通道未开放', data: null })
    expect(electronMocks.ipcRenderer.invoke.mock.calls.some(([channel]) => channel === 'plan-reference:eraseLibrary')).toBe(false)

    expect(await bridge.invoke('plan-reference:search', { library_id: 'ffffffffffffffffffffffffffffffff', query: '' }))
      .toMatchObject({ ok: false, code: 22 })
    expect(await bridge.invoke('plan-reference:search', { library_id: libraryId, root, query: '' }))
      .toMatchObject({ ok: false, code: 20 })

    dispose?.()
    dispose = undefined
    bus.emit('trace:reference-target-changed', referenceEvent)
    expect(sentReferenceEventCount()).toBe(referenceEventsBeforeDispose)
  })

  it('freezes folder rename and trash reference impacts and commits only explicit per-reference decisions', async () => {
    const [{ PlanRepository }, { StorageService }, { PlanReferenceService }] = await Promise.all([
      import('../src/main/services/plan-repository'),
      import('../src/main/services/storage-service'),
      import('../src/main/services/plan-reference-service')
    ])
    const root = await fs.mkdtemp(join(tmpdir(), 'trace-agent-folder-impact-'))
    roots.push(root)
    const repo = new PlanRepository()
    const { library_id: libraryId } = await repo.ensureLibraryRoot(root)
    const storage = new StorageService(repo)
    storage.setRoot(root)
    const references = new PlanReferenceService(repo, () => storage.getRootAbs())
    references.activateRoot(root)
    disposeService = () => references.dispose()
    const binding = await captureAgentRootCommitBinding(storage, references)

    const addPlanId = async (path: string, planId: string): Promise<void> => {
      const document = await storage.readPlan(path)
      document.plan_id = planId
      await storage.savePlan(path, document, document.updated_at)
    }
    const addReference = async (
      path: string, componentId: string, targetPlanId: string, targetPath: string
    ): Promise<void> => {
      const document = await storage.readPlan(path)
      document.components.push({
        id: componentId,
        type: 'plan_reference',
        payload: {
          mode: 'link', target_plan_id: targetPlanId,
          target_path_snapshot: targetPath, target_name_snapshot: targetPath.split('/').at(-1) ?? targetPath
        }
      })
      await storage.savePlan(path, document, document.updated_at)
    }

    await storage.createFolder('', 'Container')
    await storage.createFolder('Container', 'Nested')
    await storage.createPlan('Container/Nested', 'Target')
    await addPlanId('Container/Nested/Target', '11111111111111111111111111111111')
    await storage.createPlan('', 'RenameSource')
    await addPlanId('RenameSource', '22222222222222222222222222222222')
    await addReference('RenameSource', '33333333333333333333333333333333', '11111111111111111111111111111111', 'Container/Nested/Target')

    type FolderPreview = {
      token: string; operation: 'rename' | 'trash'; path: string; destination_path?: string;
      target_plan_ids: string[]; references: Array<{ source_path: string; source_component_id: string }>;
    }
    const agentFolders = references as unknown as {
      previewAgentFolderOperation(input: unknown, service: typeof storage): Promise<FolderPreview>
      commitAgentFolderOperation(input: unknown, service: typeof storage, binding: AgentRootCommitBinding): Promise<{ path?: string; trash_entry_id?: string }>
    }

    const renamePreview = await agentFolders.previewAgentFolderOperation({
      operation: 'rename', path: 'Container', new_name: 'RenamedContainer'
    }, storage)
    expect(renamePreview).toMatchObject({
      operation: 'rename', path: 'Container', destination_path: 'RenamedContainer',
      target_plan_ids: ['11111111111111111111111111111111'],
      references: [{ source_path: 'RenameSource', source_component_id: '33333333333333333333333333333333' }]
    })
    expect(JSON.stringify(renamePreview)).not.toContain(root)
    await expect(fs.access(join(root, 'Container'))).resolves.toBeUndefined()

    const changedSource = await storage.readPlan('RenameSource')
    const changedPayload = changedSource.components[0].payload as { target_name_snapshot: string }
    changedPayload.target_name_snapshot = 'externally changed'
    await storage.savePlan('RenameSource', changedSource, changedSource.updated_at)
    await expect(agentFolders.commitAgentFolderOperation({
      token: renamePreview.token, rename_action: 'update'
    }, storage, binding)).rejects.toMatchObject({ code: ERR.CONFLICT })
    await expect(fs.access(join(root, 'Container'))).resolves.toBeUndefined()

    const currentSource = await storage.readPlan('RenameSource')
    const currentPayload = currentSource.components[0].payload as { target_name_snapshot: string }
    currentPayload.target_name_snapshot = 'Target'
    await storage.savePlan('RenameSource', currentSource, currentSource.updated_at)
    const freshRename = await agentFolders.previewAgentFolderOperation({
      operation: 'rename', path: 'Container', new_name: 'RenamedContainer'
    }, storage)
    await expect(agentFolders.commitAgentFolderOperation({
      token: freshRename.token, rename_action: 'update'
    }, storage, binding)).resolves.toEqual({ path: 'RenamedContainer' })
    await expect(fs.access(join(root, 'RenamedContainer', 'Nested', 'Target'))).resolves.toBeUndefined()
    expect((await storage.readPlan('RenameSource')).components[0].payload)
      .toMatchObject({ target_path_snapshot: 'RenamedContainer/Nested/Target' })

    await storage.createFolder('', 'TrashFolder')
    await storage.createPlan('TrashFolder', 'TrashTarget')
    await addPlanId('TrashFolder/TrashTarget', '44444444444444444444444444444444')
    await storage.createPlan('', 'KeepSource')
    await addPlanId('KeepSource', '55555555555555555555555555555555')
    await addReference('KeepSource', '66666666666666666666666666666666', '44444444444444444444444444444444', 'TrashFolder/TrashTarget')
    await storage.createPlan('', 'ReplaceSource')
    await addPlanId('ReplaceSource', '77777777777777777777777777777777')
    await addReference('ReplaceSource', '88888888888888888888888888888888', '44444444444444444444444444444444', 'TrashFolder/TrashTarget')
    await storage.createPlan('', 'ReplacementTarget')
    await addPlanId('ReplacementTarget', '99999999999999999999999999999999')

    const trashPreview = await agentFolders.previewAgentFolderOperation({ operation: 'trash', path: 'TrashFolder' }, storage)
    expect(trashPreview.references).toHaveLength(2)
    await expect(agentFolders.commitAgentFolderOperation({
      token: trashPreview.token,
      decisions: [{
        source_path: 'KeepSource', source_component_id: '66666666666666666666666666666666', action: 'keep'
      }]
    }, storage, binding)).rejects.toMatchObject({ code: ERR.CONFIRMATION_REQUIRED })
    await expect(fs.access(join(root, 'TrashFolder'))).resolves.toBeUndefined()

    const trashResult = await agentFolders.commitAgentFolderOperation({
      token: trashPreview.token,
      decisions: [
        { source_path: 'KeepSource', source_component_id: '66666666666666666666666666666666', action: 'keep' },
        { source_path: 'ReplaceSource', source_component_id: '88888888888888888888888888888888', action: 'replace',
          replacement: { path: 'ReplacementTarget' } }
      ]
    }, storage, binding)
    expect(trashResult.trash_entry_id).toEqual(expect.any(String))
    await expect(fs.access(join(root, 'TrashFolder'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await storage.readPlan('KeepSource')).components[0].payload)
      .toMatchObject({ target_plan_id: '44444444444444444444444444444444' })
    expect((await storage.readPlan('ReplaceSource')).components[0].payload)
      .toMatchObject({ target_plan_id: '99999999999999999999999999999999' })
    expect(await references.resolve({ library_id: libraryId, plan_id: '44444444444444444444444444444444' }))
      .toMatchObject({ status: 'missing' })
  })

  it('freezes a complete metadata-only folder subtree preview and rejects a changed subtree', async () => {
    const [{ PlanRepository }, { StorageService }, { PlanReferenceService }] = await Promise.all([
      import('../src/main/services/plan-repository'),
      import('../src/main/services/storage-service'),
      import('../src/main/services/plan-reference-service')
    ])
    const root = await fs.mkdtemp(join(tmpdir(), 'trace-agent-folder-subtree-'))
    roots.push(root)
    const repo = new PlanRepository()
    await repo.ensureLibraryRoot(root)
    const storage = new StorageService(repo)
    storage.setRoot(root)
    const references = new PlanReferenceService(repo, () => storage.getRootAbs())
    references.activateRoot(root)
    disposeService = () => references.dispose()
    const binding = await captureAgentRootCommitBinding(storage, references)

    await storage.createFolder('', 'Scope')
    await storage.createFolder('Scope', 'EmptyRoot')
    await storage.createFolder('Scope', 'Nested')
    await storage.createFolder('Scope/Nested', 'EmptyNested')
    await storage.createPlan('Scope/Nested', 'Plan')
    await storage.createPlan('Scope/Nested/Plan', 'ChildPlan')

    const setPlanId = async (path: string, planId: string, content?: string): Promise<void> => {
      const document = await storage.readPlan(path)
      document.plan_id = planId
      if (content) document.components.push({
        id: `${planId.slice(0, 31)}1`, type: 'note', payload: { content }
      })
      await storage.savePlan(path, document, document.updated_at)
    }
    await setPlanId('Scope/Nested/Plan', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'PRIVATE_COMPONENT_BODY_MUST_NOT_LEAK')
    await setPlanId('Scope/Nested/Plan/ChildPlan', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')

    const preview = await references.previewAgentFolderOperation({
      operation: 'rename', path: 'Scope', new_name: 'RenamedScope'
    }, storage)
    const expectedSubtree = [
      { relative_path: '', kind: 'folder' },
      { relative_path: 'EmptyRoot', kind: 'folder' },
      { relative_path: 'Nested', kind: 'folder' },
      { relative_path: 'Nested/EmptyNested', kind: 'folder' },
      { relative_path: 'Nested/Plan', kind: 'plan', plan_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      { relative_path: 'Nested/Plan/ChildPlan', kind: 'plan', plan_id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }
    ]
    expect(preview.affected_subtree).toEqual(expectedSubtree)
    const trashPreview = await references.previewAgentFolderOperation({ operation: 'trash', path: 'Scope' }, storage)
    expect(trashPreview.affected_subtree).toEqual(expectedSubtree)
    expect(JSON.stringify({ preview, trashPreview })).not.toContain(root)
    expect(JSON.stringify({ preview, trashPreview })).not.toContain('PRIVATE_COMPONENT_BODY_MUST_NOT_LEAK')

    await fs.mkdir(join(root, 'Scope', 'AddedAfterPreview'))
    await expect(references.commitAgentFolderOperation({ token: preview.token }, storage, binding))
      .rejects.toMatchObject({ code: ERR.CONFLICT })
    await expect(references.commitAgentFolderOperation({ token: trashPreview.token, decisions: [] }, storage, binding))
      .rejects.toMatchObject({ code: ERR.CONFLICT })
    await expect(fs.access(join(root, 'Scope'))).resolves.toBeUndefined()
  })

  it.each(['edit', 'create'] as const)('rejects an Agent %s using a frozen snapshot after a cloned library becomes active', async (operation) => {
    const [{ PlanRepository }, { StorageService }, { PlanReferenceService }, { AgentTargetService }] = await Promise.all([
      import('../src/main/services/plan-repository'),
      import('../src/main/services/storage-service'),
      import('../src/main/services/plan-reference-service'),
      import('../src/main/services/agent-target-service')
    ])
    const directory = await fs.mkdtemp(join(tmpdir(), 'trace-agent-root-cas-'))
    roots.push(directory)
    const originalRoot = join(directory, 'original')
    const replacementRoot = join(directory, 'clone')
    await fs.mkdir(originalRoot)
    const repo = new PlanRepository()
    await repo.ensureLibraryRoot(originalRoot)
    const storage = new StorageService(repo)
    storage.setRoot(originalRoot)
    const references = new PlanReferenceService(repo, () => storage.getRootAbs())
    references.activateRoot(originalRoot)
    disposeService = () => references.dispose()
    const targets = new AgentTargetService(storage)
    await storage.createPlan('', 'Target')
    const frozenRoot = await targets.captureActiveLibrarySnapshot()
    const frozenWriteRoot = await references.captureAgentRootSnapshot(storage, frozenRoot,
      () => targets.assertActiveLibrarySnapshot(frozenRoot))
    const frozenTarget = await targets.captureAuditedTarget(frozenRoot, 'Target', 'plan')
    const originalDocument = await storage.readPlan('Target')
    await fs.cp(originalRoot, replacementRoot, { recursive: true })

    storage.setRoot(replacementRoot)
    references.activateRoot(replacementRoot)
    targets.invalidateRoot()

    if (operation === 'edit') {
      const changedDocument = structuredClone(originalDocument)
      changedDocument.components.push({ id: 'a'.repeat(32), type: 'note', payload: { content: 'must not be written' } })
      await expect(references.saveAgentPlan(storage, 'Target', changedDocument, frozenWriteRoot, {
        path: frozenTarget.path, directoryIdentity: frozenTarget.directoryIdentity,
        planId: frozenTarget.planId, updatedAt: frozenTarget.updatedAt!
      }, () => targets.assertActiveLibrarySnapshot(frozenRoot))).rejects.toMatchObject({ code: ERR.CONFLICT })
      for (const libraryRoot of [originalRoot, replacementRoot]) {
        const current = await repo.readPlan(libraryRoot, 'Target')
        expect(current.components).toEqual(originalDocument.components)
      }
      return
    }

    await expect(references.createAgentNode(storage, {
      kind: 'plan', parentPath: '', name: 'Unauthorized'
    }, frozenWriteRoot, () => targets.assertActiveLibrarySnapshot(frozenRoot))).rejects.toMatchObject({ code: ERR.CONFLICT })
    for (const libraryRoot of [originalRoot, replacementRoot]) {
      await expect(fs.access(join(libraryRoot, 'Unauthorized'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it.each(['edit', 'create'] as const)('rejects an Agent %s when the same root path is replaced while queued', async (operation) => {
    const [{ PlanRepository }, { StorageService }, { PlanReferenceService }, { AgentTargetService }] = await Promise.all([
      import('../src/main/services/plan-repository'),
      import('../src/main/services/storage-service'),
      import('../src/main/services/plan-reference-service'),
      import('../src/main/services/agent-target-service')
    ])
    const directory = await fs.mkdtemp(join(tmpdir(), 'trace-agent-root-identity-'))
    roots.push(directory)
    const root = join(directory, 'library')
    const displacedRoot = join(directory, 'displaced-root')
    await fs.mkdir(root)
    const repo = new PlanRepository()
    await repo.ensureLibraryRoot(root)
    const storage = new StorageService(repo)
    storage.setRoot(root)
    const references = new PlanReferenceService(repo, () => storage.getRootAbs())
    references.activateRoot(root)
    disposeService = () => references.dispose()
    const targets = new AgentTargetService(storage)
    await storage.createPlan('', 'Target')
    const frozenRoot = await targets.captureActiveLibrarySnapshot()
    const frozenWriteRoot = await references.captureAgentRootSnapshot(storage, frozenRoot,
      () => targets.assertActiveLibrarySnapshot(frozenRoot))
    const frozenTarget = await targets.captureAuditedTarget(frozenRoot, 'Target', 'plan')
    const originalDocument = await storage.readPlan('Target')

    let releaseQueue!: () => void
    let markQueueStarted!: () => void
    const queueGate = new Promise<void>((resolve) => { releaseQueue = resolve })
    const queueStarted = new Promise<void>((resolve) => { markQueueStarted = resolve })
    const blocker = references.runRendererMutation(async () => {
      markQueueStarted()
      await queueGate
    })
    await queueStarted

    let pendingWrite: Promise<unknown>
    if (operation === 'edit') {
      const changedDocument = structuredClone(originalDocument)
      changedDocument.components.push({ id: 'e'.repeat(32), type: 'note', payload: { content: 'must not be written' } })
      pendingWrite = references.saveAgentPlan(storage, 'Target', changedDocument, frozenWriteRoot, {
        path: frozenTarget.path, directoryIdentity: frozenTarget.directoryIdentity,
        planId: frozenTarget.planId, updatedAt: frozenTarget.updatedAt!
      }, () => targets.assertActiveLibrarySnapshot(frozenRoot))
    } else {
      pendingWrite = references.createAgentNode(storage, {
        kind: 'plan', parentPath: '', name: 'Unauthorized'
      }, frozenWriteRoot, () => targets.assertActiveLibrarySnapshot(frozenRoot))
    }

    await fs.rename(root, displacedRoot)
    await fs.mkdir(root)
    for (const child of await fs.readdir(displacedRoot)) {
      await fs.rename(join(displacedRoot, child), join(root, child))
    }
    releaseQueue()
    await blocker
    await expect(pendingWrite).rejects.toMatchObject({ code: ERR.CONFLICT })

    const current = await repo.readPlan(root, 'Target')
    expect(current.components).toEqual(originalDocument.components)
    if (operation === 'create') {
      await expect(fs.access(join(root, 'Unauthorized'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
    await expect(fs.access(join(displacedRoot, 'Target'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['edit', 'create'] as const)(
    'detects a same-path root replacement after the Agent %s guard but before the real storage write', async (operation) => {
      const [{ PlanRepository }, { StorageService }, { PlanReferenceService }, { AgentTargetService }] = await Promise.all([
        import('../src/main/services/plan-repository'),
        import('../src/main/services/storage-service'),
        import('../src/main/services/plan-reference-service'),
        import('../src/main/services/agent-target-service')
      ])
      const directory = await fs.mkdtemp(join(tmpdir(), 'trace-agent-storage-write-root-race-'))
      roots.push(directory)
      const root = join(directory, 'library')
      const displacedRoot = join(directory, 'displaced-root')
      await fs.mkdir(root)
      const repo = new PlanRepository()
      await repo.ensureLibraryRoot(root)
      const storage = new StorageService(repo)
      storage.setRoot(root)
      const references = new PlanReferenceService(repo, () => storage.getRootAbs())
      references.activateRoot(root)
      disposeService = () => references.dispose()
      const targets = new AgentTargetService(storage)
      await storage.createPlan('', 'Target')
      const activeRoot = await targets.captureActiveLibrarySnapshot()
      const frozenRoot = await references.captureAgentRootSnapshot(storage, activeRoot,
        () => targets.assertActiveLibrarySnapshot(activeRoot))
      const target = await targets.captureAuditedTarget(activeRoot, 'Target', 'plan')
      const original = await storage.readPlan('Target')
      const replaceRootAtSamePath = async (): Promise<void> => {
        await fs.rename(root, displacedRoot)
        await fs.mkdir(root)
        for (const child of await fs.readdir(displacedRoot)) {
          await fs.rename(join(displacedRoot, child), join(root, child))
        }
      }

      if (operation === 'edit') {
        const changed = structuredClone(original)
        changed.components.push({ id: 'd'.repeat(32), type: 'note', payload: { content: 'MUST_NOT_WRITE_AFTER_ROOT_SWAP' } })
        const write = storage.savePlan.bind(storage)
        vi.spyOn(storage, 'savePlan').mockImplementationOnce(async (...args) => {
          await replaceRootAtSamePath()
          return write(...args)
        })
        await expect(references.saveAgentPlan(storage, 'Target', changed, frozenRoot, {
          path: target.path, directoryIdentity: target.directoryIdentity, planId: target.planId,
          updatedAt: target.updatedAt!
        }, () => targets.assertActiveLibrarySnapshot(activeRoot))).rejects.toMatchObject({ code: ERR.CONFLICT })
      } else {
        const create = storage.createPlan.bind(storage)
        vi.spyOn(storage, 'createPlan').mockImplementationOnce(async (...args) => {
          await replaceRootAtSamePath()
          return create(...args)
        })
        await expect(references.createAgentNode(storage, {
          kind: 'plan', parentPath: '', name: 'MustNotExist'
        }, frozenRoot, () => targets.assertActiveLibrarySnapshot(activeRoot))).rejects.toMatchObject({ code: ERR.CONFLICT })
      }

      const current = await repo.readPlan(root, 'Target')
      expect(current.components).toEqual(original.components)
      if (operation === 'create') await expect(fs.access(join(root, 'MustNotExist'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  )

  it('rejects an Agent plan edit when the same-path target directory is replaced before the atomic write', async () => {
    const [{ PlanRepository }, { StorageService }, { PlanReferenceService }, { AgentTargetService }] = await Promise.all([
      import('../src/main/services/plan-repository'),
      import('../src/main/services/storage-service'),
      import('../src/main/services/plan-reference-service'),
      import('../src/main/services/agent-target-service')
    ])
    const directory = await fs.mkdtemp(join(tmpdir(), 'trace-agent-target-directory-cas-'))
    roots.push(directory)
    const root = join(directory, 'library')
    const displacedTarget = join(directory, 'displaced-target')
    await fs.mkdir(root)
    const repo = new PlanRepository()
    await repo.ensureLibraryRoot(root)
    const storage = new StorageService(repo)
    storage.setRoot(root)
    const references = new PlanReferenceService(repo, () => storage.getRootAbs())
    references.activateRoot(root)
    disposeService = () => references.dispose()
    const targets = new AgentTargetService(storage)
    await storage.createPlan('', 'Target')
    const activeRoot = await targets.captureActiveLibrarySnapshot()
    const rootSnapshot = await references.captureAgentRootSnapshot(storage, activeRoot,
      () => targets.assertActiveLibrarySnapshot(activeRoot))
    const target = await targets.captureAuditedTarget(activeRoot, 'Target', 'plan')
    const original = await storage.readPlan('Target')
    const changed = structuredClone(original)
    changed.components.push({ id: 'f'.repeat(32), type: 'note', payload: { content: 'must not reach replacement' } })
    const savePlan = storage.savePlan.bind(storage)
    vi.spyOn(storage, 'savePlan').mockImplementationOnce(async (...args) => {
      await fs.rename(join(root, 'Target'), displacedTarget)
      await fs.mkdir(join(root, 'Target'))
      await fs.copyFile(join(displacedTarget, 'plan.json'), join(root, 'Target', 'plan.json'))
      return savePlan(...args)
    })

    await expect(references.saveAgentPlan(storage, 'Target', changed, rootSnapshot, {
      path: target.path, directoryIdentity: target.directoryIdentity, planId: target.planId,
      updatedAt: target.updatedAt!
    }, () => targets.assertActiveLibrarySnapshot(activeRoot))).rejects.toMatchObject({ code: ERR.CONFLICT })

    await expect(storage.readPlan('Target')).resolves.toEqual(original)
    await expect(fs.readFile(join(displacedTarget, 'plan.json'), 'utf8').then((content) => JSON.parse(content)))
      .resolves.toEqual(original)
  })

  it('rejects an Agent folder create when its same-path parent is replaced before mkdir', async () => {
    const [{ PlanRepository }, { StorageService }, { PlanReferenceService }, { AgentTargetService }] = await Promise.all([
      import('../src/main/services/plan-repository'),
      import('../src/main/services/storage-service'),
      import('../src/main/services/plan-reference-service'),
      import('../src/main/services/agent-target-service')
    ])
    const directory = await fs.mkdtemp(join(tmpdir(), 'trace-agent-parent-directory-cas-'))
    roots.push(directory)
    const root = join(directory, 'library')
    const displacedParent = join(directory, 'displaced-parent')
    await fs.mkdir(root)
    const repo = new PlanRepository()
    await repo.ensureLibraryRoot(root)
    const storage = new StorageService(repo)
    storage.setRoot(root)
    const references = new PlanReferenceService(repo, () => storage.getRootAbs())
    references.activateRoot(root)
    disposeService = () => references.dispose()
    const targets = new AgentTargetService(storage)
    await storage.createFolder('', 'Parent')
    const activeRoot = await targets.captureActiveLibrarySnapshot()
    const rootSnapshot = await references.captureAgentRootSnapshot(storage, activeRoot,
      () => targets.assertActiveLibrarySnapshot(activeRoot))
    const parent = await targets.captureAuditedTarget(activeRoot, 'Parent', 'folder')
    const createFolder = storage.createFolder.bind(storage)
    vi.spyOn(storage, 'createFolder').mockImplementationOnce(async (...args) => {
      await fs.rename(join(root, 'Parent'), displacedParent)
      await fs.mkdir(join(root, 'Parent'))
      return createFolder(...args)
    })

    await expect(references.createAgentNode(storage, {
      kind: 'folder', parentPath: 'Parent', name: 'Created', parentDirectoryIdentity: parent.directoryIdentity
    }, rootSnapshot, () => targets.assertActiveLibrarySnapshot(activeRoot))).rejects.toMatchObject({ code: ERR.CONFLICT })

    await expect(fs.access(join(root, 'Parent', 'Created'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.access(join(displacedParent, 'Created'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects an Agent plan when its newly-created directory is replaced before plan.json is written', async () => {
    const [{ PlanRepository }, { StorageService }, { PlanReferenceService }, { AgentTargetService }] = await Promise.all([
      import('../src/main/services/plan-repository'),
      import('../src/main/services/storage-service'),
      import('../src/main/services/plan-reference-service'),
      import('../src/main/services/agent-target-service')
    ])
    const directory = await fs.mkdtemp(join(tmpdir(), 'trace-agent-created-plan-identity-cas-'))
    roots.push(directory)
    const root = join(directory, 'library')
    const displaced = join(directory, 'displaced-created-plan')
    await fs.mkdir(root)
    const repo = new PlanRepository()
    await repo.ensureLibraryRoot(root)
    const storage = new StorageService(repo)
    storage.setRoot(root)
    const references = new PlanReferenceService(repo, () => storage.getRootAbs())
    references.activateRoot(root)
    disposeService = () => references.dispose()
    const targets = new AgentTargetService(storage)
    const activeRoot = await targets.captureActiveLibrarySnapshot()
    const binding = await references.captureAgentRootSnapshot(storage, activeRoot,
      () => targets.assertActiveLibrarySnapshot(activeRoot))
    const writePlanAtomic = repo.writePlanAtomic.bind(repo)
    let replacementReachedWriteSeam = false
    vi.spyOn(repo, 'writePlanAtomic').mockImplementationOnce(async (rootAbs, relativePath, document, mutationGuard, targetMustNotExist) => {
      replacementReachedWriteSeam = true
      await fs.rename(join(root, 'Created'), displaced)
      await fs.mkdir(join(root, 'Created'))
      await fs.writeFile(join(root, 'Created', 'plan.json'), JSON.stringify({ marker: 'replacement plan' }))
      return writePlanAtomic(rootAbs, relativePath, document, mutationGuard, targetMustNotExist)
    })

    await expect(references.createAgentNode(storage, {
      kind: 'plan', parentPath: '', name: 'Created'
    }, binding, () => targets.assertActiveLibrarySnapshot(activeRoot)))
      .rejects.toMatchObject({ code: ERR.CONFLICT })

    expect(replacementReachedWriteSeam).toBe(true)
    await expect(fs.readFile(join(root, 'Created', 'plan.json'), 'utf8'))
      .resolves.toBe(JSON.stringify({ marker: 'replacement plan' }))
    await expect(fs.readdir(displaced)).resolves.toEqual([])
  })

  it('rejects an Agent plan rename when the same-path target directory is replaced before move', async () => {
    const [{ PlanRepository }, { StorageService }, { PlanReferenceService }, { AgentTargetService }] = await Promise.all([
      import('../src/main/services/plan-repository'),
      import('../src/main/services/storage-service'),
      import('../src/main/services/plan-reference-service'),
      import('../src/main/services/agent-target-service')
    ])
    const directory = await fs.mkdtemp(join(tmpdir(), 'trace-agent-rename-target-cas-'))
    roots.push(directory)
    const root = join(directory, 'library')
    const displacedTarget = join(directory, 'displaced-target')
    await fs.mkdir(root)
    const repo = new PlanRepository()
    await repo.ensureLibraryRoot(root)
    const storage = new StorageService(repo)
    storage.setRoot(root)
    const references = new PlanReferenceService(repo, () => storage.getRootAbs())
    references.activateRoot(root)
    disposeService = () => references.dispose()
    const targets = new AgentTargetService(storage)
    await storage.createPlan('', 'Target')
    const activeRoot = await targets.captureActiveLibrarySnapshot()
    const rootSnapshot = await references.captureAgentRootSnapshot(storage, activeRoot,
      () => targets.assertActiveLibrarySnapshot(activeRoot))
    const target = await targets.captureAuditedTarget(activeRoot, 'Target', 'plan')
    const original = await storage.readPlan('Target')
    const preview = await references.previewImpact({ library_id: activeRoot.libraryId, operation: 'rename-plan',
      path: 'Target', new_name: 'Renamed', expected_updated_at: target.updatedAt })
    const renamePlan = storage.renamePlan.bind(storage)
    vi.spyOn(storage, 'renamePlan').mockImplementationOnce(async (...args) => {
      await fs.rename(join(root, 'Target'), displacedTarget)
      await fs.mkdir(join(root, 'Target'))
      await fs.copyFile(join(displacedTarget, 'plan.json'), join(root, 'Target', 'plan.json'))
      return renamePlan(...args)
    })

    await expect(references.commitAgentImpact({ library_id: activeRoot.libraryId, preview, rename_action: 'keep' }, storage, {
      rootSnapshot,
      validateRootSnapshot: () => targets.assertActiveLibrarySnapshot(activeRoot),
      target: { path: target.path, directoryIdentity: target.directoryIdentity,
        planId: target.planId, updatedAt: target.updatedAt! }
    })).rejects.toMatchObject({ code: ERR.CONFLICT })

    await expect(storage.readPlan('Target')).resolves.toEqual(original)
    await expect(fs.readFile(join(displacedTarget, 'plan.json'), 'utf8').then((content) => JSON.parse(content)))
      .resolves.toEqual(original)
    await expect(fs.access(join(root, 'Renamed'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['source', 'destination'] as const)(
    'rejects an Agent move when its same-path %s directory is replaced before move', async (replacedSide) => {
      const [{ PlanRepository }, { StorageService }, { PlanReferenceService }] = await Promise.all([
        import('../src/main/services/plan-repository'),
        import('../src/main/services/storage-service'),
        import('../src/main/services/plan-reference-service')
      ])
      const directory = await fs.mkdtemp(join(tmpdir(), `trace-agent-move-${replacedSide}-cas-`))
      roots.push(directory)
      const root = join(directory, 'library')
      const displaced = join(directory, `displaced-${replacedSide}`)
      await fs.mkdir(root)
      const repo = new PlanRepository()
      await repo.ensureLibraryRoot(root)
      const storage = new StorageService(repo)
      storage.setRoot(root)
      const references = new PlanReferenceService(repo, () => storage.getRootAbs())
      references.activateRoot(root)
      disposeService = () => references.dispose()
      await storage.createPlan('', 'Source')
      await storage.createFolder('', 'Destination')
      const binding = await captureAgentRootCommitBinding(storage, references)
      const originalSource = await storage.readPlan('Source')
      const preview = await references.previewAgentMove({ path: 'Source', target_parent_path: 'Destination' }, storage)
      const moveDirAtomic = repo.moveDirAtomic.bind(repo)
      vi.spyOn(repo, 'moveDirAtomic').mockImplementationOnce(async (from, to, mutationGuard) => {
        if (replacedSide === 'source') {
          await fs.rename(from, displaced)
          await fs.mkdir(from)
          await fs.copyFile(join(displaced, 'plan.json'), join(from, 'plan.json'))
        } else {
          await fs.rename(join(root, 'Destination'), displaced)
          await fs.mkdir(join(root, 'Destination'))
        }
        return moveDirAtomic(from, to, mutationGuard)
      })

      await expect(references.commitAgentMove(preview.token, storage, binding)).rejects.toMatchObject({ code: ERR.CONFLICT })

      await expect(fs.access(join(root, 'Destination', 'Source'))).rejects.toMatchObject({ code: 'ENOENT' })
      if (replacedSide === 'source') {
        await expect(storage.readPlan('Source')).resolves.toEqual(originalSource)
        await expect(fs.readFile(join(displaced, 'plan.json'), 'utf8').then((content) => JSON.parse(content)))
          .resolves.toEqual(originalSource)
      } else {
        await expect(storage.readPlan('Source')).resolves.toEqual(originalSource)
      }
    }
  )

  it.each(['descendant-directory', 'descendant-plan-revision'] as const)(
    'rechecks the Agent move %s at the final structure-move seam', async (change) => {
      const [{ PlanRepository }, { StorageService }, { PlanReferenceService }] = await Promise.all([
        import('../src/main/services/plan-repository'),
        import('../src/main/services/storage-service'),
        import('../src/main/services/plan-reference-service')
      ])
      const directory = await fs.mkdtemp(join(tmpdir(), `trace-agent-move-final-${change}-cas-`))
      roots.push(directory)
      const root = join(directory, 'library')
      const displaced = join(directory, 'displaced-descendant')
      await fs.mkdir(root)
      const repo = new PlanRepository()
      await repo.ensureLibraryRoot(root)
      const storage = new StorageService(repo)
      storage.setRoot(root)
      const references = new PlanReferenceService(repo, () => storage.getRootAbs())
      references.activateRoot(root)
      disposeService = () => references.dispose()
      await storage.createFolder('', 'Source')
      await storage.createPlan('Source', 'Nested')
      await storage.createFolder('', 'Destination')
      const binding = await captureAgentRootCommitBinding(storage, references)
      const preview = await references.previewAgentMove({ path: 'Source', target_parent_path: 'Destination' }, storage)
      const movePlanRaw = storage.movePlanRaw.bind(storage)
      let finalSeamReached = false
      vi.spyOn(storage, 'movePlanRaw').mockImplementationOnce(async (snapshot, generation, mutationGuard) => {
        finalSeamReached = true
        if (change === 'descendant-directory') {
          await fs.rename(join(root, 'Source', 'Nested'), displaced)
          await fs.mkdir(join(root, 'Source', 'Nested'))
        } else {
          const changed = await repo.readPlan(root, 'Source/Nested')
          changed.components.push({ id: 'abababababababababababababababab', type: 'note', payload: { content: 'external revision' } })
          await repo.writePlanAtomic(root, 'Source/Nested', changed)
        }
        return movePlanRaw(snapshot, generation, mutationGuard)
      })

      await expect(references.commitAgentMove(preview.token, storage, binding))
        .rejects.toMatchObject({ code: ERR.CONFLICT })

      expect(finalSeamReached).toBe(true)
      await expect(fs.access(join(root, 'Source'))).resolves.toBeUndefined()
      await expect(fs.access(join(root, 'Destination', 'Source'))).rejects.toMatchObject({ code: 'ENOENT' })
      if (change === 'descendant-directory') await expect(fs.access(displaced)).resolves.toBeUndefined()
    }
  )

  it.each(['rename', 'trash'] as const)(
    'rejects an Agent folder %s when its same-path target directory is replaced before the structural move', async (operation) => {
      const [{ PlanRepository }, { StorageService }, { PlanReferenceService }] = await Promise.all([
        import('../src/main/services/plan-repository'),
        import('../src/main/services/storage-service'),
        import('../src/main/services/plan-reference-service')
      ])
      const directory = await fs.mkdtemp(join(tmpdir(), `trace-agent-folder-${operation}-target-cas-`))
      roots.push(directory)
      const root = join(directory, 'library')
      const displaced = join(directory, 'displaced-folder')
      await fs.mkdir(root)
      const repo = new PlanRepository()
      await repo.ensureLibraryRoot(root)
      const storage = new StorageService(repo)
      storage.setRoot(root)
      const references = new PlanReferenceService(repo, () => storage.getRootAbs())
      references.activateRoot(root)
      disposeService = () => references.dispose()
      const binding = await captureAgentRootCommitBinding(storage, references)
      await storage.createFolder('', 'Scope')
      await fs.writeFile(join(root, 'Scope', 'original.txt'), 'original payload')
      const originalMarker = await fs.readFile(join(root, 'Scope', 'original.txt'), 'utf8')
      const preview = await references.previewAgentFolderOperation({
        operation, path: 'Scope', ...(operation === 'rename' ? { new_name: 'RenamedScope' } : {})
      }, storage)
      if (operation === 'rename') {
        const moveDir = repo.moveDir.bind(repo)
        vi.spyOn(repo, 'moveDir').mockImplementationOnce(async (from, to, mutationGuard) => {
          await fs.rename(join(root, 'Scope'), displaced)
          await fs.mkdir(join(root, 'Scope'))
          await fs.writeFile(join(root, 'Scope', 'replacement.txt'), 'replacement payload')
          return moveDir(from, to, mutationGuard)
        })
      } else {
        const moveDirAtomic = repo.moveDirAtomic.bind(repo)
        vi.spyOn(repo, 'moveDirAtomic').mockImplementationOnce(async (from, to, mutationGuard) => {
          await fs.rename(join(root, 'Scope'), displaced)
          await fs.mkdir(join(root, 'Scope'))
          await fs.writeFile(join(root, 'Scope', 'replacement.txt'), 'replacement payload')
          return moveDirAtomic(from, to, mutationGuard)
        })
      }

      const commit = operation === 'rename'
        ? references.commitAgentFolderOperation({ token: preview.token }, storage, binding)
        : references.commitAgentFolderOperation({ token: preview.token, decisions: [] }, storage, binding)
      await expect(commit).rejects.toMatchObject({ code: ERR.CONFLICT })

      await expect(fs.readFile(join(root, 'Scope', 'replacement.txt'), 'utf8')).resolves.toBe('replacement payload')
      await expect(fs.readFile(join(displaced, 'original.txt'), 'utf8')).resolves.toBe(originalMarker)
      await expect(fs.access(join(root, 'RenamedScope'))).rejects.toMatchObject({ code: 'ENOENT' })
      const trashEntries = await storage.listTrashEntries()
      expect(trashEntries).toHaveLength(0)
    }
  )

  it.each(['rename', 'trash'] as const)(
    'checks an Agent folder %s subtree before the first linked-plan write', async (operation) => {
      const [{ PlanRepository }, { StorageService }, { PlanReferenceService }] = await Promise.all([
        import('../src/main/services/plan-repository'),
        import('../src/main/services/storage-service'),
        import('../src/main/services/plan-reference-service')
      ])
      const directory = await fs.mkdtemp(join(tmpdir(), `trace-agent-folder-${operation}-subtree-cas-`))
      roots.push(directory)
      const root = join(directory, 'library')
      const displaced = join(directory, 'displaced-folder')
      await fs.mkdir(root)
      const repo = new PlanRepository()
      await repo.ensureLibraryRoot(root)
      const storage = new StorageService(repo)
      storage.setRoot(root)
      const references = new PlanReferenceService(repo, () => storage.getRootAbs())
      references.activateRoot(root)
      disposeService = () => references.dispose()
      await storage.createFolder('', 'Scope')
      await storage.createPlan('Scope', 'Target')
      await storage.createPlan('', 'Source')
      await storage.createPlan('', 'Replacement')
      const target = await storage.readPlan('Scope/Target')
      target.plan_id = '11111111111111111111111111111111'
      await storage.savePlan('Scope/Target', target, target.updated_at)
      const originalTarget = await storage.readPlan('Scope/Target')
      const replacement = await storage.readPlan('Replacement')
      replacement.plan_id = '22222222222222222222222222222222'
      await storage.savePlan('Replacement', replacement, replacement.updated_at)
      const source = await storage.readPlan('Source')
      source.plan_id = '33333333333333333333333333333333'
      source.components.push({
        id: '44444444444444444444444444444444',
        type: 'plan_reference',
        payload: {
          mode: 'link', target_plan_id: target.plan_id!,
          target_path_snapshot: 'Scope/Target', target_name_snapshot: 'Target'
        }
      })
      await storage.savePlan('Source', source, source.updated_at)
      const originalSource = await storage.readPlan('Source')
      const binding = await captureAgentRootCommitBinding(storage, references)
      let validations = 0
      let replacementInjected = false
      const validateRootSnapshot = binding.validateRootSnapshot
      binding.validateRootSnapshot = async () => {
        await validateRootSnapshot()
        validations += 1
        if (validations === 3) {
          replacementInjected = true
          await fs.rename(join(root, 'Scope'), displaced)
          await fs.mkdir(join(root, 'Scope'))
          await fs.cp(displaced, join(root, 'Scope'), { recursive: true })
        }
      }
      const preview = await references.previewAgentFolderOperation({
        operation, path: 'Scope', ...(operation === 'rename' ? { new_name: 'RenamedScope' } : {})
      }, storage)
      expect(preview.references).toHaveLength(1)
      const request = operation === 'rename'
        ? { token: preview.token, rename_action: 'update' }
        : { token: preview.token, decisions: [{
          source_path: 'Source', source_component_id: '44444444444444444444444444444444', action: 'replace',
          replacement: { path: 'Replacement' }
        }] }
      const savePlan = vi.spyOn(storage, 'savePlan')

      const commit = references.commitAgentFolderOperation(request, storage, binding)
      const commitError = await commit.then(() => null, (error: unknown) => error)
      expect(commitError).toMatchObject({ code: ERR.CONFLICT })

      expect(validations).toBeGreaterThanOrEqual(3)
      expect(replacementInjected).toBe(true)
      await expect(fs.access(displaced)).resolves.toBeUndefined()
      expect(savePlan).not.toHaveBeenCalled()
      await expect(storage.readPlan('Source')).resolves.toEqual(originalSource)
      await expect(fs.readFile(join(displaced, 'Target', 'plan.json'), 'utf8').then((content) => JSON.parse(content)))
        .resolves.toEqual(originalTarget)
      await expect(fs.access(join(root, 'Scope', 'Target', 'plan.json'))).resolves.toBeUndefined()
      await expect(fs.access(join(root, 'RenamedScope'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  )

  it.each(['before after-write capture', 'after after-write identity capture'] as const)(
    'rejects a same-path replacement of an already written source plan %s before folder rename', async (raceWindow) => {
      const [{ PlanRepository }, { StorageService }, { PlanReferenceService }] = await Promise.all([
        import('../src/main/services/plan-repository'),
        import('../src/main/services/storage-service'),
        import('../src/main/services/plan-reference-service')
      ])
      const directory = await fs.mkdtemp(join(tmpdir(), 'trace-agent-folder-selective-plan-cas-'))
      roots.push(directory)
      const root = join(directory, 'library')
      const displacedSourceAPlanFile = join(directory, 'displaced-source-a-plan.json')
      const sourceAPlanFile = join(root, 'Scope', 'SourceA', 'plan.json')
      await fs.mkdir(root)
      const repo = new PlanRepository()
      await repo.ensureLibraryRoot(root)
      const storage = new StorageService(repo)
      storage.setRoot(root)
      const references = new PlanReferenceService(repo, () => storage.getRootAbs())
      references.activateRoot(root)
      disposeService = () => references.dispose()
      await storage.createFolder('', 'Scope')
      await storage.createPlan('Scope', 'Target')
      await storage.createPlan('Scope', 'SourceA')
      await storage.createPlan('Scope', 'SourceB')
      const target = await storage.readPlan('Scope/Target')
      target.plan_id = '11111111111111111111111111111111'
      await storage.savePlan('Scope/Target', target, target.updated_at)
      const sourceA = await storage.readPlan('Scope/SourceA')
      sourceA.plan_id = '22222222222222222222222222222222'
      sourceA.components.push({ id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', type: 'plan_reference', payload: {
        mode: 'link', target_plan_id: target.plan_id!, target_path_snapshot: 'Scope/Target', target_name_snapshot: 'Target'
      } })
      await storage.savePlan('Scope/SourceA', sourceA, sourceA.updated_at)
      const sourceB = await storage.readPlan('Scope/SourceB')
      sourceB.plan_id = '33333333333333333333333333333333'
      sourceB.components.push({ id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', type: 'plan_reference', payload: {
        mode: 'link', target_plan_id: target.plan_id!, target_path_snapshot: 'Scope/Target', target_name_snapshot: 'Target'
      } })
      await storage.savePlan('Scope/SourceB', sourceB, sourceB.updated_at)
      const originalSourceBBytes = await fs.readFile(join(root, 'Scope', 'SourceB', 'plan.json'))
      const binding = await captureAgentRootCommitBinding(storage, references)
      const preview = await references.previewAgentFolderOperation({
        operation: 'rename', path: 'Scope', new_name: 'RenamedScope'
      }, storage)
      expect(preview.references).toHaveLength(2)
      const savePlan = storage.savePlan.bind(storage)
      const originalLstat = fs.lstat.bind(fs)
      let completedSourceWrites = 0
      let sourceAReplacementReachedBarrier = false
      let sourceAPlanFileStatsAfterWrite = 0
      let sourceAUpdatedAtAfterWrite = ''
      let sourceAPlanIdAfterWrite: string | undefined
      let expectedReplacementBytes: Buffer | undefined
      const replaceSourceAPlan = async (
        committedSourceA: Awaited<ReturnType<typeof storage.readPlan>>,
        expectedUpdatedAt: string,
        expectedPlanId: string | undefined
      ) => {
        const reference = committedSourceA.components[0]
        if (reference.type !== 'plan_reference') throw new Error('SourceA reference fixture is invalid')
        const payload = reference.payload as { target_name_snapshot: string }
        payload.target_name_snapshot = 'Concurrent replacement'
        const committedBytes = await fs.readFile(sourceAPlanFile)
        const replacementBytes = Buffer.from(JSON.stringify(committedSourceA, null, 2))
        await fs.rename(sourceAPlanFile, displacedSourceAPlanFile)
        await fs.writeFile(sourceAPlanFile, replacementBytes)
        sourceAReplacementReachedBarrier = committedSourceA.updated_at === expectedUpdatedAt &&
          committedSourceA.plan_id === expectedPlanId && committedBytes.length !== replacementBytes.length
        expectedReplacementBytes = replacementBytes
      }
      const lstatSpy = vi.spyOn(fs, 'lstat').mockImplementation(async (path, options) => {
        const stat = await originalLstat(path, options)
        if (raceWindow === 'after after-write identity capture' && completedSourceWrites === 1 &&
          typeof path === 'string' && path === sourceAPlanFile) {
          sourceAPlanFileStatsAfterWrite += 1
          if (sourceAPlanFileStatsAfterWrite === 2) {
            // The second lstat is the verified file identity recorded by the after-write subtree snapshot.
            // Replace the file immediately after that identity is observed, preserving its CAS timestamp.
            const committedSourceA = await storage.readPlan('Scope/SourceA')
            await replaceSourceAPlan(committedSourceA, sourceAUpdatedAtAfterWrite, sourceAPlanIdAfterWrite)
          }
        }
        return stat
      })
      vi.spyOn(storage, 'savePlan').mockImplementation(async (path, document, expectedUpdatedAt, mutationGuard) => {
        const result = await savePlan(path, document, expectedUpdatedAt, mutationGuard)
        completedSourceWrites += 1
        if (completedSourceWrites === 1) {
          sourceAUpdatedAtAfterWrite = result.updated_at
          sourceAPlanIdAfterWrite = document.plan_id
          if (raceWindow === 'before after-write capture') {
            // SavePlan completed the real write; replace its file before the wrapper returns to the service.
            const committedSourceA = await storage.readPlan('Scope/SourceA')
            await replaceSourceAPlan(committedSourceA, result.updated_at, document.plan_id)
          }
        }
        return result
      })

      try {
        await expect(references.commitAgentFolderOperation({ token: preview.token, rename_action: 'update' }, storage, binding))
          .rejects.toMatchObject({ code: ERR.CONFLICT })
      } finally {
        lstatSpy.mockRestore()
      }

      expect(sourceAReplacementReachedBarrier).toBe(true)
      if (raceWindow === 'after after-write identity capture') {
        expect(sourceAPlanFileStatsAfterWrite).toBeGreaterThanOrEqual(2)
      }
      await expect(fs.access(join(root, 'RenamedScope'))).rejects.toMatchObject({ code: 'ENOENT' })
      expect(completedSourceWrites).toBe(1)
      await expect(fs.access(displacedSourceAPlanFile)).resolves.toBeUndefined()
      await expect(fs.readFile(join(root, 'Scope', 'SourceB', 'plan.json'))).resolves.toEqual(originalSourceBBytes)
      const replacementSourceA = await storage.readPlan('Scope/SourceA')
      expect(replacementSourceA.updated_at).toBe(sourceAUpdatedAtAfterWrite)
      expect(replacementSourceA.plan_id).toBe(sourceAPlanIdAfterWrite)
      expect((replacementSourceA.components[0].payload as { target_name_snapshot: string }).target_name_snapshot)
        .toBe('Concurrent replacement')
      await expect(fs.readFile(sourceAPlanFile)).resolves.toEqual(expectedReplacementBytes)
    }
  )

  it.each(['folder-rename', 'folder-trash', 'move', 'trash-restore', 'trash-purge'] as const)(
    'rejects an Agent %s when the frozen root identity changes while the commit waits in the queue', async (operation) => {
      const [{ PlanRepository }, { StorageService }, { PlanReferenceService }, { AgentTargetService }] = await Promise.all([
        import('../src/main/services/plan-repository'),
        import('../src/main/services/storage-service'),
        import('../src/main/services/plan-reference-service'),
        import('../src/main/services/agent-target-service')
      ])
      const directory = await fs.mkdtemp(join(tmpdir(), 'trace-agent-structural-root-cas-'))
      roots.push(directory)
      const root = join(directory, 'library')
      const displacedRoot = join(directory, 'displaced-root')
      await fs.mkdir(root)
      const repo = new PlanRepository()
      await repo.ensureLibraryRoot(root)
      const storage = new StorageService(repo)
      storage.setRoot(root)
      const references = new PlanReferenceService(repo, () => storage.getRootAbs())
      references.activateRoot(root)
      disposeService = () => references.dispose()
      const targets = new AgentTargetService(storage)
      const activeRoot = await targets.captureActiveLibrarySnapshot()
      const frozenRoot = await references.captureAgentRootSnapshot(storage, activeRoot,
        () => targets.assertActiveLibrarySnapshot(activeRoot))
      const binding: AgentRootCommitBinding = {
        rootSnapshot: frozenRoot,
        validateRootSnapshot: () => targets.assertActiveLibrarySnapshot(activeRoot)
      }
      const agentReferences = references as unknown as {
        commitAgentFolderOperation(input: unknown, service: typeof storage, binding: AgentRootCommitBinding): Promise<unknown>
        commitAgentMove(token: unknown, service: typeof storage, binding: AgentRootCommitBinding): Promise<unknown>
        commitTrashRestore(service: typeof storage, token: string, binding: AgentRootCommitBinding): Promise<unknown>
        commitTrashPurge(service: typeof storage, token: string, binding: AgentRootCommitBinding): Promise<unknown>
      }

      let queuedOperation: () => Promise<unknown>
      let sideEffect: ReturnType<typeof vi.spyOn>
      if (operation === 'folder-rename' || operation === 'folder-trash') {
        await storage.createFolder('', 'Source')
        const preview = await references.previewAgentFolderOperation({
          operation: operation === 'folder-rename' ? 'rename' : 'trash', path: 'Source',
          ...(operation === 'folder-rename' ? { new_name: 'Renamed' } : {})
        }, storage)
        sideEffect = operation === 'folder-rename'
          ? vi.spyOn(storage, 'renamePlan')
          : vi.spyOn(storage, 'trashPlan')
        queuedOperation = () => agentReferences.commitAgentFolderOperation({
          token: preview.token, ...(operation === 'folder-trash' ? { decisions: [] } : {})
        }, storage, binding)
      } else if (operation === 'move') {
        await storage.createFolder('', 'Source')
        await storage.createFolder('', 'Destination')
        const preview = await references.previewAgentMove({ path: 'Source', target_parent_path: 'Destination' }, storage)
        sideEffect = vi.spyOn(storage, 'movePlanRaw')
        queuedOperation = () => agentReferences.commitAgentMove(preview.token, storage, binding)
      } else {
        await storage.createPlan('', 'Trashed')
        const entry = await storage.trashPlan('Trashed')
        const preview = operation === 'trash-restore'
          ? await storage.previewTrashRestore(entry.id)
          : await storage.previewTrashPurge(entry.id)
        sideEffect = operation === 'trash-restore'
          ? vi.spyOn(storage, 'commitTrashRestore')
          : vi.spyOn(storage, 'commitTrashPurge')
        queuedOperation = () => operation === 'trash-restore'
          ? agentReferences.commitTrashRestore(storage, preview.confirmation_token, binding)
          : agentReferences.commitTrashPurge(storage, preview.confirmation_token, binding)
      }

      let releaseQueue!: () => void
      let markQueueStarted!: () => void
      const queueGate = new Promise<void>((resolve) => { releaseQueue = resolve })
      const queueStarted = new Promise<void>((resolve) => { markQueueStarted = resolve })
      const blocker = references.runRendererMutation(async () => {
        markQueueStarted()
        await queueGate
      })
      await queueStarted
      const pendingCommit = queuedOperation()

      await fs.rename(root, displacedRoot)
      await fs.mkdir(root)
      for (const child of await fs.readdir(displacedRoot)) {
        await fs.rename(join(displacedRoot, child), join(root, child))
      }
      releaseQueue()
      await blocker

      await expect(pendingCommit).rejects.toMatchObject({ code: ERR.CONFLICT })
      expect(sideEffect!).not.toHaveBeenCalled()
      if (operation === 'folder-rename') await expect(fs.access(join(root, 'Source'))).resolves.toBeUndefined()
      if (operation === 'folder-trash') await expect(fs.access(join(root, 'Source'))).resolves.toBeUndefined()
      if (operation === 'move') await expect(fs.access(join(root, 'Destination', 'Source'))).rejects.toMatchObject({ code: 'ENOENT' })
      if (operation === 'trash-restore') await expect(fs.access(join(root, 'Trashed'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  )

  it('keeps an Agent folder preview bound to the root captured before a same-path replacement', async () => {
    const [{ PlanRepository }, { StorageService }, { PlanReferenceService }, { AgentTargetService }] = await Promise.all([
      import('../src/main/services/plan-repository'),
      import('../src/main/services/storage-service'),
      import('../src/main/services/plan-reference-service'),
      import('../src/main/services/agent-target-service')
    ])
    const directory = await fs.mkdtemp(join(tmpdir(), 'trace-agent-preview-root-binding-'))
    roots.push(directory)
    const root = join(directory, 'library')
    const displacedRoot = join(directory, 'displaced-root')
    await fs.mkdir(root)
    const repo = new PlanRepository()
    await repo.ensureLibraryRoot(root)
    const storage = new StorageService(repo)
    storage.setRoot(root)
    const references = new PlanReferenceService(repo, () => storage.getRootAbs())
    references.activateRoot(root)
    disposeService = () => references.dispose()
    const targets = new AgentTargetService(storage)
    const activeRoot = await targets.captureActiveLibrarySnapshot()
    const frozenRoot = await references.captureAgentRootSnapshot(storage, activeRoot,
      () => targets.assertActiveLibrarySnapshot(activeRoot))
    const binding: AgentRootCommitBinding = {
      rootSnapshot: frozenRoot,
      validateRootSnapshot: () => targets.assertActiveLibrarySnapshot(activeRoot)
    }
    const agentReferences = references as unknown as {
      commitAgentFolderOperation(input: unknown, service: typeof storage, binding: AgentRootCommitBinding): Promise<unknown>
    }
    await storage.createFolder('', 'Source')
    await fs.rename(root, displacedRoot)
    await fs.mkdir(root)
    for (const child of await fs.readdir(displacedRoot)) {
      await fs.rename(join(displacedRoot, child), join(root, child))
    }

    const reboundPreview = await references.previewAgentFolderOperation({ operation: 'rename', path: 'Source', new_name: 'Renamed' }, storage)
    const rename = vi.spyOn(storage, 'renamePlan')
    await expect(agentReferences.commitAgentFolderOperation({ token: reboundPreview.token }, storage, binding))
      .rejects.toMatchObject({ code: ERR.CONFLICT })
    expect(rename).not.toHaveBeenCalled()
    await expect(fs.access(join(root, 'Source'))).resolves.toBeUndefined()
  })
})
