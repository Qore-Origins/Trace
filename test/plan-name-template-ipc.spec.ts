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
        return handler
          ? handler({}, payload)
          : { ok: false, code: 50, message: '通道未注册', data: null }
      }),
      on: vi.fn(),
      removeListener: vi.fn()
    },
    contextBridge: {
      exposeInMainWorld: vi.fn<(key: string, value: unknown) => void>()
    },
    dialog: {
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn()
    }
  }
})

vi.mock('electron', () => ({
  ipcMain: electronMocks.ipcMain,
  ipcRenderer: electronMocks.ipcRenderer,
  contextBridge: electronMocks.contextBridge,
  dialog: electronMocks.dialog
}))

type RendererBridge = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
}

describe('plan name template IPC allowlist', () => {
  let dispose: (() => void) | undefined
  let roots: string[] = []

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    electronMocks.handlers.clear()
    roots = []
  })

  afterEach(async () => {
    dispose?.()
    dispose = undefined
    await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })))
  })

  it('allows only the typed get, set and remove template channels', async () => {
    await import('../src/preload/index')
    const exposed = electronMocks.contextBridge.exposeInMainWorld.mock.calls.at(-1)?.[1]
    const bridge = exposed as RendererBridge

    await bridge.invoke('plan-template:get')
    await bridge.invoke('plan-template:set', { parent_path: 'Daily_Plan', template: 'Daily_{title}' })
    await bridge.invoke('plan-template:remove', { parent_path: 'Daily_Plan' })
    const blocked = await bridge.invoke('plan-template:root', { root_path: 'C:/outside' })

    expect(electronMocks.ipcRenderer.invoke.mock.calls.map(([channel]) => channel)).toEqual([
      'plan-template:get',
      'plan-template:set',
      'plan-template:remove'
    ])
    expect(blocked).toEqual({ ok: false, code: 50, message: '通道未开放', data: null })
  })

  it('derives the library root in main and keeps template settings isolated across roots', async () => {
    const [{ registerIpc }, { PlanRepository }, { StorageService }, { PlanNameTemplateService }] = await Promise.all([
      import('../src/main/ipc/register'),
      import('../src/main/services/plan-repository'),
      import('../src/main/services/storage-service'),
      import('../src/main/services/plan-name-template-service')
    ])
    await import('../src/preload/index')
    const bridge = electronMocks.contextBridge.exposeInMainWorld.mock.calls.at(-1)?.[1] as RendererBridge
    const firstRoot = await fs.mkdtemp(join(tmpdir(), 'trace-template-ipc-first-'))
    const secondRoot = await fs.mkdtemp(join(tmpdir(), 'trace-template-ipc-second-'))
    roots.push(firstRoot, secondRoot)
    await fs.mkdir(join(firstRoot, 'Daily_Plan'))
    await fs.mkdir(join(secondRoot, 'Daily_Plan'))

    const repository = new PlanRepository()
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
      planNameTemplates: new PlanNameTemplateService(repository),
      startup, getWindow: () => null, log: vi.fn()
    } as unknown as Parameters<typeof registerIpc>[0])

    const initial = await bridge.invoke('plan-template:get', { root_path: secondRoot }) as {
      ok: boolean
      data: { rules: Array<{ parent_path: string; template: string }> }
    }
    expect(initial.data.rules).toContainEqual({ parent_path: 'Daily_Plan', template: 'Daily-Plan_{date}_{title}', source: 'default' })

    await bridge.invoke('plan-template:set', {
      parent_path: 'Daily_Plan', template: 'First_{title}', root_path: secondRoot
    })
    storage.setRoot(secondRoot)
    const second = await bridge.invoke('plan-template:get') as {
      ok: boolean
      data: { rules: Array<{ parent_path: string; template: string }> }
    }
    expect(second.data.rules).toContainEqual({ parent_path: 'Daily_Plan', template: 'Daily-Plan_{date}_{title}', source: 'default' })

    const invalid = await bridge.invoke('plan-template:set', {
      parent_path: '../outside', template: 'Bad_{title}'
    }) as { ok: boolean; code: number }
    expect(invalid).toMatchObject({ ok: false, code: 11 })

    await bridge.invoke('plan-template:set', { parent_path: 'Daily_Plan', template: 'Second_{title}' })
    storage.setRoot(firstRoot)
    const firstAgain = await bridge.invoke('plan-template:get') as {
      ok: boolean
      data: { rules: Array<{ parent_path: string; template: string }> }
    }
    expect(firstAgain.data.rules).toContainEqual({ parent_path: 'Daily_Plan', template: 'First_{title}', source: 'custom' })

    await bridge.invoke('plan-template:remove', { parent_path: 'Daily_Plan' })
    const removed = await bridge.invoke('plan-template:get') as {
      ok: boolean
      data: { rules: Array<{ parent_path: string }> }
    }
    expect(removed.data.rules).not.toContainEqual(expect.objectContaining({ parent_path: 'Daily_Plan' }))
  })
})
