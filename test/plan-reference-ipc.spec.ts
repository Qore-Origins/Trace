import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

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

type Bridge = { invoke(channel: string, payload?: unknown): Promise<unknown> }

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
  })

  it('exposes only allowed reference channels and keeps absolute roots out of request and response DTOs', async () => {
    const [{ registerIpc }, { PlanRepository }, { StorageService }, { PlanReferenceService }] = await Promise.all([
      import('../src/main/ipc/register'),
      import('../src/main/services/plan-repository'),
      import('../src/main/services/storage-service'),
      import('../src/main/services/plan-reference-service')
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
    dispose = registerIpc({
      app: {}, storage, config: {}, transfer: {}, export: {}, search: {},
      planReferences: referenceService, startup, getWindow: () => null, log: vi.fn()
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
    expect(await bridge.invoke('plan-reference:eraseLibrary', { library_id: libraryId }))
      .toEqual({ ok: false, code: 50, message: '通道未开放', data: null })
    expect(electronMocks.ipcRenderer.invoke.mock.calls.some(([channel]) => channel === 'plan-reference:eraseLibrary')).toBe(false)

    expect(await bridge.invoke('plan-reference:search', { library_id: 'ffffffffffffffffffffffffffffffff', query: '' }))
      .toMatchObject({ ok: false, code: 22 })
    expect(await bridge.invoke('plan-reference:search', { library_id: libraryId, root, query: '' }))
      .toMatchObject({ ok: false, code: 20 })
  })
})
