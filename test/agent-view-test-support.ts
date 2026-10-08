import { act, createElement, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { App as AntdApp } from 'antd'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { beforeEach, afterEach, vi } from 'vitest'
import { bindAntdHost } from '../src/renderer/src/antd-host'
import { i18n } from '../src/renderer/src/i18n'
export { i18n }
import { useUiStore } from '../src/renderer/src/stores/ui-store'
export { useUiStore }
import type { TraceBridge, TraceResult } from '../src/shared/ipc-contract'
import type { StorageService } from '../src/main/services/storage-service'

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>()
  const listeners = new Map<string, Set<(event: unknown, payload: unknown) => void>>()
  const calls: Array<{ name: string; payload: unknown }> = []
  const gate = { preview: null as Promise<void> | null, read: null as Promise<void> | null }
  const previewTokens: string[] = []
  const boundaries = { reads: 0, terminals: 0 }
  return {
    handlers, listeners, calls, gate, previewTokens, boundaries,
    ipcMain: {
      handle: (
        name: string,
        handler: (event: unknown, payload: unknown) => Promise<unknown>
      ) => handlers.set(name, handler),
      removeHandler: (name: string) => handlers.delete(name)
    },
    ipcRenderer: {
      invoke: async (name: string, payload: unknown) => {
        calls.push({ name, payload })
        const result = await handlers.get(name)?.({}, payload)
        if (name === 'agent:preview:create') {
          const preview = result as TraceResult<{ token: string }>
          if (preview.ok) previewTokens.push(preview.data.token); await gate.preview
        }
        if (name === 'agent:session:read') { boundaries.reads += 1; await gate.read }
        return result
      },
      on: (name: string, listener: (event: unknown, payload: unknown) => void) => {
        const group = listeners.get(name) ?? new Set()
        group.add(listener); listeners.set(name, group)
      },
      removeListener: (
        name: string,
        listener: (event: unknown, payload: unknown) => void
      ) => listeners.get(name)?.delete(listener)
    },
    contextBridge: {
      exposeInMainWorld: (_name: string, bridge: unknown) => Reflect.set(window, 'trace', bridge)
    },
    dialog: {},
    safeStorage: {
      isAsyncEncryptionAvailable: async () => false,
      encryptStringAsync: async () => Buffer.from('encrypted'),
      decryptStringAsync: async () => ({
        result: 'synthetic-ui-key',
        shouldReEncrypt: false
      })
    }
  }
})
export const electron = electronMock
vi.mock('electron', () => electronMock)
function Binder(): null {
  const { modal, message } = AntdApp.useApp()
  bindAntdHost(modal, message)
  return null
}

export function data<T>(result: TraceResult<T>): T {
  if (!result.ok) throw new Error('Fixture IPC failed')
  return result.data
}

export let host: HTMLDivElement, root: ReturnType<typeof createRoot>
export let directory: string, library: string
export let storage: StorageService
export let dispose: () => void
let disposePlanReferences: (() => void) | undefined
export let bridge: TraceBridge, server: Server, responses: ServerResponse[]
export let bodies: Array<{ model: string; messages: unknown[]; stream: boolean }>
export let respond: (response: ServerResponse) => void, profileId: string

export const chunk = (text: string): string => `data: ${JSON.stringify({
  choices: [{ delta: { content: text }, finish_reason: null }]
})}\n\n`
export const end = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
const LazyAgentView = lazy(() => import('../src/renderer/src/views/AgentView'))
export async function settle(): Promise<void> {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
}
export async function until(predicate: () => boolean, waitingFor = 'the expected UI state', timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate() && Date.now() < deadline) await settle()
  if (predicate()) return
  throw new Error(`Timed out waiting for ${waitingFor}: ${JSON.stringify({
    text: host?.textContent?.slice(-1000),
    textareaValue: host?.querySelector('textarea')?.value,
    buttons: Array.from(host?.querySelectorAll('button') ?? []).map((button) => ({
      text: button.textContent?.trim(),
      disabled: button.disabled
    })),
    invokedChannels: electron.calls.map(({ name }) => name),
    providerRequests: bodies?.length,
    responseCount: responses?.length,
    terminalEvents: electron.boundaries.terminals,
    sessionReads: electron.boundaries.reads,
    listeners: electron.listeners.get('trace:agent-request')?.size ?? 0
  })}`)
}
function lazyPage() {
  const fallback = createElement('p', { role: 'status' }, 'Loading page')
  const content = createElement(Suspense, { fallback }, createElement(LazyAgentView))
  return createElement(AntdApp, {}, createElement(Binder), content)
}
export async function render(): Promise<void> {
  await renderLazyPage()
  await until(() => !!host.querySelector('[data-agent-ready="true"]'))
}
export async function renderLazyPage(): Promise<void> {
  await act(async () => root.render(lazyPage()))
}
export async function renderShell(): Promise<void> {
  await act(async () => root.render(createElement(AntdApp, {}, createElement(Binder))))
}
export function button(label: string, scope: ParentNode | null = document): HTMLButtonElement {
  // happy-dom 用例间卸载的时序竞态可能令宿主短暂为 null——显式失败信息替代 TypeError（2026-09-12 flaky 定位辅助）
  if (!scope) throw new Error(`button '${label}': host scope is null (unmounted)`)
  const result = Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find(
    (element) => (
      element.textContent?.replace(/\s/g, '') === label.replace(/\s/g, '')
        || element.getAttribute('aria-label') === label
    )
  )
  if (!result) throw new Error(`Missing button ${label}`); return result
}
export async function click(label: string, scope: ParentNode = document): Promise<void> {
  await act(async () => button(label, scope).click()); await settle()
}

export async function startConversation(label = '新建会话'): Promise<void> {
  await render(); await click(label)
  await until(() => !!host.querySelector('textarea'))
}

export async function enterPreview(message: string): Promise<void> { await compose(message); await openPreview() }
export async function previewDraft(message: string): Promise<void> {
  await enterPreview(message); await until(() => !!document.querySelector('[data-agent-payload]'))
}
export async function openPreview(): Promise<void> {
  const label = i18n.t('agentChat.preview')
  await until(() => !button(label, host).disabled, `${label} button to become enabled`); await click(label, host)
}
export async function compose(value: string): Promise<void> {
  const textarea = host.querySelector('textarea')!
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(textarea, value)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
export async function check(label: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
  await act(async () => input.click()); await settle()
}
export async function profile(name = '本机服务', usable = true): Promise<string> {
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing port')
  const result = data(await bridge.invoke('agent:profile:create', {
    name, endpoint: `http://127.0.0.1:${address.port}/v1`, model: 'ui-model'
  }))
  if (usable) data(await bridge.invoke('agent:key:set', { id: result.id, key: 'synthetic-ui-key' }))
  return result.id
}
export async function plan(path: string, content: string): Promise<void> {
  await fs.mkdir(join(library, path), { recursive: true })
  const planData = {
    format_version: '1',
    created_at: '2026-10-02T00:00:00Z',
    updated_at: '2026-10-02T00:00:00Z',
    components: [{
      id: 'note',
      type: 'note',
      payload: { content, created_at: '2026-10-02T00:00:00Z' }
    }]
  }
  await fs.writeFile(join(library, path, 'plan.json'), JSON.stringify(planData))
}
async function resetTestState(): Promise<void> {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  electron.calls.length = 0
  electron.listeners.clear()
  electron.previewTokens.length = 0
  electron.gate.preview = null
  electron.gate.read = null
  electron.boundaries.reads = 0
  electron.boundaries.terminals = 0
  useUiStore.setState({ settingsOpen: false })
  await i18n.changeLanguage('zh-CN')
  responses = []
  bodies = []
  respond = (response) => response.end(chunk('正常回复') + end)
}

function startProviderServer(): Promise<void> {
  server = createServer(async (request, response) => {
    response.setHeader('access-control-allow-origin', '*')
    response.setHeader('access-control-allow-methods', 'POST, OPTIONS')
    response.setHeader('access-control-allow-headers', 'authorization, content-type, accept')
    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }
    const fragments: Buffer[] = []
    for await (const fragment of request) fragments.push(Buffer.from(fragment))
    bodies.push(JSON.parse(Buffer.concat(fragments).toString('utf8')))
    responses.push(response)
    response.setHeader('content-type', 'text/event-stream')
    respond(response)
  })
  return new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
}

async function setupRenderer(): Promise<void> {
  directory = await fs.mkdtemp(join(tmpdir(), 'trace-agent-view-'))
  library = join(directory, 'library')
  await fs.mkdir(library)
  const [ipcModule, storageModule, planModule, referenceModule] = await Promise.all([
    import('../src/main/ipc/register'),
    import('../src/main/services/storage-service'),
    import('../src/main/services/plan-repository'),
    import('../src/main/services/plan-reference-service')
  ])
  const repository = new planModule.PlanRepository()
  await repository.ensureLibraryRoot(library)
  storage = new storageModule.StorageService(repository)
  storage.setRoot(library)
  const planReferences = new referenceModule.PlanReferenceService(repository, () => storage.getRootAbs())
  planReferences.activateRoot(library)
  disposePlanReferences = () => planReferences.dispose()
  dispose = ipcModule.registerIpc({
    storage,
    planReferences,
    agentUserDataDir: directory,
    requestAgentApproval: async () => true,
    getWindow: () => ({
      webContents: {
        isDestroyed: () => false,
        send: (name: string, payload: unknown) => {
          if (
            name === 'trace:agent-request'
            && (payload as { type: string }).type === 'terminal'
          ) {
            electron.boundaries.terminals += 1
          }
          electron.listeners.get(name)?.forEach((listener) => listener({}, payload))
        }
      }
    }),
    log: vi.fn()
  } as unknown as Parameters<typeof ipcModule.registerIpc>[0])
  await import('../src/preload/index')
  bridge = window.trace
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
}

beforeEach(async () => {
  await resetTestState()
  await startProviderServer()
  await setupRenderer()
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  dispose()
  disposePlanReferences?.()
  disposePlanReferences = undefined
  responses.forEach((response) => response.destroy())
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await fs.rm(directory, { recursive: true, force: true })
  Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
})

export function setProfileId(value: string): void { profileId = value }
export function setRespond(handler: (response: ServerResponse) => void): void { respond = handler }
