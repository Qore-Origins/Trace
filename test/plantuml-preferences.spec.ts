import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StateStorage } from 'zustand/middleware'
import { validatePlantumlPort } from '../src/shared/plantuml-types'
import { migratePlantumlPreference, usePrefStore } from '../src/renderer/src/stores/pref-store'

describe('PlantUML preferences', () => {
  afterEach(() => {
    usePrefStore.setState(usePrefStore.getInitialState(), true)
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
})
