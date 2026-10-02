// @vitest-environment happy-dom
import { act, createElement, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { App as AntdApp } from 'antd'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { bindAntdHost } from '../src/renderer/src/antd-host'
import { i18n } from '../src/renderer/src/i18n'
import { useUiStore } from '../src/renderer/src/stores/ui-store'
import type { TraceBridge, TraceResult } from '../src/shared/ipc-contract'

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>()
  const listeners = new Map<string, Set<(event: unknown, payload: unknown) => void>>()
  const calls: Array<{ name: string; payload: unknown }> = []
  const gate = { preview: null as Promise<void> | null, read: null as Promise<void> | null }
  const previewTokens: string[] = []
  const boundaries = { reads: 0, terminals: 0 }
  return {
    handlers, listeners, calls, gate, previewTokens, boundaries,
    ipcMain: { handle: (name: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => handlers.set(name, handler), removeHandler: (name: string) => handlers.delete(name) },
    ipcRenderer: {
      invoke: async (name: string, payload: unknown) => {
        calls.push({ name, payload }); const result = await handlers.get(name)?.({}, payload)
        if (name === 'agent:preview:create') {
          const preview = result as TraceResult<{ token: string }>
          if (preview.ok) previewTokens.push(preview.data.token)
          await gate.preview
        }
        if (name === 'agent:session:read') { boundaries.reads += 1; await gate.read }
        return result
      },
      on: (name: string, listener: (event: unknown, payload: unknown) => void) => { const group = listeners.get(name) ?? new Set(); group.add(listener); listeners.set(name, group) },
      removeListener: (name: string, listener: (event: unknown, payload: unknown) => void) => listeners.get(name)?.delete(listener)
    },
    contextBridge: { exposeInMainWorld: (_name: string, bridge: unknown) => Reflect.set(window, 'trace', bridge) },
    dialog: {},
    safeStorage: { isAsyncEncryptionAvailable: async () => false, encryptStringAsync: async () => Buffer.from('encrypted'), decryptStringAsync: async () => ({ result: 'synthetic-ui-key', shouldReEncrypt: false }) }
  }
})
vi.mock('electron', () => electron)
function Binder(): null { const { modal, message } = AntdApp.useApp(); bindAntdHost(modal, message); return null }
function data<T>(result: TraceResult<T>): T { if (!result.ok) throw new Error('Fixture IPC failed'); return result.data }
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, directory: string, library: string, dispose: () => void
let bridge: TraceBridge, server: Server, responses: ServerResponse[], bodies: Array<{ model: string; messages: unknown[]; stream: boolean }>
let respond: (response: ServerResponse) => void, profileId: string
const chunk = (text: string): string => `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`
const end = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
const LazyAgentView = lazy(() => import('../src/renderer/src/views/AgentView'))
async function settle(): Promise<void> { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) }) }
async function until(predicate: () => boolean, waitingFor = 'the expected UI state'): Promise<void> {
  const deadline = Date.now() + 4000
  while (!predicate() && Date.now() < deadline) await settle()
  if (predicate()) return
  throw new Error(`Timed out waiting for ${waitingFor}: ${JSON.stringify({
    text: host?.textContent?.slice(-1000),
    textareaValue: host?.querySelector('textarea')?.value,
    buttons: Array.from(host?.querySelectorAll('button') ?? []).map((button) => ({ text: button.textContent?.trim(), disabled: button.disabled })),
    invokedChannels: electron.calls.map(({ name }) => name),
    providerRequests: bodies?.length,
    responseCount: responses?.length,
    terminalEvents: electron.boundaries.terminals,
    sessionReads: electron.boundaries.reads,
    listeners: electron.listeners.get('trace:agent-request')?.size ?? 0
  })}`)
}
function lazyPage() {
  return createElement(AntdApp, {}, createElement(Binder), createElement(Suspense, { fallback: createElement('p', { role: 'status' }, 'Loading page') }, createElement(LazyAgentView)))
}
async function render(): Promise<void> {
  await act(async () => root.render(lazyPage()))
  await until(() => !!host.querySelector('[data-agent-ready="true"]'))
}
function button(label: string, scope: ParentNode = document): HTMLButtonElement {
  const result = Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find((element) => element.textContent?.replace(/\s/g, '') === label.replace(/\s/g, '') || element.getAttribute('aria-label') === label)
  if (!result) throw new Error(`Missing button ${label}`)
  return result
}
async function click(label: string, scope: ParentNode = document): Promise<void> { await act(async () => button(label, scope).click()); await settle() }
async function openPreview(): Promise<void> {
  const label = i18n.t('agentChat.preview')
  await until(() => !button(label, host).disabled, `${label} button to become enabled`)
  await click(label, host)
}
async function compose(value: string): Promise<void> {
  const textarea = host.querySelector('textarea')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value); textarea.dispatchEvent(new Event('input', { bubbles: true })) })
}
async function check(label: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
  await act(async () => input.click()); await settle()
}
async function profile(name = '本机服务', usable = true): Promise<string> {
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port')
  const result = data(await bridge.invoke('agent:profile:create', { name, endpoint: `http://127.0.0.1:${address.port}/v1`, model: 'ui-model' }))
  if (usable) data(await bridge.invoke('agent:key:set', { id: result.id, key: 'synthetic-ui-key' }))
  return result.id
}
async function plan(path: string, content: string): Promise<void> {
  await fs.mkdir(join(library, path), { recursive: true })
  await fs.writeFile(join(library, path, 'plan.json'), JSON.stringify({ format_version: '1', created_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-02T00:00:00Z', components: [{ id: 'note', type: 'note', payload: { content, created_at: '2026-10-02T00:00:00Z' } }] }))
}
beforeEach(async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  electron.calls.length = 0; electron.listeners.clear(); electron.previewTokens.length = 0; electron.gate.preview = null; electron.gate.read = null; electron.boundaries.reads = 0; electron.boundaries.terminals = 0
  useUiStore.setState({ settingsOpen: false }); await i18n.changeLanguage('zh-CN')
  responses = []; bodies = []; respond = (response) => response.end(chunk('正常回复') + end)
  server = createServer(async (request, response) => {
    response.setHeader('access-control-allow-origin', '*')
    response.setHeader('access-control-allow-methods', 'POST, OPTIONS')
    response.setHeader('access-control-allow-headers', 'authorization, content-type, accept')
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return }
    const fragments: Buffer[] = []; for await (const fragment of request) fragments.push(Buffer.from(fragment))
    bodies.push(JSON.parse(Buffer.concat(fragments).toString('utf8'))); responses.push(response)
    response.setHeader('content-type', 'text/event-stream'); respond(response)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  directory = await fs.mkdtemp(join(tmpdir(), 'trace-agent-view-')); library = join(directory, 'library'); await fs.mkdir(library)
  const [{ registerIpc }, { StorageService }, { PlanRepository }] = await Promise.all([import('../src/main/ipc/register'), import('../src/main/services/storage-service'), import('../src/main/services/plan-repository')])
  const storage = new StorageService(new PlanRepository()); storage.setRoot(library)
  dispose = registerIpc({ storage, agentUserDataDir: directory, getWindow: () => ({ webContents: { isDestroyed: () => false, send: (name: string, payload: unknown) => {
    if (name === 'trace:agent-request' && (payload as { type: string }).type === 'terminal') electron.boundaries.terminals += 1
    electron.listeners.get(name)?.forEach((listener) => listener({}, payload))
  } } }), log: vi.fn() } as unknown as Parameters<typeof registerIpc>[0])
  await import('../src/preload/index'); bridge = window.trace
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); dispose()
  responses.forEach((response) => response.destroy()); server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await fs.rm(directory, { recursive: true, force: true }); Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
})
describe('Xiao Yuan local conversation workbench', () => {
  it('loads both conversation locales on first lazy entry and reacts to language changes', async () => {
    expect(i18n.exists('agentChat.sessions', { lng: 'zh-CN' })).toBe(false)
    expect(i18n.exists('agentChat.sessions', { lng: 'en-US' })).toBe(false)
    await render()
    expect(host.textContent).toContain('请先在设置中配置模型服务')
    expect(host.textContent).toContain('本地会话')
    await act(async () => { await i18n.changeLanguage('en-US') })
    expect(host.textContent).toContain('Configure a model service in Settings')
    expect(host.textContent).toContain('Local conversations')
    await act(async () => { await i18n.changeLanguage('zh-CN') })
    expect(host.textContent).toContain('请先在设置中配置模型服务')
  })

  it('reconciles a terminal event that arrives before the recovered streaming session read is delivered', async () => {
    profileId = await profile(); respond = (response) => response.write(chunk('Recovered reply'))
    await render(); await click('新建会话'); await until(() => !!host.querySelector('textarea'))
    await compose('Question'); await openPreview(); await until(() => !!document.querySelector('[data-agent-payload]')); await click('确认发送')
    await until(() => host.textContent!.includes('Recovered reply'), 'the first SSE delta to appear after confirmation')
    await act(async () => root.render(createElement(AntdApp, {}, createElement(Binder))))
    let release!: () => void; electron.gate.read = new Promise<void>((resolve) => { release = resolve }); const reads = electron.boundaries.reads
    await act(async () => root.render(lazyPage()))
    await until(() => electron.boundaries.reads > reads)
    responses[0].end(end); await until(() => electron.boundaries.terminals === 1)
    await act(async () => release()); electron.gate.read = null
    await until(() => host.textContent!.includes('Recovered reply') && !host.textContent!.includes('正在回复'))
    expect(host.textContent).not.toContain('停止回复')
  })
  it.each(['http', 'truncated'])('renders persisted exception markers and safe provider errors for %s', async (failure) => {
    await i18n.changeLanguage('en-US'); profileId = await profile()
    respond = (response) => {
      if (failure === 'http') { response.writeHead(401); response.end('RAW_PROVIDER_SECRET synthetic-ui-key'); return }
      response.end(chunk('Retained fragment'))
    }
    await render(); await click('New conversation'); await until(() => !!host.querySelector('textarea'))
    await compose('Approved question'); await openPreview(); await until(() => !!document.querySelector('[data-agent-payload]'))
    await click('Confirm send'); await until(() => host.textContent!.includes('【异常中断】'), 'a persisted error interruption marker after the stream ends')
    expect(host.textContent).toContain('Reply interrupted by an error')
    expect(host.textContent).not.toMatch(/RAW_PROVIDER_SECRET|synthetic-ui-key/)
    const saved = data(await bridge.invoke('agent:session:read', { id: data(await bridge.invoke('agent:session:list'))[0].id }))
    expect(saved.messages[1].status).toBe('error-interrupted')
    if (failure === 'truncated') expect(saved.messages[1].content).toBe('Retained fragment')
    expect(bodies).toHaveLength(1)
  })
  it('cancels a preview that finishes after the user closes it and never dispatches its stale token', async () => {
    profileId = await profile(); await render(); await click('新建会话'); await until(() => !!host.querySelector('textarea'))
    await compose('Delayed private question')
    let release!: () => void; electron.gate.preview = new Promise<void>((resolve) => { release = resolve })
    await openPreview(); await until(() => electron.previewTokens.length === 1)
    expect(button('确认发送').disabled).toBe(true)
    await click('取消', document.querySelector('[role="dialog"]')!)
    await act(async () => release()); electron.gate.preview = null
    await until(() => electron.calls.some((call) => call.name === 'agent:preview:cancel'))
    const session = data(await bridge.invoke('agent:session:list'))[0]
    expect((await bridge.invoke('agent:request:send', { sessionId: session.id, token: electron.previewTokens[0] })).ok).toBe(false)
    expect(bodies).toEqual([])
  })
  it('cancels in-flight authorization when leaving the view, then reloads local conversations on return', async () => {
    profileId = await profile(); await render(); await click('新建会话'); await until(() => !!host.querySelector('textarea'))
    await compose('local-only until approved')
    let release!: () => void; electron.gate.preview = new Promise<void>((resolve) => { release = resolve })
    await openPreview(); await until(() => electron.previewTokens.length === 1)
    await act(async () => root.render(createElement(AntdApp, {}, createElement(Binder))))
    await act(async () => release()); electron.gate.preview = null
    await until(() => electron.calls.some((call) => call.name === 'agent:preview:cancel'))
    await render(); expect(data(await bridge.invoke('agent:session:list'))).toHaveLength(1)
    expect(host.textContent).toContain('还没有消息'); expect(bodies).toEqual([])
  })
  it('selects the saved profile and refuses source-version changes after preview without a provider request', async () => {
    profileId = await profile('First'); const second = await profile('Second'); await plan('one', 'old source')
    await render(); await click('新建会话'); await until(() => !!host.querySelector('textarea'))
    const select = host.querySelector('select')!
    await until(() => !select.disabled, 'profile selector to become available')
    await act(async () => { select.value = second; select.dispatchEvent(new Event('change', { bubbles: true })) })
    await until(() => select.value === second && !button('选择计划 / 日记', host).disabled, 'profile change to finish before opening context')
    await click('选择计划 / 日记'); await until(() => !!document.querySelector('.agent-context-picker input[aria-label="选择 one"]'))
    await check('选择 one'); await until(() => document.body.textContent!.includes('sha256:')); await click('完成')
    await until(() => !document.querySelector('.agent-context-picker') && !!host.querySelector('textarea') && !host.querySelector('textarea')!.disabled, 'context picker to close and message field to become editable')
    await compose('source question'); expect(host.querySelector('textarea')?.value).toBe('source question')
    await openPreview(); await until(() => !!document.querySelector('[data-agent-payload]'))
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('Second')
    await plan('one', 'new source'); await click('确认发送'); await until(() => host.textContent!.includes('无法生成或确认预览'))
    expect(bodies).toEqual([]); expect(host.querySelector('textarea')?.value).toBe('source question')
  })
  it('confirms exactly the visible payload, streams progressively, isolates session events and persists user stop with opt-in partial history', async () => {
    profileId = await profile(); respond = (response) => response.write(chunk('PARTIAL_PRIVATE'))
    await render(); await click('新建会话'); await until(() => !!host.querySelector('textarea')); await compose('第一问'); await openPreview()
    await until(() => !!document.querySelector('[data-agent-payload]'))
    const visible = JSON.parse(document.querySelector('[data-agent-payload]')!.textContent!)
    expect(bodies).toEqual([]); await click('确认发送')
    await until(() => host.querySelector('.agent-transcript')!.textContent!.includes('PARTIAL_PRIVATE'))
    expect(bodies).toEqual([{ model: 'ui-model', messages: visible, stream: true }])
    const first = data(await bridge.invoke('agent:session:list'))[0]
    await click('新建会话'); await until(() => host.querySelector('.agent-transcript')!.textContent!.includes('还没有消息'))
    responses[0].write(chunk('LATE_OLD_SESSION')); await settle(); expect(host.textContent).not.toContain('LATE_OLD_SESSION')
    const rail = host.querySelector('nav')!; const oldButton = Array.from(rail.querySelectorAll('button')).find((item) => !item.hasAttribute('aria-current'))!
    await act(async () => oldButton.click()); await until(() => host.textContent!.includes('LATE_OLD_SESSION'))
    await click('停止回复'); await until(() => host.textContent!.includes('【用户中断】'))
    const saved = data(await bridge.invoke('agent:session:read', { id: first.id }))
    expect(saved.messages[1]).toMatchObject({ content: 'PARTIAL_PRIVATELATE_OLD_SESSION', status: 'user-interrupted' })
    await compose('第二问'); await openPreview(); await until(() => !!document.querySelector('[data-agent-payload]'))
    expect(document.querySelector('[data-agent-payload]')!.textContent).toContain('【用户中断】')
    expect(document.querySelector('[data-agent-payload]')!.textContent).not.toContain('PARTIAL_PRIVATE')
    await check('包含此中断回复的部分正文'); await until(() => document.querySelector('[data-agent-payload]')?.textContent?.includes('PARTIAL_PRIVATE') ?? false)
    await check('包含同会话历史'); await until(() => !!document.querySelector('[data-agent-payload]') && !document.querySelector('[data-agent-payload]')!.textContent!.includes('PARTIAL_PRIVATE'))
    expect(JSON.parse(document.querySelector('[data-agent-payload]')!.textContent!)).toEqual([{ role: 'user', content: '第二问' }])
    expect(electron.calls.filter((item) => item.name === 'agent:preview:cancel')).toHaveLength(2)
    await click('取消', document.querySelector('[role="dialog"]')!); expect(bodies).toHaveLength(1)
  })
  it('browses folders without attaching, previews exact sources and all messages, recreates revoked tokens and cancels without HTTP', async () => {
    profileId = await profile(); await plan('Folder/PrivatePlan', 'LOCAL_PLAN_SENTINEL'); await plan('Diary/2026-10-02', 'LOCAL_DIARY_SENTINEL')
    await render(); await click('新建会话'); await until(() => !!host.querySelector('textarea'))
    await click('选择计划 / 日记'); await until(() => document.body.textContent!.includes('Folder'))
    await click('浏览 Folder'); await until(() => !!document.querySelector('input[aria-label="选择 Folder/PrivatePlan"]'))
    expect(electron.calls.filter((item) => item.name === 'agent:context:read')).toHaveLength(0)
    await check('选择 Folder/PrivatePlan'); await until(() => document.body.textContent!.includes('sha256:'))
    await click('上一级'); await click('浏览 Diary'); await until(() => !!document.querySelector('input[aria-label="选择 Diary/2026-10-02"]'))
    await check('选择 Diary/2026-10-02'); await until(() => document.body.textContent!.includes('LOCAL_DIARY_SENTINEL'))
    await click('完成'); await compose('请总结'); await openPreview()
    await until(() => !!document.querySelector('[data-agent-payload]'))
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('本机服务'); expect(dialog.textContent).toContain('ui-model'); expect(dialog.textContent).toContain('/v1/chat/completions')
    expect(dialog.textContent).toContain('LOCAL_PLAN_SENTINEL'); expect(dialog.textContent).toContain('LOCAL_DIARY_SENTINEL'); expect(dialog.textContent).toContain('sha256:')
    const first = electron.calls.filter((item) => item.name === 'agent:preview:create').at(-1)!.payload as { selections: unknown[] }
    expect(first.selections).toEqual([{ kind: 'plan', path: 'Folder/PrivatePlan' }, { kind: 'diary', path: 'Diary/2026-10-02' }])
    await click('移除来源 Folder/PrivatePlan', dialog)
    await until(() => !document.querySelector('[data-agent-payload]')?.textContent?.includes('LOCAL_PLAN_SENTINEL'))
    expect(electron.calls.filter((item) => item.name === 'agent:preview:cancel')).toHaveLength(1)
    expect(JSON.parse(document.querySelector('[data-agent-payload]')!.textContent!)[0].role).toBe('system')
    await click('取消', dialog); await settle(); expect(bodies).toEqual([])
    expect(electron.calls.filter((item) => item.name === 'agent:preview:cancel')).toHaveLength(2)
    expect(host.textContent).not.toContain('LOCAL_PLAN_SENTINEL')
  })
  it.each(['zh-CN', 'en-US'])('guides missing profiles and missing credentials safely in %s', async (language) => {
    await i18n.changeLanguage(language); await render()
    expect(host.textContent).toContain(i18n.t('agentChat.noProfiles'))
    await click(i18n.t('agentChat.settings')); expect(useUiStore.getState().settingsOpen).toBe(true)
    profileId = await profile('无密钥', false)
    await act(async () => useUiStore.getState().setSettingsOpen(false)); await until(() => !button(i18n.t('agentChat.newSession')).disabled)
    await click(i18n.t('agentChat.newSession')); await until(() => !!host.querySelector('h1'))
    expect(host.textContent).toContain(i18n.t('agentChat.missingKey'))
    await compose('private question'); expect(button(i18n.t('agentChat.preview')).disabled).toBe(true)
    expect(bodies).toEqual([])
  })
  it('creates with the default profile, switches isolated sessions and confirms deletion without deleting profiles', async () => {
    await profile('备用'); profileId = await profile('默认服务'); data(await bridge.invoke('agent:profile:setDefault', { id: profileId }))
    const old = data(await bridge.invoke('agent:session:create', { title: '旧会话', profileId }))
    await render(); await click('新建会话')
    await until(() => host.textContent!.includes('还没有消息'))
    let sessions = data(await bridge.invoke('agent:session:list')); const current = sessions.find((item) => item.id !== old.id)!
    expect(current.profileId).toBe(profileId)
    await click('旧会话'); expect(host.querySelector('h1')?.textContent).toBe('旧会话')
    await click('删除会话'); expect(data(await bridge.invoke('agent:session:list'))).toHaveLength(2)
    await click('删除', document.querySelector('[role="dialog"]')!); await until(() => host.querySelector('h1')?.textContent !== '旧会话')
    sessions = data(await bridge.invoke('agent:session:list')); expect(sessions.map((item) => item.id)).toEqual([current.id])
    expect(data(await bridge.invoke('agent:profile:list')).profiles).toHaveLength(2); expect(bodies).toEqual([])
  })
})
