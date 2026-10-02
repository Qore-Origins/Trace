import { AgentSseAccumulator, AgentStreamError, type AgentStreamResult } from './agent-sse'

export const AGENT_REQUEST_TIMEOUT_MS = 60_000
export const AGENT_REQUEST_TIMEOUT_MAX_MS = 180_000
export const AGENT_REQUEST_BODY_LIMIT_BYTES = 256 * 1024

export interface AgentChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface AgentProviderInput {
  endpoint: string
  model: string
  apiKey: string
  messages: readonly AgentChatMessage[]
  signal?: AbortSignal
  onText?: (text: string) => void
  timeoutMs?: number
}

export interface AgentProviderTool {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export function serializeAgentChatRequest(model: string, messages: readonly AgentChatMessage[], options?: { tools: readonly AgentProviderTool[]; toolChoice: string }): string {
  const body: Record<string, unknown> = { model, messages, stream: true }
  if (options) {
    body.tools = options.tools
    body.tool_choice = { type: 'function', function: { name: options.toolChoice } }
  }
  const serialized = JSON.stringify(body)
  if (Buffer.byteLength(serialized, 'utf8') > AGENT_REQUEST_BODY_LIMIT_BYTES) throw new AgentStreamError('limit')
  return serialized
}

function completionUrl(endpoint: string): URL {
  if (typeof endpoint !== 'string' || endpoint.length > 2048 || endpoint.trim() !== endpoint) throw new AgentStreamError('validation')
  let url: URL
  try { url = new URL(endpoint) } catch { throw new AgentStreamError('validation') }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  if (!hostname || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash) throw new AgentStreamError('validation')
  const path = url.pathname.replace(/\/$/, '')
  url.pathname = path.endsWith('/chat/completions') ? path : `${path}/chat/completions`
  return url
}

function validateInput(input: AgentProviderInput, tools?: readonly AgentProviderTool[]): void {
  if (!input || typeof input.model !== 'string' || !input.model.trim() || input.model.length > 160 || typeof input.apiKey !== 'string' || !input.apiKey.trim() || input.apiKey.length > 4096 || /[\r\n]/.test(input.apiKey)) throw new AgentStreamError('validation')
  if (!Array.isArray(input.messages) || input.messages.length === 0 || input.messages.some((message) => !message || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string')) throw new AgentStreamError('validation')
  if (tools && (!Array.isArray(tools) || tools.length !== 1 || tools[0].type !== 'function')) throw new AgentStreamError('validation')
}

export async function streamChatCompletion(input: AgentProviderInput, options?: { tools: readonly AgentProviderTool[]; toolChoice: string }): Promise<AgentStreamResult> {
  validateInput(input, options?.tools)
  const url = completionUrl(input.endpoint)
  const timeoutMs = input.timeoutMs ?? AGENT_REQUEST_TIMEOUT_MS
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > AGENT_REQUEST_TIMEOUT_MAX_MS) throw new AgentStreamError('validation')
  const serialized = serializeAgentChatRequest(input.model, input.messages, options)
  const controller = new AbortController()
  const cancel = () => controller.abort('cancelled')
  input.signal?.addEventListener('abort', cancel, { once: true })
  if (input.signal?.aborted) cancel()
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'POST', redirect: 'manual', signal: controller.signal,
      headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json', accept: 'text/event-stream' },
      body: serialized
    })
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      if (response.status === 401 || response.status === 403) throw new AgentStreamError('authentication')
      if (!response.ok) throw new AgentStreamError('http')
      if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) throw new AgentStreamError('protocol')
      if (!response.body) throw new AgentStreamError('protocol')
      const accumulator = new AgentSseAccumulator(input.onText)
      reader = response.body.getReader()
      const decoder = new TextDecoder('utf-8', { fatal: true })
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        let fragment: string
        try { fragment = decoder.decode(value, { stream: true }) } catch { throw new AgentStreamError('protocol') }
        accumulator.push(fragment, value.byteLength)
      }
      let finalFragment: string
      try { finalFragment = decoder.decode() } catch { throw new AgentStreamError('protocol') }
      accumulator.push(finalFragment, 0)
      return accumulator.complete(Boolean(options))
    } finally {
      if (reader) {
        try { await reader.cancel().catch(() => undefined) } finally { reader.releaseLock() }
      } else {
        await response.body?.cancel().catch(() => undefined)
      }
    }
  } catch (error) {
    if (controller.signal.aborted) throw new AgentStreamError(input.signal?.aborted ? 'cancelled' : 'timeout')
    if (error instanceof AgentStreamError) throw error
    throw new AgentStreamError('network')
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener('abort', cancel)
  }
}
