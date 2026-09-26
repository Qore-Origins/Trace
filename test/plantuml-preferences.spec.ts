import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StateStorage } from 'zustand/middleware'
import { validatePlantumlPort, type PlantUmlMode, type PlantUmlStatusDto } from '../src/shared/plantuml-types'
import { migratePlantumlPreference, usePrefStore } from '../src/renderer/src/stores/pref-store'
import { usePlantumlStatusStore } from '../src/renderer/src/stores/plantuml-status-store'
import { retryPlantumlService, runPlantumlRetryIfCurrent, syncPlantumlPreference } from '../src/renderer/src/App'

interface PlantumlPreferenceSyncApi {
  getStatus: () => Promise<PlantUmlStatusDto>
  configure: (configuration: { enabled: boolean; port: number }) => Promise<PlantUmlStatusDto>
  subscribe: (listener: (status: PlantUmlStatusDto) => void) => () => void
}

interface PlantumlServiceActionApi {
  retry: () => Promise<PlantUmlStatusDto>
  configure: (configuration: { enabled: boolean; port: number }) => Promise<PlantUmlStatusDto>
}

describe('PlantUML preferences', () => {
  afterEach(() => {
    usePrefStore.setState(usePrefStore.getInitialState(), true)
    usePlantumlStatusStore.getState().resetStatus()
  })

  it('新安装默认使用 Trace 本地服务端口', () => {
    expect(usePrefStore.getState()).toMatchObject({
      plantumlMode: 'local',
      plantumlPort: 18080,
      plantumlServer: ''
    })
  })

  it('旧版空地址升级为本地模式', () => {
    expect(migratePlantumlPreference({ plantumlServer: '' })).toMatchObject({
      plantumlMode: 'local',
      plantumlPort: 18080,
      plantumlServer: ''
    })
  })

  it('旧版远程地址原样升级为自定义模式', () => {
    const server = 'https://plantuml.example/plantuml'
    expect(migratePlantumlPreference({ plantumlServer: server })).toMatchObject({
      plantumlMode: 'custom',
      plantumlPort: 18080,
      plantumlServer: server
    })
  })

  it('拒绝特权端口、越界和非整数端口', () => {
    expect(() => validatePlantumlPort(1023)).toThrow()
    expect(() => validatePlantumlPort(65536)).toThrow()
    expect(() => validatePlantumlPort(18080.5)).toThrow()
    expect(validatePlantumlPort(18080)).toBe(18080)
  })

  it('模式切换和端口修改不会清空自定义远程地址', () => {
    const server = 'https://plantuml.example/plantuml'
    usePrefStore.setState({ plantumlMode: 'custom', plantumlServer: server, plantumlPort: 18080 })

    usePrefStore.getState().setPlantumlMode('off')
    usePrefStore.getState().setPlantumlMode('local')
    usePrefStore.getState().setPlantumlPort(18081)
    expect(usePrefStore.getState()).toMatchObject({
      plantumlMode: 'local',
      plantumlPort: 18081,
      plantumlServer: server
    })

    expect(() => usePrefStore.getState().setPlantumlPort(1023)).toThrow()
    expect(usePrefStore.getState().plantumlPort).toBe(18081)
  })

  it('恢复旧版持久化数据后才标记就绪，并保留远程目标', async () => {
    const server = 'https://plantuml.example/plantuml'
    const saved = JSON.stringify({ state: { plantumlServer: server, plantumlHydrated: true }, version: 0 })
    let written: string | undefined
    let resolveSaved!: (value: string) => void
    const waiting = new Promise<string>((resolve) => {
      resolveSaved = resolve
    })
    const storage: StateStorage = {
      getItem: () => waiting,
      setItem: (_key, value) => {
        written = value
      },
      removeItem: () => undefined
    }
    vi.stubGlobal('localStorage', storage)
    vi.resetModules()
    try {
      const { usePrefStore: restoredStore } = await import('../src/renderer/src/stores/pref-store')
      const hydrated = new Promise<void>((resolve) => {
        restoredStore.persist.onFinishHydration(() => resolve())
      })
      expect(restoredStore.getState().plantumlHydrated).toBe(false)

      resolveSaved(saved)
      await hydrated

      expect(restoredStore.getState()).toMatchObject({
        plantumlHydrated: true,
        plantumlMode: 'custom',
        plantumlPort: 18080,
        plantumlServer: server
      })
      expect(written).toBeDefined()
      expect(written).not.toContain('"plantumlHydrated"')
    } finally {
      vi.unstubAllGlobals()
      vi.resetModules()
    }
  })

  it('恢复损坏的当前版本偏好时回退模式和端口，保留远程地址', async () => {
    const server = 'https://plantuml.example/plantuml'
    const saved = JSON.stringify({
      state: {
        plantumlMode: 'invalid',
        plantumlPort: 1023,
        plantumlServer: server,
        plantumlHydrated: true,
        theme: 'dark'
      },
      version: 1
    })
    const storage: StateStorage = {
      getItem: () => saved,
      setItem: () => undefined,
      removeItem: () => undefined
    }
    vi.stubGlobal('localStorage', storage)
    vi.resetModules()
    try {
      const { usePrefStore: restoredStore } = await import('../src/renderer/src/stores/pref-store')
      expect(restoredStore.getState()).toMatchObject({
        plantumlHydrated: true,
        plantumlMode: 'local',
        plantumlPort: 18080,
        plantumlServer: server,
        theme: 'dark'
      })
    } finally {
      vi.unstubAllGlobals()
      vi.resetModules()
    }
  })

  it('恢复有效的当前版本偏好时保留模式、端口和远程地址', async () => {
    const server = 'https://plantuml.example/plantuml'
    const saved = JSON.stringify({
      state: { plantumlMode: 'custom', plantumlPort: 18081, plantumlServer: server, theme: 'dark' },
      version: 1
    })
    const storage: StateStorage = {
      getItem: () => saved,
      setItem: () => undefined,
      removeItem: () => undefined
    }
    vi.stubGlobal('localStorage', storage)
    vi.resetModules()
    try {
      const { usePrefStore: restoredStore } = await import('../src/renderer/src/stores/pref-store')
      expect(restoredStore.getState()).toMatchObject({
        plantumlHydrated: true,
        plantumlMode: 'custom',
        plantumlPort: 18081,
        plantumlServer: server,
        theme: 'dark'
      })
    } finally {
      vi.unstubAllGlobals()
      vi.resetModules()
    }
  })

  it('hydration 完成前不读取状态、不订阅或启动默认本地服务', () => {
    const api: PlantumlPreferenceSyncApi = {
      getStatus: vi.fn().mockResolvedValue({ state: 'stopped', port: 18080, errorCode: null }),
      configure: vi.fn().mockResolvedValue({ state: 'starting', port: 18080, errorCode: null }),
      subscribe: vi.fn(() => () => undefined)
    }

    syncPlantumlPreference(
      { plantumlHydrated: false, plantumlMode: 'local', plantumlPort: 18080 },
      vi.fn(),
      api
    )()

    expect(api.getStatus).not.toHaveBeenCalled()
    expect(api.configure).not.toHaveBeenCalled()
    expect(api.subscribe).not.toHaveBeenCalled()
  })

  it('hydration 后先订阅状态、读取当前状态，再按本地模式和端口配置', async () => {
    const calls: string[] = []
    let publishStatus: ((status: PlantUmlStatusDto) => void) | undefined
    const currentStatus: PlantUmlStatusDto = { state: 'stopped', port: 18080, errorCode: null }
    const startingStatus: PlantUmlStatusDto = { state: 'starting', port: 18081, errorCode: null }
    const api: PlantumlPreferenceSyncApi = {
      getStatus: vi.fn(async () => {
        calls.push('getStatus')
        return currentStatus
      }),
      configure: vi.fn(async (configuration) => {
        calls.push(`configure:${configuration.enabled}:${configuration.port}`)
        return startingStatus
      }),
      subscribe: vi.fn((listener) => {
        calls.push('subscribe')
        publishStatus = listener
        return () => calls.push('unsubscribe')
      })
    }
    const onStatus = vi.fn()

    const unsubscribe = syncPlantumlPreference(
      { plantumlHydrated: true, plantumlMode: 'local', plantumlPort: 18081 },
      onStatus,
      api
    )
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(calls.slice(0, 3)).toEqual(['subscribe', 'getStatus', 'configure:true:18081'])
    expect(api.configure).toHaveBeenCalledWith({ enabled: true, port: 18081 })
    expect(onStatus).toHaveBeenCalledWith(currentStatus)
    expect(onStatus).toHaveBeenCalledWith(startingStatus)
    expect(usePlantumlStatusStore.getState().status).toEqual(startingStatus)

    const runningStatus: PlantUmlStatusDto = { state: 'running', port: 18081, errorCode: null }
    publishStatus?.(runningStatus)
    expect(onStatus).toHaveBeenLastCalledWith(runningStatus)
    expect(usePlantumlStatusStore.getState().status).toEqual(runningStatus)

    unsubscribe()
    expect(calls.at(-1)).toBe('unsubscribe')
  })

  it.each(['custom', 'off'] as const)('在 %s 模式保留本地服务停止失败状态，且配置中不传入自定义 URL', async (plantumlMode) => {
    const stopError: PlantUmlStatusDto = { state: 'error', port: 18082, errorCode: 'stop_timeout' }
    const api: PlantumlPreferenceSyncApi = {
      getStatus: vi.fn().mockResolvedValue({ state: 'running', port: 18080, errorCode: null }),
      configure: vi.fn().mockResolvedValue(stopError),
      subscribe: vi.fn(() => () => undefined)
    }
    const onStatus = vi.fn()

    const unsubscribe = syncPlantumlPreference(
      { plantumlHydrated: true, plantumlMode, plantumlPort: 18082 },
      onStatus,
      api
    )
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(api.configure).toHaveBeenCalledWith({ enabled: false, port: 18082 })
    expect(api.configure).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(api.configure.mock.calls[0]?.[0])).not.toContain('plantuml.example')
    expect(onStatus).toHaveBeenCalledWith(stopError)
    unsubscribe()
  })

  it.each(['custom', 'off'] as const)('在 %s 模式重试停止失败时再次发送 disabled 配置', async (plantumlMode) => {
    const stopped: PlantUmlStatusDto = { state: 'stopped', port: 18082, errorCode: null }
    const api: PlantumlServiceActionApi = {
      retry: vi.fn().mockResolvedValue(stopped),
      configure: vi.fn().mockResolvedValue(stopped)
    }

    await expect(retryPlantumlService(plantumlMode, 18082, api)).resolves.toEqual(stopped)

    expect(api.configure).toHaveBeenCalledWith({ enabled: false, port: 18082 })
    expect(api.retry).not.toHaveBeenCalled()
  })

  it('本地模式重试启动服务时调用专用 retry 通道', async () => {
    const running: PlantUmlStatusDto = { state: 'running', port: 18080, errorCode: null }
    const api: PlantumlServiceActionApi = {
      retry: vi.fn().mockResolvedValue(running),
      configure: vi.fn().mockResolvedValue(running)
    }

    await expect(retryPlantumlService('local', 18080, api)).resolves.toEqual(running)

    expect(api.retry).toHaveBeenCalledOnce()
    expect(api.configure).not.toHaveBeenCalled()
  })

  it('只把当前 retry 回包同步到非持久化状态 store', async () => {
    const running: PlantUmlStatusDto = { state: 'running', port: 18080, errorCode: null }
    const api: PlantumlServiceActionApi = {
      retry: vi.fn().mockResolvedValue(running),
      configure: vi.fn().mockResolvedValue(running)
    }

    await runPlantumlRetryIfCurrent(
      'local',
      18080,
      api,
      () => true,
      vi.fn(),
      () => ({ state: 'stopped', port: null, errorCode: null })
    )

    expect(usePlantumlStatusStore.getState().status).toEqual(running)
  })

  it.each([
    { label: 'running', status: { state: 'running', port: 18080, errorCode: null } as PlantUmlStatusDto },
    { label: 'starting', status: { state: 'starting', port: 18080, errorCode: null } as PlantUmlStatusDto }
  ])('新模式配置状态到达后，不接受迟到的旧本地 retry $label 快照', async ({ status: staleRetryStatus }) => {
    const stopped: PlantUmlStatusDto = { state: 'stopped', port: 18080, errorCode: null }
    let resolveRetry!: (value: PlantUmlStatusDto) => void
    let mode: PlantUmlMode = 'local'
    let statusGeneration = 0
    let currentStatus: PlantUmlStatusDto = { state: 'error', port: 18080, errorCode: 'process_exit' }
    const applyStatus = vi.fn((next: PlantUmlStatusDto): void => {
      statusGeneration += 1
      currentStatus = next
    })
    const retryApi: PlantumlServiceActionApi = {
      retry: vi.fn(() => new Promise<PlantUmlStatusDto>((resolve) => { resolveRetry = resolve })),
      configure: vi.fn().mockResolvedValue(stopped)
    }
    const retryGeneration = statusGeneration
    const retryMode = mode
    const pendingRetry = runPlantumlRetryIfCurrent(
      retryMode,
      18080,
      retryApi,
      () => statusGeneration === retryGeneration && mode === retryMode,
      applyStatus,
      () => currentStatus
    )

    let publishStatus: ((next: PlantUmlStatusDto) => void) | undefined
    mode = 'custom'
    const preferenceApi: PlantumlPreferenceSyncApi = {
      getStatus: vi.fn().mockResolvedValue(stopped),
      configure: vi.fn(() => {
        publishStatus?.(stopped)
        return Promise.resolve(stopped)
      }),
      subscribe: vi.fn((listener) => {
        publishStatus = listener
        return () => undefined
      })
    }
    syncPlantumlPreference(
      { plantumlHydrated: true, plantumlMode: mode, plantumlPort: 18080 },
      applyStatus,
      preferenceApi
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(currentStatus).toEqual(stopped)

    resolveRetry(staleRetryStatus)
    await pendingRetry

    expect(currentStatus).toEqual(stopped)
    expect(applyStatus).not.toHaveBeenCalledWith(staleRetryStatus)
  })

  it('新模式状态到达后，不接受迟到旧 retry 的失败状态', async () => {
    const stopped: PlantUmlStatusDto = { state: 'stopped', port: 18080, errorCode: null }
    let rejectRetry!: (reason?: unknown) => void
    let mode: PlantUmlMode = 'local'
    let statusGeneration = 0
    let currentStatus: PlantUmlStatusDto = { state: 'error', port: 18080, errorCode: 'process_exit' }
    const applyStatus = vi.fn((next: PlantUmlStatusDto): void => {
      statusGeneration += 1
      currentStatus = next
    })
    const retryApi: PlantumlServiceActionApi = {
      retry: vi.fn(() => new Promise<PlantUmlStatusDto>((_resolve, reject) => { rejectRetry = reject })),
      configure: vi.fn().mockResolvedValue(stopped)
    }
    const retryGeneration = statusGeneration
    const retryMode = mode
    const pendingRetry = runPlantumlRetryIfCurrent(
      retryMode,
      18080,
      retryApi,
      () => statusGeneration === retryGeneration && mode === retryMode,
      applyStatus,
      () => currentStatus
    )

    mode = 'off'
    syncPlantumlPreference(
      { plantumlHydrated: true, plantumlMode: mode, plantumlPort: 18080 },
      applyStatus,
      {
        getStatus: vi.fn().mockResolvedValue(stopped),
        configure: vi.fn().mockResolvedValue(stopped),
        subscribe: vi.fn(() => () => undefined)
      }
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(currentStatus).toEqual(stopped)

    rejectRetry(new Error('superseded retry'))
    await pendingRetry

    expect(currentStatus).toEqual(stopped)
    expect(applyStatus).not.toHaveBeenCalledWith({
      state: 'error',
      port: 18080,
      errorCode: 'service_unavailable'
    })
  })
})
