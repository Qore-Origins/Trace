import type { AgentRequestCancelInput, AgentRequestErrorCategory, AgentRequestEvent, AgentRequestIdentity, AgentRequestSendInput } from '../../shared/agent-types'
import { ERR, TraceError } from '../../shared/errors'
import { AgentConversationService } from './agent-conversation-service'
import { AgentProfileService } from './agent-profile-service'
import { streamChatCompletion } from './agent-provider'
import { agentRecord, AGENT_MAX_MESSAGE_LENGTH, assertAgentSessionId } from './agent-session-repository'
import { AgentStreamError } from './agent-sse'
import { createAgentApprovalRequestSnapshot, type AgentOutboundApproval } from './agent-approval-window-service'

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
  private disposed = false
  constructor(
    private readonly conversations: AgentConversationService,
    private readonly profiles: AgentProfileService,
    private readonly emit: (event: AgentRequestEvent) => void,
    private readonly approveOutbound: AgentOutboundApproval = async () => false
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
    }, (identity, key) => {
      if (this.disposed) throw new TraceError(ERR.STATE_MACHINE, '请求服务已关闭')
      const active: ActiveRequest = { identity, controller: new AbortController(), userStopped: false, acceptingText: true, accepted: '', persisted: '', persistence: Promise.resolve(), errorCategory: null }
      this.active.set(identity.requestId, active)
      // Calling the adapter starts fetch synchronously before the authorization locks release.
      const provider = streamChatCompletion(
        { endpoint: preview.target.endpoint, model: preview.target.model, apiKey: key, messages: preview.messages, signal: active.controller.signal, onText: (text) => this.acceptText(active, text) },
        preview.tools?.length ? { tools: preview.tools, toolChoice: preview.toolChoice ?? 'auto' } : undefined
      )
      void this.finish(active, provider)
    })
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
      await this.conversations.settleAssistant(active.identity.sessionId, active.identity.assistantId, active.persisted, status, status === 'complete' ? toolCalls : [])
    } catch (error) {
      status = 'error-interrupted'
      active.errorCategory = requestErrorCategory(error) ?? 'storage'
    }
    this.publish({ ...active.identity, type: 'terminal', status, marker: status === 'complete' ? null : status === 'user-interrupted' ? '【用户中断】' : '【异常中断】', errorCategory: active.errorCategory })
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
