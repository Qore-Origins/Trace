import {
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  type WebContents,
  type WebFrameMain
} from 'electron'
import { Buffer } from 'node:buffer'
import { pathToFileURL } from 'node:url'
import type { AgentApprovalRequestSnapshot } from '../../shared/agent-types'
import { ERR, TraceError } from '../../shared/errors'
import {
  AGENT_REQUEST_BODY_LIMIT_BYTES,
  serializeAgentChatRequest,
  type AgentChatMessage,
  type AgentProviderToolOptions
} from './agent-provider'

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000

export interface AgentApprovalWindowOptions {
  getOwnerWindow: () => BrowserWindow | null
  preloadPath: string
  approvalHtmlPath: string
  rendererUrl?: string
  createWindow?: (options: BrowserWindowConstructorOptions) => BrowserWindow
}

export type AgentOutboundApproval = (snapshot: AgentApprovalRequestSnapshot) => Promise<boolean>

export function createAgentApprovalRequestSnapshot(
  endpoint: string,
  model: string,
  messages: readonly AgentChatMessage[],
  tools?: AgentProviderToolOptions
): AgentApprovalRequestSnapshot {
  const url = new URL(endpoint)
  const path = url.pathname.replace(/\/$/, '')
  url.pathname = path.endsWith('/chat/completions') ? path : `${path}/chat/completions`
  return Object.freeze({
    endpoint: url.toString(),
    model,
    serializedBody: serializeAgentChatRequest(model, messages, tools)
  })
}

interface PendingApproval {
  window: BrowserWindow
  snapshot: AgentApprovalRequestSnapshot
  expectedUrl: string
  owner: BrowserWindow
  resolve: (approved: boolean) => void
  timeout: ReturnType<typeof setTimeout>
  settled: boolean
  ownerClosed: () => void
  listeners: Array<{ target: NodeJS.EventEmitter; event: string; listener: (...args: unknown[]) => void }>
}

function exactSnapshot(value: unknown): AgentApprovalRequestSnapshot {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TraceError(ERR.VALIDATION, '外发确认内容无效')
  }
  const record = value as Record<string, unknown>
  const keys = Reflect.ownKeys(record)
  if (keys.length !== 3 || !['endpoint', 'model', 'serializedBody'].every((key) => keys.includes(key))) {
    throw new TraceError(ERR.VALIDATION, '外发确认内容无效')
  }
  if (typeof record.endpoint !== 'string' || record.endpoint.length > 2048 ||
    typeof record.model !== 'string' || !record.model.trim() || record.model.length > 160 ||
    typeof record.serializedBody !== 'string' || Buffer.byteLength(record.serializedBody, 'utf8') > AGENT_REQUEST_BODY_LIMIT_BYTES) {
    throw new TraceError(ERR.VALIDATION, '外发确认内容无效')
  }

  let endpoint: URL
  try { endpoint = new URL(record.endpoint) } catch { throw new TraceError(ERR.VALIDATION, '外发服务地址无效') }
  const hostname = endpoint.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  if (!hostname || (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && loopback)) ||
    endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new TraceError(ERR.VALIDATION, '外发服务地址无效')
  }

  return Object.freeze({ endpoint: endpoint.toString(), model: record.model, serializedBody: record.serializedBody })
}

function approvalUrl(rendererUrl: string | undefined, htmlPath: string): string {
  if (!rendererUrl) return pathToFileURL(htmlPath).toString()
  let base: URL
  try { base = new URL(rendererUrl) } catch { throw new TraceError(ERR.INTERNAL, '外发确认窗口地址无效') }
  const hostname = base.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  if (base.protocol !== 'http:' || !loopback || base.username || base.password || base.search || base.hash) {
    throw new TraceError(ERR.INTERNAL, '外发确认窗口地址无效')
  }
  const pathname = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`
  base.pathname = `${pathname}agent-approval.html`
  return base.toString()
}

function sameFrame(sender: WebContents, senderFrame: WebFrameMain | null, pending: PendingApproval): boolean {
  return !pending.settled && !pending.window.isDestroyed() && !sender.isDestroyed() &&
    sender === pending.window.webContents && senderFrame !== null && senderFrame === sender.mainFrame &&
    senderFrame.url === pending.expectedUrl
}

export class AgentApprovalWindowService {
  private readonly pending = new Map<WebContents, PendingApproval>()
  private disposed = false

  constructor(private readonly options: AgentApprovalWindowOptions) {}

  requestApproval(value: AgentApprovalRequestSnapshot): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false)
    let snapshot: AgentApprovalRequestSnapshot
    let expectedUrl: string
    try {
      snapshot = exactSnapshot(value)
      expectedUrl = approvalUrl(this.options.rendererUrl, this.options.approvalHtmlPath)
    } catch {
      return Promise.resolve(false)
    }
    const owner = this.options.getOwnerWindow()
    if (!owner || owner.isDestroyed()) return Promise.resolve(false)

    return new Promise<boolean>((resolve) => {
      let window: BrowserWindow
      try {
        window = (this.options.createWindow ?? ((windowOptions) => new BrowserWindow(windowOptions)))({
          parent: owner,
          modal: true,
          width: 920,
          height: 720,
          minWidth: 640,
          minHeight: 480,
          show: false,
          autoHideMenuBar: true,
          title: '确认外发内容',
          webPreferences: {
            preload: this.options.preloadPath,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            devTools: false
          }
        })
      } catch {
        resolve(false)
        return
      }

      const pending: PendingApproval = {
        window, snapshot, expectedUrl, owner, resolve,
        timeout: setTimeout(() => this.finish(pending, false), APPROVAL_TIMEOUT_MS),
        settled: false,
        ownerClosed: () => this.finish(pending, false),
        listeners: []
      }
      pending.timeout.unref?.()
      this.pending.set(window.webContents, pending)
      owner.once('closed', pending.ownerClosed)

      const listen = (target: NodeJS.EventEmitter, event: string, listener: (...args: unknown[]) => void): void => {
        target.on(event, listener)
        pending.listeners.push({ target, event, listener })
      }
      listen(window, 'close', (() => this.finish(pending, false)) as (...args: unknown[]) => void)
      listen(window, 'closed', (() => this.finish(pending, false)) as (...args: unknown[]) => void)
      listen(window.webContents, 'render-process-gone', (() => this.finish(pending, false)) as (...args: unknown[]) => void)
      listen(window.webContents, 'did-fail-load', ((...args: unknown[]) => {
        if (args[4] === true) this.finish(pending, false)
      }) as (...args: unknown[]) => void)
      listen(window.webContents, 'will-navigate', ((event: { preventDefault?: () => void }) => {
        event.preventDefault?.()
        this.finish(pending, false)
      }) as (...args: unknown[]) => void)
      listen(window.webContents, 'will-redirect', ((event: { preventDefault?: () => void }, _url: string, _inPlace: boolean, isMainFrame: boolean) => {
        if (!isMainFrame) return
        event.preventDefault?.()
        this.finish(pending, false)
      }) as (...args: unknown[]) => void)
      listen(window.webContents, 'did-navigate', ((_event: unknown, url: string) => {
        if (url !== expectedUrl) this.finish(pending, false)
      }) as (...args: unknown[]) => void)
      listen(window.webContents, 'did-frame-navigate', ((_event: unknown, url: string, _inPlace: boolean, isMainFrame: boolean) => {
        if (isMainFrame && url !== expectedUrl) this.finish(pending, false)
      }) as (...args: unknown[]) => void)
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

      const loading = this.options.rendererUrl
        ? window.loadURL(expectedUrl)
        : window.loadFile(this.options.approvalHtmlPath)
      void loading.then(() => {
        if (pending.settled || this.pending.get(window.webContents) !== pending) return
        if (window.webContents.mainFrame.url !== expectedUrl) {
          this.finish(pending, false)
          return
        }
        window.show()
        window.focus()
      }).catch(() => this.finish(pending, false))
    })
  }

  getSnapshot(sender: WebContents, senderFrame: WebFrameMain | null): AgentApprovalRequestSnapshot | null {
    const pending = this.pending.get(sender)
    if (!pending || !sameFrame(sender, senderFrame, pending)) return null
    return { endpoint: pending.snapshot.endpoint, model: pending.snapshot.model, serializedBody: pending.snapshot.serializedBody }
  }

  confirm(sender: WebContents, senderFrame: WebFrameMain | null): boolean {
    const pending = this.pending.get(sender)
    if (!pending || !sameFrame(sender, senderFrame, pending)) return false
    this.finish(pending, true)
    return true
  }

  cancel(sender: WebContents, senderFrame: WebFrameMain | null): boolean {
    const pending = this.pending.get(sender)
    if (!pending || !sameFrame(sender, senderFrame, pending)) return false
    this.finish(pending, false)
    return true
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const pending of this.pending.values()) this.finish(pending, false)
  }

  private finish(pending: PendingApproval, approved: boolean): void {
    if (pending.settled) return
    pending.settled = true
    clearTimeout(pending.timeout)
    this.pending.delete(pending.window.webContents)
    pending.owner.removeListener('closed', pending.ownerClosed)
    for (const { target, event, listener } of pending.listeners) target.removeListener(event, listener)
    pending.resolve(approved)
    if (!pending.window.isDestroyed()) pending.window.close()
  }
}
