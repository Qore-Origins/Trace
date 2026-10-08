import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { AGENT_MAX_TOOL_CALLS_PER_REQUEST, AGENT_MAX_TOOL_ROUNDS_PER_REQUEST, type AgentChatToolCall, type AgentContextSource, type AgentMessage, type AgentOperationBatchAudit, type AgentRequestProvenance, type AgentSession, type AgentSessionInput, type AgentSessionSummary } from '../../shared/agent-types'
import { ERR, TraceError } from '../../shared/errors'
import { assertRealPathWithinRoot } from './path-safety'

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export const AGENT_MAX_MESSAGE_LENGTH = 256 * 1024
export const AGENT_MAX_AUDIT_FIELD_BYTES = 50_000
const MAX_SESSION_FILE_BYTES = 16 * 1024 * 1024
const MAX_SESSION_TITLE_LENGTH = 120
const MAX_SESSION_OPERATION_BATCHES = 2048
const MAX_OPERATION_TARGET_RELATIVE_PATH_LENGTH = 4096
const MAX_OPERATION_AUDIT_CHANGES_PER_ITEM = 64

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
function operationBatches(value: unknown): AgentOperationBatchAudit[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_SESSION_OPERATION_BATCHES) throw new Error('invalid operation batches')
  const confirmationSources = new Set(['user', 'policy', 'none'])
  const batchStatuses = new Set(['preflight-failed', 'pending-confirmation', 'executing', 'awaiting-outbound-preview', 'completed', 'execution-failed', 'reconciliation-required', 'cancelled'])
  const itemStatuses = new Set(['ready', 'succeeded', 'failed', 'outcome-unknown', 'not-executed', 'cancelled'])
  const errorCategories = new Set(['validation', 'authorization', 'conflict', 'not-found', 'name-conflict', 'storage', 'internal'])
  const policyModes = new Set(['confirm', 'restricted', 'unrestricted'])
  const attemptKinds = new Set(['retry', 'continue', 'undo'])
  const undoStatuses = new Set(['unavailable', 'available', 'undone', 'stale'])
  const reconciliationReasons = new Set(['success-audit-persistence-failed', 'post-side-effect-verification-failed', 'process-interrupted'])
  const targetKinds = new Set(['plan', 'folder', 'trash'])
  const safeRelativePath = (path: unknown): path is string => typeof path === 'string' && path.length > 0 && path.length <= MAX_OPERATION_TARGET_RELATIVE_PATH_LENGTH &&
    !path.startsWith('/') && !path.startsWith('\\') && !/^[A-Za-z]:/.test(path) && !path.includes('\\') &&
    path.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
  const batches = value.map((candidate: unknown): AgentOperationBatchAudit => {
    if (!agentRecord(candidate) || typeof candidate.id !== 'string' || typeof candidate.requestId !== 'string' ||
      typeof candidate.assistantMessageId !== 'string' || typeof candidate.userMessageId !== 'string' ||
      typeof candidate.policyMode !== 'string' || !policyModes.has(candidate.policyMode) ||
      typeof candidate.status !== 'string' || !batchStatuses.has(candidate.status) ||
      typeof candidate.confirmationSource !== 'string' || !confirmationSources.has(candidate.confirmationSource) ||
      typeof candidate.requiredConfirmation !== 'boolean' ||
      (candidate.attemptOf !== undefined && typeof candidate.attemptOf !== 'string') ||
      (candidate.attemptKind !== undefined && (typeof candidate.attemptKind !== 'string' || !attemptKinds.has(candidate.attemptKind))) ||
      ((candidate.attemptOf === undefined) !== (candidate.attemptKind === undefined)) ||
      !Array.isArray(candidate.operations) ||
      candidate.operations.length < 1 || candidate.operations.length > AGENT_MAX_TOOL_CALLS_PER_REQUEST) throw new Error('invalid operation batch')
    assertAgentSessionId(candidate.id); assertAgentSessionId(candidate.requestId)
    assertAgentSessionId(candidate.assistantMessageId); assertAgentSessionId(candidate.userMessageId)
    if (candidate.attemptOf !== undefined) assertAgentSessionId(candidate.attemptOf)
    const createdAt = timestamp(candidate.createdAt), updatedAt = timestamp(candidate.updatedAt)
    const operations = candidate.operations.map((entry: unknown) => {
      if (!agentRecord(entry) || typeof entry.callId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(entry.callId) ||
        typeof entry.operation !== 'string' || !/^[a-z_]+(?:\.[a-z_]+)?$/.test(entry.operation) ||
        typeof entry.status !== 'string' || !itemStatuses.has(entry.status) || typeof entry.libraryId !== 'string' || !/^[0-9a-f]{32}$/.test(entry.libraryId) ||
        typeof entry.rootHash !== 'string' || !/^[0-9a-f]{64}$/.test(entry.rootHash) ||
        !Number.isSafeInteger(entry.rootGeneration) || Number(entry.rootGeneration) < 0 ||
        typeof entry.requiredConfirmation !== 'boolean' || typeof entry.confirmationSource !== 'string' || !confirmationSources.has(entry.confirmationSource) ||
        typeof entry.reversible !== 'boolean' || typeof entry.undoStatus !== 'string' || !undoStatuses.has(entry.undoStatus) ||
        !Array.isArray(entry.changes) || entry.changes.length > MAX_OPERATION_AUDIT_CHANGES_PER_ITEM) throw new Error('invalid operation item')
      if (entry.targetKind !== undefined && (typeof entry.targetKind !== 'string' || !targetKinds.has(entry.targetKind))) throw new Error('invalid operation target kind')
      if (entry.targetPath !== undefined && !safeRelativePath(entry.targetPath)) throw new Error('invalid operation target path')
      if (entry.targetStableId !== undefined && (typeof entry.targetStableId !== 'string' || entry.targetStableId.length > 128 ||
        /^[A-Za-z]:[\\/]/.test(entry.targetStableId) || entry.targetStableId.includes('\\'))) throw new Error('invalid operation stable identity')
      if (entry.targetDirectoryIdentity !== undefined && (typeof entry.targetDirectoryIdentity !== 'string' ||
        entry.targetDirectoryIdentity.length > 128 || !/^\d+:\d+:\d+$/.test(entry.targetDirectoryIdentity))) throw new Error('invalid operation directory identity')
      if (entry.targetPlanId !== undefined && (typeof entry.targetPlanId !== 'string' || !/^[0-9a-f]{32}$/.test(entry.targetPlanId))) throw new Error('invalid operation plan identity')
      if (entry.trashEntryId !== undefined && (typeof entry.trashEntryId !== 'string' || !/^[0-9a-f]{32}$/.test(entry.trashEntryId))) throw new Error('invalid operation trash identity')
      if (entry.componentId !== undefined && (typeof entry.componentId !== 'string' || !/^[0-9a-f]{32}$/.test(entry.componentId))) throw new Error('invalid operation component identity')
      if (entry.beforeUpdatedAt !== undefined) timestamp(entry.beforeUpdatedAt)
      if (entry.afterUpdatedAt !== undefined) timestamp(entry.afterUpdatedAt)
      if (entry.errorCategory !== undefined && (typeof entry.errorCategory !== 'string' || !errorCategories.has(entry.errorCategory))) throw new Error('invalid operation error category')
      if (entry.reconciliationReason !== undefined && (typeof entry.reconciliationReason !== 'string' || !reconciliationReasons.has(entry.reconciliationReason))) throw new Error('invalid reconciliation reason')
      if (entry.status !== 'succeeded' && entry.undoStatus === 'available') throw new Error('non-succeeded operation has undo available')
      if (entry.resolvedByAttempt !== undefined) assertAgentSessionId(entry.resolvedByAttempt)
      const itemCreatedAt = timestamp(entry.createdAt)
      const completedAt = entry.completedAt === undefined ? undefined : timestamp(entry.completedAt)
      const changes = entry.changes.map((change: unknown) => {
        if (!agentRecord(change) || typeof change.field !== 'string' || !/^[a-z_][a-z0-9_.-]{0,127}$/.test(change.field) ||
          (change.before !== null && typeof change.before !== 'string') || (change.after !== null && typeof change.after !== 'string') ||
          (typeof change.before === 'string' && Buffer.byteLength(change.before) > AGENT_MAX_AUDIT_FIELD_BYTES) ||
          (typeof change.after === 'string' && Buffer.byteLength(change.after) > AGENT_MAX_AUDIT_FIELD_BYTES)) throw new Error('invalid operation diff')
        return { field: change.field, before: change.before as string | null, after: change.after as string | null }
      })
      return {
        callId: entry.callId, operation: entry.operation, status: entry.status as AgentOperationBatchAudit['operations'][number]['status'],
        ...(entry.targetKind !== undefined ? { targetKind: entry.targetKind as AgentOperationBatchAudit['operations'][number]['targetKind'] } : {}),
        ...(entry.targetPath !== undefined ? { targetPath: entry.targetPath } : {}),
        ...(entry.targetStableId !== undefined ? { targetStableId: entry.targetStableId } : {}),
        ...(entry.targetDirectoryIdentity !== undefined ? { targetDirectoryIdentity: entry.targetDirectoryIdentity } : {}),
        ...(entry.targetPlanId !== undefined ? { targetPlanId: entry.targetPlanId } : {}),
        ...(entry.trashEntryId !== undefined ? { trashEntryId: entry.trashEntryId } : {}),
        ...(entry.componentId !== undefined ? { componentId: entry.componentId } : {}),
        libraryId: entry.libraryId, rootHash: entry.rootHash, rootGeneration: Number(entry.rootGeneration),
        ...(entry.beforeUpdatedAt !== undefined ? { beforeUpdatedAt: entry.beforeUpdatedAt as string } : {}),
        ...(entry.afterUpdatedAt !== undefined ? { afterUpdatedAt: entry.afterUpdatedAt as string } : {}),
        changes, requiredConfirmation: entry.requiredConfirmation, confirmationSource: entry.confirmationSource as AgentOperationBatchAudit['confirmationSource'],
        reversible: entry.reversible, undoStatus: entry.undoStatus as AgentOperationBatchAudit['operations'][number]['undoStatus'],
        ...(entry.reconciliationReason !== undefined ? { reconciliationReason: entry.reconciliationReason as AgentOperationBatchAudit['operations'][number]['reconciliationReason'] } : {}),
        ...(entry.errorCategory !== undefined ? { errorCategory: entry.errorCategory as AgentOperationBatchAudit['operations'][number]['errorCategory'] } : {}),
        ...(entry.resolvedByAttempt !== undefined ? { resolvedByAttempt: entry.resolvedByAttempt as string } : {}),
        createdAt: itemCreatedAt, ...(completedAt ? { completedAt } : {})
      }
    })
    if (new Set(operations.map((entry) => entry.callId)).size !== operations.length) throw new Error('duplicate operation call id')
    const unknownOutcomes = operations.flatMap((entry, index) => entry.status === 'outcome-unknown' ? [index] : [])
    const hasReconciliationStatus = candidate.status === 'reconciliation-required'
    if ((hasReconciliationStatus ? unknownOutcomes.length !== 1 : unknownOutcomes.length !== 0) || operations.some((entry) => entry.status === 'outcome-unknown'
      ? entry.reconciliationReason === undefined || entry.errorCategory !== 'storage' || entry.undoStatus !== 'unavailable' ||
        entry.completedAt === undefined || entry.resolvedByAttempt !== undefined
      : entry.reconciliationReason !== undefined)) throw new Error('invalid reconciliation outcome')
    if (hasReconciliationStatus) {
      const unknownIndex = unknownOutcomes[0]
      for (let index = 0; index < operations.length; index += 1) {
        const expected = index < unknownIndex ? 'succeeded' : index === unknownIndex ? 'outcome-unknown' : 'not-executed'
        if (operations[index].status !== expected) throw new Error('invalid reconciliation sequence')
      }
    }
    const statuses = operations.map((operation) => operation.status)
    const failureIndexes = statuses.flatMap((status, index) => status === 'failed' ? [index] : [])
    const validLifecycle = (() => {
      switch (candidate.status) {
        case 'preflight-failed':
          return failureIndexes.length === 1 && statuses.every((status, index) =>
            index === failureIndexes[0] ? status === 'failed' : status === 'not-executed')
        case 'pending-confirmation':
          return statuses.every((status) => status === 'ready')
        case 'executing': {
          let encounteredReady = false
          for (const status of statuses) {
            if (status === 'ready') encounteredReady = true
            else if (status !== 'succeeded' || encounteredReady) return false
          }
          return true
        }
        case 'awaiting-outbound-preview':
        case 'completed':
          return statuses.every((status) => status === 'succeeded')
        case 'execution-failed':
          return failureIndexes.length === 1 && statuses.every((status, index) => {
            if (index < failureIndexes[0]) return status === 'succeeded'
            if (index === failureIndexes[0]) return status === 'failed'
            return status === 'not-executed'
          })
        case 'reconciliation-required':
          return statuses.includes('outcome-unknown')
        case 'cancelled':
          return statuses.every((status) => status === 'cancelled')
        default:
          return false
      }
    })()
    if (!validLifecycle) throw new Error('invalid operation batch lifecycle')
    for (const operation of operations) {
      if (operation.status === 'ready' && (operation.completedAt !== undefined || operation.errorCategory !== undefined) ||
        operation.status === 'succeeded' && (operation.completedAt === undefined || operation.errorCategory !== undefined) ||
        operation.status === 'failed' && (operation.completedAt === undefined || operation.errorCategory === undefined) ||
        operation.status === 'not-executed' && (operation.completedAt === undefined || operation.errorCategory !== undefined) ||
        operation.status === 'cancelled' && (operation.completedAt === undefined || operation.errorCategory !== undefined) ||
        operation.resolvedByAttempt !== undefined && operation.status !== 'failed' && operation.status !== 'not-executed') {
        throw new Error('invalid operation item lifecycle')
      }
    }
    return {
      id: candidate.id, requestId: candidate.requestId, assistantMessageId: candidate.assistantMessageId,
      userMessageId: candidate.userMessageId, createdAt, updatedAt,
      policyMode: candidate.policyMode as AgentOperationBatchAudit['policyMode'],
      ...(candidate.attemptOf !== undefined ? { attemptOf: candidate.attemptOf as string } : {}),
      ...(candidate.attemptKind !== undefined ? { attemptKind: candidate.attemptKind as AgentOperationBatchAudit['attemptKind'] } : {}),
      status: candidate.status as AgentOperationBatchAudit['status'],
      confirmationSource: candidate.confirmationSource as AgentOperationBatchAudit['confirmationSource'],
      requiredConfirmation: candidate.requiredConfirmation, operations
    }
  })
  const batchIndexes = new Map<string, number>()
  for (const [index, batch] of batches.entries()) {
    if (batchIndexes.has(batch.id)) throw new Error('duplicate operation batch id')
    batchIndexes.set(batch.id, index)
  }
  for (const [index, batch] of batches.entries()) {
    if (batch.attemptOf !== undefined) {
      const parentIndex = batchIndexes.get(batch.attemptOf)
      if (parentIndex === undefined || parentIndex >= index) throw new Error('missing or future operation attempt ancestor')
      const parent = batches[parentIndex]
      if (parent.requestId !== batch.requestId || parent.assistantMessageId !== batch.assistantMessageId ||
        parent.userMessageId !== batch.userMessageId || batch.operations.some((operation) =>
          !parent.operations.some((parentOperation) => parentOperation.callId === operation.callId))) {
        throw new Error('invalid operation attempt ancestor')
      }
    }
    for (const operation of batch.operations) {
      if (operation.resolvedByAttempt === undefined) continue
      const targetIndex = batchIndexes.get(operation.resolvedByAttempt)
      if (targetIndex === undefined || targetIndex <= index) throw new Error('missing or invalid resolved operation attempt')
      let currentIndex = targetIndex
      let descendsFromBatch = false
      while (currentIndex > 0) {
        const current = batches[currentIndex]
        if (current.attemptOf === batch.id) {
          descendsFromBatch = true
          break
        }
        if (!current.attemptOf) break
        const ancestorIndex = batchIndexes.get(current.attemptOf)
        if (ancestorIndex === undefined || ancestorIndex >= currentIndex) throw new Error('invalid resolved operation ancestry')
        currentIndex = ancestorIndex
      }
      const resolvedAttempt = batches[targetIndex]
      if (!descendsFromBatch || resolvedAttempt.attemptKind === 'undo' ||
        !resolvedAttempt.operations.some((candidate) => candidate.callId === operation.callId && candidate.status === 'succeeded')) {
        throw new Error('invalid resolved operation attempt')
      }
    }
  }
  return batches
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
    if (!agentRecord(item) || typeof item.role !== 'string' || !['user', 'assistant', 'tool'].includes(item.role) ||
      typeof item.status !== 'string' || !['complete', 'streaming', 'user-interrupted', 'error-interrupted'].includes(item.status)) throw new Error('invalid message')
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
  const matchedToolResultIndexes = new Set<number>()
  for (let index = 0; index < messages.length; index += 1) {
    const assistant = messages[index]
    if (assistant.role !== 'assistant' || !assistant.toolCalls?.length) continue
    const firstResult = messages[index + 1]
    if (firstResult?.role !== 'tool' || firstResult.requestId !== assistant.requestId) continue
    let resultIndex = index + 1
    for (const call of assistant.toolCalls) {
      const result = messages[resultIndex]
      if (result?.role !== 'tool' || result.requestId !== assistant.requestId || result.toolCallId !== call.id) throw new Error('incomplete or out-of-order tool result group')
      matchedToolResultIndexes.add(resultIndex)
      resultIndex += 1
    }
    const extraResult = messages[resultIndex]
    if (extraResult?.role === 'tool' && extraResult.requestId === assistant.requestId) throw new Error('extra tool result in group')
  }
  if (messages.some((message, index) => message.role === 'tool' && !matchedToolResultIndexes.has(index))) throw new Error('orphaned or displaced tool result')
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
  return { id, ...input, createdAt: timestamp(value.createdAt), updatedAt: timestamp(value.updatedAt), revision: Number(value.revision), messages, requests, operationBatches: operationBatches(value.operationBatches) }
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
    if (!this.loadedSessions.has(id)) {
      let repaired = false
      const repairedAt = new Date().toISOString()
      if (session.messages.some((message) => message.status === 'streaming')) {
        session.messages = session.messages.map((message) => message.status === 'streaming' ? { ...message, status: 'error-interrupted' } : message)
        repaired = true
      }
      for (const batch of session.operationBatches) {
        if (batch.status !== 'executing') continue
        const uncertainIndex = batch.operations.findIndex((operation) => operation.status === 'ready')
        if (uncertainIndex < 0) {
          batch.status = 'awaiting-outbound-preview'
          batch.updatedAt = repairedAt
          repaired = true
          continue
        }
        batch.status = 'reconciliation-required'
        batch.updatedAt = repairedAt
        batch.operations = batch.operations.map((operation, index) => {
          if (index < uncertainIndex) return operation
          if (index === uncertainIndex) return {
            ...operation,
            status: 'outcome-unknown',
            confirmationSource: operation.requiredConfirmation ? batch.confirmationSource : 'policy',
            undoStatus: 'unavailable',
            reconciliationReason: 'process-interrupted',
            errorCategory: 'storage',
            completedAt: repairedAt
          }
          return {
            ...operation,
            status: 'not-executed',
            confirmationSource: 'none',
            undoStatus: 'unavailable',
            completedAt: repairedAt
          }
        })
        repaired = true
      }
      if (repaired) {
        session.revision += 1
        session.updatedAt = repairedAt
        session = parseSession(session, id)
        await this.write(session)
      }
    }
    this.loadedSessions.add(id)
    return session
  }
  create(input: AgentSessionInput): Promise<AgentSession> {
    return this.serial(async () => {
      const now = new Date().toISOString()
      const session: AgentSession = { id: randomUUID(), ...parseSessionInput(input), createdAt: now, updatedAt: now, revision: 0, messages: [], requests: [], operationBatches: [] }
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
