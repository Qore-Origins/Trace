import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { AGENT_MAX_TOOL_CALLS_PER_REQUEST, AGENT_MAX_TOOL_ROUNDS_PER_REQUEST, type AgentChatToolCall, type AgentContextSource, type AgentMessage, type AgentRequestProvenance, type AgentSession, type AgentSessionInput, type AgentSessionSummary } from '../../shared/agent-types'
import { ERR, TraceError } from '../../shared/errors'
import { assertRealPathWithinRoot } from './path-safety'

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export const AGENT_MAX_MESSAGE_LENGTH = 256 * 1024
const MAX_SESSION_FILE_BYTES = 16 * 1024 * 1024
const MAX_SESSION_TITLE_LENGTH = 120

export function assertAgentSessionId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new TraceError(ERR.VALIDATION, '会话标识无效')
}
export function agentRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}
export function parseSessionInput(value: unknown): AgentSessionInput {
  if (!agentRecord(value) || typeof value.title !== 'string' || !value.title.trim() || value.title.length > MAX_SESSION_TITLE_LENGTH) throw new TraceError(ERR.VALIDATION, '会话名称无效')
  assertAgentSessionId(value.profileId)
  return { title: value.title.trim(), profileId: value.profileId }
}
export function assertAgentMessageText(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length > AGENT_MAX_MESSAGE_LENGTH) throw new TraceError(ERR.VALIDATION, '消息内容无效或过长')
}
function isMissing(error: unknown): boolean { return agentRecord(error) ? error.code === 'ENOENT' : error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT' }
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('invalid timestamp')
  return value
}
function source(value: unknown): AgentContextSource {
  if (!agentRecord(value) || (value.kind !== 'plan' && value.kind !== 'diary') || typeof value.path !== 'string' || typeof value.libraryId !== 'string' || typeof value.version !== 'string') throw new Error('invalid source')
  return { kind: value.kind, path: value.path, libraryId: value.libraryId, version: value.version, updatedAt: timestamp(value.updatedAt) }
}
function toolCalls(value: unknown): AgentChatToolCall[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > AGENT_MAX_TOOL_CALLS_PER_REQUEST) throw new Error('invalid tool calls')
  const calls = value.map((item: unknown): AgentChatToolCall => {
    if (!agentRecord(item) || typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(item.id) || item.type !== 'function' || !agentRecord(item.function) || typeof item.function.name !== 'string' || !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(item.function.name) || typeof item.function.arguments !== 'string' || Buffer.byteLength(item.function.arguments) > AGENT_MAX_MESSAGE_LENGTH) throw new Error('invalid tool call')
    const args: unknown = JSON.parse(item.function.arguments)
    if (!agentRecord(args)) throw new Error('invalid tool arguments')
    return { id: item.id, type: 'function', function: { name: item.function.name, arguments: item.function.arguments } }
  })
  if (new Set(calls.map((item) => item.id)).size !== calls.length) throw new Error('duplicate tool call identifiers')
  return calls
}
function parseSession(value: unknown, id: string): AgentSession {
  if (!agentRecord(value) || value.id !== id || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || !Array.isArray(value.messages) || !Array.isArray(value.requests)) throw new Error('invalid session')
  const input = parseSessionInput(value)
  const requests: AgentRequestProvenance[] = value.requests.map((item: unknown) => {
    if (!agentRecord(item) || typeof item.profileName !== 'string' || typeof item.model !== 'string' || (item.presetId !== null && typeof item.presetId !== 'string') || !Array.isArray(item.sources)) throw new Error('invalid request')
    const toolRounds = item.toolRounds ?? 0, toolCallCount = item.toolCallCount ?? 0
    if (!Number.isSafeInteger(toolRounds) || Number(toolRounds) < 0 || Number(toolRounds) > AGENT_MAX_TOOL_ROUNDS_PER_REQUEST || !Number.isSafeInteger(toolCallCount) || Number(toolCallCount) < 0 || Number(toolCallCount) > AGENT_MAX_TOOL_CALLS_PER_REQUEST) throw new Error('invalid tool request counts')
    assertAgentSessionId(item.id); assertAgentSessionId(item.profileId)
    return { id: item.id, profileId: item.profileId, profileName: item.profileName, presetId: item.presetId, model: item.model, requestedAt: timestamp(item.requestedAt), sources: item.sources.map(source), toolRounds: Number(toolRounds), toolCallCount: Number(toolCallCount) }
  })
  const messages: AgentMessage[] = value.messages.map((item: unknown) => {
    if (!agentRecord(item) || !['user', 'assistant', 'tool'].includes(String(item.role)) || !['complete', 'streaming', 'user-interrupted', 'error-interrupted'].includes(String(item.status))) throw new Error('invalid message')
    assertAgentSessionId(item.id); assertAgentSessionId(item.requestId); assertAgentMessageText(item.content)
    if (!requests.some((request) => request.id === item.requestId) || (item.role !== 'assistant' && item.status !== 'complete')) throw new Error('invalid message request')
    const message: AgentMessage = { id: item.id, requestId: item.requestId, role: item.role as AgentMessage['role'], content: item.content, status: item.status as AgentMessage['status'], createdAt: timestamp(item.createdAt) }
    if (item.toolCalls !== undefined) {
      if (item.role !== 'assistant' || item.status !== 'complete') throw new Error('invalid executable tool call state')
      message.toolCalls = toolCalls(item.toolCalls)
    }
    if (item.toolCallId !== undefined) {
      if (item.role !== 'tool' || typeof item.toolCallId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(item.toolCallId)) throw new Error('invalid tool result reference')
      message.toolCallId = item.toolCallId
    }
    if ((item.role === 'tool') !== (typeof message.toolCallId === 'string')) throw new Error('tool result reference required')
    return message
  })
  if (new Set(messages.map((item) => item.id)).size !== messages.length || new Set(requests.map((item) => item.id)).size !== requests.length) throw new Error('duplicate identifiers')
  const callsByRequest = new Map<string, Set<string>>()
  const resultsByRequest = new Map<string, Set<string>>()
  const roundsByRequest = new Map<string, number>()
  for (const message of messages) {
    if (message.role === 'assistant' && message.toolCalls?.length) {
      const calls = callsByRequest.get(message.requestId) ?? new Set<string>()
      for (const call of message.toolCalls) {
        if (calls.has(call.id)) throw new Error('duplicate request tool call')
        calls.add(call.id)
      }
      callsByRequest.set(message.requestId, calls)
      roundsByRequest.set(message.requestId, (roundsByRequest.get(message.requestId) ?? 0) + 1)
    }
    if (message.role === 'tool' && message.toolCallId) {
      const results = resultsByRequest.get(message.requestId) ?? new Set<string>()
      if (results.has(message.toolCallId)) throw new Error('duplicate tool result')
      results.add(message.toolCallId)
      resultsByRequest.set(message.requestId, results)
    }
  }
  for (const request of requests) {
    const callCount = callsByRequest.get(request.id)?.size ?? 0
    const rounds = roundsByRequest.get(request.id) ?? 0
    if (callCount !== request.toolCallCount || rounds !== request.toolRounds || callCount > AGENT_MAX_TOOL_CALLS_PER_REQUEST || rounds > AGENT_MAX_TOOL_ROUNDS_PER_REQUEST) throw new Error('tool request counts mismatch')
    const calls = callsByRequest.get(request.id) ?? new Set<string>()
    if ([...(resultsByRequest.get(request.id) ?? [])].some((callId) => !calls.has(callId))) throw new Error('orphaned tool result')
  }
  return { id, ...input, createdAt: timestamp(value.createdAt), updatedAt: timestamp(value.updatedAt), revision: Number(value.revision), messages, requests }
}

export class AgentSessionRepository {
  private queue = Promise.resolve()
  private readonly loadedSessions = new Set<string>()
  constructor(private readonly userDataDir: string) {}
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }
  private async directory(create = false): Promise<string> {
    if (create) await fs.mkdir(this.userDataDir, { recursive: true })
    const directory = join(this.userDataDir, 'agent-sessions')
    try {
      await assertRealPathWithinRoot(this.userDataDir, directory, { allowMissing: true })
      const stat = await fs.lstat(directory)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new TraceError(ERR.PATH_UNSAFE, '会话存储路径不安全')
    } catch (error) {
      if (!isMissing(error)) throw error
      if (create) await fs.mkdir(directory)
    }
    return directory
  }
  private async file(id: string, create = false): Promise<string> {
    assertAgentSessionId(id)
    const file = join(await this.directory(create), `${id}.json`)
    await assertRealPathWithinRoot(this.userDataDir, file, { allowMissing: true })
    try {
      const stat = await fs.lstat(file)
      if (stat.isSymbolicLink() || !stat.isFile()) throw new TraceError(ERR.PATH_UNSAFE, '会话存储路径不安全')
      if (stat.size > MAX_SESSION_FILE_BYTES) throw new TraceError(ERR.FORMAT_INVALID, '会话文件过大')
    } catch (error) { if (!isMissing(error)) throw error }
    return file
  }
  private async write(session: AgentSession): Promise<void> {
    const file = await this.file(session.id, true)
    const encoded = JSON.stringify({ schemaVersion: 1, ...session })
    if (Buffer.byteLength(encoded) > MAX_SESSION_FILE_BYTES) throw new TraceError(ERR.VALIDATION, '会话内容过长')
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temporary, encoded, { flag: 'wx', mode: 0o600 })
      await this.file(session.id)
      await fs.rename(temporary, file)
    } finally { await fs.rm(temporary, { force: true }) }
    this.loadedSessions.add(session.id)
  }
  private async load(id: string): Promise<AgentSession> {
    const file = await this.file(id)
    let session: AgentSession
    try {
      const data: unknown = JSON.parse(await fs.readFile(file, 'utf8'))
      if (!agentRecord(data) || data.schemaVersion !== 1) throw new Error('invalid schema')
      session = parseSession(data, id)
    } catch (error) {
      if (isMissing(error)) throw new TraceError(ERR.PATH_NOT_FOUND, '会话不存在')
      throw new TraceError(ERR.FORMAT_INVALID, '会话记录无法读取')
    }
    if (!this.loadedSessions.has(id) && session.messages.some((message) => message.status === 'streaming')) {
      session.messages = session.messages.map((message) => message.status === 'streaming' ? { ...message, status: 'error-interrupted' } : message)
      session.revision += 1
      session.updatedAt = new Date().toISOString()
      await this.write(session)
    }
    this.loadedSessions.add(id)
    return session
  }
  create(input: AgentSessionInput): Promise<AgentSession> {
    return this.serial(async () => {
      const now = new Date().toISOString()
      const session: AgentSession = { id: randomUUID(), ...parseSessionInput(input), createdAt: now, updatedAt: now, revision: 0, messages: [], requests: [] }
      await this.write(session)
      return session
    })
  }
  read(id: string): Promise<AgentSession> { return this.serial(() => this.load(id)) }
  list(): Promise<AgentSessionSummary[]> {
    return this.serial(async () => {
      const directory = await this.directory()
      let names: string[]
      try { names = await fs.readdir(directory) } catch (error) { if (isMissing(error)) return []; throw error }
      const sessions: AgentSessionSummary[] = []
      for (const name of names.filter((name) => name.endsWith('.json')).sort()) {
        const { messages: _messages, requests: _requests, ...summary } = await this.load(name.slice(0, -5))
        sessions.push(summary)
      }
      return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
    })
  }
  mutate(id: string, operation: (session: AgentSession) => void): Promise<AgentSession> {
    return this.serial(async () => {
      const session = await this.load(id)
      operation(session)
      session.revision += 1
      session.updatedAt = new Date().toISOString()
      const validated = parseSession(session, id)
      await this.write(validated)
      return validated
    })
  }
  delete(id: string): Promise<void> {
    return this.serial(async () => {
      await this.load(id)
      await fs.unlink(await this.file(id))
      this.loadedSessions.delete(id)
    })
  }
}
