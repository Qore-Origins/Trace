import { randomUUID } from 'node:crypto'
import type { AgentHistoryItem, AgentMessageStatus, AgentOutboundPreview, AgentPreviewInput, AgentProfile, AgentSession, AgentSessionInput, AgentSessionSummary, AgentTarget } from '../../shared/agent-types'
import { ERR, TraceError } from '../../shared/errors'
import { AgentContextService, parseContextSelection } from './agent-context-service'
import { AgentSessionRepository, agentRecord, assertAgentMessageText, assertAgentSessionId, parseSessionInput } from './agent-session-repository'
import { serializeAgentChatRequest } from './agent-provider'
import { AgentStreamError } from './agent-sse'

export const AGENT_PREVIEW_TTL_MS = 5 * 60 * 1000
const MAX_PREVIEWS = 32
const MAX_CONTEXT_SELECTIONS = 32
type ResolveProfile = (id: string) => Promise<AgentProfile | null>
function target(profile: AgentProfile): AgentTarget {
  return { id: profile.id, name: profile.name, presetId: profile.presetId, protocol: profile.protocol, endpoint: profile.endpoint, model: profile.model }
}
function parsePreview(value: unknown): AgentPreviewInput {
  if (!agentRecord(value)) throw new TraceError(ERR.VALIDATION, '外发预览无效')
  assertAgentSessionId(value.sessionId); assertAgentMessageText(value.message)
  if (!value.message.trim() || !Array.isArray(value.selections) || value.selections.length > MAX_CONTEXT_SELECTIONS || (value.includeHistory !== undefined && typeof value.includeHistory !== 'boolean')) throw new TraceError(ERR.VALIDATION, '外发预览无效')
  const selections = value.selections.map(parseContextSelection)
  if (new Set(selections.map((item) => `${item.kind}:${item.path}`)).size !== selections.length) throw new TraceError(ERR.VALIDATION, '上下文条目重复')
  const partials = value.includePartialMessageIds ?? []
  if (!Array.isArray(partials) || partials.length > 1000) throw new TraceError(ERR.VALIDATION, '历史消息选择无效')
  partials.forEach(assertAgentSessionId)
  return { sessionId: value.sessionId, message: value.message, selections, includeHistory: value.includeHistory ?? true, includePartialMessageIds: partials as string[] }
}
function history(session: AgentSession, input: AgentPreviewInput): AgentHistoryItem[] {
  const selected = new Set(input.includePartialMessageIds)
  for (const id of selected) {
    if (!session.messages.some((item) => item.id === id && item.role === 'assistant' && (item.status === 'user-interrupted' || item.status === 'error-interrupted'))) throw new TraceError(ERR.VALIDATION, '历史消息选择无效')
  }
  if (!input.includeHistory) return []
  return session.messages.flatMap((message): AgentHistoryItem[] => {
    const text: AgentHistoryItem = { messageId: message.id, kind: 'message', role: message.role, content: message.content }
    if (message.status === 'complete') return [text]
    const marker: AgentHistoryItem = { messageId: message.id, kind: 'interruption', role: 'system', content: message.status === 'user-interrupted' ? '【用户中断】' : '【异常中断】' }
    return selected.has(message.id) ? [text, marker] : [marker]
  })
}

export class AgentConversationService {
  private readonly previews = new Map<string, AgentOutboundPreview>()
  private readonly approved = new WeakSet<AgentOutboundPreview>()
  private queue = Promise.resolve()
  private readonly now: () => number
  constructor(readonly sessions: AgentSessionRepository, readonly contexts: AgentContextService, private readonly resolveProfile: ResolveProfile, options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }
  private async profile(id: string): Promise<AgentProfile> {
    const profile = await this.resolveProfile(id)
    if (!profile) throw new TraceError(ERR.PATH_NOT_FOUND, '模型服务配置不存在')
    return profile
  }
  list(): Promise<AgentSessionSummary[]> { return this.sessions.list() }
  read(id: unknown): Promise<AgentSession> { assertAgentSessionId(id); return this.sessions.read(id) }
  create(payload: unknown): Promise<AgentSession> {
    return this.serial(async () => { const input = parseSessionInput(payload); await this.profile(input.profileId); return this.sessions.create(input) })
  }
  update(payload: unknown): Promise<AgentSession> {
    return this.serial(async () => {
      if (!agentRecord(payload)) throw new TraceError(ERR.VALIDATION, '会话配置无效')
      assertAgentSessionId(payload.id)
      const input: AgentSessionInput = parseSessionInput(payload)
      await this.profile(input.profileId)
      return this.sessions.mutate(payload.id, (session) => {
        if (session.messages.some((message) => message.status === 'streaming')) throw new TraceError(ERR.STATE_MACHINE, '请先停止当前生成')
        session.title = input.title; session.profileId = input.profileId
      })
    })
  }
  delete(id: unknown): Promise<void> {
    assertAgentSessionId(id)
    return this.serial(async () => {
      const session = await this.sessions.read(id)
      if (session.messages.some((message) => message.status === 'streaming')) throw new TraceError(ERR.STATE_MACHINE, '请先停止当前生成')
      await this.sessions.delete(id)
      for (const [token, preview] of this.previews) if (preview.sessionId === id) this.previews.delete(token)
    })
  }
  createPreview(payload: unknown): Promise<AgentOutboundPreview> {
    return this.serial(async () => {
      const input = parsePreview(payload)
      const session = await this.sessions.read(input.sessionId)
      if (session.messages.some((message) => message.status === 'streaming')) throw new TraceError(ERR.STATE_MACHINE, '请先停止当前生成')
      const currentTarget = target(await this.profile(session.profileId))
      const resolved = await Promise.all(input.selections.map((selection) => this.contexts.readResolved(selection)))
      if (new Set(resolved.map((item) => item.sourceIdentity)).size !== resolved.length) throw new TraceError(ERR.VALIDATION, '上下文条目重复')
      const contexts = resolved.map((item) => item.entry)
      const items = history(session, input)
      const messages = [
        ...items.map(({ role, content }) => ({ role, content })),
        ...contexts.map((item) => ({ role: 'system' as const, content: `用户授权上下文（${item.kind}：${item.path}，版本 ${item.version}）：\n${item.content}` })),
        { role: 'user' as const, content: input.message }
      ]
      try { serializeAgentChatRequest(currentTarget.model, messages) } catch (error) {
        if (error instanceof AgentStreamError && error.category === 'limit') throw new TraceError(ERR.VALIDATION, '本次外发内容过长，请减少历史或上下文')
        throw error
      }
      const preview: AgentOutboundPreview = { token: randomUUID(), sessionId: session.id, sessionRevision: session.revision, expiresAt: new Date(this.now() + AGENT_PREVIEW_TTL_MS).toISOString(), target: currentTarget, message: input.message, history: items, contexts, messages }
      for (const [token, item] of this.previews) if (Date.parse(item.expiresAt) <= this.now()) this.previews.delete(token)
      if (this.previews.size >= MAX_PREVIEWS) throw new TraceError(ERR.STATE_MACHINE, '待确认预览过多，请先取消旧预览')
      this.previews.set(preview.token, preview)
      return structuredClone(preview)
    })
  }
  cancelPreview(token: unknown): void { assertAgentSessionId(token); this.previews.delete(token) }
  private async verifySnapshot(preview: AgentOutboundPreview): Promise<void> {
    if (Date.parse(preview.expiresAt) <= this.now()) throw new TraceError(ERR.CONFLICT, '预览已过期，请重新预览')
    const session = await this.sessions.read(preview.sessionId)
    if (session.revision !== preview.sessionRevision || session.profileId !== preview.target.id || JSON.stringify(target(await this.profile(session.profileId))) !== JSON.stringify(preview.target)) throw new TraceError(ERR.CONFLICT, '会话或模型配置已变化，请重新预览')
    for (const source of preview.contexts) {
      let current
      try { current = await this.contexts.read(source) } catch { throw new TraceError(ERR.CONFLICT, '上下文条目已变化，请重新预览') }
      if (current.libraryId !== source.libraryId || current.version !== source.version || current.updatedAt !== source.updatedAt) throw new TraceError(ERR.CONFLICT, '上下文条目已变化，请重新预览')
    }
  }
  // Only main-process request orchestration consumes this one-shot authorization.
  consumePreview(token: unknown): Promise<AgentOutboundPreview> {
    assertAgentSessionId(token)
    return this.serial(async () => {
      const preview = this.previews.get(token)
      this.previews.delete(token)
      if (!preview) throw new TraceError(ERR.CONFIRMATION_REQUIRED, '预览不存在或已取消，请重新预览')
      await this.verifySnapshot(preview)
      this.approved.add(preview)
      return preview
    })
  }
  appendTurn(preview: AgentOutboundPreview): Promise<{ requestId: string; assistantId: string }> {
    return this.serial(async () => {
      if (!this.approved.has(preview)) throw new TraceError(ERR.CONFIRMATION_REQUIRED, '请先确认外发预览')
      this.approved.delete(preview)
      await this.verifySnapshot(preview)
      const requestId = randomUUID(), assistantId = randomUUID(), requestedAt = new Date(this.now()).toISOString()
      await this.sessions.mutate(preview.sessionId, (session) => {
        if (session.revision !== preview.sessionRevision || session.messages.some((item) => item.status === 'streaming')) throw new TraceError(ERR.CONFLICT, '会话已变化，请重新预览')
        session.requests.push({ id: requestId, profileId: preview.target.id, profileName: preview.target.name, presetId: preview.target.presetId, model: preview.target.model, requestedAt, sources: preview.contexts.map(({ content: _content, ...source }) => source) })
        session.messages.push({ id: randomUUID(), role: 'user', content: preview.message, status: 'complete', createdAt: requestedAt, requestId }, { id: assistantId, role: 'assistant', content: '', status: 'streaming', createdAt: requestedAt, requestId })
      })
      return { requestId, assistantId }
    })
  }
  // Incremental persistence and final status belong to main; no public mutation IPC exists.
  settleAssistant(sessionId: string, messageId: string, content: string, status: AgentMessageStatus): Promise<AgentSession> {
    assertAgentSessionId(sessionId); assertAgentSessionId(messageId); assertAgentMessageText(content)
    if (!['complete', 'streaming', 'user-interrupted', 'error-interrupted'].includes(status)) throw new TraceError(ERR.VALIDATION, '消息状态无效')
    return this.serial(() => this.sessions.mutate(sessionId, (session) => {
      const message = session.messages.find((item) => item.id === messageId && item.role === 'assistant')
      if (!message || message.status !== 'streaming') throw new TraceError(ERR.STATE_MACHINE, '该消息生成已结束')
      message.content = content; message.status = status
    }))
  }
}
