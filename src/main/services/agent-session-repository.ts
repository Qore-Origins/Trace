import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { AgentContextSource, AgentMessage, AgentRequestProvenance, AgentSession, AgentSessionInput, AgentSessionSummary } from '../../shared/agent-types'
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
function parseSession(value: unknown, id: string): AgentSession {
  if (!agentRecord(value) || value.id !== id || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || !Array.isArray(value.messages) || !Array.isArray(value.requests)) throw new Error('invalid session')
  const input = parseSessionInput(value)
  const requests: AgentRequestProvenance[] = value.requests.map((item: unknown) => {
    if (!agentRecord(item) || typeof item.profileName !== 'string' || typeof item.model !== 'string' || (item.presetId !== null && typeof item.presetId !== 'string') || !Array.isArray(item.sources)) throw new Error('invalid request')
    assertAgentSessionId(item.id); assertAgentSessionId(item.profileId)
    return { id: item.id, profileId: item.profileId, profileName: item.profileName, presetId: item.presetId, model: item.model, requestedAt: timestamp(item.requestedAt), sources: item.sources.map(source) }
  })
  const messages: AgentMessage[] = value.messages.map((item: unknown) => {
    if (!agentRecord(item) || (item.role !== 'user' && item.role !== 'assistant') || !['complete', 'streaming', 'user-interrupted', 'error-interrupted'].includes(String(item.status))) throw new Error('invalid message')
    assertAgentSessionId(item.id); assertAgentSessionId(item.requestId); assertAgentMessageText(item.content)
    if (!requests.some((request) => request.id === item.requestId) || (item.role === 'user' && item.status !== 'complete')) throw new Error('invalid message request')
    return { id: item.id, requestId: item.requestId, role: item.role, content: item.content, status: item.status as AgentMessage['status'], createdAt: timestamp(item.createdAt) }
  })
  if (new Set(messages.map((item) => item.id)).size !== messages.length || new Set(requests.map((item) => item.id)).size !== requests.length) throw new Error('duplicate identifiers')
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
