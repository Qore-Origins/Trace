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
      on: vi.fn(),
      removeListener: vi.fn()
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

type RendererBridge = { invoke(channel: string, ...args: unknown[]): Promise<unknown> }

describe('workspace tabs IPC boundary', () => {
  const roots: string[] = []
  let dispose: (() => void) | undefined

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    electronMocks.handlers.clear()
  })

  afterEach(async () => {
    dispose?.()
    dispose = undefined
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
  })

  it('exposes only the typed workspace tabs channels through preload', async () => {
    await import('../src/preload/index')
    const bridge = electronMocks.contextBridge.exposeInMainWorld.mock.calls.at(-1)?.[1] as RendererBridge
    await bridge.invoke('workspace-tabs:get')
    await bridge.invoke('workspace-tabs:set', { state: { library_id: 'id', open_paths: [], active_path: null } })
    const blocked = await bridge.invoke('workspace-tabs:deleteAll')

    expect(electronMocks.ipcRenderer.invoke.mock.calls.map(([channel]) => channel)).toEqual([
      'workspace-tabs:get', 'workspace-tabs:set'
    ])
    expect(blocked).toEqual({ ok: false, code: 50, message: '通道未开放', data: null })
  })

  it('gets the current library in main and rejects stale or malformed set payloads', async () => {
    const [{ registerIpc }, { PlanRepository }, { StorageService }, { WorkspaceTabsService }] = await Promise.all([
      import('../src/main/ipc/register'),
      import('../src/main/services/plan-repository'),
      import('../src/main/services/storage-service'),
      import('../src/main/services/workspace-tabs-service')
    ])
    await import('../src/preload/index')
    const bridge = electronMocks.contextBridge.exposeInMainWorld.mock.calls.at(-1)?.[1] as RendererBridge
    const firstRoot = await fs.mkdtemp(join(tmpdir(), 'trace-tabs-ipc-first-'))
    const secondRoot = await fs.mkdtemp(join(tmpdir(), 'trace-tabs-ipc-second-'))
    roots.push(firstRoot, secondRoot)
    const repository = new PlanRepository()
    const firstMeta = await repository.ensureLibraryRoot(firstRoot)
    const secondMeta = await repository.ensureLibraryRoot(secondRoot)
    await fs.mkdir(join(firstRoot, 'A'))
    await fs.writeFile(join(firstRoot, 'A', 'plan.json'), '{}')
    const storage = new StorageService(repository)
    storage.setRoot(firstRoot)
    const startup = {
      waitForRootActivation: async () => undefined,
      waitForBootstrap: async () => undefined,
      getRootActivationStatus: () => 'active',
      runAfterRootActivation: (operation: () => unknown) => Promise.resolve().then(operation),
      markRootActivated: vi.fn(),
      onWindowShown: vi.fn()
    }
    dispose = registerIpc({
      app: {}, storage, config: {}, transfer: {}, export: {}, search: {},
      workspaceTabs: new WorkspaceTabsService(repository, () => storage.getRootAbs()),
      startup, getWindow: () => null, log: vi.fn()
    } as unknown as Parameters<typeof registerIpc>[0])

    const first = await bridge.invoke('workspace-tabs:get') as { ok: boolean; data: { library_id: string } }
    expect(first).toMatchObject({ ok: true, data: { library_id: firstMeta.library_id } })
    const state = { library_id: firstMeta.library_id, open_paths: [{ path: 'A' }], active_path: 'A' }
    expect(await bridge.invoke('workspace-tabs:set', { state })).toMatchObject({ ok: true, data: null })

    storage.setRoot(secondRoot)
    expect(await bridge.invoke('workspace-tabs:set', { state })).toMatchObject({ ok: false, code: 22 })
    expect(await bridge.invoke('workspace-tabs:set', { wrong: state })).toMatchObject({ ok: false, code: 20 })
    expect(await bridge.invoke('workspace-tabs:get', { root: firstRoot })).toMatchObject({
      ok: true,
      data: { library_id: secondMeta.library_id, open_paths: [], active_path: null }
    })
    await expect(fs.access(join(secondRoot, '.trace', 'workspace-tabs.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
