// @vitest-environment happy-dom
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TraceBridge } from '../src/shared/ipc-contract'
import type { AgentProfileService } from '../src/main/services/agent-profile-service'

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>()
  const encryption = { available: true }
  return {
    handlers, encryption,
    ipcMain: { handle: (name: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => handlers.set(name, handler), removeHandler: (name: string) => handlers.delete(name) },
    ipcRenderer: { invoke: vi.fn((name: string, payload: unknown) => handlers.get(name)?.({}, payload)), on: vi.fn(), removeListener: vi.fn() },
    contextBridge: { exposeInMainWorld: (_key: string, value: unknown) => Reflect.set(window, 'trace', value) },
    dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
    safeStorage: {
      isAsyncEncryptionAvailable: vi.fn(async () => encryption.available),
      encryptStringAsync: vi.fn(async (value: string) => Buffer.from(value).reverse()),
      decryptStringAsync: vi.fn(async (value: Buffer) => ({ result: Buffer.from(value).reverse().toString(), shouldReEncrypt: false }))
    }
  }
})
vi.mock('electron', () => electron)

let directory: string
let dispose: (() => void) | undefined
let bridge: TraceBridge
let profileService: AgentProfileService

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  electron.handlers.clear()
  electron.encryption.available = true
  Reflect.deleteProperty(window, 'trace')
  directory = await fs.mkdtemp(join(tmpdir(), 'trace-agent-profile-'))
  const [{ registerIpc }, { AgentProfileService }] = await Promise.all([
    import('../src/main/ipc/register'), import('../src/main/services/agent-profile-service')
  ])
  profileService = new AgentProfileService(directory)
  dispose = registerIpc({ agentProfiles: profileService, log: vi.fn() } as unknown as Parameters<typeof registerIpc>[0])
  await import('../src/preload/index')
  bridge = window.trace
})

afterEach(async () => {
  dispose?.()
  await fs.rm(directory, { recursive: true, force: true })
})

describe('agent profile typed IPC', () => {
  it('creates multiple named profiles and changes the default through window.trace', async () => {
    const first = await bridge.invoke('agent:profile:create', { name: '工作', endpoint: 'https://api.deepseek.com', model: 'deepseek-flash' })
    expect(first).toMatchObject({ ok: true })
    if (!first.ok) return
    const second = await bridge.invoke('agent:profile:create', { name: '本机', endpoint: 'http://127.0.0.1:11434/v1', model: 'local' })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect((await bridge.invoke('agent:profile:setDefault', { id: second.data.id })).data).toEqual(second.data)
    expect((await bridge.invoke('agent:profile:list')).data).toMatchObject({ defaultProfileId: second.data.id, profiles: [{ name: '工作' }, { name: '本机' }] })
  })

  it('lists verified presets without credentials and persists profiles across service instances', async () => {
    const presets = await bridge.invoke('agent:provider:list')
    expect(presets.ok).toBe(true)
    if (!presets.ok) return
    expect(presets.data.map((preset) => preset.id)).toEqual(['bailian', 'deepseek', 'kimi', 'volcengine', 'siliconflow', 'qianfan', 'tokenhub'])
    expect(JSON.stringify(presets.data)).not.toContain('apiKey')
    const created = await bridge.invoke('agent:profile:create', { name: 'DeepSeek', endpoint: presets.data[1].endpoint, model: presets.data[1].model, presetId: 'deepseek' })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    dispose?.()
    const [{ registerIpc }, { AgentProfileService }] = await Promise.all([import('../src/main/ipc/register'), import('../src/main/services/agent-profile-service')])
    dispose = registerIpc({ agentProfiles: new AgentProfileService(directory), log: vi.fn() } as unknown as Parameters<typeof registerIpc>[0])
    expect((await bridge.invoke('agent:profile:list')).data).toMatchObject({ defaultProfileId: created.data.id, profiles: [{ name: 'DeepSeek', keyStatus: 'missing' }] })
  })

  it('rejects remote HTTP and URL credentials while allowing loopback HTTP', async () => {
    for (const endpoint of ['http://192.168.1.10/v1', 'http://example.com/v1', 'https://user:password@example.com/v1']) {
      const result = await bridge.invoke('agent:profile:create', { name: 'unsafe', endpoint, model: 'model' })
      expect(result.ok).toBe(false)
    }
    const accepted = await bridge.invoke('agent:profile:create', { name: 'local', endpoint: 'http://localhost:11434/v1', model: 'model' })
    expect(accepted.ok).toBe(true)
  })

  it('saves only encrypted key bytes, returns status, and invalidates capability after key or model changes', async () => {
    const created = await bridge.invoke('agent:profile:create', { name: 'one', endpoint: 'https://api.deepseek.com', model: 'deepseek-flash' })
    if (!created.ok) throw new Error('profile setup failed')
    const key = 'test-secret-key-value'
    const saved = await bridge.invoke('agent:key:set', { id: created.data.id, key })
    expect(saved.data).toMatchObject({ keyStatus: 'saved', capability: { status: 'needs-retest' } })
    expect(JSON.stringify(saved)).not.toContain(key)
    const bytes = await fs.readFile(join(directory, 'agent-credentials', `${created.data.id}.bin`))
    expect(bytes.toString()).not.toContain(key)
    const metadata = await fs.readFile(join(directory, 'agent-profiles.json'), 'utf8')
    expect(metadata).not.toContain(key)
    await profileService.recordCapability(created.data.id, { status: 'passed', testedAt: '2026-10-02T00:00:00.000Z', errorCategory: null })
    expect((await bridge.invoke('agent:profile:list')).data).toMatchObject({ profiles: [{ capability: { status: 'passed' } }] })
    const updated = await bridge.invoke('agent:profile:update', { id: created.data.id, name: 'renamed', endpoint: 'https://api.deepseek.com', model: 'deepseek-v4-pro' })
    expect(updated.data).toMatchObject({ model: 'deepseek-v4-pro', capability: { status: 'needs-retest' } })
    await profileService.recordCapability(created.data.id, { status: 'failed', testedAt: '2026-10-02T00:01:00.000Z', errorCategory: 'unsupported' })
    expect((await bridge.invoke('agent:profile:list')).data).toMatchObject({ profiles: [{ capability: { status: 'failed' } }] })
    const endpointUpdated = await bridge.invoke('agent:profile:update', { id: created.data.id, name: 'renamed', endpoint: 'https://api.example.com/v1', model: 'deepseek-v4-pro' })
    expect(endpointUpdated.data).toMatchObject({ endpoint: 'https://api.example.com/v1', capability: { status: 'needs-retest', testedAt: null, errorCategory: null } })
    const removed = await bridge.invoke('agent:key:remove', { id: created.data.id })
    expect(removed.data).toMatchObject({ keyStatus: 'missing', capability: { status: 'needs-retest' } })
    await expect(fs.access(join(directory, 'agent-credentials', `${created.data.id}.bin`))).rejects.toThrow()
  })

  it('rejects a tampered profile id without reading, writing or deleting outside the credential directory', async () => {
    const created = await bridge.invoke('agent:profile:create', { name: 'one', endpoint: 'https://api.example.com/v1', model: 'model' })
    if (!created.ok) throw new Error('profile setup failed')
    const outside = join(directory, 'outside.bin')
    await fs.writeFile(outside, 'sentinel')
    const metadataFile = join(directory, 'agent-profiles.json')
    const metadata = JSON.parse(await fs.readFile(metadataFile, 'utf8')) as { defaultProfileId: string; profiles: Array<{ id: string }> }
    metadata.profiles[0].id = '../outside'
    metadata.defaultProfileId = '../outside'
    await fs.writeFile(metadataFile, JSON.stringify(metadata))

    for (const result of [
      await bridge.invoke('agent:profile:list'),
      await bridge.invoke('agent:key:set', { id: '../outside', key: 'test-secret-key-value' }),
      await bridge.invoke('agent:key:remove', { id: '../outside' }),
      await bridge.invoke('agent:profile:delete', { id: '../outside' })
    ]) expect(result.ok).toBe(false)
    expect(await fs.readFile(outside, 'utf8')).toBe('sentinel')
  })

  it('rejects credential operations when the credential directory links to another directory', async () => {
    const created = await bridge.invoke('agent:profile:create', { name: 'linked', endpoint: 'https://api.example.com/v1', model: 'model' })
    if (!created.ok) throw new Error('profile setup failed')
    const outsideDirectory = join(directory, 'outside-credentials')
    const outsideFile = join(outsideDirectory, `${created.data.id}.bin`)
    await fs.mkdir(outsideDirectory)
    await fs.writeFile(outsideFile, 'outside-sentinel')
    await fs.symlink(outsideDirectory, join(directory, 'agent-credentials'), process.platform === 'win32' ? 'junction' : 'dir')

    for (const result of [
      await bridge.invoke('agent:profile:list'),
      await bridge.invoke('agent:key:set', { id: created.data.id, key: 'replacement-secret' }),
      await bridge.invoke('agent:key:remove', { id: created.data.id })
    ]) {
      expect(result.ok).toBe(false)
      expect(JSON.stringify(result)).not.toContain(outsideDirectory)
    }
    expect(await fs.readFile(outsideFile, 'utf8')).toBe('outside-sentinel')
  })

  it('rejects credential operations when a credential file is a symbolic link', async () => {
    const created = await bridge.invoke('agent:profile:create', { name: 'linked-file', endpoint: 'https://api.example.com/v1', model: 'model' })
    if (!created.ok) throw new Error('profile setup failed')
    const outsideFile = join(directory, 'outside-key.bin')
    await fs.writeFile(outsideFile, 'outside-sentinel')
    const credentialsDirectory = join(directory, 'agent-credentials')
    await fs.mkdir(credentialsDirectory)
    await fs.symlink(outsideFile, join(credentialsDirectory, `${created.data.id}.bin`), 'file')

    for (const result of [
      await bridge.invoke('agent:profile:list'),
      await bridge.invoke('agent:key:set', { id: created.data.id, key: 'replacement-secret' }),
      await bridge.invoke('agent:key:remove', { id: created.data.id })
    ]) expect(result.ok).toBe(false)
    expect(await fs.readFile(outsideFile, 'utf8')).toBe('outside-sentinel')
  })

  it('keeps keys only in main memory when OS encryption is unavailable', async () => {
    const created = await bridge.invoke('agent:profile:create', { name: 'local', endpoint: 'https://api.example.com/v1', model: 'model' })
    if (!created.ok) throw new Error('profile setup failed')
    electron.encryption.available = false
    const saved = await bridge.invoke('agent:key:set', { id: created.data.id, key: 'session-secret' })
    expect(saved.data).toMatchObject({ keyStatus: 'session-only' })
    await expect(fs.access(join(directory, 'agent-credentials', `${created.data.id}.bin`))).rejects.toThrow()
    dispose?.()
    const [{ registerIpc }, { AgentProfileService }] = await Promise.all([import('../src/main/ipc/register'), import('../src/main/services/agent-profile-service')])
    dispose = registerIpc({ agentProfiles: new AgentProfileService(directory), log: vi.fn() } as unknown as Parameters<typeof registerIpc>[0])
    expect((await bridge.invoke('agent:profile:list')).data).toMatchObject({ profiles: [{ keyStatus: 'missing' }] })
  })

  it('does not expose an agent key read channel and removes credentials with a deleted profile', async () => {
    const created = await bridge.invoke('agent:profile:create', { name: 'temporary', endpoint: 'https://api.example.com/v1', model: 'model' })
    if (!created.ok) throw new Error('profile setup failed')
    await bridge.invoke('agent:key:set', { id: created.data.id, key: 'discarded-secret' })
    const hidden = await (bridge as unknown as { invoke(name: string, payload: unknown): Promise<unknown> }).invoke('agent:key:get', { id: created.data.id })
    expect(hidden).toEqual({ ok: false, code: 50, message: '通道未开放', data: null })
    expect(electron.ipcRenderer.invoke.mock.calls.map(([name]) => name)).not.toContain('agent:key:get')
    expect((await bridge.invoke('agent:profile:delete', { id: created.data.id })).data).toEqual({ profiles: [], defaultProfileId: null })
    await expect(fs.access(join(directory, 'agent-credentials', `${created.data.id}.bin`))).rejects.toThrow()
  })
})
