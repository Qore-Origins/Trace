// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { App as AntdApp } from 'antd'
import AgentSettingsSection from '../src/renderer/src/components/AgentSettingsSection'
import { bindAntdHost } from '../src/renderer/src/antd-host'
import { i18n } from '../src/renderer/src/i18n'
import type { TraceBridge } from '../src/shared/ipc-contract'

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>()
  const calls: Array<{ name: string; payload: unknown }> = []
  const encryption = { available: true, gate: null as Promise<void> | null }
  const ipcGate = { list: null as Promise<void> | null }
  return {
    handlers, calls, encryption, ipcGate,
    ipcMain: { handle: (name: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => handlers.set(name, handler), removeHandler: (name: string) => handlers.delete(name) },
    ipcRenderer: { invoke: async (name: string, payload: unknown) => { calls.push({ name, payload }); const gate = name === 'agent:profile:list' ? ipcGate.list : null; const result = await handlers.get(name)?.({}, payload); await gate; return result }, on: vi.fn(), removeListener: vi.fn() },
    contextBridge: { exposeInMainWorld: (_name: string, bridge: unknown) => Reflect.set(window, 'trace', bridge) },
    dialog: {},
    safeStorage: {
      isAsyncEncryptionAvailable: async () => encryption.available,
      encryptStringAsync: async (value: string) => { await encryption.gate; return Buffer.from(value).reverse() },
      decryptStringAsync: async (value: Buffer) => ({ result: Buffer.from(value).reverse().toString(), shouldReEncrypt: false })
    }
  }
})
vi.mock('electron', () => electron)
function Binder(): null { const { modal, message } = AntdApp.useApp(); bindAntdHost(modal, message); return null }
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, directory: string, dispose: () => void
let bridge: TraceBridge
async function render(active = true): Promise<void> {
  await act(async () => { root.render(createElement(AntdApp, {}, createElement(Binder), createElement(AgentSettingsSection, { active }))) })
  if (active && !electron.ipcGate.list) await ready()
}
async function settle(): Promise<void> { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)) }) }
async function ready(): Promise<void> { await vi.waitFor(async () => { await settle(); expect(host.querySelector('fieldset')?.disabled).toBe(false) }, { timeout: 5000 }) }
function field(label: string): HTMLInputElement { const value = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`); if (!value) throw new Error(`Missing ${label}`); return value }
async function input(label: string, value: string): Promise<void> {
  const element = field(label)
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })) })
}
async function choose(label: string, value: string): Promise<void> {
  const element = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!
  await act(async () => { element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })) })
}
async function click(label: string, scope: ParentNode = host): Promise<void> {
  const button = Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find((item) => item.textContent?.replace(/\s/g, '') === label.replace(/\s/g, ''))
  if (!button) throw new Error(`Missing button ${label}`)
  await act(async () => { button.click() })
  await settle()
  if (!electron.encryption.gate && !electron.ipcGate.list) await ready()
}
beforeEach(async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  electron.calls.length = 0
  electron.encryption.available = true
  electron.encryption.gate = null
  electron.ipcGate.list = null
  await i18n.changeLanguage('zh-CN')
  directory = await fs.mkdtemp(join(tmpdir(), 'trace-agent-settings-'))
  const { registerIpc } = await import('../src/main/ipc/register')
  dispose = registerIpc({ agentUserDataDir: directory, log: vi.fn() } as unknown as Parameters<typeof registerIpc>[0])
  await import('../src/preload/index')
  bridge = window.trace
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove(); dispose()
  await fs.rm(directory, { recursive: true, force: true })
  Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
})
describe('model service settings interactions', () => {
  async function savedProfile(): Promise<string> {
    const profile = await bridge.invoke('agent:profile:create', { name: '本机', endpoint: 'http://localhost:11434/v1', model: 'local' })
    if (!profile.ok) throw new Error('Setup failed')
    await render(); await settle()
    return profile.data.id
  }
  it.each([
    { language: 'zh-CN', deleteButton: '删除服务', confirmButton: '删除', warning: '密钥恢复失败', guidance: '重新配置密钥并重测工具能力', missing: '未配置密钥', retest: '需重测', passed: '测试通过', saved: '密钥已保存', unknown: '当前状态无法确认', refreshError: '无法刷新当前服务状态', retry: '重试刷新状态' },
    { language: 'en-US', deleteButton: 'Delete service', confirmButton: 'Delete', warning: 'Credential recovery failed', guidance: 'configure the credential again and retest tool support', missing: 'Credential missing', retest: 'Needs retest', passed: 'Test passed', saved: 'Credential saved', unknown: 'Current status unknown', refreshError: 'Unable to refresh the service status', retry: 'Retry status refresh' }
  ].flatMap((labels) => [{ ...labels, refreshFails: false }, { ...labels, refreshFails: true }]))('shows local recovery in $language with failed refresh: $refreshFails', async (labels) => {
    await i18n.changeLanguage(labels.language)
    const profile = await bridge.invoke('agent:profile:create', { name: 'recovery-profile', endpoint: 'http://localhost:11434/v1', model: 'local' })
    if (!profile.ok) throw new Error('Setup failed')
    const id = profile.data.id
    await bridge.invoke('agent:key:set', { id, key: 'synthetic-recovery-key' })
    const metadataPath = join(directory, 'agent-profiles.json')
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'))
    metadata.profiles[0].capability = { status: 'passed', testedAt: '2026-10-02T00:00:00.000Z', errorCategory: null }
    await fs.writeFile(metadataPath, JSON.stringify(metadata))
    await render()
    expect(host.textContent).toContain(labels.passed)
    expect(host.textContent).toContain(labels.saved)
    const blockedTarget = join(directory, 'nonempty-ui-recovery-target')
    await fs.mkdir(blockedTarget); await fs.writeFile(join(blockedTarget, 'sentinel'), 'block-recovery')
    const credentialPath = join(directory, 'agent-credentials', `${id}.bin`)
    const realRename = fs.rename.bind(fs)
    const realReadFile = fs.readFile.bind(fs)
    let profileCommits = 0
    let recoveryAttempted = false
    const failedRefresh = vi.spyOn(fs, 'readFile').mockImplementation(async (path, options) => {
      return realReadFile(path === metadataPath && recoveryAttempted && labels.refreshFails ? blockedTarget : path, options)
    })
    const failure = vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
      if (destination === metadataPath) profileCommits += 1
      if (destination === credentialPath) recoveryAttempted = true
      const block = (destination === metadataPath && profileCommits === 2) || destination === credentialPath
      await realRename(source, block ? blockedTarget : destination)
    })
    try { await click(labels.deleteButton); await click(labels.confirmButton, document.body) }
    finally { failure.mockRestore(); failedRefresh.mockRestore() }
    expect(host.textContent).toContain(labels.warning)
    expect(host.textContent).toContain(labels.guidance)
    if (labels.refreshFails) {
      expect(host.textContent).toContain(labels.unknown)
      expect(host.textContent).toContain(labels.refreshError)
      expect(host.querySelector('time')).toBeNull()
      const testButton = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes(labels.language === 'zh-CN' ? '测试工具能力' : 'Test tool support'))!
      expect(testButton.disabled).toBe(true)
    } else {
      expect(host.textContent).toContain(labels.missing)
      expect(host.textContent).toContain(labels.retest)
    }
    expect(host.textContent).not.toContain(labels.passed)
    expect(host.textContent).not.toContain(labels.saved)
    expect(host.textContent).not.toMatch(/服务配置操作失败|服务删除部分失败|synthetic-recovery-key/)
    expect(electron.calls.filter((call) => call.name === 'agent:profile:list').length).toBeGreaterThan(1)
    if (labels.refreshFails) {
      await click(labels.retry)
      expect(host.textContent).toContain(labels.missing)
      expect(host.textContent).toContain(labels.retest)
      expect(host.textContent).toContain(labels.warning)
      expect(host.textContent).not.toContain(labels.unknown)
    }
  })
  it('prefills an editable preset and supports creating, editing, defaulting and deleting profiles', async () => {
    await render(); await settle()
    await choose('服务商预设', 'deepseek')
    expect(field('服务地址').value).toBe('https://api.deepseek.com')
    expect(field('模型').value).toBe('deepseek-flash')
    await input('服务名称', '工作模型'); await input('模型', 'editable-model')
    await click('保存服务')
    let listed = await bridge.invoke('agent:profile:list')
    expect(listed.data).toMatchObject({ profiles: [{ name: '工作模型', model: 'editable-model', keyStatus: 'missing' }] })
    await click('新建服务'); await input('服务名称', '自定义'); await input('服务地址', 'http://localhost:11434/v1'); await input('模型', 'local')
    await click('保存服务'); await click('设为默认')
    listed = await bridge.invoke('agent:profile:list')
    if (!listed.ok) throw new Error('List failed')
    expect(listed.data.profiles).toHaveLength(2)
    expect(listed.data.defaultProfileId).toBe(listed.data.profiles[1].id)
    await input('模型', 'changed'); await click('保存服务')
    expect(host.textContent).toContain('需重测')
    await click('删除服务')
    await click('删除', document.body)
    expect((await bridge.invoke('agent:profile:list')).data).toMatchObject({ profiles: [{ name: '工作模型' }] })
  })
  it('clears a typed Key before save resolves and keeps profiles when removing saved/session credentials', async () => {
    const id = await savedProfile()
    expect(host.textContent).toContain('未配置密钥')
    let release!: () => void
    electron.encryption.gate = new Promise<void>((resolve) => { release = resolve })
    await input('API Key', 'test-only-ui-key')
    await click('保存或替换密钥')
    expect(field('API Key').value).toBe('')
    await act(async () => { release() }); electron.encryption.gate = null; await ready()
    expect(host.textContent).toContain('密钥已保存')
    expect(host.textContent).toContain('需重测')
    await click('移除密钥')
    expect((await bridge.invoke('agent:profile:list')).data).toMatchObject({ profiles: [{ id, keyStatus: 'missing', capability: { status: 'needs-retest' } }] })
    electron.encryption.available = false
    await input('API Key', 'test-only-session-key'); await click('保存或替换密钥')
    expect(host.textContent).toContain('密钥仅当前会话可用')
    expect(field('API Key').value).toBe('')
    expect(electron.calls.map((call) => call.name)).not.toContain('agent:key:get')
    expect(electron.calls.map((call) => call.name)).not.toContain('agent:key:copy')
    expect(JSON.stringify(localStorage)).not.toMatch(/test-only-ui-key|test-only-session-key/)
  })
  it('keeps unsaved profile fields when a distinct credential operation completes', async () => {
    await savedProfile()
    await input('模型', 'unsaved-model')
    await input('API Key', 'test-only-draft-key'); await click('保存或替换密钥')
    expect(field('模型').value).toBe('unsaved-model')
    expect(electron.calls.map((call) => call.name)).not.toContain('agent:profile:update')
    expect(host.textContent).toContain('请先保存服务配置')
    await click('保存服务')
    expect((await bridge.invoke('agent:profile:list')).data).toMatchObject({ profiles: [{ model: 'unsaved-model' }] })
  })
  it('warns about possible charges, cancels without IPC, and confirms only the saved profile ID', async () => {
    const id = await savedProfile()
    await click('测试工具能力')
    expect(document.body.textContent).toContain('可能产生费用')
    expect(electron.calls.filter((call) => call.name === 'agent:capability:test')).toHaveLength(0)
    await click('取消', document.body)
    expect(electron.calls.filter((call) => call.name === 'agent:capability:test')).toHaveLength(0)
    await click('测试工具能力'); await click('开始测试', document.body)
    expect(electron.calls.filter((call) => call.name === 'agent:capability:test')).toEqual([{ name: 'agent:capability:test', payload: { id } }])
    expect(host.textContent).toContain('测试失败')
    expect(host.textContent).toContain('请先配置密钥')
    expect(host.textContent).toContain('不影响普通聊天')
  })
  it.each([
    { language: 'zh-CN', test: '测试工具能力', start: '开始测试', failure: '请先配置密钥', save: '保存服务', endpointLabel: '服务地址', operationError: '模型服务操作失败', providerLabel: '服务商预设' },
    { language: 'en-US', test: 'Test tool support', start: 'Start test', failure: 'Configure a credential first', save: 'Save service', endpointLabel: 'Endpoint', operationError: 'Model service operation failed', providerLabel: 'Provider preset' }
  ])('localizes status, labels and safe operation errors in $language', async (labels) => {
    await i18n.changeLanguage(labels.language)
    await savedProfile()
    expect(host.querySelector(`select[aria-label="${labels.providerLabel}"]`)).not.toBeNull()
    await click(labels.test); await click(labels.start, document.body)
    expect(host.textContent).toContain(labels.failure)
    await input(labels.endpointLabel, 'http://remote.example/private-provider-error')
    await click(labels.save)
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(labels.operationError)
    expect(host.querySelector('[role="alert"]')?.textContent).not.toContain('远程服务地址须使用 HTTPS')
    expect(host.textContent).not.toContain('missing-key')
    expect(host.textContent).not.toMatch(/密钥恢复失败|Credential recovery failed/)
  })
  it('loads only while active and drops a late load from a previous Settings opening', async () => {
    await render(false)
    expect(electron.calls).toHaveLength(0)
    const first = await bridge.invoke('agent:profile:create', { name: '旧模型', endpoint: 'http://localhost:11434/v1', model: 'old' })
    if (!first.ok) throw new Error('Setup failed')
    let release!: () => void
    electron.ipcGate.list = new Promise<void>((resolve) => { release = resolve })
    await render(); await settle()
    expect(host.textContent).toContain('载入中')
    await render(false)
    await bridge.invoke('agent:profile:update', { id: first.data.id, name: '新模型', endpoint: 'http://localhost:11434/v1', model: 'new' })
    electron.ipcGate.list = null
    await render(); await settle()
    expect(field('服务名称').value).toBe('新模型')
    await act(async () => release()); await settle()
    expect(field('服务名称').value).toBe('新模型')
    await input('API Key', 'typed-before-close'); await render(false); await render(); await settle()
    expect(field('API Key').value).toBe('')
  })
  it('renders real provider pass/failure safely, then invalidates on credential replacement', async () => {
    let fail = false
    const requests: unknown[] = []
    const server = createServer(async (request, response) => {
      response.setHeader('access-control-allow-origin', '*')
      response.setHeader('access-control-allow-methods', 'POST, OPTIONS')
      response.setHeader('access-control-allow-headers', 'authorization, content-type, accept')
      if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return }
      const fragments: Buffer[] = []
      for await (const fragment of request) fragments.push(Buffer.from(fragment))
      requests.push(JSON.parse(Buffer.concat(fragments).toString('utf8')))
      if (fail) { response.writeHead(401); response.end('private-provider-body test-only-ui-credential'); return }
      response.setHeader('content-type', 'text/event-stream')
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'probe', type: 'function', function: { name: 'trace_capability_probe', arguments: '{"value":"ready"}' } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing loopback address')
      const profile = await bridge.invoke('agent:profile:create', { name: 'Synthetic UI', endpoint: `http://127.0.0.1:${address.port}/v1`, model: 'synthetic-model' })
      if (!profile.ok) throw new Error('Setup failed')
      await bridge.invoke('agent:key:set', { id: profile.data.id, key: 'test-only-ui-credential' })
      await render()
      await click('测试工具能力'); await click('开始测试', document.body)
      expect(host.textContent).toContain('测试通过')
      expect(host.querySelector('time')?.dateTime).toEqual(expect.any(String))
      await input('API Key', 'test-only-replaced-credential'); await click('保存或替换密钥')
      expect(host.textContent).toContain('需重测')
      expect(field('API Key').value).toBe('')
      fail = true
      await act(async () => { await i18n.changeLanguage('en-US') })
      await click('Test tool support'); await click('Start test', document.body)
      expect(host.textContent).toContain('Test failed')
      expect(host.textContent).toContain('Service authentication failed')
      expect(host.textContent).not.toMatch(/private-provider-body|test-only-ui-credential/)
      expect(requests).toHaveLength(2)
      expect(JSON.stringify(requests)).not.toMatch(/test-only-ui-credential|test-only-replaced-credential/)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
