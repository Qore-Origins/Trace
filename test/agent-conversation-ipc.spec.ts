// @vitest-environment happy-dom
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TraceBridge, TraceResult } from '../src/shared/ipc-contract'
import type { AgentConversationService } from '../src/main/services/agent-conversation-service'
import type { StorageService } from '../src/main/services/storage-service'
import type { AgentTargetService } from '../src/main/services/agent-target-service'
import type { AgentProfileService } from '../src/main/services/agent-profile-service'
import type { AgentCompletedToolCall, AgentOutboundPreview, AgentSession, AgentPreviewInput } from '../src/shared/agent-types'
import { ERR } from '../src/shared/errors'
import { AGENT_REQUEST_BODY_LIMIT_BYTES } from '../src/main/services/agent-provider'

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
let targets: AgentTargetService
let profiles: AgentProfileService
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
  const [{ registerIpc }, { StorageService }, { PlanRepository }, { AgentProfileService }, { AgentTargetService }, { AgentSessionRepository }, { AgentContextService }, { AgentConversationService }] = await Promise.all([
    import('../src/main/ipc/register'), import('../src/main/services/storage-service'), import('../src/main/services/plan-repository'), import('../src/main/services/agent-profile-service'),
    import('../src/main/services/agent-target-service'),
    import('../src/main/services/agent-session-repository'), import('../src/main/services/agent-context-service'), import('../src/main/services/agent-conversation-service')
  ])
  const repository = new PlanRepository()
  await repository.ensureLibraryRoot(root)
  storage = new StorageService(repository)
  storage.setRoot(root)
  profiles = new AgentProfileService(directory)
  const created = await profiles.create({ name: '本机测试', endpoint: 'http://127.0.0.1:11434/v1', model: 'local' })
  profileId = created.id
  targets = new AgentTargetService(storage)
  mount = async () => {
    service = new AgentConversationService(new AgentSessionRepository(directory), new AgentContextService(storage), async (id) => (await profiles.list()).profiles.find((item) => item.id === id) ?? null, { now: () => clock, targets })
    dispose = registerIpc({ storage, agentProfiles: profiles, agentConversations: service, agentTargetService: targets, getWindow: () => null, log: vi.fn() } as unknown as Parameters<typeof registerIpc>[0])
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
  it('binds a target only after its confirmed user message is persisted and reuses that ID for continuation', async () => {
    await plan('one', 'grant target content')
    await plan('two', 'second grant target content')
    const created = await session()
    const grantSet = value(await bridge.invoke('agent:target:grant', { targets: [{ kind: 'plan', path: 'one' }, { kind: 'plan', path: 'two' }] }))
    const refA = grantSet.targets[0].ref
    const refB = grantSet.targets[1].ref
    const outbound = await preview(created.id, { targetGrantSetId: grantSet.id, targetRefs: [refA] })
    expect(outbound).not.toHaveProperty('userMessageId')
    expect(outbound).not.toHaveProperty('targetGrantSetId')
    expect(outbound.targets?.map((item) => item.ref)).toEqual([refA])
    // The object returned to the renderer is a clone; authorization must be derived from main's frozen snapshot.
    outbound.targets?.push(grantSet.targets[1])
    const confirmed = await service.consumePreview(outbound.token)
    expect(confirmed.targets?.map((item) => item.ref)).toEqual([refA])
    let started = false
    const profile = (await profiles.list()).profiles.find((item) => item.id === profileId)!
    const identity = await service.dispatchPreview(confirmed, (_revision, dispatch) => dispatch(profile, 'synthetic-test-key'), () => { started = true })
    expect(started).toBe(true)
    const persisted = value(await bridge.invoke('agent:session:read', { id: created.id }))
    const userMessage = persisted.messages.find((message) => message.role === 'user')!
    await expect(targets.resolveGrantForMessage({ setId: grantSet.id, ref: refA }, userMessage.id)).resolves.toMatchObject({ kind: 'plan', path: 'one' })
    await expect(targets.resolveGrantForMessage({ setId: grantSet.id, ref: refB }, userMessage.id)).rejects.toMatchObject({ code: ERR.CONFLICT })

    await service.settleAssistant(created.id, identity.assistantId, 'Read complete.', 'complete')
    const continuation = await service.beginAssistantContinuation(created.id, identity.requestId)
    expect(continuation.userMessageId).toBe(userMessage.id)
    await expect(targets.resolveGrantForMessage({ setId: grantSet.id, ref: refA }, continuation.userMessageId)).resolves.toMatchObject({ kind: 'plan', path: 'one' })
    await expect(targets.resolveGrantForMessage({ setId: grantSet.id, ref: refB }, continuation.userMessageId)).rejects.toMatchObject({ code: ERR.CONFLICT })
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
  it('rejects an oversized valid selected plan before returning a confirmation token', async () => {
    const content = 'private-oversized-source-' + 'x'.repeat(300 * 1024)
    await plan('large', content)
    expect(value(await bridge.invoke('agent:context:read', { kind: 'plan', path: 'large' })).content).toContain(content)
    const created = await session()
    const result = await bridge.invoke('agent:preview:create', { sessionId: created.id, message: 'test', selections: [{ kind: 'plan', path: 'large' }] })
    expect(result).toMatchObject({ ok: false, code: ERR.VALIDATION, message: '本次外发内容过长，请减少历史或上下文' })
    expect(result.data).toBeNull()
    expect(JSON.stringify(result)).not.toContain('private-oversized-source')
    expect(value(await bridge.invoke('agent:session:read', { id: created.id })).messages).toEqual([])
  })
  it('accepts selected context at the exact provider envelope limit and rejects one more byte', async () => {
    value(await bridge.invoke('agent:profile:update', { id: profileId, name: '本机测试', endpoint: 'http://127.0.0.1:11434/v1', model: 'm'.repeat(160) }))
    const created = await session()
    const selections = [{ kind: 'plan' as const, path: 'boundary' }]
    await plan('boundary', '')
    const baseline = await preview(created.id, { selections })
    const envelopeSize = Buffer.byteLength(JSON.stringify({ model: baseline.target.model, messages: baseline.messages, stream: true }), 'utf8')
    const contextText = 'x'.repeat(AGENT_REQUEST_BODY_LIMIT_BYTES - envelopeSize)
    await plan('boundary', contextText)
    const outbound = await preview(created.id, { selections })
    const serialized = JSON.stringify({ model: outbound.target.model, messages: outbound.messages, stream: true })
    expect(Buffer.byteLength(serialized, 'utf8')).toBe(AGENT_REQUEST_BODY_LIMIT_BYTES)
    const { serializeAgentChatRequest } = await import('../src/main/services/agent-provider')
    expect(serializeAgentChatRequest(outbound.target.model, outbound.messages)).toBe(serialized)
    expect(outbound.contexts[0].content).toContain(contextText)
    expect((await service.consumePreview(outbound.token)).messages).toEqual(outbound.messages)
    await plan('boundary', contextText + 'x')
    expect(await bridge.invoke('agent:preview:create', { sessionId: created.id, message: '今天怎么安排？', selections })).toMatchObject({ ok: false, code: ERR.VALIDATION, data: null })
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
  it('replays only complete assistant tool-call/result pairs in the approved history snapshot', async () => {
    const created = await session()
    const firstPreview = await preview(created.id)
    const turn = await service.appendTurn(await service.consumePreview(firstPreview.token))
    const calls: AgentCompletedToolCall[] = [{ id: 'call_1', name: 'plan.read', arguments: { ref: 'r1' } }]
    await service.settleAssistant(created.id, turn.assistantId, '', 'complete', calls)

    const incomplete = await preview(created.id)
    expect(incomplete.messages).toEqual([{ role: 'user', content: '今天怎么安排？' }, { role: 'user', content: '今天怎么安排？' }])
    value(await bridge.invoke('agent:preview:cancel', { token: incomplete.token }))

    await expect(service.appendToolResults(created.id, turn.assistantId, [{ toolCallId: 'unknown', content: 'must not attach' }])).rejects.toThrow('不匹配')
    await service.appendToolResults(created.id, turn.assistantId, [{ toolCallId: 'call_1', content: '{"title":"Read-only result"}' }])
    const complete = await preview(created.id)
    expect(complete.messages).toEqual([
      { role: 'user', content: '今天怎么安排？' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'plan.read', arguments: '{"ref":"r1"}' } }] },
      { role: 'tool', content: '{"title":"Read-only result"}', tool_call_id: 'call_1' },
      { role: 'user', content: '今天怎么安排？' }
    ])
    const originalUserId = value(await bridge.invoke('agent:session:read', { id: created.id })).messages.find((message) => message.role === 'user')!.id
    const continuation = await service.beginAssistantContinuation(created.id, turn.requestId)
    expect(continuation).toMatchObject({ userMessageId: originalUserId, toolRounds: 1, toolCallCount: 1, toolsAllowed: true })
    await service.settleAssistant(created.id, continuation.assistantId, 'Read-only summary.', 'complete')
    const continued = value(await bridge.invoke('agent:session:read', { id: created.id }))
    expect(continued.messages.filter((message) => message.role === 'user')).toHaveLength(1)
    expect(continued.messages.at(-1)).toMatchObject({ id: continuation.assistantId, requestId: turn.requestId, status: 'complete', content: 'Read-only summary.' })
  })
  it('requires complete tool results in the original assistant call order', async () => {
    const created = await session()
    const turn = await service.appendTurn(await service.consumePreview((await preview(created.id)).token))
    const calls: AgentCompletedToolCall[] = [
      { id: 'call_first', name: 'plan.read', arguments: { ref: 'first' } },
      { id: 'call_second', name: 'plan.read', arguments: { ref: 'second' } }
    ]
    await service.settleAssistant(created.id, turn.assistantId, '', 'complete', calls)
    const before = value(await bridge.invoke('agent:session:read', { id: created.id }))

    await expect(service.appendToolResults(created.id, turn.assistantId, [
      { toolCallId: 'call_second', content: 'second' },
      { toolCallId: 'call_first', content: 'first' }
    ])).rejects.toThrow()
    await expect(service.appendToolResults(created.id, turn.assistantId, [
      { toolCallId: 'call_first', content: 'first' }
    ])).rejects.toThrow()
    const afterRejectedResults = value(await bridge.invoke('agent:session:read', { id: created.id }))
    expect(afterRejectedResults.revision).toBe(before.revision)
    expect(afterRejectedResults.messages).toHaveLength(before.messages.length)

    const completed = await service.appendToolResults(created.id, turn.assistantId, [
      { toolCallId: 'call_first', content: 'first' },
      { toolCallId: 'call_second', content: 'second' }
    ])
    expect(completed.messages.filter((message) => message.role === 'tool').map((message) => message.toolCallId)).toEqual(['call_first', 'call_second'])
  })
  it.each([
    { label: 'tool-round', rounds: 8, callsPerRound: 1 },
    { label: 'tool-call', rounds: 1, callsPerRound: 20 }
  ])('does not create a continuation at the exact $label limit', async ({ rounds, callsPerRound }) => {
    const created = await session()
    const turn = await service.appendTurn(await service.consumePreview((await preview(created.id)).token))
    let assistantId = turn.assistantId
    for (let round = 0; round < rounds; round += 1) {
      const calls: AgentCompletedToolCall[] = Array.from({ length: callsPerRound }, (_, index) => {
        const callNumber = round * callsPerRound + index
        return { id: `call_${callNumber}`, name: 'plan.read', arguments: { ref: `r${callNumber}` } }
      })
      await service.settleAssistant(created.id, assistantId, '', 'complete', calls)
      await service.appendToolResults(created.id, assistantId, calls.map((call) => ({ toolCallId: call.id, content: '{}' })))
      if (round < rounds - 1) assistantId = (await service.beginAssistantContinuation(created.id, turn.requestId)).assistantId
    }

    const before = value(await bridge.invoke('agent:session:read', { id: created.id }))
    await expect(service.beginAssistantContinuation(created.id, turn.requestId)).rejects.toMatchObject({ category: 'limit' })
    const after = value(await bridge.invoke('agent:session:read', { id: created.id }))
    expect(after.revision).toBe(before.revision)
    expect(after.messages).toHaveLength(before.messages.length)
    expect(after.messages.some((message) => message.status === 'streaming')).toBe(false)
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
    await plan('one', 'outside-sentinel')
    expect(value(await bridge.invoke('agent:context:read', { kind: 'plan', path: 'one' })).content).toContain('outside-sentinel')
    const outsideContent = await fs.readFile(join(root, 'one', 'plan.json'), 'utf8')
    await fs.mkdir(join(directory, 'outside'))
    await fs.writeFile(join(directory, 'outside', 'plan.json'), outsideContent)
    await fs.symlink(join(directory, 'outside'), join(root, 'escaped'), process.platform === 'win32' ? 'junction' : 'dir')
    for (const result of [
      await bridge.invoke('agent:context:read', { kind: 'plan', path: '../outside' }),
      await bridge.invoke('agent:context:read', { kind: 'plan', path: 'escaped' }),
      await bridge.invoke('agent:context:browse', { parentPath: 'escaped' })
    ]) { expect(result).toMatchObject({ ok: false, code: ERR.PATH_UNSAFE }); expect(JSON.stringify(result)).not.toContain('outside-sentinel') }
    for (const result of [await bridge.invoke('agent:session:read', { id: '../outside' }), await bridge.invoke('agent:session:delete', { id: '../outside' })]) {
      expect(result).toMatchObject({ ok: false, code: ERR.VALIDATION })
    }
    expect(await fs.readFile(join(directory, 'outside', 'plan.json'), 'utf8')).toBe(outsideContent)
  })
  it('rejects malformed session records with FORMAT_INVALID without overwriting them', async () => {
    const created = await session()
    const file = join(directory, 'agent-sessions', `${created.id}.json`)
    await fs.writeFile(file, '{broken')
    expect(await bridge.invoke('agent:session:read', { id: created.id })).toMatchObject({ ok: false, code: ERR.FORMAT_INVALID })
    expect(await bridge.invoke('agent:session:delete', { id: created.id })).toMatchObject({ ok: false, code: ERR.FORMAT_INVALID })
    expect(await fs.readFile(file, 'utf8')).toBe('{broken')
  })
  it('rejects linked session directories containing valid readable records', async () => {
    const created = await session()
    expect(value(await bridge.invoke('agent:session:read', { id: created.id }))).toEqual(created)
    const record = await fs.readFile(join(directory, 'agent-sessions', `${created.id}.json`), 'utf8')
    await fs.rename(join(directory, 'agent-sessions'), join(directory, 'outside-sessions'))
    await fs.symlink(join(directory, 'outside-sessions'), join(directory, 'agent-sessions'), process.platform === 'win32' ? 'junction' : 'dir')
    for (const result of [await bridge.invoke('agent:session:list'), await bridge.invoke('agent:session:read', { id: created.id }), await bridge.invoke('agent:session:delete', { id: created.id })]) {
      expect(result).toMatchObject({ ok: false, code: ERR.PATH_UNSAFE })
    }
    expect(await fs.readFile(join(directory, 'outside-sessions', `${created.id}.json`), 'utf8')).toBe(record)
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
  it('rejects selecting the same Diary entry as both diary and plan', async () => {
    await plan('Diary/2026-10-02', 'private-diary-source')
    const created = await session()
    expect(value(await bridge.invoke('agent:context:read', { kind: 'diary', path: 'Diary/2026-10-02' })).kind).toBe('diary')
    expect(await bridge.invoke('agent:context:read', { kind: 'plan', path: 'Diary/2026-10-02' })).toMatchObject({ ok: false, code: ERR.VALIDATION })
    const result = await bridge.invoke('agent:preview:create', { sessionId: created.id, message: 'test', selections: [{ kind: 'diary', path: 'Diary/2026-10-02' }, { kind: 'plan', path: 'Diary/2026-10-02' }] })
    expect(result).toMatchObject({ ok: false, code: ERR.VALIDATION, data: null })
    expect(JSON.stringify(result)).not.toContain('private-diary-source')
  })
  it.skipIf(process.platform !== 'win32')('rejects Windows case aliases while preserving a single selected display path', async () => {
    await plan('CasePlan', 'private-case-source')
    const created = await session()
    expect((await preview(created.id, { selections: [{ kind: 'plan', path: 'caseplan' }] })).contexts[0].path).toBe('caseplan')
    const result = await bridge.invoke('agent:preview:create', { sessionId: created.id, message: 'test', selections: [{ kind: 'plan', path: 'CasePlan' }, { kind: 'plan', path: 'caseplan' }] })
    expect(result).toMatchObject({ ok: false, code: ERR.VALIDATION, data: null })
    expect(JSON.stringify(result)).not.toContain('private-case-source')
  })
  it('rejects resolved file aliases and validates a Diary source behind a plan alias', async () => {
    await plan('one', 'private-alias-source')
    await plan('Diary/2026-10-02', 'private-diary-source')
    await fs.mkdir(join(root, 'alias'))
    await fs.symlink(join(root, 'one', 'plan.json'), join(root, 'alias', 'plan.json'), 'file')
    const created = await session()
    expect((await preview(created.id, { selections: [{ kind: 'plan', path: 'alias' }] })).contexts[0].path).toBe('alias')
    expect(await bridge.invoke('agent:preview:create', { sessionId: created.id, message: 'test', selections: [{ kind: 'plan', path: 'one' }, { kind: 'plan', path: 'alias' }] })).toMatchObject({ ok: false, code: ERR.VALIDATION })
    await fs.symlink(join(root, 'Diary', '2026-10-02'), join(root, 'diary-alias'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(await bridge.invoke('agent:context:read', { kind: 'plan', path: 'diary-alias' })).toMatchObject({ ok: false, code: ERR.VALIDATION })
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
    const sessionFile = join(directory, 'agent-sessions', `${created.id}.json`)
    expect(value(await bridge.invoke('agent:session:read', { id: created.id }))).toEqual(created)
    const sessionRecord = await fs.readFile(sessionFile, 'utf8')
    const outsideSession = join(directory, 'outside-session.json')
    await fs.writeFile(outsideSession, sessionRecord)
    await fs.unlink(sessionFile)
    await fs.symlink(outsideSession, sessionFile, 'file')
    for (const result of [await bridge.invoke('agent:session:list'), await bridge.invoke('agent:session:read', { id: created.id }), await bridge.invoke('agent:session:delete', { id: created.id })]) {
      expect(result).toMatchObject({ ok: false, code: ERR.PATH_UNSAFE })
    }
    await plan('one', 'outside-plan-sentinel')
    expect(value(await bridge.invoke('agent:context:read', { kind: 'plan', path: 'one' })).content).toContain('outside-plan-sentinel')
    const planRecord = await fs.readFile(join(root, 'one', 'plan.json'), 'utf8')
    const outsidePlan = join(directory, 'outside-plan.json')
    await fs.writeFile(outsidePlan, planRecord)
    await fs.mkdir(join(root, 'linked-plan'))
    await fs.symlink(outsidePlan, join(root, 'linked-plan', 'plan.json'), 'file')
    const result = await bridge.invoke('agent:context:read', { kind: 'plan', path: 'linked-plan' })
    expect(result).toMatchObject({ ok: false, code: ERR.PATH_UNSAFE })
    expect(JSON.stringify(result)).not.toContain('outside-plan-sentinel')
    const children = value(await bridge.invoke('agent:context:browse', { parentPath: '' }))
    expect(children.map((node) => node.path)).toEqual(['one'])
    expect(JSON.stringify(children)).not.toContain('outside-plan-sentinel')
    expect(await fs.readFile(outsideSession, 'utf8')).toBe(sessionRecord)
    expect(await fs.readFile(outsidePlan, 'utf8')).toBe(planRecord)
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
