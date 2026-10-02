// @vitest-environment happy-dom
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TraceBridge, TraceResult } from '../src/shared/ipc-contract'
import type { AgentConversationService } from '../src/main/services/agent-conversation-service'
import type { StorageService } from '../src/main/services/storage-service'
import type { AgentOutboundPreview, AgentSession, AgentPreviewInput } from '../src/shared/agent-types'

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>()
  return {
    handlers,
    ipcMain: { handle: (name: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => handlers.set(name, handler), removeHandler: (name: string) => handlers.delete(name) },
    ipcRenderer: { invoke: vi.fn((name: string, payload: unknown) => handlers.get(name)?.({}, payload)), on: vi.fn(), removeListener: vi.fn() },
    contextBridge: { exposeInMainWorld: (_key: string, value: unknown) => Reflect.set(window, 'trace', value) },
    dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
    safeStorage: { isAsyncEncryptionAvailable: vi.fn(async () => false) }
  }
})
vi.mock('electron', () => electron)

let directory: string
let root: string
let bridge: TraceBridge
let service: AgentConversationService
let storage: StorageService
let dispose: (() => void) | undefined
let profileId: string
let clock: number
let mount: () => Promise<void>

function value<T>(result: TraceResult<T>): T {
  if (!result.ok) throw new Error(`IPC failed: ${result.message}`)
  return result.data
}
async function plan(path: string, content: string, updatedAt = '2026-10-02T00:00:00.000Z') {
  await fs.mkdir(join(root, path), { recursive: true })
  await fs.writeFile(join(root, path, 'plan.json'), JSON.stringify({ format_version: '1', created_at: updatedAt, updated_at: updatedAt, components: [{ id: 'note-one', type: 'note', payload: { content, created_at: updatedAt } }] }))
}
async function session(): Promise<AgentSession> {
  return value(await bridge.invoke('agent:session:create', { title: '会话', profileId }))
}
async function preview(id: string, extra: Partial<AgentPreviewInput> = {}): Promise<AgentOutboundPreview> {
  return value(await bridge.invoke('agent:preview:create', { sessionId: id, message: '今天怎么安排？', selections: [], ...extra }))
}

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  electron.handlers.clear()
  directory = await fs.mkdtemp(join(tmpdir(), 'trace-agent-conversation-'))
  root = join(directory, 'library')
  await fs.mkdir(root)
  clock = Date.parse('2026-10-02T01:00:00.000Z')
  const [{ registerIpc }, { StorageService }, { PlanRepository }, { AgentProfileService }, { AgentSessionRepository }, { AgentContextService }, { AgentConversationService }] = await Promise.all([
    import('../src/main/ipc/register'), import('../src/main/services/storage-service'), import('../src/main/services/plan-repository'), import('../src/main/services/agent-profile-service'),
    import('../src/main/services/agent-session-repository'), import('../src/main/services/agent-context-service'), import('../src/main/services/agent-conversation-service')
  ])
  storage = new StorageService(new PlanRepository())
  storage.setRoot(root)
  const profiles = new AgentProfileService(directory)
  const created = await profiles.create({ name: '本机测试', endpoint: 'http://127.0.0.1:11434/v1', model: 'local' })
  profileId = created.id
  mount = async () => {
    service = new AgentConversationService(new AgentSessionRepository(directory), new AgentContextService(storage), async (id) => (await profiles.list()).profiles.find((item) => item.id === id) ?? null, { now: () => clock })
    dispose = registerIpc({ storage, agentProfiles: profiles, agentConversations: service, getWindow: () => null, log: vi.fn() } as unknown as Parameters<typeof registerIpc>[0])
  }
  await mount()
  await import('../src/preload/index')
  bridge = window.trace
})
afterEach(async () => { dispose?.(); await fs.rm(directory, { recursive: true, force: true }) })

describe('agent conversation typed IPC', () => {
  it('persists session CRUD without deleting the separate profile', async () => {
    const created = await session()
    expect(created.messages).toEqual([])
    expect(value(await bridge.invoke('agent:session:update', { id: created.id, title: '新标题', profileId })).title).toBe('新标题')
    dispose?.(); await mount()
    expect(value(await bridge.invoke('agent:session:list')).map((item) => item.title)).toEqual(['新标题'])
    expect(value(await bridge.invoke('agent:session:read', { id: created.id })).title).toBe('新标题')
    value(await bridge.invoke('agent:session:delete', { id: created.id }))
    expect(value(await bridge.invoke('agent:session:list'))).toEqual([])
    expect(value(await bridge.invoke('agent:profile:list')).profiles[0].id).toBe(profileId)
  })
  it('serializes concurrent session creation without lost updates', async () => {
    const created = await Promise.all(Array.from({ length: 8 }, () => session()))
    expect(new Set(created.map((item) => item.id)).size).toBe(8)
    expect(value(await bridge.invoke('agent:session:list'))).toHaveLength(8)
  })
  it('browses folders without reading descendants and only reads an explicit plan or diary entry', async () => {
    await plan('Daily/one', 'private-plan-body')
    await plan('Diary/2026-10-02', 'private-diary-body')
    const nodes = value(await bridge.invoke('agent:context:browse', { parentPath: '' }))
    expect(nodes.map((node) => node.path)).toEqual(['Daily', 'Diary'])
    expect(JSON.stringify(nodes)).not.toContain('private-')
    const item = value(await bridge.invoke('agent:context:read', { kind: 'diary', path: 'Diary/2026-10-02' }))
    expect(item.content).toContain('private-diary-body')
    expect(item.version).toMatch(/^sha256:/)
    expect((await bridge.invoke('agent:context:read', { kind: 'plan', path: 'Daily' })).ok).toBe(false)
    expect((await bridge.invoke('agent:context:read', { kind: 'diary', path: 'Daily/one' })).ok).toBe(false)
  })
  it('previews exactly selected content and target metadata; snapshots never persist source bodies', async () => {
    await plan('one', 'selected-context-body')
    await plan('two', 'unselected-context-body')
    const created = await session()
    const outbound = await preview(created.id, { selections: [{ kind: 'plan', path: 'one' }] })
    expect(outbound.target).toMatchObject({ id: profileId, name: '本机测试', model: 'local', endpoint: 'http://127.0.0.1:11434/v1' })
    expect(outbound.contexts).toHaveLength(1)
    expect(outbound.contexts[0].content).toContain('selected-context-body')
    expect(JSON.stringify(outbound)).not.toContain('unselected-context-body')
    const confirmed = await service.consumePreview(outbound.token)
    expect(confirmed.messages).toEqual(outbound.messages)
    expect(confirmed.contexts).toEqual(outbound.contexts)
    await expect(service.consumePreview(outbound.token)).rejects.toThrow()
    const persisted = await fs.readFile(join(directory, 'agent-sessions', `${created.id}.json`), 'utf8')
    expect(persisted).not.toContain('selected-context-body')
  })
  it('isolates concurrent previews and refuses renderer supplied confirmed content', async () => {
    const created = await session()
    const [first, second] = await Promise.all([preview(created.id), preview(created.id, { message: 'second' })])
    first.messages[0].content = 'renderer-tampered'
    expect((await service.consumePreview(first.token)).message).toBe('今天怎么安排？')
    expect((await service.consumePreview(second.token)).message).toBe('second')
    const hidden = await (bridge as unknown as { invoke(channel: string, payload: unknown): Promise<unknown> }).invoke('agent:preview:confirm', { token: first.token, content: 'tampered' })
    expect(hidden).toMatchObject({ ok: false, message: '通道未开放' })
  })
  it('cancels or expires tokens without creating messages', async () => {
    const created = await session()
    const cancelled = await preview(created.id)
    value(await bridge.invoke('agent:preview:cancel', { token: cancelled.token }))
    await expect(service.consumePreview(cancelled.token)).rejects.toThrow()
    const expired = await preview(created.id)
    clock += 10 * 60 * 1000
    await expect(service.consumePreview(expired.token)).rejects.toThrow()
    expect(value(await bridge.invoke('agent:session:read', { id: created.id })).messages).toEqual([])
  })
  it('rejects changed source bytes even if updated_at has not changed', async () => {
    await plan('one', 'before')
    const created = await session()
    const outbound = await preview(created.id, { selections: [{ kind: 'plan', path: 'one' }] })
    await plan('one', 'after')
    await expect(service.consumePreview(outbound.token)).rejects.toThrow('重新预览')
  })
  it('invalidates preview when the profile or session changes or is deleted', async () => {
    const created = await session()
    const oldProfile = await preview(created.id)
    value(await bridge.invoke('agent:profile:update', { id: profileId, name: 'new', endpoint: 'http://127.0.0.1:11434/v1', model: 'changed' }))
    await expect(service.consumePreview(oldProfile.token)).rejects.toThrow('重新预览')
    const oldSession = await preview(created.id)
    value(await bridge.invoke('agent:session:update', { id: created.id, title: 'changed', profileId }))
    await expect(service.consumePreview(oldSession.token)).rejects.toThrow('重新预览')
    const deleted = await preview(created.id)
    value(await bridge.invoke('agent:session:delete', { id: created.id }))
    await expect(service.consumePreview(deleted.token)).rejects.toThrow()
  })
  it('persists interrupted text separately while preview defaults to visible placeholders', async () => {
    const created = await session()
    const approved = await service.consumePreview((await preview(created.id)).token)
    const turn = await service.appendTurn(approved)
    await service.settleAssistant(created.id, turn.assistantId, 'half answer', 'user-interrupted')
    const outbound = await preview(created.id)
    expect(outbound.history.map((item) => item.content)).toEqual(['今天怎么安排？', '【用户中断】'])
    expect(JSON.stringify(outbound.messages)).not.toContain('half answer')
    const withPartial = await preview(created.id, { includePartialMessageIds: [turn.assistantId] })
    expect(withPartial.history.map((item) => item.content)).toEqual(['今天怎么安排？', 'half answer', '【用户中断】'])
    expect((await preview(created.id, { includeHistory: false })).history).toEqual([])
    expect((await preview((await session()).id)).history).toEqual([])
    dispose?.(); await mount()
    expect(value(await bridge.invoke('agent:session:read', { id: created.id })).messages[1]).toMatchObject({ content: 'half answer', status: 'user-interrupted' })
  })
  it('records source identifiers and versions only with a turn and recovers interrupted streaming on reopen', async () => {
    await plan('one', 'source-body-not-persisted')
    const created = await session()
    const approved = await service.consumePreview((await preview(created.id, { selections: [{ kind: 'plan', path: 'one' }] })).token)
    const turn = await service.appendTurn(approved)
    await service.settleAssistant(created.id, turn.assistantId, 'saved-delta', 'streaming')
    dispose?.(); await mount()
    const loaded = value(await bridge.invoke('agent:session:read', { id: created.id }))
    expect(loaded.messages[1]).toMatchObject({ content: 'saved-delta', status: 'error-interrupted' })
    expect(loaded.requests[0]).toMatchObject({ profileId, model: 'local', sources: [{ kind: 'plan', path: 'one', version: approved.contexts[0].version }] })
    expect(await fs.readFile(join(directory, 'agent-sessions', `${created.id}.json`), 'utf8')).not.toContain('source-body-not-persisted')
  })
  it('rejects traversal and static symlink or junction context reads and session paths', async () => {
    await plan('one', 'safe')
    await fs.mkdir(join(directory, 'outside'))
    await fs.writeFile(join(directory, 'outside', 'plan.json'), 'outside-sentinel')
    await fs.symlink(join(directory, 'outside'), join(root, 'escaped'), process.platform === 'win32' ? 'junction' : 'dir')
    for (const result of [
      await bridge.invoke('agent:context:read', { kind: 'plan', path: '../outside' }),
      await bridge.invoke('agent:context:read', { kind: 'plan', path: 'escaped' }),
      await bridge.invoke('agent:context:browse', { parentPath: 'escaped' }),
      await bridge.invoke('agent:session:read', { id: '../outside' }),
      await bridge.invoke('agent:session:delete', { id: '../outside' })
    ]) { expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain('outside-sentinel') }
    expect(await fs.readFile(join(directory, 'outside', 'plan.json'), 'utf8')).toBe('outside-sentinel')
  })
  it('rejects linked session directories and corrupted records without overwriting them', async () => {
    const created = await session()
    const file = join(directory, 'agent-sessions', `${created.id}.json`)
    await fs.writeFile(file, '{broken')
    expect((await bridge.invoke('agent:session:read', { id: created.id })).ok).toBe(false)
    expect(await fs.readFile(file, 'utf8')).toBe('{broken')
    await fs.rename(join(directory, 'agent-sessions'), join(directory, 'outside-sessions'))
    await fs.symlink(join(directory, 'outside-sessions'), join(directory, 'agent-sessions'), process.platform === 'win32' ? 'junction' : 'dir')
    expect((await bridge.invoke('agent:session:list')).ok).toBe(false)
    expect((await bridge.invoke('agent:session:delete', { id: created.id })).ok).toBe(false)
  })
  it('rejects malformed payloads and duplicate aliases before storing a preview', async () => {
    const created = await session()
    await plan('one', 'private-source')
    for (const input of [
      { sessionId: created.id, message: '', selections: [] },
      { sessionId: created.id, message: 'test', selections: [{ kind: 'folder', path: 'one' }] },
      { sessionId: created.id, message: 'test', selections: [{ kind: 'plan', path: 'one' }, { kind: 'plan', path: 'one/' }] },
      { sessionId: created.id, message: 'test', selections: [], includePartialMessageIds: [profileId] }
    ]) {
      const result = await (bridge as unknown as { invoke(channel: string, payload: unknown): Promise<TraceResult<unknown>> }).invoke('agent:preview:create', input)
      expect(result.ok).toBe(false)
      expect(JSON.stringify(result)).not.toContain('private-source')
    }
  })
  it('rechecks source changes between confirmation and main-process turn creation', async () => {
    const created = await session()
    await plan('one', 'before')
    const approved = await service.consumePreview((await preview(created.id, { selections: [{ kind: 'plan', path: 'one' }] })).token)
    await plan('one', 'after')
    await expect(service.appendTurn(approved)).rejects.toThrow('重新预览')
    expect(value(await bridge.invoke('agent:session:read', { id: created.id })).messages).toEqual([])
  })
  it('rejects deleted sources, library switches and replay after app restart', async () => {
    await plan('one', 'private-source')
    const created = await session()
    const deleted = await preview(created.id, { selections: [{ kind: 'plan', path: 'one' }] })
    await fs.unlink(join(root, 'one', 'plan.json'))
    await expect(service.consumePreview(deleted.token)).rejects.toThrow('重新预览')
    await plan('one', 'private-source')
    const oldLibrary = await preview(created.id, { selections: [{ kind: 'plan', path: 'one' }] })
    const previousRoot = root
    root = join(directory, 'new-library')
    await plan('one', 'private-source')
    // Repointing the actual StorageService simulates the existing app root-switch boundary.
    storage.setRoot(root)
    await expect(service.consumePreview(oldLibrary.token)).rejects.toThrow('重新预览')
    storage.setRoot(previousRoot); root = previousRoot
    const oldProcess = await preview(created.id)
    dispose?.(); await mount()
    await expect(service.consumePreview(oldProcess.token)).rejects.toThrow()
  })
  it('rejects static session file and plan file links without touching outside sentinels', async () => {
    const created = await session()
    const outsideFile = join(directory, 'outside-sentinel.json')
    await fs.writeFile(outsideFile, 'outside-sentinel')
    const sessionFile = join(directory, 'agent-sessions', `${created.id}.json`)
    await fs.unlink(sessionFile)
    await fs.symlink(outsideFile, sessionFile, 'file')
    expect((await bridge.invoke('agent:session:read', { id: created.id })).ok).toBe(false)
    expect((await bridge.invoke('agent:session:delete', { id: created.id })).ok).toBe(false)
    await fs.mkdir(join(root, 'linked-plan'))
    await fs.symlink(outsideFile, join(root, 'linked-plan', 'plan.json'), 'file')
    const result = await bridge.invoke('agent:context:read', { kind: 'plan', path: 'linked-plan' })
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain('outside-sentinel')
    expect(await fs.readFile(outsideFile, 'utf8')).toBe('outside-sentinel')
  })
  it('stores abnormal interruptions and prevents mutation or deletion during generation', async () => {
    const created = await session()
    const turn = await service.appendTurn(await service.consumePreview((await preview(created.id)).token))
    const updating = await bridge.invoke('agent:session:update', { id: created.id, title: 'new', profileId })
    expect(updating.ok).toBe(false)
    expect((await bridge.invoke('agent:session:delete', { id: created.id })).ok).toBe(false)
    await service.settleAssistant(created.id, turn.assistantId, 'partial', 'error-interrupted')
    expect((await preview(created.id)).history[1].content).toBe('【异常中断】')
    await expect(service.settleAssistant(created.id, turn.assistantId, 'changed', 'complete')).rejects.toThrow()
    value(await bridge.invoke('agent:session:delete', { id: created.id }))
  })
  it('keeps local history readable after profile deletion and rejects creating a new preview', async () => {
    const created = await session()
    const turn = await service.appendTurn(await service.consumePreview((await preview(created.id)).token))
    await service.settleAssistant(created.id, turn.assistantId, 'completed answer', 'complete')
    const outbound = await preview(created.id)
    expect(outbound.history.map((item) => item.content)).toEqual(['今天怎么安排？', 'completed answer'])
    value(await bridge.invoke('agent:profile:delete', { id: profileId }))
    expect(value(await bridge.invoke('agent:session:read', { id: created.id })).messages[1].content).toBe('completed answer')
    expect((await bridge.invoke('agent:preview:create', { sessionId: created.id, message: 'new', selections: [] })).ok).toBe(false)
  })
  it('wires lazy production IPC without requiring injected conversation services', async () => {
    dispose?.()
    const { registerIpc } = await import('../src/main/ipc/register')
    dispose = registerIpc({ storage, agentUserDataDir: directory, getWindow: () => null, log: vi.fn() } as unknown as Parameters<typeof registerIpc>[0])
    await expect(fs.access(join(directory, 'agent-sessions'))).rejects.toThrow()
    const created = await session()
    expect(value(await bridge.invoke('agent:session:read', { id: created.id })).id).toBe(created.id)
    expect((await preview(created.id)).contexts).toEqual([])
  })
})
