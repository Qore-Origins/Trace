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
      getWindow: () => ({ webContents: { isDestroyed: () => false, send } }),
      log: vi.fn()
    } as unknown as Parameters<typeof registerIpc>[0])

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
})
