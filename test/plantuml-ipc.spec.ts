import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { PlantUmlStatusDto } from '../src/shared/plantuml-types'
import type { PlantumlService } from '../src/main/services/plantuml-service'
import { createStartupCoordinator } from '../src/main/services/startup-coordinator'

const electronMocks = vi.hoisted(() => ({
  ipcMain: {
    handle: vi.fn<(channel: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => void>(),
    removeHandler: vi.fn<(channel: string) => void>()
  },
  ipcRenderer: {
    invoke: vi.fn(async (_channel: string, _payload?: unknown) => ({ ok: true, code: 0, message: 'ok', data: null })),
    on: vi.fn<(event: string, handler: (event: unknown, ...args: unknown[]) => void) => void>(),
    removeListener: vi.fn<(event: string, handler: (event: unknown, ...args: unknown[]) => void) => void>()
  },
  contextBridge: {
    exposeInMainWorld: vi.fn<(key: string, value: unknown) => void>()
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn()
  }
}))

vi.mock('electron', () => ({
  ipcMain: electronMocks.ipcMain,
  ipcRenderer: electronMocks.ipcRenderer,
  contextBridge: electronMocks.contextBridge,
  dialog: electronMocks.dialog
}))

import { registerIpc } from '../src/main/ipc/register'

type IpcHandler = (event: unknown, payload: unknown) => Promise<unknown>
type RendererBridge = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(event: string, callback: (payload: unknown) => void): () => void
}
type IpcDependencies = Parameters<typeof registerIpc>[0]
type StartupGate = IpcDependencies['startup']
type Step6Dependencies = IpcDependencies & { startup: StartupGate }

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function findHandler(channel: string): IpcHandler {
  const registered = electronMocks.ipcMain.handle.mock.calls.find(([name]) => name === channel)
  if (!registered) throw new Error(`Missing IPC handler: ${channel}`)
  return registered[1] as IpcHandler
}

function createPlantumlServiceMock(options: { configure?: () => Promise<PlantUmlStatusDto> } = {}) {
  const status: PlantUmlStatusDto = { state: 'running', port: 18080, errorCode: null }
  const listeners = new Set<(nextStatus: PlantUmlStatusDto) => void>()
  const unsubscribe = vi.fn((listener: (nextStatus: PlantUmlStatusDto) => void) => listeners.delete(listener))
  const service: PlantumlService = {
    configure: vi.fn(options.configure ?? (async () => ({ ...status }))),
    start: vi.fn(async () => ({ ...status })),
    stop: vi.fn(async () => ({ ...status })),
    shutdown: vi.fn(async () => ({ ...status })),
    retry: vi.fn(async () => ({ ...status })),
    getStatus: vi.fn(() => ({ ...status })),
    onStatus: vi.fn((listener: (nextStatus: PlantUmlStatusDto) => void) => {
      listeners.add(listener)
      return () => unsubscribe(listener)
    })
  }

  return {
    service,
    emitStatus(nextStatus: PlantUmlStatusDto) {
      for (const listener of listeners) listener(nextStatus)
    },
    unsubscribe
  }
}

function createWindow() {
  return {
    send: vi.fn(),
    isDestroyed: vi.fn(() => false)
  }
}

function createDependencies(options: {
  plantuml?: IpcDependencies['plantuml']
  webContents?: ReturnType<typeof createWindow>
  startup?: StartupGate
  app?: IpcDependencies['app']
} = {}): Step6Dependencies {
  return {
    app: options.app ?? ({ bootstrap: vi.fn(async () => ({ rootConfigured: false })) } as unknown as IpcDependencies['app']),
    storage: {} as IpcDependencies['storage'],
    config: {} as IpcDependencies['config'],
    transfer: {} as IpcDependencies['transfer'],
    export: {} as IpcDependencies['export'],
    search: {} as IpcDependencies['search'],
    plantuml: options.plantuml,
    startup: options.startup ?? {
      onWindowShown: vi.fn(),
      waitForRootActivation: async () => undefined,
      waitForBootstrap: async () => undefined,
      getRootActivationStatus: () => 'active',
      runAfterRootActivation: (operation) => Promise.resolve().then(operation),
      markRootActivated: vi.fn()
    },
    getWindow: () => options.webContents
      ? ({ webContents: options.webContents } as unknown as BrowserWindow)
      : null,
    log: vi.fn()
  } as Step6Dependencies
}

describe('PlantUML IPC boundary', () => {
  let dispose: (() => void) | undefined

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  afterEach(() => {
    dispose?.()
    dispose = undefined
  })

  it('defines three service channels and rejects unknown PlantUML channels in preload', async () => {
    const { contextBridge, ipcRenderer } = await import('electron')
    await import('../src/preload/index')
    const exposedCall = electronMocks.contextBridge.exposeInMainWorld.mock.calls.at(-1)
    expect(exposedCall?.[0]).toBe('trace')
    const bridge = exposedCall?.[1] as RendererBridge

    await bridge.invoke('plantuml:configure', { enabled: true, port: 18080 })
    await bridge.invoke('plantuml:getStatus')
    await bridge.invoke('plantuml:retry')
    const blockedChannel = await bridge.invoke('plantuml:shutdown')

    expect(Object.keys(bridge).sort()).toEqual(['invoke', 'on'])
    expect(electronMocks.ipcRenderer.invoke.mock.calls.map(([channel]) => channel)).toEqual([
      'plantuml:configure',
      'plantuml:getStatus',
      'plantuml:retry'
    ])
    expect(electronMocks.ipcRenderer.invoke).toHaveBeenCalledWith('plantuml:configure', { enabled: true, port: 18080 })
    expect(blockedChannel).toEqual({ ok: false, code: 50, message: '通道未开放', data: null })
    expect(electronMocks.ipcRenderer.invoke).toHaveBeenCalledTimes(3)
    expect(contextBridge).toBeDefined()
    expect(ipcRenderer).toBeDefined()
  })

  it('delegates configure, status and retry through TraceResult handlers', async () => {
    const plantuml = createPlantumlServiceMock()
    dispose = registerIpc(createDependencies({ plantuml: plantuml.service }))

    const configureResult = await findHandler('plantuml:configure')({}, { enabled: true, port: 18081 })
    const statusResult = await findHandler('plantuml:getStatus')({}, undefined)
    const retryResult = await findHandler('plantuml:retry')({}, undefined)

    const expectedResult = {
      ok: true,
      code: 0,
      message: 'ok',
      data: { state: 'running', port: 18080, errorCode: null }
    }
    expect(configureResult).toEqual(expectedResult)
    expect(statusResult).toEqual(expectedResult)
    expect(retryResult).toEqual(expectedResult)
    expect(plantuml.service.configure).toHaveBeenCalledWith({ enabled: true, port: 18081 })
    expect(plantuml.service.getStatus).toHaveBeenCalledTimes(1)
    expect(plantuml.service.retry).toHaveBeenCalledTimes(1)
  })

  it('contains PlantUML startup failures in a TraceResult without blocking bootstrap', async () => {
    const plantuml = createPlantumlServiceMock({
      configure: async () => { throw new Error('local runtime unavailable') }
    })
    const bootstrap = vi.fn(async () => ({ rootConfigured: false }))
    dispose = registerIpc(createDependencies({
      plantuml: plantuml.service,
      app: { bootstrap } as unknown as IpcDependencies['app']
    }))

    const configureResult = await findHandler('plantuml:configure')({}, { enabled: true, port: 18080 })
    const bootstrapResult = await findHandler('app:bootstrap')({}, undefined)

    expect(configureResult).toMatchObject({ ok: false, code: 50, data: null })
    expect(bootstrapResult).toMatchObject({ ok: true, data: { rootConfigured: false } })
    expect(bootstrap).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['extra local path', { enabled: true, port: 18080, javaPath: 'C:\\private\\java.exe' }],
    ['remote URL', { enabled: true, port: 18080, url: 'https://example.invalid/plantuml' }],
    ['PlantUML source', { enabled: true, port: 18080, source: '@startuml' }],
    ['unknown property', { enabled: true, port: 18080, extra: true }],
    ['missing port', { enabled: true }],
    ['invalid enabled type', { enabled: 'yes', port: 18080 }],
    ['fractional port', { enabled: true, port: 18080.5 }],
    ['privileged port', { enabled: true, port: 1023 }],
    ['out of range port', { enabled: true, port: 65536 }],
    ['array payload', [{ enabled: true, port: 18080 }]],
    ['null payload', null]
  ])('rejects %s before calling the PlantUML service', async (_description, payload) => {
    const plantuml = createPlantumlServiceMock()
    dispose = registerIpc(createDependencies({ plantuml: plantuml.service }))

    const result = await findHandler('plantuml:configure')({}, payload)

    expect(result).toMatchObject({ ok: false, code: 20, data: null })
    expect(plantuml.service.configure).not.toHaveBeenCalled()
  })

  it('does not accept a non-plain configuration object', async () => {
    const plantuml = createPlantumlServiceMock()
    dispose = registerIpc(createDependencies({ plantuml: plantuml.service }))
    const payload = Object.assign(Object.create({ inherited: true }) as object, { enabled: true, port: 18080 })

    const result = await findHandler('plantuml:configure')({}, payload)

    expect(result).toMatchObject({ ok: false, code: 20, data: null })
    expect(plantuml.service.configure).not.toHaveBeenCalled()
  })

  it('rejects accessor configuration fields without invoking user-provided getters', async () => {
    const plantuml = createPlantumlServiceMock()
    dispose = registerIpc(createDependencies({ plantuml: plantuml.service }))
    const enabledGetter = vi.fn(() => true)
    const payload = Object.defineProperty({ port: 18080 }, 'enabled', {
      enumerable: true,
      get: enabledGetter
    })

    const result = await findHandler('plantuml:configure')({}, payload)

    expect(result).toMatchObject({ ok: false, code: 20, data: null })
    expect(enabledGetter).not.toHaveBeenCalled()
    expect(plantuml.service.configure).not.toHaveBeenCalled()
  })

  it('rejects Symbol own keys on configuration payloads', async () => {
    const plantuml = createPlantumlServiceMock()
    dispose = registerIpc(createDependencies({ plantuml: plantuml.service }))
    const secret = Symbol('extra')
    const payload = { enabled: true, port: 18080, [secret]: 'unexpected' }

    const result = await findHandler('plantuml:configure')({}, payload)

    expect(result).toMatchObject({ ok: false, code: 20, data: null })
    expect(plantuml.service.configure).not.toHaveBeenCalled()
  })

  it('forwards status only to a live window and ignores destroyed webContents', () => {
    const plantuml = createPlantumlServiceMock()
    const webContents = createWindow()
    dispose = registerIpc(createDependencies({ plantuml: plantuml.service, webContents }))
    const status: PlantUmlStatusDto = { state: 'starting', port: 18080, errorCode: null }

    plantuml.emitStatus(status)
    webContents.isDestroyed.mockReturnValue(true)
    plantuml.emitStatus({ ...status, state: 'running' })

    expect(webContents.send).toHaveBeenCalledTimes(1)
    expect(webContents.send).toHaveBeenCalledWith('trace:plantuml-status', status)
  })

  it('allows only the status event through preload and unregisters all listeners on dispose', async () => {
    await import('../src/preload/index')
    const exposedCall = electronMocks.contextBridge.exposeInMainWorld.mock.calls.at(-1)
    const bridge = exposedCall?.[1] as RendererBridge
    const callback = vi.fn()
    const plantuml = createPlantumlServiceMock()
    dispose = registerIpc(createDependencies({ plantuml: plantuml.service }))

    const unsubscribeEvent = bridge.on('trace:plantuml-status', callback)
    bridge.on('trace:plantuml-secret', callback)
    const registeredChannels = electronMocks.ipcMain.handle.mock.calls.map(([channel]) => channel)
    dispose()
    dispose = undefined
    unsubscribeEvent()

    expect(electronMocks.ipcRenderer.on).toHaveBeenCalledTimes(1)
    expect(electronMocks.ipcRenderer.on).toHaveBeenCalledWith('trace:plantuml-status', expect.any(Function))
    expect(electronMocks.ipcRenderer.removeListener).toHaveBeenCalledWith('trace:plantuml-status', expect.any(Function))
    expect(plantuml.unsubscribe).toHaveBeenCalledTimes(1)
    expect(electronMocks.ipcMain.removeHandler.mock.calls.map(([channel]) => channel)).toEqual(registeredChannels)
  })

  it('provides a safe status without an initialized service and rejects configuration until injected', async () => {
    dispose = registerIpc(createDependencies())

    const statusResult = await findHandler('plantuml:getStatus')({}, undefined)
    const configureResult = await findHandler('plantuml:configure')({}, { enabled: true, port: 18080 })
    const retryResult = await findHandler('plantuml:retry')({}, undefined)

    expect(statusResult).toMatchObject({ ok: true, data: { state: 'stopped', port: 18080 } })
    expect(configureResult).toMatchObject({ ok: false, data: null })
    expect(retryResult).toMatchObject({ ok: false, data: null })
  })

  it('waits to configure and retry until the window has shown and root activation finishes', async () => {
    const rootActivation = deferred<void>()
    const startup = createStartupCoordinator({ activateConfiguredRoot: () => rootActivation.promise })
    const plantuml = createPlantumlServiceMock()
    dispose = registerIpc(createDependencies({ plantuml: plantuml.service, startup }))
    const configurePromise = findHandler('plantuml:configure')({}, { enabled: true, port: 18080 })
    const retryPromise = findHandler('plantuml:retry')({}, undefined)

    expect(plantuml.service.configure).not.toHaveBeenCalled()
    expect(plantuml.service.retry).not.toHaveBeenCalled()
    startup.onWindowShown()
    expect(plantuml.service.configure).not.toHaveBeenCalled()

    rootActivation.resolve()
    const [configureResult, retryResult] = await Promise.all([configurePromise, retryPromise])

    expect(configureResult).toMatchObject({ ok: true, data: { state: 'running' } })
    expect(retryResult).toMatchObject({ ok: true, data: { state: 'running' } })
    expect(plantuml.service.configure).toHaveBeenCalledWith({ enabled: true, port: 18080 })
    expect(plantuml.service.retry).toHaveBeenCalledTimes(1)
  })

  it('does not launch a queued PlantUML configure after IPC disposal', async () => {
    const rootActivation = deferred<void>()
    const startup = createStartupCoordinator({ activateConfiguredRoot: () => rootActivation.promise })
    const plantuml = createPlantumlServiceMock()
    dispose = registerIpc(createDependencies({ plantuml: plantuml.service, startup }))
    const configureHandler = findHandler('plantuml:configure')
    const configurePromise = configureHandler({}, { enabled: true, port: 18080 })

    dispose()
    startup.onWindowShown()
    rootActivation.resolve()
    const result = await configurePromise

    expect(result).toMatchObject({ ok: false, data: null })
    expect(plantuml.service.configure).not.toHaveBeenCalled()
    expect(plantuml.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('reports an accessible but unactivated root as invalid and allows onboarding recovery', async () => {
    const rootActivation = deferred<void>()
    const startup = createStartupCoordinator({ activateConfiguredRoot: () => rootActivation.promise })
    const markRootActivated = vi.spyOn(startup, 'markRootActivated')
    const existingRoot = 'C:\\existing-library'
    const recoveredRoot = 'D:\\recovered-library'
    let configuredRoot = existingRoot
    const app = {
      bootstrap: vi.fn(async () => ({
        appVersion: '0.15.1',
        formatVersion: '1',
        rootDir: configuredRoot,
        rootConfigured: true,
        rootInvalid: false,
        indexState: 'ready'
      })),
      setRootDir: vi.fn(async (dirPath: string, confirmed: boolean) => {
        if (!confirmed) throw new Error('switching an active root requires confirmation')
        configuredRoot = dirPath
        return { rootDir: dirPath }
      })
    }
    dispose = registerIpc(createDependencies({ app: app as unknown as IpcDependencies['app'], startup }))

    const bootstrapPromise = findHandler('app:bootstrap')({}, undefined)
    startup.onWindowShown()
    rootActivation.reject(new Error('root metadata is not writable'))
    const bootstrapResult = await bootstrapPromise

    expect(bootstrapResult).toMatchObject({
      ok: true,
      data: { rootDir: existingRoot, rootConfigured: true, rootInvalid: true }
    })

    const recoveryResult = await findHandler('app:setRootDir')({}, {
      dirPath: recoveredRoot,
      confirmed: false
    })
    expect(recoveryResult).toMatchObject({ ok: true, data: { rootDir: recoveredRoot } })
    expect(app.setRootDir).toHaveBeenCalledWith(recoveredRoot, true)
    expect(markRootActivated).toHaveBeenCalledTimes(1)

    const recoveredBootstrap = await findHandler('app:bootstrap')({}, undefined)
    expect(recoveredBootstrap).toMatchObject({
      ok: true,
      data: { rootDir: recoveredRoot, rootConfigured: true, rootInvalid: false }
    })
  })

  it('does not bypass confirmation when the configured root activated successfully', async () => {
    const startup = createStartupCoordinator({ activateConfiguredRoot: async () => true })
    const app = {
      bootstrap: vi.fn(async () => ({ rootConfigured: true, rootInvalid: false })),
      setRootDir: vi.fn(async (_dirPath: string, confirmed: boolean) => {
        if (!confirmed) throw new Error('active library switch requires confirmation')
        return { rootDir: 'D:\\new-library' }
      })
    }
    dispose = registerIpc(createDependencies({ app: app as unknown as IpcDependencies['app'], startup }))
    startup.onWindowShown()

    const result = await findHandler('app:setRootDir')({}, {
      dirPath: 'D:\\new-library',
      confirmed: false
    })

    expect(result).toMatchObject({ ok: false, data: null })
    expect(app.setRootDir).toHaveBeenCalledWith('D:\\new-library', false)
  })

  it('lets bootstrap finish after root activation while PlantUML configure remains pending', async () => {
    const rootActivation = deferred<void>()
    const plantumlConfiguration = deferred<PlantUmlStatusDto>()
    const order: string[] = []
    const startup = createStartupCoordinator({
      activateConfiguredRoot: () => {
        order.push('root activation')
        return rootActivation.promise
      }
    })
    const plantuml = createPlantumlServiceMock({
      configure: () => {
        order.push('PlantUML configure')
        return plantumlConfiguration.promise
      }
    })
    const appBootstrap = vi.fn(async () => {
      order.push('bootstrap')
      return { rootConfigured: true }
    })
    dispose = registerIpc(createDependencies({
      plantuml: plantuml.service,
      startup,
      app: { bootstrap: appBootstrap } as unknown as IpcDependencies['app']
    }))
    let configureSettled = false
    const configurePromise = findHandler('plantuml:configure')({}, { enabled: true, port: 18080 })
      .then((result) => {
        configureSettled = true
        return result
      })
    const bootstrapPromise = findHandler('app:bootstrap')({}, undefined)

    expect(appBootstrap).not.toHaveBeenCalled()
    expect(plantuml.service.configure).not.toHaveBeenCalled()
    order.push('window.show')
    startup.onWindowShown()
    rootActivation.resolve()

    const bootstrapResult = await bootstrapPromise
    await vi.waitFor(() => expect(plantuml.service.configure).toHaveBeenCalledTimes(1))

    expect(bootstrapResult).toMatchObject({ ok: true, data: { rootConfigured: true } })
    expect(appBootstrap).toHaveBeenCalledTimes(1)
    expect(configureSettled).toBe(false)
    expect(order).toEqual(['window.show', 'root activation', 'PlantUML configure', 'bootstrap'])

    plantumlConfiguration.resolve({ state: 'running', port: 18080, errorCode: null })
    await configurePromise
  })
})
