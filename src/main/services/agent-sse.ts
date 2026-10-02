export const AGENT_SSE_EVENT_LIMIT_BYTES = 64 * 1024
export const AGENT_SSE_RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024

export class AgentStreamError extends Error {
  constructor(readonly category: 'validation' | 'authentication' | 'http' | 'protocol' | 'limit' | 'timeout' | 'cancelled' | 'network') {
    super(`模型服务请求失败：${category}`)
    this.name = 'AgentStreamError'
  }
}

export interface AgentToolCall { id: string; name: string; arguments: unknown }
export interface AgentStreamResult { text: string; toolCalls: AgentToolCall[] }

interface PendingCall { id: string; type: string; name: string; arguments: string }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export class AgentSseAccumulator {
  private buffer = ''
  private bytes = 0
  private done = false
  private finished = false
  private finishReason: string | null = null
  private messageId: string | null = null
  private text = ''
  private calls = new Map<number, PendingCall>()

  constructor(private readonly onText?: (text: string) => void) {}

  push(fragment: string, byteLength: number): void {
    this.bytes += byteLength
    if (this.bytes > AGENT_SSE_RESPONSE_LIMIT_BYTES) throw new AgentStreamError('limit')
    if (this.done && fragment.trim()) throw new AgentStreamError('protocol')
    this.buffer += fragment
    let boundary = this.buffer.search(/\r?\n\r?\n/)
    while (boundary >= 0) {
      const separator = this.buffer.match(/\r?\n\r?\n/)?.[0] ?? '\n\n'
      const event = this.buffer.slice(0, boundary)
      if (Buffer.byteLength(event, 'utf8') > AGENT_SSE_EVENT_LIMIT_BYTES) throw new AgentStreamError('limit')
      this.buffer = this.buffer.slice(boundary + separator.length)
      if (event.trim()) this.process(event)
      boundary = this.buffer.search(/\r?\n\r?\n/)
    }
    if (Buffer.byteLength(this.buffer, 'utf8') > AGENT_SSE_EVENT_LIMIT_BYTES) throw new AgentStreamError('limit')
  }

  private process(event: string): void {
    if (this.done) throw new AgentStreamError('protocol')
    const data = event.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
    if (!data) return
    if (data === '[DONE]') { this.done = true; return }
    if (this.finished) throw new AgentStreamError('protocol')
    let parsed: unknown
    try { parsed = JSON.parse(data) } catch { throw new AgentStreamError('protocol') }
    if (!record(parsed) || !Array.isArray(parsed.choices) || parsed.choices.length !== 1) throw new AgentStreamError('protocol')
    if (parsed.id !== undefined) {
      if (typeof parsed.id !== 'string' || !parsed.id) throw new AgentStreamError('protocol')
      if (this.messageId !== null && parsed.id !== this.messageId) throw new AgentStreamError('protocol')
      this.messageId = parsed.id
    }
    const choice: unknown = parsed.choices[0]
    if (!record(choice) || !record(choice.delta)) throw new AgentStreamError('protocol')
    if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
      if (typeof choice.finish_reason !== 'string' || this.finished) throw new AgentStreamError('protocol')
      this.finishReason = choice.finish_reason
      this.finished = true
    }
    if (choice.delta.content !== undefined && choice.delta.content !== null) {
      if (typeof choice.delta.content !== 'string') throw new AgentStreamError('protocol')
      this.text += choice.delta.content
      this.onText?.(choice.delta.content)
    }
    if (choice.delta.tool_calls === undefined) return
    if (!Array.isArray(choice.delta.tool_calls)) throw new AgentStreamError('protocol')
    for (const value of choice.delta.tool_calls) {
      if (!record(value) || !Number.isSafeInteger(value.index) || (value.index as number) < 0 || (value.index as number) > 63) throw new AgentStreamError('protocol')
      const index = value.index as number
      const pending = this.calls.get(index) ?? { id: '', type: '', name: '', arguments: '' }
      if (value.id !== undefined) {
        if (typeof value.id !== 'string') throw new AgentStreamError('protocol')
        pending.id += value.id
      }
      if (value.type !== undefined) {
        if (typeof value.type !== 'string') throw new AgentStreamError('protocol')
        pending.type += value.type
      }
      if (value.function !== undefined) {
        if (!record(value.function)) throw new AgentStreamError('protocol')
        if (value.function.name !== undefined) {
          if (typeof value.function.name !== 'string') throw new AgentStreamError('protocol')
          pending.name += value.function.name
        }
        if (value.function.arguments !== undefined) {
          if (typeof value.function.arguments !== 'string') throw new AgentStreamError('protocol')
          pending.arguments += value.function.arguments
        }
      }
      this.calls.set(index, pending)
    }
  }

  complete(allowTools: boolean): AgentStreamResult {
    if (!this.done || !this.finished || this.buffer.trim()) throw new AgentStreamError('protocol')
    if (this.calls.size && (!allowTools || this.finishReason !== 'tool_calls')) throw new AgentStreamError('protocol')
    if (!this.calls.size && this.finishReason !== 'stop') throw new AgentStreamError('protocol')
    const toolCalls: AgentToolCall[] = []
    for (const [index, pending] of [...this.calls].sort(([a], [b]) => a - b)) {
      if (index !== toolCalls.length || !pending.id || pending.type !== 'function' || !pending.name || !pending.arguments) throw new AgentStreamError('protocol')
      let args: unknown
      try { args = JSON.parse(pending.arguments) } catch { throw new AgentStreamError('protocol') }
      if (!record(args)) throw new AgentStreamError('protocol')
      toolCalls.push({ id: pending.id, name: pending.name, arguments: args })
    }
    return { text: this.text, toolCalls }
  }
}
