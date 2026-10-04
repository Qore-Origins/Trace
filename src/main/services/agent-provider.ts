import { AgentSseAccumulator, AgentStreamError, type AgentStreamResult } from './agent-sse'
import type { AgentChatToolCall } from '../../shared/agent-types'

export const AGENT_REQUEST_TIMEOUT_MS = 60_000
export const AGENT_REQUEST_TIMEOUT_MAX_MS = 180_000
export const AGENT_REQUEST_BODY_LIMIT_BYTES = 256 * 1024

export type AgentChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: AgentChatToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string }
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

export interface AgentProviderToolOptions {
  tools: readonly AgentProviderTool[]
  toolChoice: 'auto' | string
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Reflect.ownKeys(value)
  return keys.every((key) => typeof key === 'string' && [...required, ...optional].includes(key)) &&
    required.every((key) => Object.hasOwn(value, key)) && keys.length >= required.length && keys.length <= required.length + optional.length
}

const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/
const TOOL_ARGUMENT_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object'])
const PROPERTY_SCHEMA_KEYS = new Set(['type', 'description', 'enum', 'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems', 'items', 'additionalItems', 'properties', 'required', 'additionalProperties'])

function validPropertySchema(value: unknown, depth = 0): value is Record<string, unknown> {
  if (!plainRecord(value) || depth > 4 || typeof value.type !== 'string' || !TOOL_ARGUMENT_TYPES.has(value.type)) return false
  if (Object.keys(value).some((key) => !PROPERTY_SCHEMA_KEYS.has(key))) return false
  if (value.description !== undefined && (typeof value.description !== 'string' || value.description.length > 1024)) return false
  if (value.enum !== undefined) {
    if (!Array.isArray(value.enum) || value.enum.length === 0 || value.enum.length > 64) return false
    if (value.enum.some((item) => value.type === 'string' ? typeof item !== 'string' : value.type === 'boolean' ? typeof item !== 'boolean' : value.type === 'number' ? typeof item !== 'number' || !Number.isFinite(item) : value.type === 'integer' ? typeof item !== 'number' || !Number.isSafeInteger(item) : true)) return false
  }
  if (value.type === 'string') {
    if (Object.keys(value).some((key) => !['type', 'description', 'enum', 'minLength', 'maxLength'].includes(key))) return false
    const min = value.minLength ?? 0, max = value.maxLength ?? 16_384
    return Number.isSafeInteger(min) && Number(min) >= 0 && Number.isSafeInteger(max) && Number(max) <= 16_384 && Number(min) <= Number(max)
  }
  if (value.type === 'number' || value.type === 'integer') {
    if (Object.keys(value).some((key) => !['type', 'description', 'enum', 'minimum', 'maximum'].includes(key))) return false
    const min = value.minimum ?? Number.NEGATIVE_INFINITY, max = value.maximum ?? Number.POSITIVE_INFINITY
    return (min === Number.NEGATIVE_INFINITY || (typeof min === 'number' && Number.isFinite(min))) && (max === Number.POSITIVE_INFINITY || (typeof max === 'number' && Number.isFinite(max))) && Number(min) <= Number(max)
  }
  if (value.type === 'boolean') return Object.keys(value).every((key) => ['type', 'description', 'enum'].includes(key))
  if (value.type === 'array') {
    if (Object.keys(value).some((key) => !['type', 'description', 'minItems', 'maxItems', 'items', 'additionalItems'].includes(key))) return false
    const min = value.minItems ?? 0, max = value.maxItems ?? 256
    return Number.isSafeInteger(min) && Number(min) >= 0 && Number.isSafeInteger(max) && Number(max) <= 256 && Number(min) <= Number(max) &&
      (value.additionalItems === undefined || value.additionalItems === false) && validPropertySchema(value.items, depth + 1)
  }
  if (value.type !== 'object') return true
  if (Object.keys(value).some((key) => !['type', 'description', 'properties', 'required', 'additionalProperties'].includes(key))) return false
  if (!plainRecord(value.properties) || value.additionalProperties !== false || Object.keys(value.properties).length > 64) return false
  if (value.required !== undefined && (!Array.isArray(value.required) || value.required.some((item) => typeof item !== 'string') || new Set(value.required).size !== value.required.length)) return false
  if (Array.isArray(value.required) && value.required.some((item) => !Object.hasOwn(value.properties as object, item))) return false
  return Object.values(value.properties).every((schema) => validPropertySchema(schema, depth + 1))
}

function validToolDefinition(value: unknown): value is AgentProviderTool {
  if (!plainRecord(value) || value.type !== 'function' || !plainRecord(value.function)) return false
  const definition = value.function
  if (typeof definition.name !== 'string' || definition.name.length > 128 || !TOOL_NAME_PATTERN.test(definition.name) ||
    typeof definition.description !== 'string' || definition.description.length > 8_000 || !plainRecord(definition.parameters)) return false
  const schema = definition.parameters
  return validPropertySchema(schema)
}

function validToolCall(value: unknown): value is AgentChatToolCall {
  if (!plainRecord(value) || !exactKeys(value, ['id', 'type', 'function']) || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(value.id) || value.type !== 'function' || !plainRecord(value.function) || !exactKeys(value.function, ['name', 'arguments'])) return false
  if (typeof value.function.name !== 'string' || !TOOL_NAME_PATTERN.test(value.function.name) || typeof value.function.arguments !== 'string' || !value.function.arguments.length) return false
  try { return plainRecord(JSON.parse(value.function.arguments)) } catch { return false }
}

function validChatMessage(value: unknown): value is AgentChatMessage {
  if (!plainRecord(value) || typeof value.role !== 'string' || !Object.hasOwn(value, 'content')) return false
  if (value.role === 'system' || value.role === 'user') return exactKeys(value, ['role', 'content']) && typeof value.content === 'string'
  if (value.role === 'assistant') {
    if (!exactKeys(value, ['role', 'content'], ['tool_calls'])) return false
    if (value.content !== null && typeof value.content !== 'string') return false
    if (!Object.hasOwn(value, 'tool_calls')) return value.content !== null
    return Array.isArray(value.tool_calls) && value.tool_calls.length > 0 && value.tool_calls.every(validToolCall) &&
      new Set(value.tool_calls.map((call) => call.id)).size === value.tool_calls.length
  }
  return value.role === 'tool' && exactKeys(value, ['role', 'content', 'tool_call_id']) && typeof value.content === 'string' && typeof value.tool_call_id === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value.tool_call_id)
}

function validChatTranscript(messages: readonly unknown[]): messages is readonly AgentChatMessage[] {
  if (!messages.length) return false
  let expectedToolResults: string[] = []
  for (const value of messages) {
    if (!validChatMessage(value)) return false
    const message = value
    if (expectedToolResults.length > 0) {
      if (message.role !== 'tool' || message.tool_call_id !== expectedToolResults[0]) return false
      expectedToolResults.shift()
      continue
    }
    if (message.role === 'tool') return false
    if (message.role === 'assistant' && message.tool_calls) expectedToolResults = message.tool_calls.map((call) => call.id)
  }
  return expectedToolResults.length === 0
}

function validateToolOptions(options: AgentProviderToolOptions): void {
  if (!options || !Array.isArray(options.tools) || options.tools.length === 0 || !options.tools.every(validToolDefinition)) throw new AgentStreamError('validation')
  const names = options.tools.map((tool) => tool.function.name)
  if (new Set(names).size !== names.length || (options.toolChoice !== 'auto' && !names.includes(options.toolChoice))) throw new AgentStreamError('validation')
}

function valueMatchesSchema(value: unknown, schema: Record<string, unknown>): boolean {
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => Object.is(candidate, value))) return false
  switch (schema.type) {
    case 'string': return typeof value === 'string'
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'integer': return typeof value === 'number' && Number.isSafeInteger(value)
    case 'boolean': return typeof value === 'boolean'
    case 'array': return Array.isArray(value) && value.length <= 256 && value.every((item) => valueMatchesSchema(item, schema.items as Record<string, unknown>))
    case 'object': {
      if (!plainRecord(value)) return false
      const properties = schema.properties as Record<string, Record<string, unknown>>
      const required = (schema.required as string[] | undefined) ?? []
      if (Object.keys(value).some((key) => !Object.hasOwn(properties, key)) || required.some((key) => !Object.hasOwn(value, key))) return false
      return Object.entries(value).every(([key, item]) => valueMatchesSchema(item, properties[key]))
    }
    default: return false
  }
}

function toolArgumentSchemas(options?: AgentProviderToolOptions): ReadonlyMap<string, Record<string, unknown>> | undefined {
  return options ? new Map(options.tools.map((tool) => [tool.function.name, tool.function.parameters])) : undefined
}

export function serializeAgentChatRequest(model: string, messages: readonly AgentChatMessage[], options?: AgentProviderToolOptions): string {
  if (typeof model !== 'string' || !model.trim() || model.length > 160 || !validChatTranscript(messages)) throw new AgentStreamError('validation')
  if (options) validateToolOptions(options)
  const body: Record<string, unknown> = { model, messages, stream: true }
  if (options) {
    body.tools = options.tools
    body.tool_choice = options.toolChoice === 'auto' ? 'auto' : { type: 'function', function: { name: options.toolChoice } }
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

function validateInput(input: AgentProviderInput, options?: AgentProviderToolOptions): void {
  if (!input || typeof input.model !== 'string' || !input.model.trim() || input.model.length > 160 || typeof input.apiKey !== 'string' || !input.apiKey.trim() || input.apiKey.length > 4096 || /[\r\n]/.test(input.apiKey)) throw new AgentStreamError('validation')
  if (!Array.isArray(input.messages) || !validChatTranscript(input.messages)) throw new AgentStreamError('validation')
  if (options) validateToolOptions(options)
}

export async function streamChatCompletion(input: AgentProviderInput, options?: AgentProviderToolOptions): Promise<AgentStreamResult> {
  validateInput(input, options)
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
      const accumulator = new AgentSseAccumulator(input.onText, toolArgumentSchemas(options), options !== undefined && options.toolChoice !== 'auto')
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
