import { randomUUID } from 'node:crypto'
import { AGENT_MAX_TOOL_CALLS_PER_REQUEST, AGENT_MAX_TOOL_ROUNDS_PER_REQUEST, type AgentChatToolCall, type AgentCompletedToolCall, type AgentHistoryItem, type AgentMessage, type AgentMessageStatus, type AgentOutboundPreview, type AgentPreviewInput, type AgentPreviewMessage, type AgentProfile, type AgentSession, type AgentSessionInput, type AgentSessionSummary, type AgentTarget, type AgentTargetGrant, type AgentRequestIdentity, type AgentCapabilityStatus } from '../../shared/agent-types'
import { ERR, TraceError } from '../../shared/errors'
import { AgentContextService, parseContextSelection } from './agent-context-service'
import { AGENT_MAX_MESSAGE_LENGTH, AgentSessionRepository, agentRecord, assertAgentMessageText, assertAgentSessionId, parseSessionInput } from './agent-session-repository'
import { serializeAgentChatRequest } from './agent-provider'
import { AgentStreamError } from './agent-sse'
import type { AgentProviderTool } from './agent-provider'
import type { AgentTargetService } from './agent-target-service'

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
  const grantSetId = value.targetGrantSetId
  const targetRefs = value.targetRefs ?? []
  if (grantSetId !== undefined && (typeof grantSetId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(grantSetId))) throw new TraceError(ERR.VALIDATION, '计划操作目标无效')
  if (!Array.isArray(targetRefs) || targetRefs.length > MAX_CONTEXT_SELECTIONS || targetRefs.some((ref) => typeof ref !== 'string' || !ref || ref.length > 128) || new Set(targetRefs).size !== targetRefs.length || (targetRefs.length > 0) !== (typeof grantSetId === 'string')) throw new TraceError(ERR.VALIDATION, '计划操作目标无效')
  return { sessionId: value.sessionId, message: value.message, selections, includeHistory: value.includeHistory ?? true, includePartialMessageIds: partials as string[], ...(typeof grantSetId === 'string' ? { targetGrantSetId: grantSetId } : {}), targetRefs: targetRefs as string[] }
}
function history(session: AgentSession, input: AgentPreviewInput): AgentHistoryItem[] {
  const selected = new Set(input.includePartialMessageIds)
  for (const id of selected) {
    if (!session.messages.some((item) => item.id === id && item.role === 'assistant' && (item.status === 'user-interrupted' || item.status === 'error-interrupted'))) throw new TraceError(ERR.VALIDATION, '历史消息选择无效')
  }
  if (!input.includeHistory) return []
  const savedResults = new Set(session.messages.filter((message) => message.role === 'tool' && message.toolCallId).map((message) => `${message.requestId}:${message.toolCallId}`))
  const completedCallIds = new Set<string>()
  for (const message of session.messages) {
    if (message.role === 'assistant' && message.toolCalls?.length && message.toolCalls.every((call) => savedResults.has(`${message.requestId}:${call.id}`))) {
      for (const call of message.toolCalls) completedCallIds.add(`${message.requestId}:${call.id}`)
    }
  }
  return session.messages.flatMap((message): AgentHistoryItem[] => {
    let text: AgentHistoryItem
    if (message.role === 'tool') {
      if (!message.toolCallId || !completedCallIds.has(`${message.requestId}:${message.toolCallId}`)) return []
      text = { messageId: message.id, kind: 'message', role: 'tool', content: message.content, tool_call_id: message.toolCallId }
    } else if (message.role === 'assistant' && message.toolCalls?.length) {
      // Do not replay an incomplete historical tool transaction; old Phase 1 sessions have no tool fields.
      if (message.toolCalls.some((call) => !completedCallIds.has(`${message.requestId}:${call.id}`))) return []
      text = { messageId: message.id, kind: 'message', role: 'assistant', content: message.content || null, tool_calls: message.toolCalls }
    } else {
      text = { messageId: message.id, kind: 'message', role: message.role, content: message.content }
    }
    if (message.status === 'complete') return [text]
    if (message.role !== 'assistant') return []
    const marker: AgentHistoryItem = { messageId: message.id, kind: 'interruption', role: 'system', content: message.status === 'user-interrupted' ? '【用户中断】' : '【异常中断】' }
    return selected.has(message.id) ? [text, marker] : [marker]
  })
}

function chatCall(call: AgentCompletedToolCall): AgentChatToolCall {
  return { id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } }
}

function previewMessage(item: AgentHistoryItem) {
  if (item.role === 'assistant') return { role: 'assistant' as const, content: item.content, ...(item.tool_calls ? { tool_calls: item.tool_calls } : {}) }
  if (item.role === 'tool') return { role: 'tool' as const, content: item.content, tool_call_id: item.tool_call_id }
  return { role: item.role, content: item.content }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}

export class AgentConversationService {
  private readonly previews = new Map<string, AgentOutboundPreview>()
  private readonly approved = new WeakSet<AgentOutboundPreview>()
  private readonly credentialRevisions = new WeakMap<AgentOutboundPreview, number>()
  private readonly capabilityStatuses = new WeakMap<AgentOutboundPreview, AgentCapabilityStatus>()
  private readonly userMessageIds = new WeakMap<AgentOutboundPreview, string>()
  private readonly grantSetIds = new WeakMap<AgentOutboundPreview, string>()
  private readonly continuationRequestIds = new WeakMap<AgentOutboundPreview, string>()
  private readonly requestTargetAuthorizations = new Map<string, { setId: string; refs: string[] }>()
  private readonly requestBaseSnapshots = new Map<string, {
    messages: AgentOutboundPreview['messages']
    history: AgentOutboundPreview['history']
    contexts: AgentOutboundPreview['contexts']
    target: AgentOutboundPreview['target']
    message: string
    tools?: AgentOutboundPreview['tools']
    toolChoice?: AgentOutboundPreview['toolChoice']
    userMessageId: string
  }>()
  private queue = Promise.resolve()
  private readonly now: () => number
  private readonly credentialRevision: (id: string) => Promise<number>
  constructor(readonly sessions: AgentSessionRepository, readonly contexts: AgentContextService, private readonly resolveProfile: ResolveProfile, options: { now?: () => number; credentialRevision?: (id: string) => Promise<number>; targets?: AgentTargetService; tools?: () => readonly AgentProviderTool[] } = {}) {
    this.now = options.now ?? Date.now
    this.credentialRevision = options.credentialRevision ?? (async () => 0)
    this.targets = options.targets
    this.toolDefinitions = options.tools ?? (() => [])
  }
  private readonly targets?: AgentTargetService
  private readonly toolDefinitions: () => readonly AgentProviderTool[]
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
      const profile = await this.profile(session.profileId)
      const currentTarget = target(profile)
      const credentialRevision = await this.credentialRevision(session.profileId)
      const resolved = await Promise.all(input.selections.map((selection) => this.contexts.readResolved(selection)))
      if (new Set(resolved.map((item) => item.sourceIdentity)).size !== resolved.length) throw new TraceError(ERR.VALIDATION, '上下文条目重复')
      const contexts = resolved.map((item) => item.entry)
      const items = history(session, input)
      let targets: AgentTargetGrant[] = []
      if (input.targetGrantSetId && input.targetRefs?.length) {
        if (!this.targets) throw new TraceError(ERR.STATE_MACHINE, '计划操作服务不可用')
        targets = await Promise.all(input.targetRefs.map((ref) => this.targets!.validate({ setId: input.targetGrantSetId!, ref })))
      }
      const tools = profile.capability.status === 'passed' ? structuredClone([...this.toolDefinitions()]) : []
      const toolChoice = tools.length > 0 ? 'auto' as const : undefined
      const messages = [
        ...items.map(previewMessage),
        ...contexts.map((item) => ({ role: 'system' as const, content: `用户授权上下文（${item.kind}：${item.path}，版本 ${item.version}）：\n${item.content}` })),
        ...(targets.length ? [{ role: 'system' as const, content: `用户本轮明确授权的计划操作目标（仅允许通过目标引用进行读取）：\n${targets.map((item) => `${item.kind} ref=${item.ref} 名称=${item.name}`).join('\n')}` }] : []),
        { role: 'user' as const, content: input.message }
      ]
      try { serializeAgentChatRequest(currentTarget.model, messages, toolChoice ? { tools, toolChoice } : undefined) } catch (error) {
        if (error instanceof AgentStreamError && error.category === 'limit') throw new TraceError(ERR.VALIDATION, '本次外发内容过长，请减少历史或上下文')
        throw error
      }
      const preview: AgentOutboundPreview = deepFreeze({ token: randomUUID(), sessionId: session.id, sessionRevision: session.revision, expiresAt: new Date(this.now() + AGENT_PREVIEW_TTL_MS).toISOString(), target: currentTarget, message: input.message, history: items, contexts, messages, ...(toolChoice ? { tools, toolChoice } : {}), ...(targets.length ? { targets } : {}) })
      for (const [token, item] of this.previews) if (Date.parse(item.expiresAt) <= this.now()) this.previews.delete(token)
      if (this.previews.size >= MAX_PREVIEWS) throw new TraceError(ERR.STATE_MACHINE, '待确认预览过多，请先取消旧预览')
      this.previews.set(preview.token, preview)
      this.credentialRevisions.set(preview, credentialRevision)
      this.capabilityStatuses.set(preview, profile.capability.status)
      this.userMessageIds.set(preview, randomUUID())
      if (input.targetGrantSetId) this.grantSetIds.set(preview, input.targetGrantSetId)
      return structuredClone(preview)
    })
  }
  /** Main-only provenance used by the operation executor; never accepts renderer/provider IDs. */
  async getRequestOperationContext(sessionId: string, requestId: string): Promise<{ userMessageId: string; targetSetId?: string; targetRefs: string[] }> {
    assertAgentSessionId(sessionId); assertAgentSessionId(requestId)
    const session = await this.sessions.read(sessionId)
    if (!session.requests.some((request) => request.id === requestId)) throw new TraceError(ERR.PATH_NOT_FOUND, '请求溯源记录不存在')
    const users = session.messages.filter((message) => message.requestId === requestId && message.role === 'user' && message.status === 'complete')
    if (users.length !== 1) throw new TraceError(ERR.STATE_MACHINE, '当前请求缺少唯一的已提交用户消息')
    const authorization = this.requestTargetAuthorizations.get(requestId)
    return { userMessageId: users[0].id, ...(authorization ? { targetSetId: authorization.setId } : {}), targetRefs: authorization ? [...authorization.refs] : [] }
  }
  /** Build a fresh exact provider snapshot after operation receipts; does not create a new user turn. */
  createContinuationPreview(payload: unknown): Promise<AgentOutboundPreview> {
    return this.serial(async () => {
      if (!agentRecord(payload) || Reflect.ownKeys(payload).length !== 2 || typeof payload.sessionId !== 'string' || typeof payload.requestId !== 'string') {
        throw new TraceError(ERR.VALIDATION, '续轮预览无效')
      }
      assertAgentSessionId(payload.sessionId); assertAgentSessionId(payload.requestId)
      const session = await this.sessions.read(payload.sessionId)
      if (session.messages.some((item) => item.status === 'streaming')) throw new TraceError(ERR.STATE_MACHINE, '请先停止当前生成')
      const request = session.requests.find((item) => item.id === payload.requestId)
      const base = this.requestBaseSnapshots.get(payload.requestId)
      if (!request || !base) throw new TraceError(ERR.STATE_MACHINE, '该请求不能在当前进程中继续')
      const profile = await this.profile(session.profileId)
      if (profile.capability.status !== 'passed') throw new TraceError(ERR.CONFIRMATION_REQUIRED, '模型能力未通过测试，不能继续计划操作')
      const tail: AgentPreviewMessage[] = []
      for (const message of session.messages) {
        if (message.requestId !== payload.requestId || message.role === 'user') continue
        if (message.role === 'assistant') {
          tail.push({ role: 'assistant', content: message.content || null, ...(message.toolCalls?.length ? { tool_calls: message.toolCalls } : {}) })
        } else {
          tail.push({ role: 'tool', content: message.content, tool_call_id: message.toolCallId! })
        }
      }
      const messages = [...structuredClone(base.messages), ...tail]
      const credentialRevision = await this.credentialRevision(session.profileId)
      const toolDefinitions = profile.capability.status === 'passed' ? structuredClone([...this.toolDefinitions()]) : []
      const toolChoice = toolDefinitions.length ? 'auto' as const : undefined
      try { serializeAgentChatRequest(profile.model, messages, toolChoice ? { tools: toolDefinitions, toolChoice } : undefined) } catch (error) {
        if (error instanceof AgentStreamError && error.category === 'limit') throw new TraceError(ERR.VALIDATION, '本次续轮内容过长，请减少会话历史')
        throw error
      }
      const preview: AgentOutboundPreview = deepFreeze({
        token: randomUUID(), sessionId: session.id, sessionRevision: session.revision,
        expiresAt: new Date(this.now() + AGENT_PREVIEW_TTL_MS).toISOString(), target: target(profile),
        message: base.message, history: [...structuredClone(base.history), ...tail.map((item, index) => ({
          messageId: session.messages.filter((message) => message.requestId === payload.requestId && message.role !== 'user')[index]?.id ?? randomUUID(),
          kind: 'message' as const, ...item
        }))], contexts: structuredClone(base.contexts), messages,
        ...(toolChoice ? { tools: toolDefinitions, toolChoice } : {})
      })
      for (const [token, item] of this.previews) if (Date.parse(item.expiresAt) <= this.now()) this.previews.delete(token)
      if (this.previews.size >= MAX_PREVIEWS) throw new TraceError(ERR.STATE_MACHINE, '待确认预览过多，请先取消旧预览')
      this.previews.set(preview.token, preview)
      this.credentialRevisions.set(preview, credentialRevision)
      this.capabilityStatuses.set(preview, profile.capability.status)
      this.grantSetIds.set(preview, '')
      this.continuationRequestIds.set(preview, payload.requestId)
      return structuredClone(preview)
    })
  }
  cancelPreview(token: unknown): void { assertAgentSessionId(token); this.previews.delete(token) }
  private async verifySnapshot(preview: AgentOutboundPreview, currentProfile?: AgentProfile, revision = preview.sessionRevision): Promise<void> {
    if (Date.parse(preview.expiresAt) <= this.now()) throw new TraceError(ERR.CONFLICT, '预览已过期，请重新预览')
    const session = await this.sessions.read(preview.sessionId)
    const profile = currentProfile ?? await this.profile(session.profileId)
    if (session.revision !== revision || session.profileId !== preview.target.id || JSON.stringify(target(profile)) !== JSON.stringify(preview.target) || profile.capability.status !== this.capabilityStatuses.get(preview)) throw new TraceError(ERR.CONFLICT, '会话或模型配置已变化，请重新预览')
    if (!currentProfile && await this.credentialRevision(session.profileId) !== this.credentialRevisions.get(preview)) throw new TraceError(ERR.CONFLICT, '模型服务配置已变化，请重新预览')
    for (const source of preview.contexts) {
      let current
      try { current = await this.contexts.read(source) } catch { throw new TraceError(ERR.CONFLICT, '上下文条目已变化，请重新预览') }
      if (current.libraryId !== source.libraryId || current.version !== source.version || current.updatedAt !== source.updatedAt) throw new TraceError(ERR.CONFLICT, '上下文条目已变化，请重新预览')
    }
    if (preview.targets?.length) {
      const setId = this.grantSetIds.get(preview)
      if (!this.targets || !setId) throw new TraceError(ERR.CONFLICT, '计划操作授权已失效，请重新预览')
      for (const item of preview.targets) {
        let current: AgentTargetGrant
        try { current = await this.targets.validate({ setId, ref: item.ref }) } catch { throw new TraceError(ERR.CONFLICT, '计划操作目标已变化，请重新选择') }
        if (JSON.stringify(current) !== JSON.stringify(item)) throw new TraceError(ERR.CONFLICT, '计划操作目标已变化，请重新选择')
      }
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
      const { requestId, assistantId } = await this.createTurn(preview)
      return { requestId, assistantId }
    })
  }
  private async createTurn(preview: AgentOutboundPreview): Promise<{ requestId: string; assistantId: string; userMessage: AgentMessage }> {
    const requestId = randomUUID(), assistantId = randomUUID(), requestedAt = new Date(this.now()).toISOString()
    const userMessageId = this.userMessageIds.get(preview)
    if (!userMessageId) throw new TraceError(ERR.CONFIRMATION_REQUIRED, '预览授权不完整，请重新预览')
    const userMessage: AgentMessage = { id: userMessageId, role: 'user', content: preview.message, status: 'complete', createdAt: requestedAt, requestId }
    const session = await this.sessions.mutate(preview.sessionId, (session) => {
      if (session.revision !== preview.sessionRevision || session.messages.some((item) => item.status === 'streaming')) throw new TraceError(ERR.CONFLICT, '会话已变化，请重新预览')
      session.requests.push({ id: requestId, profileId: preview.target.id, profileName: preview.target.name, presetId: preview.target.presetId, model: preview.target.model, requestedAt, sources: preview.contexts.map(({ content: _content, ...source }) => source), toolRounds: 0, toolCallCount: 0 })
      session.messages.push(userMessage, { id: assistantId, role: 'assistant', content: '', status: 'streaming', createdAt: requestedAt, requestId })
    })
    const persistedUserMessage = session.messages.find((message) => message.id === userMessageId)
    if (!persistedUserMessage || persistedUserMessage.role !== 'user' || persistedUserMessage.status !== 'complete') throw new TraceError(ERR.SAVE_FAILED, '用户消息未能完整保存')
    return { requestId, assistantId, userMessage: persistedUserMessage }
  }
  /** Main-only continuation seam: retain the committed user-message identity for retries and tool rounds. */
  beginAssistantContinuation(sessionId: string, requestId: string): Promise<{ assistantId: string; userMessageId: string; toolRounds: number; toolCallCount: number; toolsAllowed: boolean }> {
    assertAgentSessionId(sessionId); assertAgentSessionId(requestId)
    return this.serial(() => this.beginAssistantContinuationNow(sessionId, requestId))
  }

  private async beginAssistantContinuationNow(sessionId: string, requestId: string): Promise<{ assistantId: string; userMessageId: string; toolRounds: number; toolCallCount: number; toolsAllowed: boolean }> {
    let continuation: { assistantId: string; userMessageId: string; toolRounds: number; toolCallCount: number; toolsAllowed: boolean } | undefined
    await this.sessions.mutate(sessionId, (session) => {
      const request = session.requests.find((item) => item.id === requestId)
      const userMessages = session.messages.filter((message) => message.requestId === requestId && message.role === 'user')
      if (!request || userMessages.length !== 1 || userMessages[0].status !== 'complete' || session.messages.some((message) => message.status === 'streaming')) throw new TraceError(ERR.STATE_MACHINE, '当前请求无法继续')
      const requestCalls = session.messages.filter((message) => message.requestId === requestId && message.role === 'assistant' && message.toolCalls?.length)
      const results = new Set(session.messages.filter((message) => message.requestId === requestId && message.role === 'tool').map((message) => message.toolCallId))
      if (requestCalls.some((message) => message.toolCalls?.some((call) => !results.has(call.id)))) throw new TraceError(ERR.STATE_MACHINE, '工具结果尚未全部持久化')
      const toolRounds = request.toolRounds ?? 0, toolCallCount = request.toolCallCount ?? 0
      if (toolRounds >= AGENT_MAX_TOOL_ROUNDS_PER_REQUEST || toolCallCount >= AGENT_MAX_TOOL_CALLS_PER_REQUEST) throw new AgentStreamError('limit')
      const assistantId = randomUUID()
      session.messages.push({ id: assistantId, requestId, role: 'assistant', content: '', status: 'streaming', createdAt: new Date(this.now()).toISOString() })
      continuation = { assistantId, userMessageId: userMessages[0].id, toolRounds, toolCallCount, toolsAllowed: toolRounds < AGENT_MAX_TOOL_ROUNDS_PER_REQUEST && toolCallCount < AGENT_MAX_TOOL_CALLS_PER_REQUEST }
    })
    if (!continuation) throw new TraceError(ERR.STATE_MACHINE, '当前请求无法继续')
    return continuation
  }
  // Keep session update/delete serialized through the actual network dispatch. Profile
  // mutations are held by authorize while the last source/session reads run.
  dispatchPreview(preview: AgentOutboundPreview, authorize: (revision: number, dispatch: (profile: AgentProfile, key: string) => Promise<AgentRequestIdentity>) => Promise<AgentRequestIdentity>, start: (identity: AgentRequestIdentity, key: string) => void): Promise<AgentRequestIdentity> {
    return this.serial(async () => {
      if (!this.approved.has(preview)) throw new TraceError(ERR.CONFIRMATION_REQUIRED, '请先确认外发预览')
      this.approved.delete(preview)
      await this.verifySnapshot(preview)
      return authorize(this.credentialRevisions.get(preview)!, async (profile, key) => {
        await this.verifySnapshot(preview, profile)
        const continuationRequestId = this.continuationRequestIds.get(preview)
        const turn = continuationRequestId
          ? await this.beginAssistantContinuationNow(preview.sessionId, continuationRequestId)
          : await this.createTurn(preview)
        const isContinuation = 'userMessageId' in turn
        const identity: AgentRequestIdentity = isContinuation
          ? { sessionId: preview.sessionId, requestId: continuationRequestId!, assistantId: turn.assistantId }
          : { sessionId: preview.sessionId, requestId: turn.requestId, assistantId: turn.assistantId }
        try {
          const grantSetId = this.grantSetIds.get(preview)
          if (grantSetId && !isContinuation) {
            if (!this.targets) throw new TraceError(ERR.CONFLICT, '计划操作授权已失效，请重新选择')
            const confirmedRefs = preview.targets?.map((item) => item.ref) ?? []
            if (!('userMessage' in turn)) throw new TraceError(ERR.INTERNAL, '用户消息身份无效')
            await this.targets.bindGrantSetToUserMessage(grantSetId, turn.userMessage, confirmedRefs)
            this.requestTargetAuthorizations.set(identity.requestId, { setId: grantSetId, refs: [...confirmedRefs] })
          }
          const userMessageId = isContinuation ? turn.userMessageId : turn.userMessage.id
          if (!isContinuation) this.requestBaseSnapshots.set(identity.requestId, {
            messages: structuredClone(preview.messages), history: structuredClone(preview.history),
            contexts: structuredClone(preview.contexts), target: structuredClone(preview.target),
            message: preview.message, ...(preview.tools ? { tools: structuredClone(preview.tools) } : {}),
            ...(preview.toolChoice ? { toolChoice: preview.toolChoice } : {}), userMessageId
          })
          await this.verifySnapshot(preview, profile, preview.sessionRevision + 1)
          start(identity, key)
          return identity
        } catch (error) {
          await this.sessions.mutate(preview.sessionId, (session) => {
            const message = session.messages.find((item) => item.id === turn.assistantId)
            if (message?.status === 'streaming') message.status = 'error-interrupted'
          })
          throw error
        }
      })
    })
  }
  // Incremental persistence and final status belong to main; no public mutation IPC exists.
  settleAssistant(sessionId: string, messageId: string, content: string, status: AgentMessageStatus, toolCalls: readonly AgentCompletedToolCall[] = []): Promise<AgentSession> {
    assertAgentSessionId(sessionId); assertAgentSessionId(messageId); assertAgentMessageText(content)
    if (!['complete', 'streaming', 'user-interrupted', 'error-interrupted'].includes(status)) throw new TraceError(ERR.VALIDATION, '消息状态无效')
    if (toolCalls.length > AGENT_MAX_TOOL_CALLS_PER_REQUEST || toolCalls.some((call) => !call || typeof call.id !== 'string' || typeof call.name !== 'string' || !agentRecord(call.arguments))) throw new TraceError(ERR.VALIDATION, '工具调用结果无效')
    return this.serial(() => this.sessions.mutate(sessionId, (session) => {
      const message = session.messages.find((item) => item.id === messageId && item.role === 'assistant')
      if (!message || message.status !== 'streaming') throw new TraceError(ERR.STATE_MACHINE, '该消息生成已结束')
      if (toolCalls.length > 0) {
        if (status !== 'complete') throw new TraceError(ERR.STATE_MACHINE, '未完成的工具调用不能保存为可执行状态')
        const request = session.requests.find((item) => item.id === message.requestId)
        if (!request) throw new TraceError(ERR.FORMAT_INVALID, '请求溯源记录不存在')
        const nextRounds = (request.toolRounds ?? 0) + 1
        const nextCalls = (request.toolCallCount ?? 0) + toolCalls.length
        if (nextRounds > AGENT_MAX_TOOL_ROUNDS_PER_REQUEST || nextCalls > AGENT_MAX_TOOL_CALLS_PER_REQUEST) throw new AgentStreamError('limit')
        request.toolRounds = nextRounds; request.toolCallCount = nextCalls
        message.toolCalls = toolCalls.map(chatCall)
      }
      message.content = content; message.status = status
    }))
  }

  appendToolResults(sessionId: string, assistantId: string, results: readonly { toolCallId: string; content: string }[]): Promise<AgentSession> {
    assertAgentSessionId(sessionId); assertAgentSessionId(assistantId)
    if (!results.length || results.length > AGENT_MAX_TOOL_CALLS_PER_REQUEST || results.some((result) => typeof result.toolCallId !== 'string' || !result.toolCallId || typeof result.content !== 'string' || result.content.length > AGENT_MAX_MESSAGE_LENGTH) || new Set(results.map((result) => result.toolCallId)).size !== results.length) throw new TraceError(ERR.VALIDATION, '工具结果无效')
    return this.serial(() => this.sessions.mutate(sessionId, (session) => {
      const assistant = session.messages.find((message) => message.id === assistantId && message.role === 'assistant')
      if (!assistant?.toolCalls?.length || assistant.status !== 'complete') throw new TraceError(ERR.STATE_MACHINE, '没有可关联的已完成工具调用')
      const callIds = new Set(assistant.toolCalls.map((call) => call.id))
      const savedResultIds = new Set(session.messages.filter((message) => message.role === 'tool' && message.requestId === assistant.requestId).map((message) => message.toolCallId))
      if (results.some((result) => !callIds.has(result.toolCallId) || savedResultIds.has(result.toolCallId))) throw new TraceError(ERR.VALIDATION, '工具结果与调用不匹配')
      if (results.length !== assistant.toolCalls.length || results.some((result, index) => result.toolCallId !== assistant.toolCalls?.[index]?.id)) throw new TraceError(ERR.VALIDATION, '工具结果必须完整并按调用顺序提供')
      const createdAt = new Date(this.now()).toISOString()
      for (const result of results) session.messages.push({ id: randomUUID(), role: 'tool', toolCallId: result.toolCallId, content: result.content, status: 'complete', createdAt, requestId: assistant.requestId })
    }))
  }
}
