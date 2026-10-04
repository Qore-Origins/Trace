// @vitest-environment happy-dom
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, BrowserWindowConstructorOptions, IpcMain } from 'electron'
import { AGENT_APPROVAL_IPC, type AgentApprovalBridge, type AgentApprovalRequestSnapshot } from '../src/shared/agent-types'

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>()
  const exposed = new Map<string, unknown>()
  const calls: Array<{ channel: string; payload: unknown[] }> = []
  return {
    handlers, exposed, calls,
    ipcMain: {
      handle: (name: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>) => handlers.set(name, handler),
      removeHandler: (name: string) => handlers.delete(name)
    },
    contextBridge: { exposeInMainWorld: (name: string, value: unknown) => { exposed.set(name, value); Reflect.set(window, name, value) } },
    ipcRenderer: { invoke: vi.fn((channel: string, ...payload: unknown[]) => { calls.push({ channel, payload }); return Promise.resolve(null) }) }
  }
})
vi.mock('electron', () => electron)

type Listener = (...args: unknown[]) => void
class EventTargetFake {
  private readonly listeners = new Map<string, Set<Listener>>()
  on(name: string, listener: Listener): this { const group = this.listeners.get(name) ?? new Set<Listener>(); group.add(listener); this.listeners.set(name, group); return this }
  once(name: string, listener: Listener): this {
    const wrapped: Listener = (...args) => { this.removeListener(name, wrapped); listener(...args) }
    return this.on(name, wrapped)
  }
  removeListener(name: string, listener: Listener): this { this.listeners.get(name)?.delete(listener); return this }
  emit(name: string, ...args: unknown[]): void { for (const listener of [...(this.listeners.get(name) ?? [])]) listener(...args) }
}

class WebContentsFake extends EventTargetFake {
  destroyed = false
  windowOpenHandler: ((details: unknown) => unknown) | undefined
  mainFrame: { url: string } = { url: 'about:blank' }
  isDestroyed(): boolean { return this.destroyed }
  setWindowOpenHandler(handler: (details: unknown) => unknown): void { this.windowOpenHandler = handler }
}

class WindowFake extends EventTargetFake {
  readonly webContents = new WebContentsFake()
  destroyed = false
  shown = false
  loadError: Error | null = null
  loadedUrl = ''
  constructor(readonly options: BrowserWindowConstructorOptions) { super() }
  isDestroyed(): boolean { return this.destroyed }
  async loadFile(path: string): Promise<void> {
    if (this.loadError) throw this.loadError
    this.loadedUrl = `file:///${path.replaceAll('\\', '/')}`
    this.webContents.mainFrame.url = this.loadedUrl
  }
  async loadURL(url: string): Promise<void> {
    if (this.loadError) throw this.loadError
    this.loadedUrl = url
    this.webContents.mainFrame.url = url
  }
  show(): void { this.shown = true }
  focus(): void {}
  close(): void {
    this.emit('close', { preventDefault() {} })
    this.destroyed = true
    this.webContents.destroyed = true
    this.emit('closed')
  }
}

function parentWindow(): EventTargetFake & { isDestroyed(): boolean } {
  return Object.assign(new EventTargetFake(), { isDestroyed: () => false })
}

const snapshot: AgentApprovalRequestSnapshot = {
  endpoint: 'https://provider.example/v1/chat/completions',
  model: 'approved-model',
  serializedBody: '{"model":"approved-model","messages":[{"role":"user","content":"<script>private-body</script>"}],"stream":true}'
}

describe('isolated agent outbound approval window', () => {
  let service: InstanceType<typeof import('../src/main/services/agent-approval-window-service').AgentApprovalWindowService>
  let owner: ReturnType<typeof parentWindow>
  let windows: WindowFake[]
  let disposeIpc: (() => void) | undefined
  let roots: Root[]

  async function setup(options: { rendererUrl?: string; failLoad?: boolean } = {}) {
    vi.resetModules()
    electron.handlers.clear()
    electron.exposed.clear()
    electron.calls.length = 0
    owner = parentWindow()
    windows = []
    roots = []
    const [{ AgentApprovalWindowService }, { registerAgentApprovalIpc }] = await Promise.all([
      import('../src/main/services/agent-approval-window-service'),
      import('../src/main/ipc/agent-approval-ipc')
    ])
    service = new AgentApprovalWindowService({
      getOwnerWindow: () => owner as unknown as BrowserWindow,
      preloadPath: 'out/preload/agent-approval.js',
      approvalHtmlPath: 'D:/trace/out/renderer/agent-approval.html',
      rendererUrl: options.rendererUrl,
      createWindow: (windowOptions) => {
        const window = new WindowFake(windowOptions)
        if (options.failLoad) window.loadError = new Error('synthetic load failure')
        windows.push(window)
        return window as unknown as BrowserWindow
      }
    })
    disposeIpc = registerAgentApprovalIpc(service, electron.ipcMain as unknown as IpcMain)
  }

  async function waitForWindow(): Promise<WindowFake> {
    await vi.waitFor(() => expect(windows).toHaveLength(1))
    await Promise.resolve()
    return windows[0]
  }

  function ipc(name: string): (event: unknown, payload?: unknown) => Promise<unknown> {
    const handler = electron.handlers.get(name)
    if (!handler) throw new Error(`missing private handler: ${name}`)
    return handler
  }

  function event(window: WindowFake, sender = window.webContents, senderFrame = sender.mainFrame): { sender: unknown; senderFrame: unknown } {
    return { sender, senderFrame }
  }

  beforeEach(() => { vi.clearAllMocks(); Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true) })
  afterEach(async () => {
    for (const root of roots) await act(async () => root.unmount())
    disposeIpc?.()
    service?.dispose()
    Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  })

  it('allows only the exact pending window main frame to read and confirm its frozen snapshot once', async () => {
    await setup()
    const decision = service.requestApproval(snapshot)
    const first = await waitForWindow()
    const secondDecision = service.requestApproval({ ...snapshot, model: 'other-model' })
    await vi.waitFor(() => {
      expect(windows).toHaveLength(2)
    })
    const second = windows[1]

    const getSnapshot = ipc('trace:agent-approval:get-snapshot')
    const confirm = ipc('trace:agent-approval:confirm')
    expect(await getSnapshot(event(first))).toEqual(snapshot)
    expect(await getSnapshot(event(first, first.webContents, { url: first.loadedUrl }))).toBeNull()
    expect(await getSnapshot(event(second))).toEqual({ ...snapshot, model: 'other-model' })
    expect(await confirm(event(second))).toBe(true)
    expect(await confirm(event(second))).toBe(false)
    expect(await confirm(event(first))).toBe(true)
    await expect(decision).resolves.toBe(true)
    await expect(secondDecision).resolves.toBe(true)
  })

  it('rejects forged senders and cross-window decisions without resolving another preview', async () => {
    await setup()
    const decision = service.requestApproval(snapshot)
    const window = await waitForWindow()
    const foreign = new WebContentsFake()
    expect(await ipc('trace:agent-approval:get-snapshot')(event(window, foreign))).toBeNull()
    expect(await ipc('trace:agent-approval:confirm')(event(window, foreign))).toBe(false)
    expect(window.shown).toBe(true)
    window.close()
    await expect(decision).resolves.toBe(false)
  })

  it('accepts one explicit cancel from the exact pending main frame and rejects replay', async () => {
    await setup()
    const decision = service.requestApproval(snapshot)
    const window = await waitForWindow()
    const cancel = ipc('trace:agent-approval:cancel')

    expect(await cancel(event(window))).toBe(true)
    expect(await cancel(event(window))).toBe(false)
    expect(await ipc('trace:agent-approval:confirm')(event(window))).toBe(false)
    await expect(decision).resolves.toBe(false)
  })

  it.each(['close', 'load-failure', 'crash', 'navigation', 'unexpected-main-navigation', 'owner-close'] as const)('fails closed on %s', async (failure) => {
    await setup()
    const decision = service.requestApproval(snapshot)
    const window = await waitForWindow()
    if (failure === 'close') window.close()
    if (failure === 'load-failure') window.webContents.emit('did-fail-load', {}, -2, 'failed', window.loadedUrl, true)
    if (failure === 'crash') window.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
    if (failure === 'navigation') {
      let prevented = false
      window.webContents.emit('will-navigate', { preventDefault: () => { prevented = true } }, 'https://attacker.example')
      expect(prevented).toBe(true)
    }
    if (failure === 'unexpected-main-navigation') window.webContents.emit('did-navigate', {}, 'https://attacker.example')
    if (failure === 'owner-close') owner.emit('closed')
    await expect(decision).resolves.toBe(false)
    expect(await ipc('trace:agent-approval:confirm')(event(window))).toBe(false)
  })

  it('fails closed when initial navigation rejects without showing the window', async () => {
    await setup({ failLoad: true })
    const decision = service.requestApproval(snapshot)
    const window = await waitForWindow()
    await expect(decision).resolves.toBe(false)
    expect(window.shown).toBe(false)
  })

  it('uses a locked-down child window and never places body, path, or credentials in the URL', async () => {
    await setup({ rendererUrl: 'http://localhost:5173/' })
    const decision = service.requestApproval(snapshot)
    const window = await waitForWindow()
    const options = window.options
    expect(options.webPreferences).toMatchObject({
      preload: 'out/preload/agent-approval.js', contextIsolation: true,
      sandbox: true, nodeIntegration: false, webSecurity: true, devTools: false
    })
    expect(window.loadedUrl).toBe('http://localhost:5173/agent-approval.html')
    expect(window.loadedUrl).not.toMatch(/private-body|api.?key|C%3A|D%3A/i)
    expect(await ipc('trace:agent-approval:get-snapshot')(event(window))).toEqual(snapshot)
    window.close()
    await expect(decision).resolves.toBe(false)
  })

  it('exposes only the dedicated approval preload bridge, with no general Trace API', async () => {
    await setup()
    await import('../src/preload/agent-approval')
    expect([...electron.exposed.keys()]).toEqual(['traceAgentApproval'])
    const bridge = electron.exposed.get('traceAgentApproval') as AgentApprovalBridge
    await bridge.getSnapshot()
    await bridge.confirm()
    await bridge.cancel()
    expect(electron.calls).toEqual([
      { channel: AGENT_APPROVAL_IPC.getSnapshot, payload: [] },
      { channel: AGENT_APPROVAL_IPC.confirm, payload: [] },
      { channel: AGENT_APPROVAL_IPC.cancel, payload: [] }
    ])
    expect((window as Window & { trace?: unknown }).trace).toBeUndefined()
  })

  it('renders serialized user HTML as escaped plain text, not markup', async () => {
    await setup()
    const decision = service.requestApproval(snapshot)
    const approvalWindow = await waitForWindow()
    const { AgentApprovalWindow } = await import('../src/renderer/src/views/agent-approval/AgentApprovalWindow')
    window.traceAgentApproval = {
      getSnapshot: vi.fn(async () => snapshot),
      confirm: vi.fn(async () => true),
      cancel: vi.fn(async () => true)
    }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => { root.render(createElement(AgentApprovalWindow)) })
    await act(async () => { await Promise.resolve() })
    expect(container.querySelector('[data-agent-approval-endpoint]')?.textContent).toBe(snapshot.endpoint)
    expect(container.querySelector('[data-agent-approval-model]')?.textContent).toBe(snapshot.model)
    expect(container.querySelector('[data-agent-approval-body]')?.textContent).toBe(snapshot.serializedBody)
    expect(container.querySelector('script')).toBeNull()
    expect(container.innerHTML).not.toContain('<script>private-body</script>')
    expect(window.traceAgentApproval.getSnapshot).toHaveBeenCalledOnce()
    expect((window as Window & { trace?: unknown }).trace).toBeUndefined()
    await act(async () => root.unmount())
    roots.pop()
    container.remove()
    approvalWindow.close()
    await expect(decision).resolves.toBe(false)
  })
})
