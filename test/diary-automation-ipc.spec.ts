// @vitest-environment happy-dom

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { DiaryMonthEntry, PlanTreeNode, TraceBridge } from '../src/shared/ipc-contract'
import type { DiaryAutomationStatus } from '../src/shared/event-types'
import StatusBar from '../src/renderer/src/components/StatusBar'
import DiaryView from '../src/renderer/src/views/DiaryView'
import { i18n } from '../src/renderer/src/i18n'

const electron = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void
  const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>()
  const rendererListeners = new Map<string, Set<Listener>>()
  const appListeners = new Map<string, Listener[]>()
  const instances: FakeWindow[] = []
  const emitRenderer = (event: string, payload: unknown): void => {
    for (const listener of rendererListeners.get(event) ?? []) listener({}, payload)
  }
  class FakeWindow {
    private listeners = new Map<string, Listener[]>()
    webContents = {
      send: vi.fn((event: string, payload: unknown) => emitRenderer(event, payload)),
      isDestroyed: () => false,
      setWindowOpenHandler: vi.fn(),
      on: vi.fn()
    }
    show = vi.fn()
    loadFile = vi.fn()
    loadURL = vi.fn()
    maximize = vi.fn()
    constructor(_options: unknown) { instances.push(this) }
    on(event: string, listener: Listener) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
      return this
    }
    once(event: string, listener: Listener) {
      const once = (...args: unknown[]): void => {
        this.removeListener(event, once)
        listener(...args)
      }
      return this.on(event, once)
    }
    removeListener(event: string, listener: Listener) {
      this.listeners.set(event, (this.listeners.get(event) ?? []).filter((item) => item !== listener))
      return this
    }
    emit(event: string, ...args: unknown[]) {
      for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args)
    }
    getBounds() { return { width: 1200, height: 800 } }
    isMaximized() { return false }
  }
  const paths = { userData: '' }
  return {
    paths, handlers, rendererListeners, appListeners, instances, emitRenderer,
    BrowserWindow: FakeWindow,
    app: {
      isPackaged: false,
      getVersion: () => '0.18.1',
      getPath: () => paths.userData,
      requestSingleInstanceLock: () => true,
      setAppUserModelId: vi.fn(),
      whenReady: () => Promise.resolve(),
      quit: vi.fn(),
      on: (event: string, listener: Listener) => appListeners.set(event, [...(appListeners.get(event) ?? []), listener])
    },
    ipcMain: {
      handle: (channel: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => handlers.set(channel, handler),
      removeHandler: (channel: string) => handlers.delete(channel)
    },
    ipcRenderer: {
      invoke: vi.fn(async (channel: string, payload?: unknown) => {
        const handler = handlers.get(channel)
        if (!handler) return { ok: true, code: 0, message: 'ok', data: null }
        return handler({}, payload)
      }),
      on: vi.fn((event: string, listener: Listener) => {
        const listeners = rendererListeners.get(event) ?? new Set<Listener>()
        listeners.add(listener)
        rendererListeners.set(event, listeners)
      }),
      removeListener: vi.fn((event: string, listener: Listener) => rendererListeners.get(event)?.delete(listener))
    },
    contextBridge: { exposeInMainWorld: vi.fn((key: string, value: unknown) => Reflect.set(window, key, value)) },
    dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showErrorBox: vi.fn() },
    shell: { openExternal: vi.fn() }
  }
})

vi.mock('electron', () => electron)
// Calendar renders real colors; loading the unrelated editor barrel would initialize Muya.
vi.mock('../src/renderer/src/components/cards', async () => {
  const colors = await import('../src/renderer/src/components/cards/MoodCard')
  return { scoreColor: colors.scoreColor, scoreTextColor: colors.scoreTextColor }
})

let temp: string | undefined
let disposeIpc: (() => void) | undefined
let host: HTMLDivElement | undefined
let reactRoot: ReturnType<typeof createRoot> | undefined
let mainLoaded = false
let previousAct: unknown
const eventCleanup: Array<() => void> = []

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  electron.handlers.clear()
  electron.rendererListeners.clear()
  electron.appListeners.clear()
  electron.instances.splice(0)
  Reflect.deleteProperty(window, 'trace')
  previousAct = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  temp = await fs.mkdtemp(join(tmpdir(), 'trace-diary-automation-'))
  electron.paths.userData = join(temp, 'settings')
})

afterEach(async () => {
  if (reactRoot) await act(async () => { reactRoot?.unmount() })
  reactRoot = undefined
  host?.remove()
  host = undefined
  if (mainLoaded) {
    for (const listener of electron.appListeners.get('before-quit') ?? []) listener({ preventDefault() {} })
    await vi.waitFor(() => expect(electron.handlers.size).toBe(0))
    for (const listener of electron.appListeners.get('window-all-closed') ?? []) listener()
    mainLoaded = false
  }
  disposeIpc?.()
  disposeIpc = undefined
  for (const off of eventCleanup.splice(0)) off()
  vi.restoreAllMocks()
  if (temp) await fs.rm(temp, { recursive: true, force: true })
  temp = undefined
  if (previousAct === undefined) Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  else Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct)
})

function handler(channel: string) {
  const found = electron.handlers.get(channel)
  if (!found) throw new Error(`Missing handler: ${channel}`)
  return found
}

async function preload(): Promise<TraceBridge> {
  await import('../src/preload/index')
  return Reflect.get(window, 'trace') as TraceBridge
}

async function render(component: Parameters<typeof createElement>[0]): Promise<void> {
  host = document.createElement('div')
  document.body.append(host)
  reactRoot = createRoot(host)
  await act(async () => { reactRoot?.render(createElement(component)) })
}

describe('diary automation IPC and consumers', () => {
  it('allows the typed status event, blocks unrelated events and replays status to late subscribers', async () => {
    const bridge = await preload()
    const status: DiaryAutomationStatus = { state: 'error', retryable: true }
    electron.emitRenderer('trace:diary-automation-status', status)
    const received: unknown[] = []
    const off = bridge.on('trace:diary-automation-status', (payload) => received.push(payload))
    const unknownBridge = bridge as unknown as { on(event: string, cb: (payload: unknown) => void): () => void }
    unknownBridge.on('trace:diary-content', (payload) => received.push(payload))
    expect(received).toEqual([status])
    const running: DiaryAutomationStatus = { state: 'running', retryable: false }
    electron.emitRenderer('trace:diary-automation-status', running)
    expect(received).toEqual([status, running])
    electron.emitRenderer('trace:diary-content', { text: 'private' })
    off()
    electron.emitRenderer('trace:diary-automation-status', { state: 'complete', retryable: false })
    expect(received).toEqual([status, running])
    expect(electron.ipcRenderer.on.mock.calls.map(([event]) => event)).not.toContain('trace:diary-content')
  })

  it('forwards diary status to a live renderer and disposes the forwarding listener', async () => {
    const { registerIpc } = await import('../src/main/ipc/register')
    const { createStartupCoordinator } = await import('../src/main/services/startup-coordinator')
    const { bus } = await import('../src/main/services/event-bus')
    const win = new electron.BrowserWindow({})
    const startup = createStartupCoordinator({ activateConfiguredRoot: async () => false })
    const deps = {
      app: {}, storage: {}, config: {}, transfer: {}, export: {}, search: {}, startup,
      getWindow: () => win as unknown as BrowserWindow, log() {}
    } as unknown as Parameters<typeof registerIpc>[0]
    disposeIpc = registerIpc(deps)
    bus.emit('trace:diary-automation-status', { state: 'running', retryable: false })
    expect(win.webContents.send.mock.calls).toEqual([
      ['trace:diary-automation-status', { state: 'running', retryable: false }]
    ])
    disposeIpc()
    bus.emit('trace:diary-automation-status', { state: 'error', retryable: true })
    expect(win.webContents.send).toHaveBeenCalledTimes(1)
  })

  it('runs real main activation in the background, refreshes partial writes and retries on focus', async () => {
    const { PlanRepository } = await import('../src/main/services/plan-repository')
    const { ConfigService } = await import('../src/main/services/config-service')
    const diary = await import('../src/main/services/diary-service')
    const root = join(temp!, 'library-a')
    const newRoot = join(temp!, 'library-b')
    await fs.mkdir(root)
    await fs.mkdir(newRoot)
    const configuration = new ConfigService(electron.paths.userData, new PlanRepository())
    await configuration.setRootDir(root)
    let attempt = 0
    let rejectOld!: (error: unknown) => void
    const oldFlight = new Promise<never>((_resolve, reject) => { rejectOld = reject })
    const original = diary.reconcileDiaryPages
    vi.spyOn(diary, 'reconcileDiaryPages').mockImplementation(async (library, today) => {
      attempt++
      if (attempt === 1) {
        await diary.ensureDiaryRoot(library)
        await diary.ensureTodayPage(library, today)
        throw new Error('private text C:\\private-library\\checkpoint')
      }
      if (attempt === 3) return oldFlight
      return original(library, today)
    })
    await preload()
    await import('../src/main/index')
    mainLoaded = true
    await vi.waitFor(() => expect(electron.instances).toHaveLength(1))
    const win = electron.instances[0]
    const bootstrap = handler('app:bootstrap')({}, undefined)
    expect(attempt).toBe(0)
    win.emit('ready-to-show')
    expect(win.show).toHaveBeenCalledTimes(1)
    expect(attempt).toBe(0)
    expect(await bootstrap).toMatchObject({ ok: true, data: { rootDir: root } })
    // Prime the cache before asynchronous diary writes finish.
    await handler('storage:treeGetChildren')({}, { parent_path: 'Diary' })
    await vi.waitFor(() => expect(win.webContents.send.mock.calls).toContainEqual([
      'trace:diary-automation-status', { state: 'error', retryable: true }
    ]))
    const refreshes = () => win.webContents.send.mock.calls.filter(([event]) => event === 'trace:plan-changed')
    expect(refreshes()).toHaveLength(1)
    const refresh = refreshes()[0][1] as { path: string }
    expect(refresh.path).toMatch(/^Diary\/\d{4}-\d{2}-\d{2}$/)
    const date = refresh.path.slice('Diary/'.length)
    expect(await handler('storage:treeGetChildren')({}, { parent_path: 'Diary' })).toMatchObject({
      ok: true, data: [{ path: `Diary/${date}` }]
    })
    await vi.waitFor(async () => {
      expect(await handler('search:query')({}, { keywords: [date] })).toMatchObject({
        ok: true, data: expect.arrayContaining([expect.objectContaining({ path: `Diary/${date}` })])
      })
    }, { timeout: 2000 })
    const failureIndex = win.webContents.send.mock.calls.findIndex(([event, payload]) =>
      event === 'trace:diary-automation-status' && (payload as DiaryAutomationStatus).state === 'error')
    expect(win.webContents.send.mock.calls.findIndex(([event]) => event === 'trace:plan-changed')).toBeLessThan(failureIndex)
    win.emit('focus')
    await vi.waitFor(() => expect(attempt).toBe(2))
    await vi.waitFor(() => expect(win.webContents.send.mock.calls.at(-1)).toEqual([
      'trace:diary-automation-status', { state: 'complete', retryable: false }
    ]))
    expect(refreshes()).toHaveLength(1)
    // A new activation of A is pending while B replaces it; A must stay silent.
    await handler('app:setRootDir')({}, { dirPath: root, confirmed: true })
    await vi.waitFor(() => expect(attempt).toBe(3))
    await handler('app:setRootDir')({}, { dirPath: newRoot, confirmed: true })
    const newStatus: DiaryAutomationStatus[] = []
    const offDuringSwitch = (Reflect.get(window, 'trace') as TraceBridge).on('trace:diary-automation-status', (status) => newStatus.push(status))
    expect(newStatus).toEqual([{ state: 'running', retryable: false }])
    offDuringSwitch()
    await vi.waitFor(() => expect(attempt).toBe(4))
    await vi.waitFor(() => expect(refreshes()).toHaveLength(2))
    const scopedNotifications = () => win.webContents.send.mock.calls.filter(([event]) =>
      event === 'trace:diary-automation-status' || event === 'trace:plan-changed')
    const afterSwitch = [...scopedNotifications()]
    rejectOld(new Error('obsolete root failed'))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(scopedNotifications()).toEqual(afterSwitch)
    const latest: DiaryAutomationStatus[] = []
    const off = (Reflect.get(window, 'trace') as TraceBridge).on('trace:diary-automation-status', (status) => latest.push(status))
    expect(latest).toEqual([{ state: 'complete', retryable: false }])
    off()
    expect(JSON.stringify(win.webContents.send.mock.calls.filter(([event]) => event === 'trace:diary-automation-status'))).not.toContain('private')
  })

  it('keeps foreground ensure serialized with real reconciliation and ignores renderer root input', async () => {
    const { registerIpc } = await import('../src/main/ipc/register')
    const { PlanRepository } = await import('../src/main/services/plan-repository')
    const { StorageService } = await import('../src/main/services/storage-service')
    const { createStartupCoordinator } = await import('../src/main/services/startup-coordinator')
    const diary = await import('../src/main/services/diary-service')
    const { todayDateStr } = await import('../src/shared/validation')
    const { bus } = await import('../src/main/services/event-bus')
    const root = join(temp!, 'library')
    await fs.mkdir(root)
    const repo = new PlanRepository()
    diary.setDiaryRepo(repo)
    const storage = new StorageService(repo)
    storage.setRoot(root)
    await diary.ensureDiaryRoot(root)
    await storage.treeGetChildren('Diary')
    const notifications: Array<{ path: string }> = []
    eventCleanup.push(bus.on('trace:plan-changed', (payload) => notifications.push(payload)))
    const startup = createStartupCoordinator({ activateConfiguredRoot: async () => true })
    startup.onWindowShown()
    const logs: unknown[] = []
    let activation = 1
    disposeIpc = registerIpc({
      app: {}, storage, config: {}, transfer: {}, export: {}, search: {}, startup,
      captureDiaryRootGuard: () => {
        const current = activation
        return () => current === activation
      },
      getWindow: () => null, log: (...args: unknown[]) => logs.push(args)
    } as unknown as Parameters<typeof registerIpc>[0])
    const originalWrite = repo.writePlanAtomic.bind(repo)
    let writes = 0
    vi.spyOn(repo, 'writePlanAtomic').mockImplementation(async (...args) => {
      writes++
      return originalWrite(...args)
    })
    const today = todayDateStr()
    const [background, foreground] = await Promise.all([
      diary.reconcileDiaryPages(root, today),
      handler('diary:ensure')({}, { planRoot: join(temp!, 'untrusted') })
    ])
    expect(background.today).toBe(today)
    expect(foreground).toMatchObject({ ok: true, data: null })
    expect(writes).toBe(1)
    expect(notifications).toEqual([{ path: `Diary/${today}` }])
    expect(await storage.treeGetChildren('Diary')).toMatchObject([{ path: `Diary/${today}` }])
    await handler('diary:ensure')({}, {})
    expect(notifications).toHaveLength(1)
    expect((await diary.readDaySummary(root, today)).components).toHaveLength(3)
    expect(await fs.stat(join(temp!, 'untrusted')).catch(() => null)).toBeNull()
    vi.spyOn(repo, 'writePlanAtomic').mockRejectedValue(new Error('C:\\private\\diary content'))
    await fs.rm(join(root, 'Diary', today, 'plan.json'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await handler('diary:ensure')({}, {})).toMatchObject({ ok: false, code: 50, message: '日记初始化失败，请稍后重试' })
    expect(JSON.stringify(logs)).not.toContain('private')
    expect(consoleError.mock.calls).toEqual([])
    vi.spyOn(repo, 'writePlanAtomic').mockImplementation(async (...args) => {
      activation++ // Same-path root replacement while foreground ensure is awaiting a write.
      return originalWrite(...args)
    })
    expect(await handler('diary:ensure')({}, {})).toMatchObject({ ok: true })
    expect(notifications).toHaveLength(1)
  })

  it('shows localized retry availability in StatusBar without displaying payload error details', async () => {
    await preload()
    await i18n.changeLanguage('zh-CN')
    await render(StatusBar)
    await act(async () => electron.emitRenderer('trace:diary-automation-status', {
      state: 'error', retryable: true, message: 'C:\\private\\diary content'
    }))
    expect(host?.textContent).toContain('日记补建失败')
    expect(host?.textContent).toContain('重新聚焦窗口后重试')
    expect(host?.textContent).not.toContain('private')
    await act(async () => { await i18n.changeLanguage('en-US') })
    expect(host?.textContent).toContain('Diary backfill failed')
    await act(async () => electron.emitRenderer('trace:diary-automation-status', { state: 'running', retryable: false }))
    expect(host?.textContent).toContain('Preparing diary pages')
    await act(async () => electron.emitRenderer('trace:diary-automation-status', { state: 'complete', retryable: false }))
    expect(host?.textContent).not.toContain('Diary backfill failed')
  })

  it('reloads the displayed month once for the diary scoped batch notification', async () => {
    await preload()
    await i18n.changeLanguage('zh-CN')
    const now = new Date()
    const month = now.getMonth() + 1
    const year = now.getFullYear()
    const date = `${year}-${String(month).padStart(2, '0')}-01`
    let entries: DiaryMonthEntry[] = []
    electron.handlers.set('diary:month', async () => ({ ok: true, code: 0, message: 'ok', data: { entries } }))
    await render(DiaryView)
    expect(host?.textContent).toContain('本月还没有日记')
    entries = [{ date, score: null, notePreview: 'batch-visible', compCount: 3 }]
    electron.ipcRenderer.invoke.mockClear()
    await act(async () => electron.emitRenderer('trace:plan-changed', { path: 'Other/plan' }))
    expect(electron.ipcRenderer.invoke.mock.calls).toEqual([])
    await act(async () => electron.emitRenderer('trace:plan-changed', { path: `Diary/${date}` }))
    expect(electron.ipcRenderer.invoke.mock.calls.filter(([channel]) => channel === 'diary:month')).toEqual([
      ['diary:month', { year, month }]
    ])
    expect(host?.textContent).toContain('batch-visible')
    expect(electron.ipcRenderer.invoke.mock.calls.some(([channel]) => channel === 'diary:ensure')).toBe(false)
    await act(async () => host?.querySelector<HTMLButtonElement>('.diary-cal-nav')?.click())
    electron.ipcRenderer.invoke.mockClear()
    await act(async () => electron.emitRenderer('trace:plan-changed', { path: `Diary/${date}` }))
    expect(electron.ipcRenderer.invoke.mock.calls.filter(([channel]) => channel === 'diary:month')).toEqual([
      ['diary:month', { year: month === 1 ? year - 1 : year, month: month === 1 ? 12 : month - 1 }]
    ])
    await act(async () => { reactRoot?.unmount() })
    reactRoot = undefined
    electron.ipcRenderer.invoke.mockClear()
    electron.emitRenderer('trace:plan-changed', { path: `Diary/${date}` })
    expect(electron.ipcRenderer.invoke.mock.calls).toEqual([])
  })

  it('refreshes Diary and its root through the existing tree subscriber for one batch', async () => {
    await preload()
    const { subscribeTreeEvents, useTreeStore } = await import('../src/renderer/src/stores/tree-store')
    const old = useTreeStore.getState()
    const nodes: PlanTreeNode[] = [{ path: 'Diary/2026-09-28', name: '2026-09-28', kind: 'plan', has_children: false, order: Number.MAX_SAFE_INTEGER }]
    electron.handlers.set('storage:treeGetChildren', async (_event, payload) => ({
      ok: true, code: 0, message: 'ok',
      data: (payload as { parent_path: string }).parent_path === 'Diary' ? nodes : []
    }))
    const off = subscribeTreeEvents()
    try {
      electron.emitRenderer('trace:plan-changed', { path: 'Diary/2026-09-28' })
      await vi.waitFor(() => expect(useTreeStore.getState().childrenMap.Diary).toEqual(nodes))
      expect(electron.ipcRenderer.invoke.mock.calls).toEqual([
        ['storage:treeGetChildren', { parent_path: 'Diary' }],
        ['storage:treeGetChildren', { parent_path: '' }]
      ])
    } finally {
      off()
      useTreeStore.setState(old, true)
    }
  })
})
