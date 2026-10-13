import { AGENT_MAX_TOOL_CALLS_PER_REQUEST } from '../../shared/agent-types'

export const AGENT_SSE_EVENT_LIMIT_BYTES = 64 * 1024
export const AGENT_SSE_RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024

export interface AgentStreamDiagnostic {
  phase: 'response' | 'sse-event' | 'failure' | 'result' | 'capability' | 'schema-mismatch'
  httpStatus?: number
  mediaType?: 'event-stream' | 'json' | 'other' | 'missing'
  eventIndex?: number
  eventType?: 'json' | 'done' | 'invalid-json' | 'comment' | 'suppressed'
  payloadType?: 'object' | 'array' | 'null' | 'string' | 'number' | 'boolean' | 'invalid'
  fields?: string[]
  unknownFieldCount?: number
  choiceCount?: number
  choiceFields?: string[]
  deltaFields?: string[]
  finishReason?: 'tool_calls' | 'stop' | 'length' | 'content_filter' | 'null' | 'missing' | 'other'
  contentType?: 'string' | 'null' | 'other' | 'missing'
  contentLength?: number
  toolCallCount?: number
  toolCalls?: Array<{
    indexValid: boolean
    idLength: number | null
    idFormatValid: boolean | null
    typeIsFunction: boolean | null
    functionPresent: boolean
    nameAllowed: boolean | null
    nameLength: number | null
    argumentsType: 'string' | 'other' | 'missing'
    argumentsLength: number | null
  }>
  category?: AgentStreamError['category'] | 'internal'
  code?: string
  result?: 'passed' | 'failed'
  done?: boolean
  finished?: boolean
  callCount?: number
  textLength?: number
  schemaToolName?: string
  schemaFailure?: 'schema-invalid' | 'missing-required' | 'unknown-properties' | 'type-mismatch' | 'enum-mismatch' | 'string-length' | 'number-range' | 'integer' | 'array-length'
  schemaPath?: string
  schemaActualType?: 'object' | 'array' | 'null' | 'string' | 'number' | 'boolean' | 'invalid' | 'missing'
  schemaExpectedTypes?: string[]
  schemaUnknownFieldCount?: number
}

export type AgentStreamDiagnosticObserver = (diagnostic: Readonly<AgentStreamDiagnostic>) => void

export function emitAgentStreamDiagnostic(
  observer: AgentStreamDiagnosticObserver | undefined,
  diagnostic: AgentStreamDiagnostic
): void {
  try { observer?.(diagnostic) } catch { /* Diagnostics must never affect the request. */ }
}

const MAX_DIAGNOSTIC_EVENTS = 8
const TOP_LEVEL_DIAGNOSTIC_FIELDS = new Set(['id', 'object', 'created', 'model', 'choices', 'error', 'message', 'msg', 'detail'])
const CHOICE_DIAGNOSTIC_FIELDS = new Set(['index', 'delta', 'finish_reason', 'logprobs'])
const DELTA_DIAGNOSTIC_FIELDS = new Set(['role', 'content', 'tool_calls', 'refusal'])
const SCHEMA_PATH_SEGMENT = /^[a-z][a-z0-9_]{0,63}$/

function safeFields(value: Record<string, unknown>, allowed: ReadonlySet<string>): string[] {
  return Object.keys(value).filter((field) => allowed.has(field)).sort()
}

function diagnosticPayloadType(value: unknown): NonNullable<AgentStreamDiagnostic['payloadType']> {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'invalid'
}

function safeFinishReason(value: unknown): NonNullable<AgentStreamDiagnostic['finishReason']> {
  if (value === undefined) return 'missing'
  if (value === null) return 'null'
  if (value === 'tool_calls' || value === 'stop' || value === 'length' || value === 'content_filter') return value
  return 'other'
}

function safeSchemaPath(parent: string, property: string): string {
  if (!SCHEMA_PATH_SEGMENT.test(property) || parent.length > 256) return '$'
  return parent === '$' ? `$.${property}` : `${parent}.${property}`
}

function safeSchemaExpectedTypes(value: unknown): string[] {
  const knownTypes = new Set(['object', 'array', 'null', 'string', 'number', 'integer', 'boolean'])
  const candidates = Array.isArray(value) ? value : [value]
  return candidates.filter((candidate): candidate is string => typeof candidate === 'string' && knownTypes.has(candidate)).slice(0, 4)
}

export class AgentStreamError extends Error {
  constructor(
    readonly category: 'validation' | 'authentication' | 'http' | 'provider' | 'protocol' | 'unsupported' | 'limit' | 'timeout' | 'cancelled' | 'network',
    readonly httpStatus?: number,
    readonly providerMessage?: string | null,
    readonly diagnosticCode?: string
  ) {
    super(`模型服务请求失败：${category}`)
    this.name = 'AgentStreamError'
  }
}

export interface AgentToolCall { id: string; name: string; arguments: Record<string, unknown> }
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
  private diagnosticEventCount = 0
  private diagnosticsSuppressed = false

  constructor(
    private readonly onText?: (text: string) => void,
    private readonly allowedTools?: ReadonlyMap<string, Record<string, unknown>>,
    private readonly classifyToolMismatchAsUnsupported = false,
    private readonly onProviderError?: (payload: unknown) => AgentStreamError,
    private readonly onDiagnostic?: AgentStreamDiagnosticObserver
  ) {}

  push(fragment: string, byteLength: number): void {
    this.bytes += byteLength
    if (this.bytes > AGENT_SSE_RESPONSE_LIMIT_BYTES) throw new AgentStreamError('limit')
    if (this.done && fragment.trim()) this.failProtocol('sse.data_after_done')
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
    const eventIndex = ++this.diagnosticEventCount
    if (this.done) this.failProtocol('sse.event_after_done')
    const data = event.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
    if (!data) {
      this.emitEventDiagnostic({ phase: 'sse-event', eventIndex, eventType: 'comment' })
      return
    }
    if (data === '[DONE]') {
      this.emitEventDiagnostic({ phase: 'sse-event', eventIndex, eventType: 'done', payloadType: 'string' })
      this.done = true
      return
    }
    let parsed: unknown
    try { parsed = JSON.parse(data) } catch {
      this.emitEventDiagnostic({ phase: 'sse-event', eventIndex, eventType: 'invalid-json', payloadType: 'invalid' })
      this.failProtocol('sse.invalid_json')
    }
    this.emitEventDiagnostic(this.summarizeEvent(parsed, eventIndex))
    if (!record(parsed)) this.failProtocol('sse.payload_not_object')
    const hasStructuredError = Object.hasOwn(parsed, 'error') ||
      (!Object.hasOwn(parsed, 'choices') && ['message', 'msg', 'detail'].some((key) => typeof parsed[key] === 'string'))
    if (hasStructuredError) {
      if (this.onProviderError && (record(parsed.error) || typeof parsed.error === 'string' ||
        ['message', 'msg', 'detail'].some((key) => typeof parsed[key] === 'string'))) throw this.onProviderError(parsed)
      this.failProtocol('sse.provider_error_unclassified')
    }
    if (!Array.isArray(parsed.choices) || parsed.choices.length !== 1) this.failProtocol('sse.choices_shape')
    if (parsed.id !== undefined) {
      if (typeof parsed.id !== 'string' || !parsed.id) this.failProtocol('sse.id_invalid')
      if (this.messageId !== null && parsed.id !== this.messageId) this.failProtocol('sse.id_changed')
      this.messageId = parsed.id
    }
    const choice: unknown = parsed.choices[0]
    if (!record(choice) || !record(choice.delta)) this.failProtocol('sse.choice_or_delta_shape')
    if (this.finished) {
      const deltaFields = Reflect.ownKeys(choice.delta)
      const isEmptyAssistantContinuation = deltaFields.length === 2 &&
        deltaFields.includes('role') && deltaFields.includes('content') &&
        choice.delta.role === 'assistant' && choice.delta.content === ''
      if (choice.finish_reason !== this.finishReason || (deltaFields.length !== 0 && !isEmptyAssistantContinuation)) {
        this.failProtocol('sse.duplicate_terminal_mismatch')
      }
      return
    }
    if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
      if (typeof choice.finish_reason !== 'string') this.failProtocol('sse.finish_reason_type')
      this.finishReason = choice.finish_reason
      this.finished = true
    }
    if (choice.delta.content !== undefined && choice.delta.content !== null) {
      if (typeof choice.delta.content !== 'string') this.failProtocol('sse.content_type')
      this.text += choice.delta.content
      this.onText?.(choice.delta.content)
    }
    if (choice.delta.tool_calls === undefined) return
    if (!Array.isArray(choice.delta.tool_calls)) this.failProtocol('sse.tool_calls_shape')
    for (const value of choice.delta.tool_calls) {
      if (!record(value) || !Number.isSafeInteger(value.index) || (value.index as number) < 0 || (value.index as number) >= AGENT_MAX_TOOL_CALLS_PER_REQUEST) throw new AgentStreamError('limit')
      const index = value.index as number
      if (!this.calls.has(index) && this.calls.size >= AGENT_MAX_TOOL_CALLS_PER_REQUEST) throw new AgentStreamError('limit')
      const pending = this.calls.get(index) ?? { id: '', type: '', name: '', arguments: '' }
      if (value.id !== undefined) {
        if (typeof value.id !== 'string' || pending.id.length + value.id.length > 256) this.failProtocol('sse.tool_call_id_invalid')
        pending.id += value.id
      }
      if (value.type !== undefined) {
        if (typeof value.type !== 'string' || pending.type.length + value.type.length > 32) this.failProtocol('sse.tool_call_type_invalid')
        pending.type += value.type
      }
      if (value.function !== undefined) {
        if (!record(value.function)) this.failProtocol('sse.tool_call_function_shape')
        if (value.function.name !== undefined) {
          if (typeof value.function.name !== 'string' || pending.name.length + value.function.name.length > 128) this.failProtocol('sse.tool_call_name_invalid')
          pending.name += value.function.name
        }
        if (value.function.arguments !== undefined) {
          if (typeof value.function.arguments !== 'string' || pending.arguments.length + value.function.arguments.length > AGENT_SSE_RESPONSE_LIMIT_BYTES) throw new AgentStreamError('limit')
          pending.arguments += value.function.arguments
        }
      }
      this.calls.set(index, pending)
    }
  }

  private failProtocol(code: string): never {
    throw new AgentStreamError('protocol', undefined, null, code)
  }

  private emitEventDiagnostic(diagnostic: AgentStreamDiagnostic): void {
    if (!this.onDiagnostic) return
    if (diagnostic.eventIndex !== undefined && diagnostic.eventIndex > MAX_DIAGNOSTIC_EVENTS) {
      if (!this.diagnosticsSuppressed) {
        this.diagnosticsSuppressed = true
        emitAgentStreamDiagnostic(this.onDiagnostic, {
          phase: 'sse-event', eventIndex: diagnostic.eventIndex, eventType: 'suppressed'
        })
      }
      return
    }
    emitAgentStreamDiagnostic(this.onDiagnostic, diagnostic)
  }

  private summarizeEvent(parsed: unknown, eventIndex: number): AgentStreamDiagnostic {
    const diagnostic: AgentStreamDiagnostic = {
      phase: 'sse-event', eventIndex, eventType: 'json', payloadType: diagnosticPayloadType(parsed)
    }
    if (!record(parsed)) return diagnostic
    diagnostic.fields = safeFields(parsed, TOP_LEVEL_DIAGNOSTIC_FIELDS)
    diagnostic.unknownFieldCount = Object.keys(parsed).filter((field) => !TOP_LEVEL_DIAGNOSTIC_FIELDS.has(field)).length
    if (!Array.isArray(parsed.choices)) return diagnostic
    diagnostic.choiceCount = parsed.choices.length
    if (parsed.choices.length !== 1 || !record(parsed.choices[0])) return diagnostic
    const choice = parsed.choices[0]
    diagnostic.choiceFields = safeFields(choice, CHOICE_DIAGNOSTIC_FIELDS)
    diagnostic.finishReason = safeFinishReason(choice.finish_reason)
    if (!record(choice.delta)) return diagnostic
    const delta = choice.delta
    diagnostic.deltaFields = safeFields(delta, DELTA_DIAGNOSTIC_FIELDS)
    if (!Object.hasOwn(delta, 'content')) diagnostic.contentType = 'missing'
    else if (delta.content === null) diagnostic.contentType = 'null'
    else if (typeof delta.content === 'string') {
      diagnostic.contentType = 'string'
      diagnostic.contentLength = delta.content.length
    } else diagnostic.contentType = 'other'
    if (!Array.isArray(delta.tool_calls)) return diagnostic
    diagnostic.toolCallCount = delta.tool_calls.length
    diagnostic.toolCalls = delta.tool_calls.slice(0, AGENT_MAX_TOOL_CALLS_PER_REQUEST).map((call) => {
      if (!record(call)) return {
        indexValid: false, idLength: null, idFormatValid: null, typeIsFunction: null,
        functionPresent: false, nameAllowed: null, nameLength: null,
        argumentsType: 'missing', argumentsLength: null
      }
      const functionValue = record(call.function) ? call.function : null
      const hasId = Object.hasOwn(call, 'id')
      const name = functionValue?.name
      const argumentsValue = functionValue?.arguments
      return {
        indexValid: Number.isSafeInteger(call.index) && (call.index as number) >= 0 && (call.index as number) < AGENT_MAX_TOOL_CALLS_PER_REQUEST,
        idLength: typeof call.id === 'string' ? call.id.length : null,
        idFormatValid: hasId && typeof call.id === 'string' ? /^[A-Za-z0-9_-]{1,256}$/.test(call.id) : null,
        typeIsFunction: Object.hasOwn(call, 'type') ? call.type === 'function' : null,
        functionPresent: functionValue !== null,
        nameAllowed: typeof name === 'string' ? Boolean(this.allowedTools?.has(name)) : null,
        nameLength: typeof name === 'string' ? name.length : null,
        argumentsType: argumentsValue === undefined ? 'missing' : typeof argumentsValue === 'string' ? 'string' : 'other',
        argumentsLength: typeof argumentsValue === 'string' ? argumentsValue.length : null
      }
    })
    return diagnostic
  }

  complete(allowTools: boolean): AgentStreamResult {
    if (!this.done || !this.finished || this.buffer.trim()) this.failProtocol('completion.incomplete_stream')
    if (this.calls.size && (!allowTools || this.finishReason !== 'tool_calls')) this.failProtocol('completion.tool_calls_finish_reason')
    if (!this.calls.size && this.finishReason !== 'stop') this.failProtocol('completion.empty_finish_reason')
    const toolCalls: AgentToolCall[] = []
    const callIds = new Set<string>()
    for (const [index, pending] of [...this.calls].sort(([a], [b]) => a - b)) {
      if (index !== toolCalls.length || !/^[A-Za-z0-9_-]{1,256}$/.test(pending.id) || callIds.has(pending.id) || pending.type !== 'function' || !pending.name || !pending.arguments) this.failProtocol('completion.tool_call_metadata')
      if (!this.allowedTools?.has(pending.name)) throw new AgentStreamError(this.classifyToolMismatchAsUnsupported ? 'unsupported' : 'protocol', undefined, null, 'completion.tool_not_allowed')
      let args: unknown
      try { args = JSON.parse(pending.arguments) } catch { this.failProtocol('completion.arguments_json') }
      if (!record(args)) this.failProtocol('completion.arguments_object')
      const schema = this.allowedTools.get(pending.name)
      const mismatch = schema ? findSchemaMismatch(args, schema) : {
        reason: 'schema-invalid' as const, path: '$', actualType: diagnosticPayloadType(args), expectedTypes: []
      }
      if (mismatch) {
        emitAgentStreamDiagnostic(this.onDiagnostic, {
          phase: 'schema-mismatch', schemaToolName: /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/.test(pending.name) ? pending.name : undefined,
          schemaFailure: mismatch.reason, schemaPath: mismatch.path, schemaActualType: mismatch.actualType,
          schemaExpectedTypes: mismatch.expectedTypes, schemaUnknownFieldCount: mismatch.unknownFieldCount
        })
        throw new AgentStreamError(this.classifyToolMismatchAsUnsupported ? 'unsupported' : 'protocol', undefined, null, 'completion.arguments_schema')
      }
      callIds.add(pending.id)
      toolCalls.push({ id: pending.id, name: pending.name, arguments: args })
    }
    emitAgentStreamDiagnostic(this.onDiagnostic, {
      phase: 'result', result: 'passed', done: this.done, finished: this.finished,
      finishReason: safeFinishReason(this.finishReason), callCount: this.calls.size, textLength: this.text.length
    })
    return { text: this.text, toolCalls }
  }
}

type SchemaMismatch = {
  reason: NonNullable<AgentStreamDiagnostic['schemaFailure']>
  path: string
  actualType: NonNullable<AgentStreamDiagnostic['schemaActualType']>
  expectedTypes: string[]
  unknownFieldCount?: number
}

function findSchemaMismatch(value: unknown, schema: Record<string, unknown>, path = '$'): SchemaMismatch | null {
  const expectedTypes = safeSchemaExpectedTypes(schema.type)
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    return { reason: 'enum-mismatch', path, actualType: diagnosticPayloadType(value), expectedTypes }
  }
  if (Array.isArray(schema.type)) {
    if (schema.type.length !== 2 || !schema.type.includes('number') || !schema.type.includes('null') || new Set(schema.type).size !== 2) {
      return { reason: 'schema-invalid', path, actualType: diagnosticPayloadType(value), expectedTypes }
    }
    if (value === null) return null
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { reason: 'type-mismatch', path, actualType: diagnosticPayloadType(value), expectedTypes }
    }
    if (value < Number(schema.minimum ?? Number.NEGATIVE_INFINITY) || value > Number(schema.maximum ?? Number.POSITIVE_INFINITY)) {
      return { reason: 'number-range', path, actualType: diagnosticPayloadType(value), expectedTypes }
    }
    return null
  }
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') return { reason: 'type-mismatch', path, actualType: diagnosticPayloadType(value), expectedTypes }
      if (value.length < Number(schema.minLength ?? 0) || value.length > Number(schema.maxLength ?? 16_384)) {
        return { reason: 'string-length', path, actualType: 'string', expectedTypes }
      }
      return null
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return { reason: 'type-mismatch', path, actualType: diagnosticPayloadType(value), expectedTypes }
      if (value < Number(schema.minimum ?? Number.NEGATIVE_INFINITY) || value > Number(schema.maximum ?? Number.POSITIVE_INFINITY)) {
        return { reason: 'number-range', path, actualType: 'number', expectedTypes }
      }
      return null
    case 'integer':
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) return { reason: 'integer', path, actualType: diagnosticPayloadType(value), expectedTypes }
      if (value < Number(schema.minimum ?? Number.NEGATIVE_INFINITY) || value > Number(schema.maximum ?? Number.POSITIVE_INFINITY)) {
        return { reason: 'number-range', path, actualType: 'number', expectedTypes }
      }
      return null
    case 'boolean': return typeof value === 'boolean' ? null : { reason: 'type-mismatch', path, actualType: diagnosticPayloadType(value), expectedTypes }
    case 'array': {
      if (!Array.isArray(value)) return { reason: 'type-mismatch', path, actualType: diagnosticPayloadType(value), expectedTypes }
      if (!record(schema.items)) return { reason: 'schema-invalid', path, actualType: 'array', expectedTypes }
      if (value.length < Number(schema.minItems ?? 0) || value.length > Number(schema.maxItems ?? 256)) {
        return { reason: 'array-length', path, actualType: 'array', expectedTypes }
      }
      for (const item of value) {
        const mismatch = findSchemaMismatch(item, schema.items, `${path}[]`)
        if (mismatch) return mismatch
      }
      return null
    }
    case 'object': {
      if (!record(value)) return { reason: 'type-mismatch', path, actualType: diagnosticPayloadType(value), expectedTypes }
      if (!record(schema.properties)) return { reason: 'schema-invalid', path, actualType: 'object', expectedTypes }
      const properties = schema.properties
      const required = Array.isArray(schema.required) ? schema.required : []
      for (const key of required) {
        if (typeof key !== 'string') return { reason: 'schema-invalid', path, actualType: 'object', expectedTypes }
        if (!Object.hasOwn(value, key)) {
          const propertySchema = properties[key]
          return {
            reason: 'missing-required', path: safeSchemaPath(path, key), actualType: 'missing',
            expectedTypes: record(propertySchema) ? safeSchemaExpectedTypes(propertySchema.type) : []
          }
        }
      }
      const unknownFieldCount = Object.keys(value).filter((key) => !Object.hasOwn(properties, key)).length
      if (unknownFieldCount) return { reason: 'unknown-properties', path, actualType: 'object', expectedTypes, unknownFieldCount }
      for (const [key, item] of Object.entries(value)) {
        const propertySchema = properties[key]
        const propertyPath = safeSchemaPath(path, key)
        if (!record(propertySchema)) return { reason: 'schema-invalid', path: propertyPath, actualType: diagnosticPayloadType(item), expectedTypes: [] }
        const mismatch = findSchemaMismatch(item, propertySchema, propertyPath)
        if (mismatch) return mismatch
      }
      return null
    }
    default: return { reason: 'schema-invalid', path, actualType: diagnosticPayloadType(value), expectedTypes }
  }
}
