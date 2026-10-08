import type { AgentContinuationPreviewInput, AgentOperationBatch, AgentOperationEvent, AgentOutboundPreview, AgentRequestCancelInput, AgentRequestErrorCategory, AgentRequestEvent, AgentRequestIdentity, AgentRequestSendInput } from '../../shared/agent-types'
import { ERR, TraceError } from '../../shared/errors'
import { AgentConversationService } from './agent-conversation-service'
import { AgentProfileService } from './agent-profile-service'
import { streamChatCompletion } from './agent-provider'
import { agentRecord, AGENT_MAX_MESSAGE_LENGTH, assertAgentSessionId } from './agent-session-repository'
import { AgentStreamError } from './agent-sse'
import { createAgentApprovalRequestSnapshot, type AgentOutboundApproval } from './agent-approval-window-service'
import type { AgentOperationService } from './agent-operation-service'

interface ActiveRequest {
  identity: AgentRequestIdentity
  controller: AbortController
  userStopped: boolean
  acceptingText: boolean
  accepted: string
  persisted: string
  persistence: Promise<void>
  errorCategory: AgentRequestErrorCategory | null
}

function requestErrorCategory(error: unknown): AgentRequestErrorCategory | null {
  if (!(error instanceof AgentStreamError)) return null
  if (error.category === 'cancelled') return 'network'
  if (error.category === 'unsupported') return 'protocol'
  return error.category
}



function metadata(payload: unknown, keys: string[]): Record<string, unknown> {
  if (!agentRecord(payload) || Reflect.ownKeys(payload).length !== keys.length || keys.some((key) => !Object.hasOwn(payload, key))) throw new TraceError(ERR.VALIDATION, '请求载荷无效')
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(payload, key)
    if (!descriptor || !('value' in descriptor)) throw new TraceError(ERR.VALIDATION, '请求载荷无效')
    assertAgentSessionId(descriptor.value)
  }
  return payload
}

export class AgentRequestService {
  private readonly active = new Map<string, ActiveRequest>()
  private readonly continuationClaims = new Set<string>()
  private disposed = false
  constructor(
    private readonly conversations: AgentConversationService,
    private readonly profiles: AgentProfileService,
    private readonly emit: (event: AgentRequestEvent) => void,
    private readonly approveOutbound: AgentOutboundApproval = async () => false,
    private readonly operations?: AgentOperationService,
    private readonly emitOperation?: (event: AgentOperationEvent) => void
  ) {}

  async send(payload: unknown): Promise<AgentRequestIdentity> {
    const input = metadata(payload, ['token', 'sessionId']) as unknown as AgentRequestSendInput
    if (this.disposed) throw new TraceError(ERR.STATE_MACHINE, '请求服务已关闭')
    const preview = await this.conversations.consumePreview(input.token)
    if (preview.sessionId !== input.sessionId) throw new TraceError(ERR.CONFLICT, '预览与会话不匹配')
    return this.conversations.dispatchPreview(preview, async (revision, dispatch) => {
      const tools = preview.tools?.length ? { tools: preview.tools, toolChoice: preview.toolChoice ?? 'auto' as const } : undefined
      const snapshot = createAgentApprovalRequestSnapshot(preview.target.endpoint, preview.target.model, preview.messages, tools)
      if (!await this.approveOutbound(snapshot)) throw new TraceError(ERR.CONFIRMATION_REQUIRED, '外发请求未获批准')
      return this.profiles.dispatchAuthorized(preview.target.id, revision, dispatch)
    }, (identity, key) => this.startProvider(identity, preview, key))
  }

  async continueAssistant(sessionId: string, requestId: string): Promise<AgentRequestIdentity> {
    if (this.disposed) throw new TraceError(ERR.STATE_MACHINE, '请求服务已关闭')
    assertAgentSessionId(sessionId); assertAgentSessionId(requestId)
    const release = this.claimContinuation(requestId)
    try {
      const preview = await this.conversations.createContinuationPreview({ sessionId, requestId })
      return await this.dispatchContinuation(preview)
    } finally {
      release()
    }
  }

  async continueAwaitingBatch(payload: unknown): Promise<AgentRequestIdentity> {
    const input = metadata(payload, ['sessionId', 'batchId']) as unknown as AgentContinuationPreviewInput
    if (this.disposed) throw new TraceError(ERR.STATE_MACHINE, '请求服务已关闭')
    const first = await this.readReadyContinuationBatch(input)
    const release = this.claimContinuation(first.requestId)
    let preview: AgentOutboundPreview | undefined
    try {
      const ready = await this.readReadyContinuationBatch(input)
      if (ready.requestId !== first.requestId) throw new TraceError(ERR.CONFLICT, '操作批次来源已变化')
      preview = await this.conversations.createContinuationPreview({ sessionId: input.sessionId, requestId: ready.requestId })
      const current = await this.readReadyContinuationBatch(input)
      if (current.requestId !== ready.requestId || current.sessionRevision !== preview.sessionRevision) {
        throw new TraceError(ERR.CONFLICT, '操作批次或会话已变化，请重新确认')
      }
    } catch (error) {
      if (preview) this.conversations.cancelPreview(preview.token)
      release()
      throw error
    }
    try {
      return await this.dispatchContinuation(preview)
    } finally {
      release()
    }
  }

  private claimContinuation(requestId: string): () => void {
    if (this.active.has(requestId) || this.continuationClaims.has(requestId)) {
      throw new TraceError(ERR.STATE_MACHINE, '该请求的续轮正在确认或生成')
    }
    this.continuationClaims.add(requestId)
    return () => this.continuationClaims.delete(requestId)
  }

  private async readReadyContinuationBatch(input: AgentContinuationPreviewInput): Promise<{ requestId: string; sessionRevision: number }> {
    if (!this.operations) throw new TraceError(ERR.STATE_MACHINE, '计划操作服务不可用')
    const batch = await this.operations.readBatch(input)
    if (batch.status !== 'awaiting-outbound-preview' || batch.operations.length === 0 || batch.operations.some((operation) => operation.status !== 'succeeded')) {
      throw new TraceError(ERR.STATE_MACHINE, '该操作批次尚未具备安全续轮条件')
    }

    const session = await this.conversations.sessions.read(input.sessionId)
    const persistedBatch = session.operationBatches.find((item) => item.id === input.batchId)
    const request = session.requests.find((item) => item.id === batch.requestId)
    if (!persistedBatch || persistedBatch.status !== 'awaiting-outbound-preview' || persistedBatch.requestId !== batch.requestId ||
      persistedBatch.assistantMessageId !== batch.assistantMessageId || persistedBatch.operations.length !== batch.operations.length ||
      persistedBatch.operations.some((operation, index) => operation.callId !== batch.operations[index]?.callId || operation.status !== 'succeeded') || !request) {
      throw new TraceError(ERR.CONFLICT, '操作批次状态已变化')
    }
    if (session.messages.some((message) => message.status === 'streaming')) throw new TraceError(ERR.STATE_MACHINE, '请先停止当前生成')

    const assistantIndex = session.messages.findIndex((message) => message.id === batch.assistantMessageId)
    const assistant = session.messages[assistantIndex]
    const userMessages = session.messages.filter((message) => message.requestId === batch.requestId && message.role === 'user')
    const lastAssistant = [...session.messages].reverse().find((message) => message.role === 'assistant')
    const calls = assistant?.role === 'assistant' ? assistant.toolCalls ?? [] : []
    const callIds = calls.map((call) => call.id)
    if (assistantIndex < 0 || assistant?.role !== 'assistant' || assistant.status !== 'complete' || assistant.requestId !== batch.requestId ||
      !calls.length || lastAssistant?.id !== assistant.id || userMessages.length !== 1 || userMessages[0].id !== batch.userMessageId ||
      userMessages[0].status !== 'complete' || persistedBatch.operations.length !== callIds.length ||
      new Set(callIds).size !== callIds.length || persistedBatch.operations.some((operation, index) => operation.callId !== callIds[index])) {
      throw new TraceError(ERR.STATE_MACHINE, '工具调用与操作收据不完整')
    }

    const results = session.messages.slice(assistantIndex + 1)
    if (results.length !== calls.length || results.some((message, index) => message.role !== 'tool' || message.status !== 'complete' ||
      message.requestId !== batch.requestId || message.toolCallId !== callIds[index])) {
      throw new TraceError(ERR.STATE_MACHINE, '工具结果尚未全部持久化')
    }
    return { requestId: batch.requestId, sessionRevision: session.revision }
  }

  private async dispatchContinuation(preview: AgentOutboundPreview): Promise<AgentRequestIdentity> {
    const approved = await this.conversations.consumePreview(preview.token)
    return this.conversations.dispatchPreview(approved, async (revision, dispatch) => {
      const tools = approved.tools?.length ? { tools: approved.tools, toolChoice: approved.toolChoice ?? 'auto' as const } : undefined
      const snapshot = createAgentApprovalRequestSnapshot(approved.target.endpoint, approved.target.model, approved.messages, tools)
      if (!await this.approveOutbound(snapshot)) throw new TraceError(ERR.CONFIRMATION_REQUIRED, '工具结果外发未获批准')
      return this.profiles.dispatchAuthorized(approved.target.id, revision, dispatch)
    }, (identity, key) => this.startProvider(identity, approved, key))
  }

  private startProvider(identity: AgentRequestIdentity, preview: Awaited<ReturnType<AgentConversationService['consumePreview']>>, key: string): void {
    if (this.disposed) throw new TraceError(ERR.STATE_MACHINE, '请求服务已关闭')
    const active: ActiveRequest = { identity, controller: new AbortController(), userStopped: false, acceptingText: true, accepted: '', persisted: '', persistence: Promise.resolve(), errorCategory: null }
    this.active.set(identity.requestId, active)
    const provider = streamChatCompletion(
      { endpoint: preview.target.endpoint, model: preview.target.model, apiKey: key, messages: preview.messages, signal: active.controller.signal, onText: (text) => this.acceptText(active, text) },
      preview.tools?.length ? { tools: preview.tools, toolChoice: preview.toolChoice ?? 'auto' } : undefined
    )
    void this.finish(active, provider)
  }

  private publish(event: AgentRequestEvent): void {
    if (this.disposed) return
    // A closed renderer cannot turn a persisted delta into a provider/storage failure.
    try { this.emit(event) } catch { /* Window may close between checking and sending. */ }
  }

  private acceptText(active: ActiveRequest, text: string): void {
    if (!text || !active.acceptingText || active.userStopped) return
    if (active.accepted.length + text.length > AGENT_MAX_MESSAGE_LENGTH) {
      active.errorCategory = 'limit'
      active.acceptingText = false
      active.controller.abort()
      throw new AgentStreamError('limit')
    }
    active.accepted += text
    const content = active.accepted
    active.persistence = active.persistence.then(async () => {
      if (active.errorCategory === 'storage') return
      try {
        await this.conversations.settleAssistant(active.identity.sessionId, active.identity.assistantId, content, 'streaming')
        active.persisted = content
        this.publish({ ...active.identity, type: 'delta', text })
      } catch {
        active.errorCategory = 'storage'
        active.acceptingText = false
        active.controller.abort()
      }
    })
  }

  private async finish(active: ActiveRequest, provider: ReturnType<typeof streamChatCompletion>): Promise<void> {
    let toolCalls: Awaited<ReturnType<typeof streamChatCompletion>>['toolCalls'] = []
    try { toolCalls = (await provider).toolCalls } catch (error) {
      if (!active.errorCategory && !active.userStopped) active.errorCategory = requestErrorCategory(error) ?? 'network'
    }
    // Claim finalization synchronously: cancellation cannot be accepted while the
    // already settled provider's incremental or terminal persistence is pending.
    this.active.delete(active.identity.requestId)
    active.acceptingText = false
    await active.persistence
    let status: 'complete' | 'user-interrupted' | 'error-interrupted' = active.errorCategory ? 'error-interrupted' : active.userStopped ? 'user-interrupted' : 'complete'
    try {
      if (status === 'complete' && toolCalls.length && !this.operations) {
        status = 'error-interrupted'
        active.errorCategory = 'protocol'
        await this.conversations.settleAssistant(active.identity.sessionId, active.identity.assistantId, active.persisted, status)
      } else {
        await this.conversations.settleAssistant(active.identity.sessionId, active.identity.assistantId, active.persisted, status, status === 'complete' ? toolCalls : [])
      }
    } catch (error) {
      status = 'error-interrupted'
      active.errorCategory = requestErrorCategory(error) ?? 'storage'
    }
    if (status === 'complete' && toolCalls.length && this.operations) {
      try {
        const batch = await this.operations.prepareBatch(active.identity.sessionId, active.identity.requestId, active.identity.assistantId, toolCalls)
        this.emitOperationBatch(active.identity.sessionId, batch)
        if (batch.status === 'pending-confirmation') {
          this.publish({ ...active.identity, type: 'terminal', status: 'complete', marker: null, errorCategory: null })
          return
        }
        try {
          await this.continueAssistant(active.identity.sessionId, active.identity.requestId)
        } catch {
          this.publish({ ...active.identity, type: 'terminal', status: 'complete', marker: null, errorCategory: null })
        }
        return
      } catch {
        this.publish({ ...active.identity, type: 'terminal', status: 'error-interrupted', marker: '【异常中断】', errorCategory: 'storage' })
        return
      }
    }
    this.publish({ ...active.identity, type: 'terminal', status, marker: status === 'complete' ? null : status === 'user-interrupted' ? '【用户中断】' : '【异常中断】', errorCategory: active.errorCategory })
  }

  emitOperationBatch(sessionId: string, batch: AgentOperationBatch): void {
    if (this.disposed || !this.emitOperation) return
    try { this.emitOperation({ sessionId, requestId: batch.requestId, batchId: batch.id, status: batch.status }) } catch { /* Renderer may close between persistence and event delivery. */ }
  }

  async cancel(payload: unknown): Promise<null> {
    const input = metadata(payload, ['sessionId', 'requestId']) as unknown as AgentRequestCancelInput
    const active = this.active.get(input.requestId)
    if (!active || active.identity.sessionId !== input.sessionId || active.errorCategory) throw new TraceError(ERR.STATE_MACHINE, '当前请求不存在')
    active.userStopped = true
    active.acceptingText = false
    active.controller.abort()
    return null
  }

  dispose(): void {
    this.disposed = true
    for (const active of this.active.values()) {
      active.acceptingText = false
      active.errorCategory ??= 'network'
      active.controller.abort()
    }
  }
}
