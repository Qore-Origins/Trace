// @vitest-environment happy-dom
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TraceBridge, TraceResult } from '../src/shared/ipc-contract'
import { ERR } from '../src/shared/errors'

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>()
  return {
    handlers,
    ipcMain: { handle: (name: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => handlers.set(name, handler), removeHandler: (name: string) => handlers.delete(name) },
    ipcRenderer: { invoke: vi.fn((name: string, payload: unknown) => handlers.get(name)?.({}, payload)), on: vi.fn(), removeListener: vi.fn() },
    contextBridge: { exposeInMainWorld: (_key: string, value: unknown) => Reflect.set(window, 'trace', value) },
    dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
    safeStorage: { isAsyncEncryptionAvailable: vi.fn(async () => false) }
  }
})
vi.mock('electron', () => electron)

let directory: string
let bridge: TraceBridge
let dispose: (() => void) | undefined

type DynamicInvoke = (channel: string, payload?: unknown) => Promise<TraceResult<unknown>>
function invoke(channel: string, payload?: unknown): Promise<TraceResult<unknown>> {
  return (bridge as unknown as { invoke: DynamicInvoke }).invoke(channel, payload)
}

async function mount(): Promise<void> {
  const { registerIpc } = await import('../src/main/ipc/register')
  const startup = {
    waitForRootActivation: async () => undefined,
    waitForBootstrap: async () => undefined,
    getRootActivationStatus: () => 'active',
    runAfterRootActivation: (operation: () => unknown) => Promise.resolve().then(operation),
    markRootActivated: vi.fn(), onWindowShown: vi.fn()
  }
  dispose = registerIpc({
    app: {}, storage: {}, config: {}, transfer: {}, export: {}, search: {}, startup,
    agentUserDataDir: directory, getWindow: () => null, log: vi.fn()
  } as unknown as Parameters<typeof registerIpc>[0])
  await import('../src/preload/index')
  bridge = window.trace
}

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  electron.handlers.clear()
  Reflect.deleteProperty(window, 'trace')
  directory = await fs.mkdtemp(join(tmpdir(), 'trace-agent-policy-'))
  await mount()
})

afterEach(async () => {
  dispose?.()
  dispose = undefined
  await fs.rm(directory, { recursive: true, force: true })
})

describe('agent permission policy typed IPC', () => {
  it('defaults safely, persists explicit changes, and rejects model-supplied policy fields', async () => {
    expect(await invoke('agent:policy:get')).toMatchObject({ ok: true, data: { mode: 'confirm' } })
    expect(await invoke('agent:policy:set', { mode: 'restricted' }))
      .toMatchObject({ ok: true, data: { mode: 'restricted' } })

    expect(await invoke('agent:policy:set', { mode: 'unrestricted', authorizedByModel: true }))
      .toMatchObject({ ok: false })
    expect(await invoke('agent:policy:get')).toMatchObject({ ok: true, data: { mode: 'restricted' } })

    dispose?.()
    dispose = undefined
    await mount()
    expect(await invoke('agent:policy:get')).toMatchObject({ ok: true, data: { mode: 'restricted' } })
  })

  it('fails closed on malformed persisted policy without overwriting it', async () => {
    const file = join(directory, 'agent-permission-policy.json')
    const malformed = '{"version":1,"mode":"unrestricted","unexpected":true}'
    await fs.writeFile(file, malformed)

    expect(await invoke('agent:policy:get')).toMatchObject({ ok: false })
    expect(await fs.readFile(file, 'utf8')).toBe(malformed)
  })

  it('rejects unknown policy modes and refuses a non-file policy destination', async () => {
    expect(await invoke('agent:policy:set', { mode: 'always' }))
      .toMatchObject({ ok: false, code: ERR.VALIDATION })

    const file = join(directory, 'agent-permission-policy.json')
    await fs.mkdir(file)
    expect(await invoke('agent:policy:set', { mode: 'unrestricted' }))
      .toMatchObject({ ok: false, code: ERR.PATH_UNSAFE })
    expect((await fs.lstat(file)).isDirectory()).toBe(true)
  })

  it('rejects a symlink at the policy destination without reading or overwriting its target', async () => {
    const file = join(directory, 'agent-permission-policy.json')
    const outside = join(directory, 'outside-existing-policy.json')
    const original = '{"version":1,"mode":"confirm"}'
    await fs.writeFile(outside, original)
    await fs.symlink(outside, file, 'file')

    expect(await invoke('agent:policy:get')).toMatchObject({ ok: false, code: ERR.PATH_UNSAFE })
    expect(await invoke('agent:policy:set', { mode: 'restricted' }))
      .toMatchObject({ ok: false, code: ERR.PATH_UNSAFE })
    expect(await fs.readFile(outside, 'utf8')).toBe(original)
  })

  it('rejects a symlink at the randomized temporary path without touching its target', async () => {
    const outside = join(directory, 'outside-policy-target.json')
    const original = 'do not overwrite'
    await fs.writeFile(outside, original)

    const originalWriteFile = fs.writeFile.bind(fs)
    const writeFile = vi.spyOn(fs, 'writeFile').mockImplementation(async (...args) => {
      const [path] = args
      if (String(path).endsWith('.tmp')) await fs.symlink(outside, path, 'file')
      return Reflect.apply(originalWriteFile, fs, args) as ReturnType<typeof fs.writeFile>
    })
    try {
      expect(await invoke('agent:policy:set', { mode: 'restricted' }))
        .toMatchObject({ ok: false, code: ERR.PATH_UNSAFE })
      expect(await fs.readFile(outside, 'utf8')).toBe(original)
    } finally {
      writeFile.mockRestore()
    }
  })
})
