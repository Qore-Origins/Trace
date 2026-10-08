import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ERR } from '../src/shared/errors'

const electronMocks = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>()
  return {
    handlers,
    ipcMain: {
      handle: vi.fn((channel: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => handlers.set(channel, handler)),
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
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

describe('plan trash IPC boundary', () => {
  let root: string
  let dispose: (() => void) | undefined
  let disposeReferences: (() => void) | undefined

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    electronMocks.handlers.clear()
  })

  afterEach(async () => {
    dispose?.()
    dispose = undefined
    disposeReferences?.()
    disposeReferences = undefined
    if (root) await fs.rm(root, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('exposes typed trash routes without roots and rejects the stale delete route without touching storage', async () => {
    const [{ registerIpc }, { PlanRepository }, { StorageService }, { PlanReferenceService }] = await Promise.all([
      import('../src/main/ipc/register'),
      import('../src/main/services/plan-repository'),
      import('../src/main/services/storage-service'),
      import('../src/main/services/plan-reference-service')
    ])
    await import('../src/preload/index')
    const bridge = electronMocks.contextBridge.exposeInMainWorld.mock.calls.at(-1)?.[1] as Bridge
    root = await fs.mkdtemp(join(tmpdir(), 'trace-trash-ipc-'))
    const repo = new PlanRepository()
    await repo.ensureLibraryRoot(root)
    const storage = new StorageService(repo)
    storage.setRoot(root)
    const planReferences = new PlanReferenceService(repo, () => storage.getRootAbs())
    planReferences.activateRoot(root)
    disposeReferences = () => planReferences.dispose()
    await storage.createPlan('', 'Protected')
    const deleteSpy = vi.spyOn(storage, 'deletePlan')
    const startup = {
      waitForRootActivation: async () => undefined,
      waitForBootstrap: async () => undefined,
      getRootActivationStatus: () => 'active',
      runAfterRootActivation: (operation: () => unknown) => Promise.resolve().then(operation),
      markRootActivated: vi.fn(), onWindowShown: vi.fn()
    }
    dispose = registerIpc({
      app: {}, storage, config: {}, transfer: {}, export: {}, search: {}, startup, planReferences,
      getWindow: () => null, log: vi.fn()
    } as unknown as Parameters<typeof registerIpc>[0])

    const listing = await bridge.invoke('trash:list', { root }) as { ok: boolean; data: unknown[] }
    expect(listing).toMatchObject({ ok: true, data: [] })
    expect(JSON.stringify(listing)).not.toContain(root)

    const staleDelete = await bridge.invoke('storage:deletePlan', { path: 'Protected', confirmed: true })
    expect(staleDelete).toMatchObject({ ok: false, code: ERR.CONFIRMATION_REQUIRED, data: null })
    expect(deleteSpy).not.toHaveBeenCalled()
    await expect(storage.readPlan('Protected')).resolves.toMatchObject({ components: [] })

    expect(electronMocks.ipcMain.handle).toHaveBeenCalledWith('storage:deletePlan', expect.any(Function))
    dispose()
    dispose = undefined
    expect(electronMocks.handlers.has('storage:deletePlan')).toBe(false)
  })

  it('does not let preload invoke an unlisted trash route', async () => {
    await import('../src/preload/index')
    const bridge = electronMocks.contextBridge.exposeInMainWorld.mock.calls.at(-1)?.[1] as Bridge
    const result = await bridge.invoke('trash:debug-delete', { path: 'anything' })
    expect(result).toMatchObject({ ok: false, code: 50, data: null })
    expect(electronMocks.ipcRenderer.invoke).not.toHaveBeenCalled()
  })

  it('requires trusted main-window acceptance for the exact validated purge snapshot', async () => {
    const [{ registerIpc }, { PlanRepository }, { StorageService }] = await Promise.all([
      import('../src/main/ipc/register'),
      import('../src/main/services/plan-repository'),
      import('../src/main/services/storage-service')
    ])
    await import('../src/preload/index')
    const bridge = electronMocks.contextBridge.exposeInMainWorld.mock.calls.at(-1)?.[1] as Bridge
    root = await fs.mkdtemp(join(tmpdir(), 'trace-trash-purge-confirmation-'))
    const repo = new PlanRepository()
    await repo.ensureLibraryRoot(root)
    const storage = new StorageService(repo)
    storage.setRoot(root)
    const validToken = 'main-owned-one-shot-token'
    const snapshot = {
      entry_id: 'trash-entry-01', kind: 'plan' as const, name: 'Reviewed plan',
      original_relative_path: 'Daily_Plan/Reviewed plan', plan_count: 1, reference_count: 2,
      status: 'trashed' as const, expires_at: new Date(Date.now() + 60_000).toISOString()
    }
    const snapshotReader = vi.spyOn(storage, 'getTrashPurgeConfirmationSnapshot').mockImplementation(async (token) => {
      if (token !== validToken) throw new Error('purge preview token is not valid')
      return snapshot
    })
    const commitTrashPurge = vi.fn(async (_storage: unknown, token: string) => {
      expect(token).toBe(validToken)
      return { changed_plan_ids: ['plan-id-01'] }
    })
    const presented: unknown[] = []
    let ownerAvailable = false
    let acceptInTrustedWindow = false
    const trustedOwner = {
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false }
    }
    const startup = {
      waitForRootActivation: async () => undefined,
      waitForBootstrap: async () => undefined,
      getRootActivationStatus: () => 'active',
      runAfterRootActivation: (operation: () => unknown) => Promise.resolve().then(operation),
      markRootActivated: vi.fn(), onWindowShown: vi.fn()
    }
    const disposeHandlers = registerIpc({
      app: {}, storage, config: {}, transfer: {}, export: {}, search: {}, startup,
      planReferences: { commitTrashPurge },
      requestTrustedTrashPurgeConfirmation: async (authoritativeSnapshot: unknown, accept: () => Promise<unknown>) => {
        presented.push(authoritativeSnapshot)
        if (acceptInTrustedWindow) await accept()
      },
      getWindow: () => ownerAvailable ? trustedOwner : null,
      log: vi.fn()
    } as unknown as Parameters<typeof registerIpc>[0])
    dispose = disposeHandlers

    const invokePurge = (confirmation_token: string) => bridge.invoke('trash:purge-commit', { confirmation_token })

    const missingOwner = await invokePurge(validToken)
    expect(missingOwner).toMatchObject({ ok: false, code: ERR.CONFIRMATION_REQUIRED })
    expect(presented).toHaveLength(0)
    expect(commitTrashPurge).not.toHaveBeenCalled()

    ownerAvailable = true
    const forged = await invokePurge('renderer-forged-token')
    expect(forged).toMatchObject({ ok: false })
    expect(presented).toHaveLength(0)
    expect(commitTrashPurge).not.toHaveBeenCalled()

    const cancelled = await invokePurge(validToken)
    expect(cancelled).toMatchObject({ ok: false, code: ERR.CONFIRMATION_REQUIRED })
    expect(presented).toEqual([snapshot])
    expect(JSON.stringify(presented)).not.toContain(validToken)
    expect(commitTrashPurge).not.toHaveBeenCalled()

    acceptInTrustedWindow = true
    await expect(invokePurge(validToken)).resolves.toMatchObject({
      ok: true, data: { changed_plan_ids: ['plan-id-01'] }
    })
    expect(presented).toEqual([snapshot, snapshot])
    expect(snapshotReader).toHaveBeenCalledTimes(4)
    expect(commitTrashPurge).toHaveBeenCalledOnce()
  })

  it('serializes reference-impact commits with library root switches', async () => {
    const [{ registerIpc }, { PlanRepository }, { StorageService }] = await Promise.all([
      import('../src/main/ipc/register'),
      import('../src/main/services/plan-repository'),
      import('../src/main/services/storage-service')
    ])
    await import('../src/preload/index')
    const bridge = electronMocks.contextBridge.exposeInMainWorld.mock.calls.at(-1)?.[1] as Bridge
    root = await fs.mkdtemp(join(tmpdir(), 'trace-trash-root-queue-'))
    const repo = new PlanRepository()
    await repo.ensureLibraryRoot(root)
    const storage = new StorageService(repo)
    storage.setRoot(root)
    const releaseRootSwitch = deferred<{ rootDir: string }>()
    const rootSwitchStarted = deferred<void>()
    const order: string[] = []
    const app = {
      setRootDir: vi.fn(async () => {
        order.push('root-start')
        rootSwitchStarted.resolve()
        const result = await releaseRootSwitch.promise
        order.push('root-end')
        return result
      })
    }
    const commitImpact = vi.fn(async () => {
      order.push('impact-commit')
      return { path: 'Plan' }
    })
    const startup = {
      waitForRootActivation: async () => undefined,
      waitForBootstrap: async () => undefined,
      getRootActivationStatus: () => 'active',
      runAfterRootActivation: (operation: () => unknown) => Promise.resolve().then(operation),
      markRootActivated: vi.fn(), onWindowShown: vi.fn()
    }
    dispose = registerIpc({
      app, storage, config: {}, transfer: {}, export: {}, search: {}, startup,
      planReferences: { commitImpact },
      getWindow: () => null, log: vi.fn()
    } as unknown as Parameters<typeof registerIpc>[0])

    const switching = bridge.invoke('app:setRootDir', { dirPath: root, confirmed: true })
    await rootSwitchStarted.promise
    const committing = bridge.invoke('plan-reference:commitImpact', { action: 'delete-plan' })
    await Promise.resolve()
    expect(commitImpact).not.toHaveBeenCalled()

    releaseRootSwitch.resolve({ rootDir: root })
    await expect(switching).resolves.toMatchObject({ ok: true, data: { rootDir: root } })
    await expect(committing).resolves.toMatchObject({ ok: true, data: { path: 'Plan' } })
    expect(order).toEqual(['root-start', 'root-end', 'impact-commit'])
  })

  it('keeps every renderer mutation that changes reference impact behind an in-flight purge', async () => {
    const [{ registerIpc }, { PlanRepository }, { StorageService }] = await Promise.all([
      import('../src/main/ipc/register'),
      import('../src/main/services/plan-repository'),
      import('../src/main/services/storage-service')
    ])
    await import('../src/preload/index')
    const bridge = electronMocks.contextBridge.exposeInMainWorld.mock.calls.at(-1)?.[1] as Bridge
    root = await fs.mkdtemp(join(tmpdir(), 'trace-trash-purge-queue-'))
    const repo = new PlanRepository()
    await repo.ensureLibraryRoot(root)
    const storage = new StorageService(repo)
    storage.setRoot(root)
    vi.spyOn(storage, 'getTrashPurgeConfirmationSnapshot').mockResolvedValue({
      entry_id: 'entry', kind: 'plan', name: 'Purge source', original_relative_path: 'Source',
      plan_count: 1, reference_count: 0, status: 'trashed', expires_at: new Date(Date.now() + 60_000).toISOString()
    })
    const purgeStarted = deferred<void>()
    const releasePurge = deferred<void>()
    const order: string[] = []
    const commitTrashPurge = vi.fn(async () => {
      order.push('purge-start')
      purgeStarted.resolve()
      await releasePurge.promise
      order.push('purge-end')
      return { changed_plan_ids: [] }
    })
    const saveRendererPlan = vi.fn(async () => {
      order.push('save-plan')
      return { updated_at: '2026-10-03T00:00:00.000Z' }
    })
    const appendRendererComponent = vi.fn(async () => { order.push('append-component') })
    const commitTarget = vi.fn(async () => {
      order.push('commit-target')
      return { path: 'Target' }
    })
    const commitImpact = vi.fn(async () => {
      order.push('commit-impact')
      return { path: 'Target' }
    })
    const runRendererMutation = vi.fn(async (operation: () => Promise<unknown>) => operation())
    const commitMove = vi.fn(async () => {
      order.push('move-plan')
      return { path: 'Moved/Source' }
    })
    const importPlan = vi.fn(async () => {
      order.push('import-plan')
      return { imported: [], plans: 0, components: 0, tasks: 0, notes: 0, skipped: [] }
    })
    const startup = {
      waitForRootActivation: async () => undefined,
      waitForBootstrap: async () => undefined,
      getRootActivationStatus: () => 'active',
      runAfterRootActivation: (operation: () => unknown) => Promise.resolve().then(operation),
      markRootActivated: vi.fn(), onWindowShown: vi.fn()
    }
    const trustedOwner = { isDestroyed: () => false, webContents: { isDestroyed: () => false } }
    dispose = registerIpc({
      app: {}, storage, config: {}, transfer: { importPlan }, export: {}, search: {}, startup,
      planReferences: {
        saveRendererPlan,
        appendRendererComponent,
        commitTarget,
        commitImpact,
        commitMove,
        commitTrashPurge,
        runRendererMutation
      },
      requestTrustedTrashPurgeConfirmation: async (_snapshot: unknown, accept: () => Promise<unknown>) => { await accept() },
      getWindow: () => trustedOwner, log: vi.fn()
    } as unknown as Parameters<typeof registerIpc>[0])

    const purge = bridge.invoke('trash:purge-commit', { confirmation_token: 'one-shot-token' })
    await purgeStarted.promise
    const mutations = [
      bridge.invoke('storage:movePlan', { path: 'Source', target_parent_path: 'Moved' }),
      bridge.invoke('storage:savePlan', {
        path: 'Source',
        document: { format_version: '1', created_at: '', updated_at: '', components: [] },
        expected_updated_at: 'previous-revision'
      }),
      bridge.invoke('storage:appendComponent', { path: 'Source', component: { id: 'component' } }),
      bridge.invoke('plan-reference:commitTarget', {
        library_id: 'library', path: 'Source', mode: 'plan'
      }),
      bridge.invoke('plan-reference:commitImpact', { action: 'delete-plan' }),
      bridge.invoke('transfer:importPlan', { target_parent_path: '', filePath: 'source.plan' })
    ]
    await Promise.resolve()
    expect(order).toEqual(['purge-start'])
    expect(commitMove).not.toHaveBeenCalled()
    expect(saveRendererPlan).not.toHaveBeenCalled()
    expect(appendRendererComponent).not.toHaveBeenCalled()
    expect(commitTarget).not.toHaveBeenCalled()
    expect(commitImpact).not.toHaveBeenCalled()
    expect(importPlan).not.toHaveBeenCalled()

    releasePurge.resolve()
    await expect(purge).resolves.toMatchObject({ ok: true, data: { changed_plan_ids: [] } })
    await expect(Promise.all(mutations)).resolves.toHaveLength(mutations.length)
    expect(order).toEqual([
      'purge-start', 'purge-end', 'move-plan', 'save-plan', 'append-component',
      'commit-target', 'commit-impact', 'import-plan'
    ])
    expect(commitMove).toHaveBeenCalledOnce()
    expect(commitTrashPurge).toHaveBeenCalledOnce()
    expect(runRendererMutation).toHaveBeenCalledOnce()
    expect(saveRendererPlan).toHaveBeenCalledOnce()
    expect(appendRendererComponent).toHaveBeenCalledOnce()
    expect(commitTarget).toHaveBeenCalledOnce()
    expect(commitImpact).toHaveBeenCalledOnce()
    expect(importPlan).toHaveBeenCalledOnce()
  })
})
