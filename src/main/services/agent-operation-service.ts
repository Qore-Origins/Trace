import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  AGENT_MAX_TOOL_CALLS_PER_REQUEST,
  type AgentCompletedToolCall, type AgentOperationAuditItem, type AgentOperationBatch, type AgentOperationBatchAudit, type AgentOperationConfirmationPreview,
  type AgentOperationBatchCancelInput, type AgentOperationBatchConfirmInput, type AgentOperationBatchReadInput, type AgentOperationTrashPreviewItem,
  type AgentOperationAttemptKind, type AgentOperationDecision, type AgentOperationErrorCategory, type AgentOperationResumeInput, type AgentOperationUndoInput, type AgentOperationValueChange
} from '../../shared/agent-types'
import type { Component, ComponentPayload, ComponentType, PlanDocument, TaskItem } from '../../shared/plan-types'
import type { ReferenceImpactDecision, ReferenceImpactPreview } from '../../shared/plan-reference-types'
import type { TrashRestoreDestination } from '../../shared/trash-types'
import { formatPlanNameTemplate } from '../../shared/plan-name-templates'
import { applyStatusChange } from '../../shared/task-state'
import { ERR, TraceError } from '../../shared/errors'
import { uuid32, validatePlanName } from '../../shared/validation'
import { AgentConversationService } from './agent-conversation-service'
import { AgentPolicyService } from './agent-policy-service'
import { AgentTargetService, validateAgentAuditedPath, type AgentActiveLibrarySnapshot, type AgentAuditedTargetSnapshot, type AgentTargetResolution } from './agent-target-service'
import { AgentSessionRepository, AGENT_MAX_AUDIT_FIELD_BYTES, AGENT_MAX_MESSAGE_LENGTH, agentRecord, assertAgentSessionId } from './agent-session-repository'
import { AgentToolName, parseAgentToolCalls } from './agent-tool-registry'
import { PlanNameTemplateService } from './plan-name-template-service'
import { PlanReferenceService } from './plan-reference-service'
import { StorageService } from './storage-service'

const PREVIEW_TTL_MS = 5 * 60 * 1000
const MAX_PENDING_BATCHES = 64
const MAX_RESULT_BYTES = AGENT_MAX_MESSAGE_LENGTH
const EDITABLE_AGENT_COMPONENT_TYPES = new Set<string>([
  'single_plan', 'multi_plan', 'task_list', 'task_detail', 'note', 'mood', 'heading', 'custom'
])

class PendingCapacityError extends TraceError {
  constructor() {
    super(ERR.STATE_MACHINE, '待确认操作批次过多')
  }
}

class StaleAttemptPreviewError extends TraceError {
  constructor() {
    super(ERR.CONFLICT, '操作预览已失效，来源操作状态已变化，请重新预检')
  }
}

type ReconciliationReason = Exclude<AgentOperationAuditItem['reconciliationReason'], undefined>

class PostSideEffectVerificationError extends Error {
  readonly reconciliationReason = 'post-side-effect-verification-failed' as const
  constructor() {
    super('A committed local change could not be verified')
  }
}

async function verifyCommittedSideEffect<T>(verification: () => Promise<T>): Promise<T> {
  try {
    return await verification()
  } catch {
    throw new PostSideEffectVerificationError()
  }
}

type JsonRecord = Record<string, unknown>
interface RequestContext { userMessageId: string; targetSetId?: string; targetRefs: string[] }
type AgentWriteRootSnapshot = AgentActiveLibrarySnapshot & { rootDirectoryIdentity: string }
interface StagedPlan { initialUpdatedAt: string; document: PlanDocument }
interface ExecutionResult {
  content: string
  afterUpdatedAt?: string
  undoStatus?: AgentOperationAuditItem['undoStatus']
  targetKind?: AgentOperationAuditItem['targetKind']
  targetPath?: string
  targetStableId?: string
  targetDirectoryIdentity?: string
  targetPlanId?: string
  trashEntryId?: string
}
interface PreparedOperation {
  call: AgentCompletedToolCall
  audit: AgentOperationAuditItem
  needsConfirmation: boolean
  referencePreview?: ReferenceImpactPreview
  folderPreview?: Awaited<ReturnType<PlanReferenceService['previewAgentFolderOperation']>>
  movePreview?: Awaited<ReturnType<PlanReferenceService['previewAgentMove']>>
  trashPreview?: Awaited<ReturnType<AgentTargetService['previewTrashOperation']>>
  stagedDocument?: PlanDocument
  stagedPath?: string
  execute: (decision?: AgentOperationDecision) => Promise<ExecutionResult>
}
interface PendingBatch {
  sessionId: string
  requestId: string
  assistantMessageId: string
  userMessageId: string
  token: string
  expiresAt: number
  rootSnapshot: AgentActiveLibrarySnapshot
  operations: PreparedOperation[]
  confirmationPreview?: AgentOperationConfirmationPreview
  appendToolResults: boolean
  attemptOf?: string
  attemptKind?: AgentOperationAttemptKind
  sourceStatuses?: Map<string, AgentOperationAuditItem['status']>
  reservedSourceKeys?: string[]
}

export interface AgentOperationConfirmationSnapshot {
  batchId: string
  expiresAt: string
  operations: Array<{
    callId: string
    operation: string
    targetKind?: AgentOperationAuditItem['targetKind']
    targetPath: string | null
    changes: AgentOperationValueChange[]
  }>
  confirmationPreview?: AgentOperationConfirmationPreview
  decisions: readonly AgentOperationDecision[]
}

export type AgentOperationTrustedConfirmationPresenter = (
  snapshot: Readonly<AgentOperationConfirmationSnapshot>,
  accept: () => Promise<AgentOperationBatch>
) => Promise<void>

function freezeSnapshot<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor && 'value' in descriptor) freezeSnapshot(descriptor.value)
    }
    Object.freeze(value)
  }
  return value
}

function operationConfirmationSnapshot(
  batchId: string,
  pending: PendingBatch,
  decisions: readonly AgentOperationDecision[]
): Readonly<AgentOperationConfirmationSnapshot> {
  return freezeSnapshot({
    batchId,
    expiresAt: new Date(pending.expiresAt).toISOString(),
    operations: pending.operations.map(({ audit }) => ({
      callId: audit.callId,
      operation: audit.operation,
      ...(audit.targetKind ? { targetKind: audit.targetKind } : {}),
      targetPath: audit.targetPath ?? null,
      changes: structuredClone(audit.changes)
    })),
    ...(pending.confirmationPreview ? { confirmationPreview: structuredClone(pending.confirmationPreview) } : {}),
    decisions: structuredClone(decisions)
  })
}

function confirmationPreviewFor(operations: readonly PreparedOperation[]): AgentOperationConfirmationPreview | undefined {
  const references = operations.flatMap((operation) => {
    const rows = operation.folderPreview?.references ?? operation.referencePreview?.references ?? []
    return rows.map((reference) => ({
      callId: operation.call.id,
      sourcePath: reference.source_path,
      sourceComponentId: reference.source_component_id,
      mode: reference.mode,
      targetNameSnapshot: reference.target_name_snapshot,
      allowedActions: operation.call.name.endsWith('.rename')
        ? ['update', 'keep'] as Array<'update' | 'keep' | 'replace'>
        : ['keep', 'replace'] as Array<'update' | 'keep' | 'replace'>
    }))
  })
  const affectedSubtrees = operations.flatMap((operation) => {
    const preview = operation.folderPreview
    if (!preview || preview.affected_subtree.length === 0) return []
    return [{
      callId: operation.call.id,
      targetPath: preview.path,
      entries: preview.affected_subtree.map((entry) => ({
        relativePath: entry.relative_path,
        kind: entry.kind,
        ...(entry.plan_id ? { planId: entry.plan_id } : {})
      }))
    }]
  })
  const trashOperations: AgentOperationTrashPreviewItem[] = operations.flatMap((operation) => {
    const preview = operation.trashPreview
    if (!preview) return []
    return [{
      callId: operation.call.id,
      operation: preview.operation,
      entryId: preview.entry_id,
      name: preview.name,
      originalRelativePath: preview.original_relative_path,
      restoreRelativePath: preview.restore_relative_path ?? null,
      planCount: preview.plan_count,
      referenceCount: preview.reference_count
    }]
  })
  return references.length > 0 || affectedSubtrees.length > 0 || trashOperations.length > 0
    ? {
      references,
      ...(affectedSubtrees.length > 0 ? { affectedSubtrees } : {}),
      ...(trashOperations.length > 0 ? { trashOperations } : {})
    }
    : undefined
}
interface PrepareBatchOptions {
  attemptOf?: string
  attemptKind?: AgentOperationAttemptKind
  forceConfirmation?: boolean
  appendToolResults?: boolean
  refreshablePlanRevisions?: Map<string, { stableId: string; beforeUpdatedAt: string; afterUpdatedAt: string }>
  sourceStatuses?: Map<string, AgentOperationAuditItem['status']>
  reservedSourceKeys?: string[]
}

function exactRecord(value: unknown, keys: readonly string[]): value is JsonRecord {
  if (!agentRecord(value)) return false
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) return false
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor !== undefined && 'value' in descriptor
  })
}

function isPlanResolution(value: AgentTargetResolution): value is Extract<AgentTargetResolution, { kind: 'plan' }> {
  return value.kind === 'plan'
}

function isFolderResolution(value: AgentTargetResolution): value is Extract<AgentTargetResolution, { kind: 'folder' }> {
  return value.kind === 'folder'
}

function serialized(value: unknown): string {
  const result = JSON.stringify(value)
  if (Buffer.byteLength(result, 'utf8') > MAX_RESULT_BYTES) throw new TraceError(ERR.VALIDATION, '工具结果过长，无法安全保存')
  return result
}

function auditValue(value: unknown): string | null {
  if (value === undefined) return null
  const text = JSON.stringify(value)
  if (Buffer.byteLength(text, 'utf8') <= AGENT_MAX_AUDIT_FIELD_BYTES) return text
  const bytes = Buffer.byteLength(text, 'utf8')
  const digest = createHash('sha256').update(text).digest('hex')
  return JSON.stringify({ summary: 'large-value', bytes, sha256: digest })
}

function change(field: string, before: unknown, after: unknown): AgentOperationValueChange {
  return { field, before: auditValue(before), after: auditValue(after) }
}

function readChangeValue(value: string | null): unknown {
  return value === null ? null : JSON.parse(value)
}

function safeErrorCategory(error: unknown): AgentOperationErrorCategory {
  if (!(error instanceof TraceError)) return 'internal'
  if (error.code === ERR.VALIDATION || error.code === ERR.FORMAT_INVALID) return 'validation'
  if (error.code === ERR.CONFLICT || error.code === ERR.STATE_MACHINE) return 'conflict'
  if (error.code === ERR.PATH_NOT_FOUND) return 'not-found'
  if (error.code === ERR.NAME_CONFLICT) return 'name-conflict'
  if (error.code === ERR.PATH_UNSAFE || error.code === ERR.CONFIRMATION_REQUIRED) return 'authorization'
  if (error.code === ERR.SAVE_FAILED || error.code === ERR.INTERNAL) return 'storage'
  return 'internal'
}

function errorResult(category: AgentOperationErrorCategory): string {
  return serialized({ ok: false, errorCategory: category })
}

function reconciliationRequiredResult(reason: ReconciliationReason): string {
  const message = reason === 'post-side-effect-verification-failed'
    ? '本地变更已提交，但目标身份或版本无法确认；请人工核对目标状态，核对前不要重试或撤销。'
    : '本地操作已返回，但执行结果审计未能可靠保存；请人工核对目标状态，核对前不要重试或撤销。'
  return serialized({ ok: false, outcome: 'reconciliation-required', reconciliationReason: reason, message })
}

function withPayload(component: Component, payload: JsonRecord): Component {
  return { ...component, payload: payload as unknown as ComponentPayload }
}

function strictName(value: unknown): string {
  if (typeof value !== 'string') throw new TraceError(ERR.VALIDATION, '计划名称无效')
  validatePlanName(value)
  return value
}

function pathWithNewName(path: string, name: string): string {
  const separator = path.lastIndexOf('/')
  const parent = separator >= 0 ? path.slice(0, separator) : ''
  return parent ? `${parent}/${name}` : name
}

function referencesFromArgs(args: JsonRecord): string[] {
  const keys = ['plan_ref', 'folder_ref', 'target_ref', 'parent_ref', 'trash_entry_ref', 'destination_parent_ref']
  return keys.flatMap((key) => typeof args[key] === 'string' ? [args[key] as string] : [])
}

const READ_ONLY_AGENT_TOOLS = new Set<string>(['plan.read', 'plan.list_children', 'trash.list'])

function ensureSameLibrary(snapshot: AgentActiveLibrarySnapshot, target: AgentTargetResolution): void {
  if (snapshot.rootHash !== target.rootHash || snapshot.libraryId !== target.libraryId || snapshot.rootGeneration !== target.rootGeneration) {
    throw new TraceError(ERR.CONFLICT, '计划库已变化，请重新预检')
  }
}

function isStructural(name: AgentToolName): boolean {
  return name.includes('.rename') || name.includes('.move') || name.includes('.trash') || name === 'trash.restore' || name === 'trash.purge' || name === 'component.delete'
}

function isUndoableTool(name: AgentToolName): boolean {
  return ['component.add', 'component.update', 'task.add', 'task.update', 'task.delete',
    'multi_option.add', 'multi_option.update', 'multi_option.delete', 'plan.create', 'folder.create',
    'plan.rename', 'folder.rename', 'plan.move', 'folder.move', 'plan.trash', 'folder.trash'].includes(name)
}

function permissionRequiresConfirmation(mode: 'confirm' | 'restricted' | 'unrestricted', name: AgentToolName, batchSize: number): boolean {
  if (name === 'trash.purge' || isStructural(name) || batchSize > 1) return true
  if (mode === 'confirm') return true
  if (mode === 'restricted') return !['plan.create', 'folder.create', 'component.add', 'component.update', 'task.add', 'task.update', 'multi_option.add', 'multi_option.update'].includes(name)
  return false
}

function asReferenceDecisions(decisions: AgentOperationDecision | undefined): ReferenceImpactDecision[] {
  return (decisions?.referenceDecisions ?? []).map((item) => ({
    source_path: item.sourcePath, source_component_id: item.sourceComponentId, action: item.action,
    ...(item.replacement ? { replacement: { path: item.replacement.path, ...(item.replacement.componentId ? { component_id: item.replacement.componentId } : {}) } } : {})
  }))
}

interface OperationFootprint {
  name: AgentToolName
  stableTarget?: string
  planWrites: string[]
  planReads: string[]
  folderReads: string[]
  parentPaths: string[]
  structuralRoots: Array<{ path: string; subtree: boolean }>
  referenceSources: string[]
  destinations: string[]
  creates: string[]
  readsTrash: boolean
  writesTrash: boolean
}

function pathMatchesRoot(path: string, root: string, subtree: boolean): boolean {
  return path === root || subtree && path.startsWith(`${root}/`)
}

function parseAuditPath(operation: PreparedOperation, field: string): string | undefined {
  const value = operation.audit.changes.find((item) => item.field === field)?.after
  if (typeof value !== 'string') return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'string' ? parsed : undefined
  } catch {
    return undefined
  }
}

function operationFootprint(operation: PreparedOperation, resolutions: Map<string, AgentTargetResolution>): OperationFootprint {
  const { name, arguments: args } = operation.call
  const resolutionFor = (key: string): AgentTargetResolution | undefined => {
    const ref = args[key]
    return typeof ref === 'string' ? resolutions.get(ref) : undefined
  }
  const plan = resolutionFor('plan_ref')
  const primary = resolutionFor('target_ref') ?? plan ?? resolutionFor('folder_ref') ?? resolutionFor('trash_entry_ref')
  const targetPath = primary?.path ?? undefined
  const isPlanWrite = Boolean(plan?.kind === 'plan' && name !== 'plan.read')
  const footprint: OperationFootprint = {
    name: name as AgentToolName,
    stableTarget: primary?.kind === 'trash' ? primary.entryId : primary?.kind === 'plan' ? primary.planId ?? `path:${primary.path}` : primary?.kind === 'folder' ? primary.directoryIdentity : undefined,
    planWrites: isPlanWrite && plan?.kind === 'plan' ? [plan.path] : [],
    planReads: name === 'plan.read' && plan?.kind === 'plan' ? [plan.path] : [],
    folderReads: name === 'plan.list_children' && primary?.kind === 'folder' ? [primary.path] : [],
    parentPaths: ['parent_ref', 'destination_parent_ref'].flatMap((key) => {
      const parent = resolutionFor(key)
      return parent?.kind === 'folder' ? [parent.path] : []
    }),
    structuralRoots: [], referenceSources: [], destinations: [], creates: [],
    readsTrash: name === 'trash.list',
    writesTrash: name === 'plan.trash' || name === 'folder.trash' || name === 'trash.restore' || name === 'trash.purge'
  }

  const isFolderStructural = name === 'folder.rename' || name === 'folder.move' || name === 'folder.trash'
  const isPlanStructural = name === 'plan.rename' || name === 'plan.move' || name === 'plan.trash' || name === 'component.delete'
  if (isFolderStructural && targetPath) footprint.structuralRoots.push({ path: targetPath, subtree: true })
  if (isPlanStructural && targetPath) footprint.structuralRoots.push({ path: targetPath, subtree: false })
  if (name === 'trash.restore') {
    const restoredPath = operation.trashPreview?.restore_relative_path
    if (restoredPath) {
      footprint.structuralRoots.push({ path: restoredPath, subtree: true })
      footprint.destinations.push(restoredPath)
    }
  }
  const moveDestination = operation.movePreview?.destination_path
  if (moveDestination) footprint.destinations.push(moveDestination)
  const folderDestination = operation.folderPreview?.destination_path
  if (folderDestination) footprint.destinations.push(folderDestination)
  const renameDestination = parseAuditPath(operation, 'path')
  if (renameDestination && (name === 'plan.rename' || name === 'folder.rename')) footprint.destinations.push(renameDestination)
  const createdPath = parseAuditPath(operation, 'created_path')
  if (createdPath) footprint.creates.push(createdPath)

  const referenceItems = operation.folderPreview?.references ?? operation.referencePreview?.references ?? []
  footprint.referenceSources = [...new Set(referenceItems.map((item) => item.source_path))]
  if (name === 'folder.move' && operation.movePreview) {
    for (const source of operation.movePreview.source_plans) {
      if (!footprint.structuralRoots.some((item) => item.path === source.path && item.subtree)) {
        footprint.structuralRoots.push({ path: source.path, subtree: false })
      }
    }
  }
  return footprint
}

function footprintsConflict(previous: OperationFootprint, next: OperationFootprint): boolean {
  const anyPathMatches = (path: string, roots: OperationFootprint['structuralRoots']): boolean =>
    roots.some((root) => pathMatchesRoot(path, root.path, root.subtree))
  const intersectsRoots = (left: OperationFootprint['structuralRoots'], right: OperationFootprint['structuralRoots']): boolean =>
    left.some((a) => right.some((b) => pathMatchesRoot(a.path, b.path, b.subtree) || pathMatchesRoot(b.path, a.path, a.subtree)))

  if (previous.stableTarget && previous.stableTarget === next.stableTarget &&
    previous.structuralRoots.length > 0 && next.structuralRoots.length > 0) return true
  if (intersectsRoots(previous.structuralRoots, next.structuralRoots)) return true
  if (previous.planWrites.some((path) => anyPathMatches(path, next.structuralRoots)) ||
    next.planWrites.some((path) => anyPathMatches(path, previous.structuralRoots))) return true
  if (previous.referenceSources.some((path) => anyPathMatches(path, next.structuralRoots)) ||
    next.referenceSources.some((path) => anyPathMatches(path, previous.structuralRoots))) return true
  if (previous.referenceSources.some((path) => next.planWrites.includes(path)) ||
    next.referenceSources.some((path) => previous.planWrites.includes(path))) return true
  if (previous.parentPaths.some((path) => anyPathMatches(path, next.structuralRoots)) ||
    next.parentPaths.some((path) => anyPathMatches(path, previous.structuralRoots))) return true
  if (previous.creates.some((path) => next.creates.includes(path)) ||
    previous.creates.some((path) => next.destinations.includes(path)) ||
    next.creates.some((path) => previous.destinations.includes(path))) return true
  if (previous.writesTrash && next.writesTrash || previous.writesTrash && next.readsTrash) return true

  const previousWrites = [...previous.planWrites, ...previous.creates, ...previous.destinations]
  if (previousWrites.some((path) => next.planReads.includes(path) || next.folderReads.some((folder) => pathMatchesRoot(path, folder, true))) ||
    previousWrites.some((path) => next.structuralRoots.some((root) => pathMatchesRoot(path, root.path, root.subtree)))) return true
  if (previous.structuralRoots.some((root) => next.planReads.some((path) => pathMatchesRoot(path, root.path, root.subtree)) ||
    next.folderReads.some((path) => pathMatchesRoot(path, root.path, root.subtree))) ||
    previous.writesTrash && next.readsTrash) return true
  return false
}

export class AgentOperationService {
  private readonly pending = new Map<string, PendingBatch>()
  private readonly pendingSlotReservations = new Set<string>()
  private readonly claimedBatches = new Set<string>()
  private readonly reservedSourceOperations = new Set<string>()

  constructor(
    private readonly conversations: AgentConversationService,
    private readonly targets: AgentTargetService,
    private readonly policies: AgentPolicyService,
    private readonly storage: StorageService,
    private readonly references: PlanReferenceService,
    private readonly templates: PlanNameTemplateService,
    private readonly now: () => number = Date.now
  ) {}

  retryBatch(payload: unknown): Promise<AgentOperationBatch> {
    return this.resumeBatch(payload, 'retry')
  }

  continueBatch(payload: unknown): Promise<AgentOperationBatch> {
    return this.resumeBatch(payload, 'continue')
  }

  private async resumeBatch(payload: unknown, kind: 'retry' | 'continue'): Promise<AgentOperationBatch> {
    if (!exactRecord(payload, ['sessionId', 'batchId', 'callIds']) || typeof payload.sessionId !== 'string' ||
      typeof payload.batchId !== 'string' || !Array.isArray(payload.callIds) || payload.callIds.length < 1 ||
      payload.callIds.length > AGENT_MAX_TOOL_CALLS_PER_REQUEST || payload.callIds.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(id)) ||
      new Set(payload.callIds).size !== payload.callIds.length) {
      throw new TraceError(ERR.VALIDATION, '操作批次重试请求无效')
    }
    const input = payload as unknown as AgentOperationResumeInput
    assertAgentSessionId(input.sessionId)
    assertAgentSessionId(input.batchId)
    const session = await this.conversations.sessions.read(input.sessionId)
    const source = session.operationBatches.find((batch) => batch.id === input.batchId)
    if (!source || source.status !== 'execution-failed') throw new TraceError(ERR.CONFLICT, '仅执行失败批次可以重试或继续')
    if (source.attemptKind === 'undo') throw new TraceError(ERR.CONFLICT, '撤销尝试不可重放，请先人工核对目标状态')
    const requiredStatus = kind === 'retry' ? 'failed' : 'not-executed'
    const selected = source.operations.filter((item) => input.callIds.includes(item.callId))
    if (selected.length !== input.callIds.length || selected.some((item) => item.status !== requiredStatus || item.resolvedByAttempt !== undefined)) {
      throw new TraceError(ERR.CONFLICT, kind === 'retry' ? '只能重试尚未成功的失败项' : '只能继续尚未执行的项目')
    }
    this.prunePending()
    const origin = this.attemptOrigin(session.operationBatches, source.id)
    if (selected.some((item) => this.hasUnresolvedAttempt(session.operationBatches, origin.id, item.callId))) {
      throw new TraceError(ERR.CONFLICT, '该来源操作存在待核验的执行尝试')
    }
    const reservationKeys = selected.map((item) => this.sourceOperationReservationKey(input.sessionId, session.operationBatches, source.id, item.callId))
    if (reservationKeys.some((key) => this.reservedSourceOperations.has(key))) throw new TraceError(ERR.CONFLICT, '来源操作已有待确认尝试')
    reservationKeys.forEach((key) => this.reservedSourceOperations.add(key))
    try {
    const assistant = session.messages.find((message) => message.id === source.assistantMessageId &&
      message.requestId === source.requestId && message.role === 'assistant' && message.status === 'complete')
    if (!assistant?.toolCalls?.length) throw new TraceError(ERR.CONFLICT, '原始模型工具调用已不可用')
    const context = await this.conversations.getRequestOperationContext(input.sessionId, source.requestId)
    if (context.userMessageId !== source.userMessageId) throw new TraceError(ERR.CONFLICT, '原始用户消息授权已变化')

    const selectedIds = new Set(input.callIds)
    const calls: AgentCompletedToolCall[] = []
    const refreshablePlanRevisions = new Map<string, { stableId: string; beforeUpdatedAt: string; afterUpdatedAt: string }>()
    for (const saved of assistant.toolCalls) {
      if (!selectedIds.has(saved.id)) continue
      const operation = source.operations.find((item) => item.callId === saved.id)
      if (!operation || operation.status !== requiredStatus || operation.resolvedByAttempt !== undefined) {
        throw new TraceError(ERR.CONFLICT, '原始工具调用状态已变化')
      }
      const args: unknown = JSON.parse(saved.function.arguments)
      if (!agentRecord(args)) throw new TraceError(ERR.FORMAT_INVALID, '原始工具参数无效')
      if (typeof args.plan_ref === 'string' && operation.targetStableId && operation.beforeUpdatedAt) {
        const sourceIndex = source.operations.findIndex((item) => item.callId === saved.id)
        const prefixWrite = source.operations.slice(0, sourceIndex).filter((item) =>
          item.status === 'succeeded' && item.targetStableId === operation.targetStableId && typeof item.afterUpdatedAt === 'string').at(-1)
        if (prefixWrite?.afterUpdatedAt) {
          if (args.expected_updated_at !== operation.beforeUpdatedAt) throw new TraceError(ERR.CONFLICT, '原始计划版本与操作审计不一致')
          refreshablePlanRevisions.set(args.plan_ref, {
            stableId: operation.targetStableId, beforeUpdatedAt: operation.beforeUpdatedAt, afterUpdatedAt: prefixWrite.afterUpdatedAt
          })
        }
      }
      calls.push({ id: saved.id, name: saved.function.name, arguments: args })
    }
    if (calls.length !== selectedIds.size) throw new TraceError(ERR.CONFLICT, '原始工具调用不完整')
    const batch = await this.prepareBatch(input.sessionId, source.requestId, source.assistantMessageId, calls, {
      attemptOf: source.id, attemptKind: kind, forceConfirmation: true, appendToolResults: false,
      refreshablePlanRevisions, sourceStatuses: new Map(selected.map((item) => [item.callId, requiredStatus])), reservedSourceKeys: reservationKeys
    })
    if (batch.status !== 'pending-confirmation') this.releaseSourceKeys(reservationKeys)
    return batch
    } catch (error) {
      this.releaseSourceKeys(reservationKeys)
      throw error
    }
  }

  async undoOperation(payload: unknown): Promise<AgentOperationBatch> {
    if (!exactRecord(payload, ['sessionId', 'batchId', 'callId']) || typeof payload.sessionId !== 'string' ||
      typeof payload.batchId !== 'string' || typeof payload.callId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(payload.callId)) {
      throw new TraceError(ERR.VALIDATION, '操作撤销请求无效')
    }
    const input = payload as unknown as AgentOperationUndoInput
    assertAgentSessionId(input.sessionId)
    assertAgentSessionId(input.batchId)
    const session = await this.conversations.sessions.read(input.sessionId)
    const source = session.operationBatches.find((batch) => batch.id === input.batchId)
    if (!source || (source.status !== 'awaiting-outbound-preview' && source.status !== 'completed' && source.status !== 'execution-failed')) {
      throw new TraceError(ERR.CONFLICT, '该操作批次当前不可撤销')
    }
    const sourceOperation = source.operations.find((item) => item.callId === input.callId)
    if (!sourceOperation || sourceOperation.status !== 'succeeded' || sourceOperation.undoStatus !== 'available' || !sourceOperation.reversible) {
      throw new TraceError(ERR.CONFLICT, '该操作没有可用的安全撤销方式')
    }
    const name = sourceOperation.operation as AgentToolName
    if (!isUndoableTool(name)) throw new TraceError(ERR.CONFLICT, '该操作类型暂不支持撤销')
    this.prunePending()
    const origin = this.attemptOrigin(session.operationBatches, source.id)
    if (this.hasUnresolvedAttempt(session.operationBatches, origin.id, sourceOperation.callId)) {
      throw new TraceError(ERR.CONFLICT, '该来源操作存在待核验的执行尝试')
    }
    const assistant = session.messages.find((message) => message.id === source.assistantMessageId &&
      message.requestId === source.requestId && message.role === 'assistant' && message.status === 'complete')
    const savedCall = assistant?.toolCalls?.find((item) => item.id === sourceOperation.callId)
    if (!savedCall || savedCall.function.name !== sourceOperation.operation) throw new TraceError(ERR.CONFLICT, '原始操作溯源已变化')
    const args: unknown = JSON.parse(savedCall.function.arguments)
    if (!agentRecord(args)) throw new TraceError(ERR.CONFLICT, '原始操作参数不可用')
    const context = await this.conversations.getRequestOperationContext(input.sessionId, source.requestId)
    if (context.userMessageId !== source.userMessageId) throw new TraceError(ERR.CONFLICT, '原始用户消息授权已失效')
    const rootSnapshot = await this.targets.captureActiveLibrarySnapshot()
    if (rootSnapshot.libraryId !== sourceOperation.libraryId || rootSnapshot.rootHash !== sourceOperation.rootHash ||
      rootSnapshot.rootGeneration !== sourceOperation.rootGeneration) throw new TraceError(ERR.CONFLICT, '原计划库身份已变化，不能撤销')
    const writeRootSnapshot = await this.references.captureAgentRootSnapshot(this.storage, rootSnapshot,
      () => this.targets.assertActiveLibrarySnapshot(rootSnapshot))

    if (['plan.create', 'folder.create', 'plan.rename', 'folder.rename', 'plan.move', 'folder.move', 'plan.trash', 'folder.trash'].includes(name)) {
      return this.prepareStructuralUndo(input, source, sourceOperation, name, args, context, rootSnapshot, writeRootSnapshot, session.operationBatches)
    }
    if (typeof args.plan_ref !== 'string' || !context.targetSetId) throw new TraceError(ERR.CONFLICT, '原始计划授权信息不可用')

    const resolution = await this.targets.refreshGrantForMessage({ setId: context.targetSetId, ref: args.plan_ref }, context.userMessageId, rootSnapshot)
    const stableId = resolution.kind === 'plan' ? resolution.planId ?? `path:${resolution.path}` : undefined
    if (resolution.kind !== 'plan' || stableId !== sourceOperation.targetStableId ||
      resolution.updatedAt !== sourceOperation.afterUpdatedAt || !sourceOperation.afterUpdatedAt) {
      await this.markUndoStale(input.sessionId, source.id, input.callId)
      throw new TraceError(ERR.CONFLICT, '原计划版本已变化，不能撤销')
    }
    const document = await this.storage.readPlan(resolution.path)
    if (document.updated_at !== sourceOperation.afterUpdatedAt || (resolution.planId && document.plan_id !== resolution.planId)) {
      await this.markUndoStale(input.sessionId, source.id, input.callId)
      throw new TraceError(ERR.CONFLICT, '原计划版本已变化，不能撤销')
    }

    const inverse = structuredClone(document)
    const inverseChanges: AgentOperationValueChange[] = []
    const diffField = name === 'component.add' || name === 'component.update' ? 'component'
      : name.startsWith('task.') ? 'task_list.items' : 'multi_plan.options'
    const recorded = sourceOperation.changes.find((item) => item.field === diffField)
    if (!recorded) throw new TraceError(ERR.CONFLICT, '操作差异审计不完整，不能撤销')
    const before = readChangeValue(recorded.before)
    const after = readChangeValue(recorded.after)
    let componentId = sourceOperation.componentId
    if (name === 'component.add') {
      if (!agentRecord(after) || typeof after.id !== 'string' || !/^[0-9a-f]{32}$/.test(after.id)) throw new TraceError(ERR.FORMAT_INVALID, '新增组件撤销审计无效')
      componentId = after.id
      const current = inverse.components.filter((component) => component.id === componentId)
      if (current.length !== 1 || JSON.stringify(current[0]) !== JSON.stringify(after)) throw new TraceError(ERR.CONFLICT, '新增组件当前内容已变化，不能撤销')
      inverse.components = inverse.components.filter((component) => component.id !== componentId)
      inverseChanges.push(change('component', current[0], null))
    } else {
      if (!componentId) throw new TraceError(ERR.FORMAT_INVALID, '操作差异缺少组件标识')
      const matches = inverse.components.filter((component) => component.id === componentId)
      if (matches.length !== 1 || matches[0].type === 'plan_reference') throw new TraceError(ERR.CONFLICT, '目标组件身份已变化，不能撤销')
      const current = matches[0]
      if (name === 'component.update') {
        if (!agentRecord(before) || !agentRecord(after) || JSON.stringify(current) !== JSON.stringify(after) ||
          before.id !== componentId || after.id !== componentId || typeof before.type !== 'string' || before.type !== after.type) {
          throw new TraceError(ERR.CONFLICT, '组件当前内容已变化，不能撤销')
        }
        inverse.components[inverse.components.indexOf(current)] = structuredClone(before) as unknown as Component
        inverseChanges.push(change('component', current, before))
      } else if (name.startsWith('task.')) {
        if (current.type !== 'task_list' || !Array.isArray(before) || !Array.isArray(after) ||
          JSON.stringify((current.payload as { items?: unknown }).items) !== JSON.stringify(after)) {
          throw new TraceError(ERR.CONFLICT, '任务列表当前内容已变化，不能撤销')
        }
        const payload = structuredClone(current.payload) as unknown as JsonRecord
        payload.items = structuredClone(before)
        inverse.components[inverse.components.indexOf(current)] = withPayload(current, payload)
        inverseChanges.push(change(diffField, after, before))
      } else {
        if (current.type !== 'multi_plan' || !Array.isArray(before) || !Array.isArray(after) ||
          JSON.stringify((current.payload as { options?: unknown }).options) !== JSON.stringify(after)) {
          throw new TraceError(ERR.CONFLICT, '计划选项当前内容已变化，不能撤销')
        }
        const payload = structuredClone(current.payload) as unknown as JsonRecord
        payload.options = structuredClone(before)
        inverse.components[inverse.components.indexOf(current)] = withPayload(current, payload)
        inverseChanges.push(change(diffField, after, before))
      }
    }

    const createdAt = new Date(this.now()).toISOString()
    const batchId = randomUUID()
    const auditItem: AgentOperationAuditItem = {
      callId: sourceOperation.callId, operation: 'undo.operation', status: 'ready', targetKind: 'plan',
      targetPath: resolution.path, targetStableId: sourceOperation.targetStableId, ...(componentId ? { componentId } : {}),
      libraryId: rootSnapshot.libraryId, rootHash: rootSnapshot.rootHash, rootGeneration: rootSnapshot.rootGeneration,
      beforeUpdatedAt: document.updated_at, changes: inverseChanges, requiredConfirmation: true,
      confirmationSource: 'none', reversible: false, undoStatus: 'unavailable', createdAt
    }
    const audit: AgentOperationBatchAudit = {
      id: batchId, requestId: source.requestId, assistantMessageId: source.assistantMessageId, userMessageId: source.userMessageId,
      createdAt, updatedAt: createdAt, policyMode: source.policyMode, attemptOf: source.id, attemptKind: 'undo',
      status: 'pending-confirmation', confirmationSource: 'none', requiredConfirmation: true, operations: [auditItem]
    }
    const call: AgentCompletedToolCall = { id: sourceOperation.callId, name: sourceOperation.operation, arguments: args }
    const reservationKey = this.sourceOperationReservationKey(input.sessionId, session.operationBatches, source.id, sourceOperation.callId)
    if (this.reservedSourceOperations.has(reservationKey)) throw new TraceError(ERR.CONFLICT, '该操作已有待确认撤销')
    this.reservedSourceOperations.add(reservationKey)
    const operation: PreparedOperation = {
      call, audit: auditItem, needsConfirmation: true,
      execute: async () => {
        await this.targets.assertActiveLibrarySnapshot(rootSnapshot)
        const fresh = await this.targets.refreshGrantForMessage({ setId: context.targetSetId!, ref: args.plan_ref as string }, context.userMessageId, rootSnapshot)
        if (fresh.kind !== 'plan' || fresh.planId !== resolution.planId || fresh.path !== resolution.path) {
          throw new TraceError(ERR.CONFLICT, '原计划版本已变化，请重新预览撤销')
        }
        const current = await this.storage.readPlan(fresh.path)
        if (current.updated_at !== sourceOperation.afterUpdatedAt) throw new TraceError(ERR.CONFLICT, '原计划版本已变化，请重新预览撤销')
        const next = structuredClone(inverse)
        next.updated_at = current.updated_at
        const saved = await this.references.saveAgentPlan(this.storage, resolution.path, next, writeRootSnapshot, {
          path: resolution.path, directoryIdentity: fresh.directoryIdentity, planId: fresh.planId,
          updatedAt: current.updated_at
        }, () => this.targets.assertActiveLibrarySnapshot(rootSnapshot))
        return { content: serialized({ ok: true, operation: 'undo', path: resolution.path, updated_at: saved.updated_at }), afterUpdatedAt: saved.updated_at }
      }
    }
    const pending: PendingBatch = {
        sessionId: input.sessionId, requestId: source.requestId, assistantMessageId: source.assistantMessageId,
        userMessageId: source.userMessageId, token: randomBytes(32).toString('base64url'), expiresAt: this.now() + PREVIEW_TTL_MS,
        rootSnapshot, operations: [operation], appendToolResults: false, attemptOf: source.id, attemptKind: 'undo',
        sourceStatuses: new Map([[sourceOperation.callId, 'succeeded']]), reservedSourceKeys: [reservationKey]
    }
    try {
      this.reservePendingSlot(batchId)
      await this.storeBatch(input.sessionId, audit)
      this.installPending(batchId, pending)
      return { ...audit }
    } catch (error) {
      this.releasePendingSlotReservation(batchId)
      this.releaseSourceKeys([reservationKey])
      throw error
    }
  }

  private async prepareStructuralUndo(input: AgentOperationUndoInput, source: AgentOperationBatchAudit,
    sourceOperation: AgentOperationAuditItem, name: AgentToolName, args: JsonRecord,
    context: RequestContext, rootSnapshot: AgentActiveLibrarySnapshot, writeRootSnapshot: AgentWriteRootSnapshot,
    batches: readonly AgentOperationBatchAudit[]): Promise<AgentOperationBatch> {
    const rootCommitBinding = {
      rootSnapshot: writeRootSnapshot,
      validateRootSnapshot: () => this.targets.assertActiveLibrarySnapshot(rootSnapshot)
    }
    const reservationKey = this.sourceOperationReservationKey(input.sessionId, batches, source.id, sourceOperation.callId)
    this.prunePending()
    if (this.reservedSourceOperations.has(reservationKey)) throw new TraceError(ERR.CONFLICT, '该操作已有待确认撤销')
    this.reservedSourceOperations.add(reservationKey)
    let pendingBatchId: string | undefined
    let verifiedStale = false
    try {
      const isCreate = name === 'plan.create' || name === 'folder.create'
      const isTrash = name === 'plan.trash' || name === 'folder.trash'
      const kind = name.startsWith('folder.') ? 'folder' as const : 'plan' as const
      const auditPath = (field: string, side: 'before' | 'after'): string => {
        const recorded = sourceOperation.changes.find((item) => item.field === field)
        const value = recorded ? readChangeValue(recorded[side]) : undefined
        if (typeof value !== 'string' || !value || value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:/.test(value) ||
          value.includes('\\') || value.split('/').some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) {
          throw new TraceError(ERR.CONFLICT, '操作审计缺少安全的相对路径')
        }
        return value
      }
      const planId = sourceOperation.targetPlanId ?? null
      const identity = sourceOperation.targetDirectoryIdentity
      if (!identity || sourceOperation.targetKind !== kind) throw new TraceError(ERR.CONFLICT, '操作审计缺少稳定目标身份')

      let targetPath: string
      let beforePath: string | undefined
      let afterPath: string | undefined
      let auditedTarget: AgentAuditedTargetSnapshot | AgentTargetResolution | undefined
      let referencePreview: ReferenceImpactPreview | undefined
      let folderPreview: PreparedOperation['folderPreview']
      let movePreview: PreparedOperation['movePreview']
      let trashPreview: PreparedOperation['trashPreview']
      let expectedTrashId: string | undefined
      let createdPlanTarget: AgentAuditedTargetSnapshot | undefined

      if (isCreate) {
        targetPath = auditPath('created_path', 'after')
        auditedTarget = await this.targets.captureAuditedTarget(rootSnapshot, targetPath, kind)
        if (kind === 'plan') createdPlanTarget = auditedTarget
        if (auditedTarget.directoryIdentity !== identity || (planId !== null && auditedTarget.planId !== planId)) {
          verifiedStale = true
          throw new TraceError(ERR.CONFLICT, '新建对象身份已变化，不能撤销')
        }
        if (kind === 'plan') {
          referencePreview = await this.references.previewImpact({ library_id: rootSnapshot.libraryId, operation: 'delete-plan', path: targetPath })
        } else {
          folderPreview = await this.references.previewAgentFolderOperation({ operation: 'trash', path: targetPath }, this.storage)
        }
      } else if (isTrash) {
        targetPath = sourceOperation.targetPath ?? ''
        const trashId = sourceOperation.trashEntryId
        if (!trashId || !/^[0-9a-f]{32}$/.test(trashId) || !context.targetSetId || typeof args.target_ref !== 'string') {
          throw new TraceError(ERR.CONFLICT, '原删除操作缺少精确回收站溯源')
        }
        await this.targets.assertGrantBindingForMessage({ setId: context.targetSetId, ref: args.target_ref }, context.userMessageId,
          rootSnapshot, { kind, directoryIdentity: identity, planId })
        let entry
        try {
          entry = await this.storage.readTrashEntry(trashId)
        } catch (error) {
          if (!(error instanceof TraceError) || (error.code !== ERR.PATH_NOT_FOUND && error.code !== ERR.CONFLICT)) throw error
          verifiedStale = true
          throw new TraceError(ERR.CONFLICT, '原删除回收站条目已变化或不可恢复')
        }
        if (!entry || entry.status !== 'trashed' || !entry.can_restore || entry.kind !== kind || entry.original_relative_path !== targetPath) {
          verifiedStale = true
          throw new TraceError(ERR.CONFLICT, '原删除回收站条目已变化或不可恢复')
        }
        const targetGrant = await this.storage.issueTrashEntryTarget(trashId)
        trashPreview = await this.storage.previewTrashRestore(trashId, undefined, targetGrant.token)
        if (trashPreview.entry_id !== trashId || trashPreview.original_relative_path !== targetPath) {
          verifiedStale = true
          throw new TraceError(ERR.CONFLICT, '回收站恢复预览与原删除条目不匹配')
        }
        expectedTrashId = trashId
      } else {
        beforePath = auditPath('path', 'before')
        afterPath = auditPath('path', 'after')
        targetPath = afterPath
        if (!context.targetSetId || typeof args.target_ref !== 'string') throw new TraceError(ERR.CONFLICT, '原结构操作授权不可用')
        const resolvedTarget = await this.targets.resolveAuditedRelocationForMessage({
          setId: context.targetSetId, ref: args.target_ref, kind, path: afterPath,
          directoryIdentity: identity, ...(kind === 'plan' ? { planId } : {})
        }, context.userMessageId, rootSnapshot)
        const targetChanged = kind === 'plan'
          ? resolvedTarget.kind !== 'plan' || resolvedTarget.directoryIdentity !== identity ||
            resolvedTarget.planId !== planId || resolvedTarget.updatedAt !== sourceOperation.afterUpdatedAt
          : resolvedTarget.kind !== 'folder' || resolvedTarget.directoryIdentity !== identity
        if (targetChanged) {
          verifiedStale = true
          throw new TraceError(ERR.CONFLICT, '结构操作目标版本或身份已变化，不能撤销')
        }
        auditedTarget = resolvedTarget
        if (name === 'plan.rename') {
          const oldName = beforePath.split('/').at(-1)!
          referencePreview = await this.references.previewImpact({ library_id: rootSnapshot.libraryId,
            operation: 'rename-plan', path: afterPath, new_name: oldName })
        } else if (name === 'folder.rename') {
          const oldName = beforePath.split('/').at(-1)!
          folderPreview = await this.references.previewAgentFolderOperation({ operation: 'rename', path: afterPath, new_name: oldName }, this.storage)
        } else {
          const targetParentPath = beforePath.includes('/') ? beforePath.slice(0, beforePath.lastIndexOf('/')) : ''
          movePreview = await this.references.previewAgentMove({ path: afterPath, target_parent_path: targetParentPath }, this.storage)
          if (movePreview.destination_path !== beforePath) throw new TraceError(ERR.NAME_CONFLICT, '原位置已出现冲突，不能撤销移动')
        }
      }

      const inverseChanges = isCreate
        ? [change('created_path', targetPath, 'trash')]
        : isTrash
          ? [change('trash', 'trash', targetPath)]
          : [change('path', afterPath, beforePath)]
      const createdAt = new Date(this.now()).toISOString()
      const batchId = randomUUID()
      pendingBatchId = batchId
      const auditItem: AgentOperationAuditItem = {
        callId: sourceOperation.callId, operation: 'undo.operation', status: 'ready', targetKind: isTrash ? 'trash' : kind,
        targetPath, targetStableId: isTrash ? expectedTrashId : sourceOperation.targetStableId,
        targetDirectoryIdentity: identity, ...(planId ? { targetPlanId: planId } : {}),
        ...(expectedTrashId ? { trashEntryId: expectedTrashId } : {}),
        libraryId: rootSnapshot.libraryId, rootHash: rootSnapshot.rootHash, rootGeneration: rootSnapshot.rootGeneration,
        ...(auditedTarget?.kind === 'plan' && auditedTarget.updatedAt ? { beforeUpdatedAt: auditedTarget.updatedAt } : {}), changes: inverseChanges,
        requiredConfirmation: true, confirmationSource: 'none', reversible: false, undoStatus: 'unavailable', createdAt
      }
      const audit: AgentOperationBatchAudit = {
        id: batchId, requestId: source.requestId, assistantMessageId: source.assistantMessageId, userMessageId: source.userMessageId,
        createdAt, updatedAt: createdAt, policyMode: source.policyMode, attemptOf: source.id, attemptKind: 'undo',
        status: 'pending-confirmation', confirmationSource: 'none', requiredConfirmation: true, operations: [auditItem]
      }
      const callName: AgentToolName = isCreate ? kind === 'plan' ? 'plan.trash' : 'folder.trash' : name
      const call: AgentCompletedToolCall = { id: sourceOperation.callId, name: callName, arguments: args }
      const operation: PreparedOperation = {
        call, audit: auditItem, needsConfirmation: true, referencePreview, folderPreview, movePreview, trashPreview,
        execute: async (decision) => {
          await this.targets.assertActiveLibrarySnapshot(rootSnapshot)
          if (isCreate) {
            const current = await this.targets.captureAuditedTarget(rootSnapshot, targetPath, kind)
            if (current.directoryIdentity !== identity || (planId !== null && current.planId !== planId)) throw new TraceError(ERR.CONFLICT, '新建对象身份已变化，请重新预览撤销')
            const result = kind === 'plan'
              ? await this.references.commitAgentImpact({ library_id: rootSnapshot.libraryId, preview: referencePreview!, decisions: asReferenceDecisions(decision) }, this.storage,
                { ...rootCommitBinding,
                  target: { path: targetPath, directoryIdentity: identity, planId: createdPlanTarget!.planId,
                    updatedAt: createdPlanTarget!.updatedAt! } })
              : await this.references.commitAgentFolderOperation({ token: folderPreview!.token, decisions: asReferenceDecisions(decision) }, this.storage,
                rootCommitBinding)
            return verifyCommittedSideEffect(async () => {
              if (!result.trash_entry_id) throw new Error('The committed undo has no verifiable trash entry')
              return { content: serialized({ ok: true, operation: 'undo-create', trash_entry_id: result.trash_entry_id }),
                trashEntryId: result.trash_entry_id, targetKind: kind, targetPath,
                targetStableId: sourceOperation.targetStableId, targetDirectoryIdentity: identity,
                ...(planId ? { targetPlanId: planId } : {}) }
            })
          }
          if (isTrash) {
            const result = await this.references.commitTrashRestore(this.storage, trashPreview!.confirmation_token, rootCommitBinding)
            return verifyCommittedSideEffect(async () => {
              const restoredPath = result.path ?? trashPreview!.restore_relative_path
              if (!restoredPath || restoredPath !== targetPath) throw new Error('The committed restore path could not be verified')
              const restored = await this.targets.captureAuditedTarget(rootSnapshot, restoredPath, kind)
              if (restored.directoryIdentity !== identity || restored.planId !== planId) throw new Error('The restored target identity could not be verified')
              return { content: serialized({ ok: true, operation: 'undo-trash', path: restoredPath }),
                targetKind: kind, targetPath: restoredPath, targetDirectoryIdentity: identity,
                targetStableId: sourceOperation.targetStableId, ...(restored.updatedAt ? { afterUpdatedAt: restored.updatedAt } : {}),
                ...(planId ? { targetPlanId: planId } : {}) }
            })
          }
          let resultPath = beforePath!
          if (name === 'plan.rename') {
            const fresh = await this.targets.resolveAuditedRelocationForMessage({ setId: context.targetSetId!, ref: args.target_ref as string,
              kind, path: afterPath!, directoryIdentity: identity, planId }, context.userMessageId, rootSnapshot)
            if (fresh.kind !== 'plan' || fresh.updatedAt !== sourceOperation.afterUpdatedAt) throw new TraceError(ERR.CONFLICT, '计划版本已变化，请重新预览撤销')
            const rename = await this.references.commitAgentImpact({ library_id: rootSnapshot.libraryId, preview: referencePreview!, rename_action: decision?.renameAction }, this.storage,
              { ...rootCommitBinding,
                target: { path: afterPath!, directoryIdentity: identity, planId, updatedAt: sourceOperation.afterUpdatedAt! } })
            resultPath = rename.path ?? beforePath!
          } else if (name === 'folder.rename') {
            await this.targets.resolveAuditedRelocationForMessage({ setId: context.targetSetId!, ref: args.target_ref as string,
              kind, path: afterPath!, directoryIdentity: identity }, context.userMessageId, rootSnapshot)
            const renamed = await this.references.commitAgentFolderOperation({ token: folderPreview!.token,
              rename_action: decision?.renameAction }, this.storage, rootCommitBinding)
            resultPath = renamed.path ?? beforePath!
          } else {
            await this.targets.resolveAuditedRelocationForMessage({ setId: context.targetSetId!, ref: args.target_ref as string,
              kind, path: afterPath!, directoryIdentity: identity, ...(kind === 'plan' ? { planId } : {}) }, context.userMessageId, rootSnapshot)
            const moved = await this.references.commitAgentMove(movePreview!.token, this.storage, rootCommitBinding)
            resultPath = moved.path
          }
          return verifyCommittedSideEffect(async () => {
            if (resultPath !== beforePath) throw new Error('The committed structure path could not be verified')
            const restored = await this.targets.captureAuditedTarget(rootSnapshot, resultPath, kind)
            if (restored.directoryIdentity !== identity || restored.planId !== planId) throw new Error('The restored structure identity could not be verified')
            return { content: serialized({ ok: true, operation: 'undo-structure', path: resultPath }),
              targetKind: kind, targetPath: resultPath, targetDirectoryIdentity: identity,
              targetStableId: sourceOperation.targetStableId, ...(restored.updatedAt ? { afterUpdatedAt: restored.updatedAt } : {}),
              ...(planId ? { targetPlanId: planId } : {}) }
          })
        }
      }
      const displayPreview = confirmationPreviewFor([operation])
      const pending: PendingBatch = {
        sessionId: input.sessionId, requestId: source.requestId, assistantMessageId: source.assistantMessageId,
        userMessageId: source.userMessageId, token: randomBytes(32).toString('base64url'), expiresAt: this.now() + PREVIEW_TTL_MS,
        rootSnapshot, operations: [operation], ...(displayPreview ? { confirmationPreview: displayPreview } : {}),
        appendToolResults: false, attemptOf: source.id, attemptKind: 'undo',
        sourceStatuses: new Map([[sourceOperation.callId, 'succeeded']]), reservedSourceKeys: [reservationKey]
      }
      this.reservePendingSlot(batchId)
      await this.storeBatch(input.sessionId, audit)
      this.installPending(batchId, pending)
      return { ...audit, ...(displayPreview ? { confirmationPreview: displayPreview } : {}) }
    } catch (error) {
      if (pendingBatchId) this.releasePendingSlotReservation(pendingBatchId)
      this.releaseSourceKeys([reservationKey])
      if (verifiedStale) {
        await this.markUndoStale(input.sessionId, source.id, sourceOperation.callId).catch(() => undefined)
      }
      throw error
    }
  }

  async prepareBatch(sessionId: string, requestId: string, assistantMessageId: string, calls: readonly AgentCompletedToolCall[], options: PrepareBatchOptions = {}): Promise<AgentOperationBatch> {
    const context = await this.conversations.getRequestOperationContext(sessionId, requestId)
    const session = await this.conversations.sessions.read(sessionId)
    const assistant = session.messages.find((message) => message.id === assistantMessageId && message.requestId === requestId && message.role === 'assistant')
    const savedById = new Map(assistant?.toolCalls?.map((saved) => [saved.id, saved]) ?? [])
    const callsMatch = assistant?.status === 'complete' && Boolean(assistant.toolCalls?.length) && calls.length > 0 &&
      (options.attemptOf !== undefined || assistant.toolCalls?.length === calls.length) &&
      calls.every((call) => {
        const saved = savedById.get(call.id)
        return saved?.function.name === call.name && JSON.stringify(JSON.parse(saved.function.arguments)) === JSON.stringify(call.arguments)
      })
    if (!assistant || !callsMatch) {
      throw new TraceError(ERR.CONFLICT, '工具调用不属于当前已完成的模型响应')
    }
    const policy = await this.policies.get()
    const rootSnapshot = await this.targets.captureActiveLibrarySnapshot()
    const batchId = randomUUID()
    const createdAt = new Date(this.now()).toISOString()
    const initialAudit = calls.map((call) => this.auditItem(call, rootSnapshot, createdAt, policy.mode, calls.length))
    let parsed: AgentCompletedToolCall[]
    try {
      parsed = parseAgentToolCalls(calls.map((call) => ({
        id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) }
      })))
    } catch (error) {
      const failed = this.failedBatch(batchId, sessionId, requestId, assistantMessageId, context.userMessageId, policy.mode, createdAt, initialAudit, 0, safeErrorCategory(error), options)
      await this.storeBatch(sessionId, failed)
      if (options.appendToolResults !== false) await this.appendResults(sessionId, assistantMessageId, failed.operations)
      return failed
    }

    const resolutions = new Map<string, AgentTargetResolution>()
    let preflightError: { index: number; category: AgentOperationErrorCategory } | undefined
    let writeRootSnapshot: AgentWriteRootSnapshot | undefined
    try {
      writeRootSnapshot = await this.references.captureAgentRootSnapshot(this.storage, rootSnapshot,
        () => this.targets.assertActiveLibrarySnapshot(rootSnapshot))
    } catch (error) {
      preflightError = { index: 0, category: safeErrorCategory(error) }
    }
    for (let index = 0; index < parsed.length && !preflightError; index += 1) {
      try {
        const args = parsed[index].arguments
        for (const ref of referencesFromArgs(args)) {
          if (!context.targetSetId) throw new TraceError(ERR.CONFLICT, '目标不属于当前已确认消息')
          if (!resolutions.has(ref)) {
            const refresh = options.refreshablePlanRevisions?.get(ref)
            const resolution = refresh
              ? await this.targets.refreshGrantForMessage({ setId: context.targetSetId, ref }, context.userMessageId, rootSnapshot)
              : await this.targets.resolveGrantForMessage({ setId: context.targetSetId, ref }, context.userMessageId)
            ensureSameLibrary(rootSnapshot, resolution)
            if (refresh) {
              const refreshedStableId = resolution.kind === 'plan' ? resolution.planId ?? `path:${resolution.path}` : undefined
              if (resolution.kind !== 'plan' || refreshedStableId !== refresh.stableId || resolution.updatedAt !== refresh.afterUpdatedAt) {
                throw new TraceError(ERR.CONFLICT, '原计划版本并非由本批已完成前序操作产生')
              }
              for (const selectedCall of parsed) {
                if (selectedCall.arguments.plan_ref === ref) {
                  if (selectedCall.arguments.expected_updated_at !== refresh.beforeUpdatedAt) throw new TraceError(ERR.CONFLICT, '原计划版本与续行审计不匹配')
                  selectedCall.arguments.expected_updated_at = resolution.updatedAt
                }
              }
            }
            resolutions.set(ref, resolution)
          }
        }
      } catch (error) {
        preflightError = { index, category: safeErrorCategory(error) }
      }
    }

    const stagedPlans = new Map<string, StagedPlan>()
    const committedPlanRevisions = new Map<string, string>()
    const prepared: PreparedOperation[] = []
    if (!preflightError) {
      for (const [index, call] of parsed.entries()) {
        try {
          const operation = await this.preflightOne(call, initialAudit[index], resolutions, rootSnapshot, writeRootSnapshot!, stagedPlans,
            committedPlanRevisions, parsed.length, context.userMessageId, policy.mode)
          prepared.push(operation)
        } catch (error) {
          preflightError = { index, category: safeErrorCategory(error) }
          break
        }
      }
    }

    if (!preflightError && parsed.length > 1) {
      const footprints = prepared.map((operation) => operationFootprint(operation, resolutions))
      for (let index = 1; index < footprints.length; index += 1) {
        if (footprints.slice(0, index).some((previous) => footprintsConflict(previous, footprints[index]))) {
          preflightError = { index, category: 'conflict' }
          break
        }
      }
    }
    await this.targets.assertActiveLibrarySnapshot(rootSnapshot)

    if (preflightError) {
      const failed = this.failedBatch(batchId, sessionId, requestId, assistantMessageId, context.userMessageId, policy.mode, createdAt,
        initialAudit, preflightError.index, preflightError.category, options)
      await this.storeBatch(sessionId, failed)
      if (options.appendToolResults !== false) await this.appendResults(sessionId, assistantMessageId, failed.operations)
      return failed
    }

    if (options.forceConfirmation) {
      for (const operation of prepared) {
        operation.needsConfirmation = true
        operation.audit.requiredConfirmation = true
      }
    }
    for (const operation of prepared) {
      if (READ_ONLY_AGENT_TOOLS.has(operation.call.name)) continue
      const writesThroughReadGrant = referencesFromArgs(operation.call.arguments)
        .some((ref) => resolutions.get(ref)?.capability === 'read')
      if (!writesThroughReadGrant) continue
      operation.needsConfirmation = true
      operation.audit.requiredConfirmation = true
    }
    const requiredConfirmation = options.forceConfirmation === true || prepared.some((item) => item.needsConfirmation)
    const confirmationSource = requiredConfirmation ? 'none' : 'policy'
    const audit: AgentOperationBatchAudit = {
      id: batchId, requestId, assistantMessageId, userMessageId: context.userMessageId, createdAt,
      updatedAt: createdAt, policyMode: policy.mode,
      ...(options.attemptOf ? { attemptOf: options.attemptOf } : {}), ...(options.attemptKind ? { attemptKind: options.attemptKind } : {}),
      status: requiredConfirmation ? 'pending-confirmation' : 'executing',
      confirmationSource, requiredConfirmation,
      operations: prepared.map((item) => ({ ...item.audit, status: 'ready', confirmationSource }))
    }
    const displayPreview = confirmationPreviewFor(prepared)
    if (requiredConfirmation) {
      const pending: PendingBatch = { sessionId, requestId, assistantMessageId, userMessageId: context.userMessageId,
        token: randomBytes(32).toString('base64url'),
        expiresAt: this.now() + PREVIEW_TTL_MS, rootSnapshot, operations: prepared,
        ...(displayPreview ? { confirmationPreview: displayPreview } : {}), appendToolResults: options.appendToolResults !== false,
        ...(options.attemptOf ? { attemptOf: options.attemptOf } : {}), ...(options.attemptKind ? { attemptKind: options.attemptKind } : {}),
        ...(options.sourceStatuses ? { sourceStatuses: options.sourceStatuses } : {}),
        ...(options.reservedSourceKeys ? { reservedSourceKeys: options.reservedSourceKeys } : {}) }
      this.reservePendingSlot(batchId)
      try {
        await this.storeBatch(sessionId, audit)
        this.installPending(batchId, pending)
      } catch (error) {
        this.releasePendingSlotReservation(batchId)
        throw error
      }
      return { ...audit, ...(displayPreview ? { confirmationPreview: displayPreview } : {}) }
    }
    await this.storeBatch(sessionId, audit)
    return this.execute(batchId, { sessionId, requestId, assistantMessageId, userMessageId: context.userMessageId,
      token: '', expiresAt: this.now() + PREVIEW_TTL_MS, rootSnapshot, operations: prepared, appendToolResults: options.appendToolResults !== false,
      ...(options.attemptOf ? { attemptOf: options.attemptOf } : {}), ...(options.attemptKind ? { attemptKind: options.attemptKind } : {}),
      ...(options.sourceStatuses ? { sourceStatuses: options.sourceStatuses } : {}) }, new Map())
  }

  async readBatch(payload: unknown): Promise<AgentOperationBatch> {
    if (!exactRecord(payload, ['sessionId', 'batchId']) || typeof payload.sessionId !== 'string' || typeof payload.batchId !== 'string') {
      throw new TraceError(ERR.VALIDATION, '操作批次读取请求无效')
    }
    const session = await this.conversations.sessions.read(payload.sessionId)
    const batch = session.operationBatches.find((item) => item.id === payload.batchId)
    if (!batch) throw new TraceError(ERR.PATH_NOT_FOUND, '操作批次不存在')
    const pending = this.pending.get(batch.id)
    return { ...structuredClone(batch),
      ...(pending && pending.expiresAt > this.now() && pending.sessionId === payload.sessionId && batch.status === 'pending-confirmation' && pending.confirmationPreview
        ? { confirmationPreview: structuredClone(pending.confirmationPreview) }
        : {}) }
  }

  async confirmBatch(payload: unknown, presentTrustedConfirmation: AgentOperationTrustedConfirmationPresenter): Promise<AgentOperationBatch> {
    if (!agentRecord(payload) || typeof payload.sessionId !== 'string' || typeof payload.batchId !== 'string' ||
      (payload.decisions !== undefined && !Array.isArray(payload.decisions)) ||
      Reflect.ownKeys(payload).some((key) => typeof key !== 'string' || !['sessionId', 'batchId', 'decisions'].includes(key)) ||
      !['sessionId', 'batchId'].every((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(payload, key)
        return descriptor !== undefined && 'value' in descriptor
      })) {
      throw new TraceError(ERR.VALIDATION, '操作批次确认请求无效')
    }
    const input = payload as unknown as AgentOperationBatchConfirmInput
    const pending = this.pending.get(input.batchId)
    if (!pending || pending.sessionId !== input.sessionId) {
      throw new TraceError(ERR.CONFLICT, '操作预览已失效，请重新预检')
    }
    if (this.claimedBatches.has(input.batchId)) throw new TraceError(ERR.CONFLICT, '该操作批次正在确认或取消')
    if (pending.expiresAt <= this.now()) {
      this.pending.delete(input.batchId)
      this.releaseSourceKeys(pending.reservedSourceKeys ?? [])
      throw new TraceError(ERR.CONFLICT, '操作预览已失效，请重新预检')
    }
    this.claimedBatches.add(input.batchId)
    let consumed = false
    const privateToken = pending.token
    try {
      const session = await this.conversations.sessions.read(input.sessionId)
      const audit = session.operationBatches.find((item) => item.id === input.batchId)
      if (!audit || audit.status !== 'pending-confirmation' || audit.requestId !== pending.requestId || audit.assistantMessageId !== pending.assistantMessageId) {
        throw new TraceError(ERR.CONFLICT, '操作批次状态已变化')
      }
      if ((await this.policies.get()).mode !== audit.policyMode) throw new TraceError(ERR.CONFLICT, '权限策略已变化，请重新预检')
      const decisions = this.validateDecisions(input.decisions ?? [], pending.operations)
      const snapshot = operationConfirmationSnapshot(input.batchId, pending, input.decisions ?? [])
      let committedBatch: AgentOperationBatch | undefined
      let acceptanceStarted = false
      const accept = async (): Promise<AgentOperationBatch> => {
        if (acceptanceStarted || this.pending.get(input.batchId) !== pending || pending.token !== privateToken) {
          throw new TraceError(ERR.CONFLICT, '操作预览已失效，请重新预检')
        }
        acceptanceStarted = true
        if (pending.expiresAt <= this.now()) throw new TraceError(ERR.CONFLICT, '操作预览已失效，请重新预检')
        try {
          await this.invalidateStaleAttemptPreview(input.batchId, pending)
        } catch (error) {
          if (error instanceof StaleAttemptPreviewError) {
            this.pending.delete(input.batchId)
            consumed = true
          }
          throw error
        }
        this.pending.delete(input.batchId)
        consumed = true
        await this.targets.assertActiveLibrarySnapshot(pending.rootSnapshot)
        committedBatch = await this.execute(input.batchId, pending, decisions, 'user')
        return committedBatch
      }
      await presentTrustedConfirmation(snapshot, accept)
      return committedBatch ?? await this.readBatch({ sessionId: input.sessionId, batchId: input.batchId })
    } finally {
      this.claimedBatches.delete(input.batchId)
      if (consumed) this.releaseSourceKeys(pending.reservedSourceKeys ?? [])
    }
  }

  async cancelBatch(payload: unknown): Promise<null> {
    if (!exactRecord(payload, ['sessionId', 'batchId']) || typeof payload.sessionId !== 'string' ||
      typeof payload.batchId !== 'string') throw new TraceError(ERR.VALIDATION, '操作批次取消请求无效')
    const input = payload as unknown as AgentOperationBatchCancelInput
    const pending = this.pending.get(input.batchId)
    if (!pending || pending.sessionId !== input.sessionId) {
      throw new TraceError(ERR.CONFLICT, '操作预览已失效，请重新预检')
    }
    if (this.claimedBatches.has(input.batchId)) throw new TraceError(ERR.CONFLICT, '该操作批次正在确认或取消')
    if (pending.expiresAt <= this.now()) {
      this.pending.delete(input.batchId)
      this.releaseSourceKeys(pending.reservedSourceKeys ?? [])
      throw new TraceError(ERR.CONFLICT, '操作预览已失效，请重新预检')
    }
    this.claimedBatches.add(input.batchId)
    let consumed = false
    try {
      const session = await this.conversations.sessions.read(input.sessionId)
      const batch = session.operationBatches.find((item) => item.id === input.batchId)
      if (!batch || batch.status !== 'pending-confirmation') throw new TraceError(ERR.CONFLICT, '操作批次状态已变化')
      const now = new Date(this.now()).toISOString()
      await this.updateBatch(input.sessionId, input.batchId, (stored) => {
        stored.status = 'cancelled'; stored.confirmationSource = 'user'; stored.updatedAt = now
        stored.operations = stored.operations.map((item) => ({ ...item,
          status: 'cancelled', confirmationSource: 'user', completedAt: now
        }))
      })
      this.pending.delete(input.batchId)
      consumed = true
      if (pending.appendToolResults) await this.appendResults(input.sessionId, batch.assistantMessageId, pending.operations.map((item) => ({
        ...item.audit,
        status: 'cancelled',
        confirmationSource: 'user',
        completedAt: now,
        output: errorResult('authorization')
      })))
      return null
    } finally {
      this.claimedBatches.delete(input.batchId)
      if (consumed) this.releaseSourceKeys(pending.reservedSourceKeys ?? [])
    }
  }

  private auditItem(call: AgentCompletedToolCall, snapshot: AgentActiveLibrarySnapshot, createdAt: string, mode: 'confirm' | 'restricted' | 'unrestricted', batchSize: number): AgentOperationAuditItem {
    const name = /^[a-z_]+(?:\.[a-z_]+)?$/.test(call.name) ? call.name : 'unknown'
    return {
      callId: call.id, operation: name, status: 'ready', libraryId: snapshot.libraryId, rootHash: snapshot.rootHash,
      rootGeneration: snapshot.rootGeneration, changes: [],
      requiredConfirmation: permissionRequiresConfirmation(mode, name as AgentToolName, batchSize),
      confirmationSource: 'none', reversible: isUndoableTool(name as AgentToolName), undoStatus: 'unavailable', createdAt
    }
  }

  private failedBatch(batchId: string, sessionId: string, requestId: string, assistantMessageId: string, userMessageId: string,
    mode: 'confirm' | 'restricted' | 'unrestricted', createdAt: string, items: AgentOperationAuditItem[], failureIndex: number,
    category: AgentOperationErrorCategory, options: PrepareBatchOptions = {}): AgentOperationBatchAudit {
    return {
      id: batchId, requestId, assistantMessageId, userMessageId, createdAt, updatedAt: createdAt,
      policyMode: mode, ...(options.attemptOf ? { attemptOf: options.attemptOf } : {}), ...(options.attemptKind ? { attemptKind: options.attemptKind } : {}),
      status: 'preflight-failed', confirmationSource: 'none', requiredConfirmation: false,
      operations: items.map((item, index) => ({ ...item,
        status: index === failureIndex ? 'failed' : 'not-executed',
        ...(index === failureIndex ? { errorCategory: category } : {}), completedAt: createdAt
      }))
    }
  }

  private async storeBatch(sessionId: string, batch: AgentOperationBatchAudit): Promise<void> {
    await this.conversations.sessions.mutate(sessionId, (session) => {
      session.operationBatches.push(structuredClone(batch))
    })
  }

  private attemptOrigin(batches: readonly AgentOperationBatchAudit[], sourceBatchId: string): AgentOperationBatchAudit {
    const byId = new Map(batches.map((batch) => [batch.id, batch]))
    let current = byId.get(sourceBatchId)
    if (!current) throw new TraceError(ERR.PATH_NOT_FOUND, '操作尝试来源不存在')
    const visited = new Set<string>()
    while (current.attemptOf) {
      if (visited.has(current.id)) throw new TraceError(ERR.CONFLICT, '操作尝试谱系无效')
      visited.add(current.id)
      const parent = byId.get(current.attemptOf)
      if (!parent) throw new TraceError(ERR.CONFLICT, '操作尝试来源不存在')
      current = parent
    }
    return current
  }

  private sourceOperationReservationKey(sessionId: string, batches: readonly AgentOperationBatchAudit[], batchId: string, callId: string): string {
    return `${sessionId}:${this.attemptOrigin(batches, batchId).id}:${callId}`
  }

  private hasUnresolvedAttempt(batches: readonly AgentOperationBatchAudit[], sourceBatchId: string, callId: string,
    excludeBatchId?: string): boolean {
    const byId = new Map(batches.map((batch) => [batch.id, batch]))
    const descendsFrom = (batch: AgentOperationBatchAudit): boolean => {
      const visited = new Set<string>([batch.id])
      let parentId = batch.attemptOf
      while (parentId) {
        if (parentId === sourceBatchId) return true
        if (visited.has(parentId)) return false
        visited.add(parentId)
        parentId = byId.get(parentId)?.attemptOf
      }
      return false
    }
    return batches.some((batch) => batch.id !== excludeBatchId && descendsFrom(batch) &&
      (batch.status === 'executing' || batch.status === 'reconciliation-required' ||
        (batch.status === 'pending-confirmation' && Date.parse(batch.createdAt) + PREVIEW_TTL_MS > this.now())) &&
      batch.operations.some((operation) => operation.callId === callId &&
        (operation.status === 'ready' || operation.status === 'outcome-unknown')))
  }

  private assertPendingAttemptCurrent(batches: readonly AgentOperationBatchAudit[], batchId: string, pending: PendingBatch, callId: string): void {
    if (!pending.attemptOf || !pending.attemptKind) return
    const byId = new Map(batches.map((batch) => [batch.id, batch]))
    const source = byId.get(pending.attemptOf)
    if (!source) throw new StaleAttemptPreviewError()
    const sourceOperation = source.operations.find((item) => item.callId === callId)
    const expectedStatus = pending.sourceStatuses?.get(callId)
    if (!sourceOperation || !expectedStatus || sourceOperation.status !== expectedStatus || sourceOperation.resolvedByAttempt !== undefined) {
      throw new StaleAttemptPreviewError()
    }
    const origin = this.attemptOrigin(batches, source.id)
    if (this.hasUnresolvedAttempt(batches, origin.id, callId, batchId)) throw new StaleAttemptPreviewError()
  }

  private async invalidateStaleAttemptPreview(batchId: string, pending: PendingBatch): Promise<void> {
    const session = await this.conversations.sessions.read(pending.sessionId)
    try {
      for (const operation of pending.operations) {
        this.assertPendingAttemptCurrent(session.operationBatches, batchId, pending, operation.call.id)
      }
    } catch (error) {
      if (!(error instanceof StaleAttemptPreviewError)) throw error
      const completedAt = new Date(this.now()).toISOString()
      await this.updateBatch(pending.sessionId, batchId, (batch) => {
        batch.status = 'cancelled'
        batch.confirmationSource = 'none'
        batch.updatedAt = completedAt
        batch.operations = batch.operations.map((item) => ({ ...item, status: 'cancelled', confirmationSource: 'none', completedAt }))
      })
      throw error
    }
  }

  private async markUndoStale(sessionId: string, batchId: string, callId: string): Promise<void> {
    await this.updateBatch(sessionId, batchId, (batch) => {
      const item = batch.operations.find((candidate) => candidate.callId === callId)
      if (item?.undoStatus === 'available') item.undoStatus = 'stale'
      batch.updatedAt = new Date(this.now()).toISOString()
    })
  }

  private async updateBatch(sessionId: string, batchId: string, update: (batch: AgentOperationBatchAudit) => void): Promise<AgentOperationBatchAudit> {
    let updated: AgentOperationBatchAudit | undefined
    await this.conversations.sessions.mutate(sessionId, (session) => {
      const batch = session.operationBatches.find((item) => item.id === batchId)
      if (!batch) throw new TraceError(ERR.PATH_NOT_FOUND, '操作批次不存在')
      update(batch)
      updated = structuredClone(batch)
    })
    if (!updated) throw new TraceError(ERR.INTERNAL, '操作批次未能保存')
    return updated
  }

  private async recordAttemptSuccess(sessionId: string, batchId: string, operationIndex: number, completed: AgentOperationAuditItem,
    pending: PendingBatch, updatedAt: string): Promise<void> {
    if (!pending.attemptOf || !pending.attemptKind) {
      await this.updateBatch(sessionId, batchId, (batch) => {
        batch.operations[operationIndex] = completed
        batch.updatedAt = updatedAt
      })
      return
    }
    await this.conversations.sessions.mutate(sessionId, (session) => {
      const attempt = session.operationBatches.find((batch) => batch.id === batchId)
      if (!attempt) throw new TraceError(ERR.PATH_NOT_FOUND, '操作尝试批次不存在')
      const byId = new Map(session.operationBatches.map((batch) => [batch.id, batch]))
      const ancestors: AgentOperationBatchAudit[] = []
      const visited = new Set([batchId])
      let parentId: string | undefined = pending.attemptOf
      while (parentId) {
        if (visited.has(parentId)) throw new TraceError(ERR.CONFLICT, '操作尝试谱系无效')
        visited.add(parentId)
        const parent = byId.get(parentId)
        if (!parent) {
          if (ancestors.length === 0) throw new TraceError(ERR.PATH_NOT_FOUND, '操作尝试来源不存在')
          break
        }
        ancestors.push(parent)
        parentId = parent.attemptOf
      }
      const source = ancestors[0]
      if (!source) throw new TraceError(ERR.PATH_NOT_FOUND, '操作尝试来源不存在')
      const sourceOperation = source.operations.find((item) => item.callId === completed.callId)
      const expectedStatus = pending.sourceStatuses?.get(completed.callId)
      if (!sourceOperation || !expectedStatus || sourceOperation.status !== expectedStatus || sourceOperation.resolvedByAttempt !== undefined) {
        throw new TraceError(ERR.CONFLICT, '来源操作状态已变化，不能重放')
      }
      attempt.operations[operationIndex] = completed
      attempt.updatedAt = updatedAt
      if (pending.attemptKind === 'undo') sourceOperation.undoStatus = 'undone'
      else if (sourceOperation.status === 'failed' || sourceOperation.status === 'not-executed') sourceOperation.resolvedByAttempt = batchId
      source.updatedAt = updatedAt

      for (let index = 0; index < ancestors.length; index += 1) {
        const ancestor = ancestors[index]
        const ancestorOperation = ancestor.operations.find((item) => item.callId === completed.callId)
        if (!ancestorOperation) continue
        let changed = false
        if ((ancestorOperation.status === 'failed' || ancestorOperation.status === 'not-executed') &&
          ancestorOperation.resolvedByAttempt === undefined) {
          ancestorOperation.resolvedByAttempt = batchId
          changed = true
        }
        const descendantAttemptKind = index === 0 ? pending.attemptKind : ancestors[index - 1].attemptKind
        if (descendantAttemptKind === 'undo' && ancestorOperation.status === 'succeeded' && ancestorOperation.undoStatus === 'available') {
          ancestorOperation.undoStatus = 'undone'
          changed = true
        }
        if (changed) ancestor.updatedAt = updatedAt
      }
    })
  }

  private async appendResults(sessionId: string, assistantMessageId: string, operations: Array<AgentOperationAuditItem & { output?: string }>): Promise<void> {
    await this.conversations.appendToolResults(sessionId, assistantMessageId, operations.map((item) => ({
      toolCallId: item.callId, content: item.output ?? errorResult(item.errorCategory ?? 'internal')
    })))
  }

  private async preflightOne(call: AgentCompletedToolCall, audit: AgentOperationAuditItem,
    resolutions: Map<string, AgentTargetResolution>, rootSnapshot: AgentActiveLibrarySnapshot,
    writeRootSnapshot: AgentWriteRootSnapshot,
    stagedPlans: Map<string, StagedPlan>, committedPlanRevisions: Map<string, string>, batchSize: number, userMessageId: string,
    policyMode: 'confirm' | 'restricted' | 'unrestricted'): Promise<PreparedOperation> {
    const rootCommitBinding = {
      rootSnapshot: writeRootSnapshot,
      validateRootSnapshot: () => this.targets.assertActiveLibrarySnapshot(rootSnapshot)
    }
    const toolName = call.name as AgentToolName
    const name = toolName
    const args = call.arguments
    const target = (field: string): AgentTargetResolution => {
      const ref = args[field]
      const resolved = typeof ref === 'string' ? resolutions.get(ref) : undefined
      if (!resolved) throw new TraceError(ERR.CONFLICT, '目标不属于本轮已确认范围')
      ensureSameLibrary(rootSnapshot, resolved)
      return resolved
    }
    const withTarget = (resolution: AgentTargetResolution): AgentOperationAuditItem => ({
      ...audit,
      targetKind: resolution.kind,
      ...(resolution.path ? { targetPath: resolution.path } : {}),
      ...(resolution.kind !== 'trash' ? { targetDirectoryIdentity: resolution.directoryIdentity } : {}),
      ...(resolution.kind === 'plan' && resolution.planId ? { targetPlanId: resolution.planId } : {}),
      ...(resolution.kind === 'trash' ? { targetStableId: resolution.entryId } :
        resolution.kind === 'plan' ? { targetStableId: resolution.planId ?? `path:${resolution.path}` } : { targetStableId: resolution.directoryIdentity })
    })
    const prepared = (execute: PreparedOperation['execute'], changes: AgentOperationValueChange[] = [], resolution?: AgentTargetResolution,
      needsConfirmation = permissionRequiresConfirmation(policyMode, name, batchSize)): PreparedOperation => ({
      call, audit: { ...(resolution ? withTarget(resolution) : audit), changes, requiredConfirmation: needsConfirmation },
      needsConfirmation, execute
    })

    if (name === 'trash.list') {
      const resolution = target('trash_entry_ref')
      if (resolution.kind !== 'trash') throw new TraceError(ERR.VALIDATION, '目标不是回收站条目')
      const entry = await this.references.readTrashEntry(this.storage, resolution.entryId, resolution.manifestRevision)
      const result = { entries: [entry] }
      const content = serialized({ ok: true, ...result })
      return prepared(async () => ({ content }), [change('result', null, result)], resolution, false)
    }
    if (name === 'plan.list_children') {
      const folder = target('folder_ref')
      if (!isFolderResolution(folder)) throw new TraceError(ERR.VALIDATION, '目标不是文件夹')
      const children = await this.targets.children({ setId: folder.setId, ref: folder.ref })
      const content = serialized({ ok: true, children })
      return prepared(async () => ({ content }), [change('result', null, { children })], folder, false)
    }
    if (name === 'plan.read') {
      const resolution = target('plan_ref')
      if (!isPlanResolution(resolution)) throw new TraceError(ERR.VALIDATION, '目标不是计划')
      const doc = await this.storage.readPlan(resolution.path)
      if (doc.updated_at !== resolution.updatedAt || (resolution.planId && doc.plan_id !== resolution.planId)) throw new TraceError(ERR.CONFLICT, '目标计划已变化，请重新选择')
      const result = { path: resolution.path, plan_id: doc.plan_id ?? null, updated_at: doc.updated_at, components: doc.components }
      const content = serialized({ ok: true, plan: result })
      return prepared(async () => ({ content }), [change('result', null, result)], resolution, false)
    }
    if (name === 'plan.create' || name === 'folder.create') {
      const parent = typeof args.parent_ref === 'string' ? target('parent_ref') : undefined
      if (parent && !isFolderResolution(parent)) throw new TraceError(ERR.VALIDATION, '新建父级必须是文件夹')
      const parentPath = parent?.path ?? ''
      const root = this.storage.getRootAbs()
      if (!root) throw new TraceError(ERR.INTERNAL, '计划库根目录未初始化')
      let createdName = name === 'folder.create' ? strictName(args.name) : strictName(args.name_part)
      if (name === 'plan.create') {
        const settings = await this.templates.get(root)
        const rule = settings.rules.find((item) => item.parent_path === parentPath)
        if (rule) createdName = formatPlanNameTemplate(rule.template, args.name_part, new Date(this.now()))
      }
      validatePlanName(createdName)
      const resolvedName = createdName
      const createdPath = parentPath ? `${parentPath}/${resolvedName}` : resolvedName
      validateAgentAuditedPath(createdPath)
      const siblings = await this.storage.treeGetChildren(parentPath)
      if (siblings.some((item) => item.name === createdName)) throw new TraceError(ERR.NAME_CONFLICT, '同名计划或文件夹已存在')
      await this.targets.assertActiveLibrarySnapshot(rootSnapshot)
      return prepared(async () => {
        await this.targets.assertActiveLibrarySnapshot(rootSnapshot)
        if (parent) {
          const refreshedParent = await this.targets.refreshGrantForMessage(
            { setId: parent.setId, ref: parent.ref }, userMessageId, rootSnapshot
          )
          if (!isFolderResolution(refreshedParent) || refreshedParent.path !== parent.path ||
            refreshedParent.directoryIdentity !== parent.directoryIdentity || refreshedParent.libraryId !== parent.libraryId ||
            refreshedParent.rootHash !== parent.rootHash || refreshedParent.rootGeneration !== parent.rootGeneration) {
            throw new TraceError(ERR.CONFLICT, '原授权父文件夹身份或计划库已变化，请重新预检')
          }
        }
        const node = await this.references.createAgentNode(this.storage, {
          kind: name === 'plan.create' ? 'plan' : 'folder', parentPath, name: resolvedName,
          ...(parent ? { parentDirectoryIdentity: parent.directoryIdentity } : {})
        }, writeRootSnapshot, () => this.targets.assertActiveLibrarySnapshot(rootSnapshot))
        const createdTarget = await verifyCommittedSideEffect(() => this.targets.captureAuditedTarget(rootSnapshot, node.path, node.kind))
        return {
          content: serialized({ ok: true, path: node.path, kind: node.kind }),
          ...(createdTarget.updatedAt ? { afterUpdatedAt: createdTarget.updatedAt } : {}),
          undoStatus: 'available', targetKind: createdTarget.kind, targetPath: createdTarget.path,
          targetStableId: createdTarget.planId ?? `directory:${createdTarget.directoryIdentity}`,
          targetDirectoryIdentity: createdTarget.directoryIdentity,
          ...(createdTarget.planId ? { targetPlanId: createdTarget.planId } : {})
        }
      }, [change('created_path', null, createdPath)], parent, permissionRequiresConfirmation(policyMode, name as AgentToolName, batchSize))
    }

    const planRef = typeof args.plan_ref === 'string' ? target('plan_ref') : undefined
    if (planRef && !isPlanResolution(planRef)) throw new TraceError(ERR.VALIDATION, '目标不是计划')
    if (planRef && name !== 'plan.rename' && name !== 'folder.rename' && name !== 'plan.move' && name !== 'folder.move' && name !== 'plan.trash' && name !== 'folder.trash') {
      const planResolution = planRef
      let staged = stagedPlans.get(planResolution.path)
      if (!staged) {
        const document = await this.storage.readPlan(planResolution.path)
        if (document.updated_at !== planResolution.updatedAt || (planResolution.planId && document.plan_id !== planResolution.planId)) {
          throw new TraceError(ERR.CONFLICT, '目标计划已变化，请重新选择')
        }
        staged = { initialUpdatedAt: document.updated_at, document: structuredClone(document) }
        stagedPlans.set(planResolution.path, staged)
      }
      const expected = args.expected_updated_at
      if (typeof expected !== 'string' || expected !== staged.initialUpdatedAt) throw new TraceError(ERR.CONFLICT, '调用版本必须匹配批次开始时的计划版本')
      const before = structuredClone(staged.document)
      const after = structuredClone(staged.document)
      let changedComponentId: string | undefined
      this.applyPlanCall(name, args, after)
      staged.document = after
      const componentId = typeof args.component_id === 'string' ? args.component_id : typeof args.list_component_id === 'string' ? args.list_component_id : undefined
      changedComponentId = componentId
      const diff = this.planCallDiff(name, args, before, after)
      const isDelete = name === 'component.delete'
      let referencePreview: ReferenceImpactPreview | undefined
      let needsConfirmation = permissionRequiresConfirmation(policyMode, name, batchSize)
      if (isDelete) {
        referencePreview = await this.references.previewImpact({ library_id: planResolution.libraryId, operation: 'delete-component', path: planResolution.path, component_id: String(args.component_id), expected_updated_at: staged.initialUpdatedAt })
        if (referencePreview.references.length) needsConfirmation = true
      }
      return {
        call, audit: { ...withTarget(planResolution), changes: diff, componentId: changedComponentId, beforeUpdatedAt: staged.initialUpdatedAt, requiredConfirmation: needsConfirmation },
        needsConfirmation, referencePreview, stagedDocument: after, stagedPath: planResolution.path,
        execute: async (decision) => {
          if (isDelete) {
            const preview = referencePreview!
            const refreshed = await this.targets.refreshGrantForMessage(
              { setId: planResolution.setId, ref: planResolution.ref }, userMessageId, rootSnapshot
            )
            if (!isPlanResolution(refreshed) || refreshed.path !== planResolution.path ||
              refreshed.directoryIdentity !== planResolution.directoryIdentity || refreshed.planId !== planResolution.planId ||
              refreshed.libraryId !== planResolution.libraryId || refreshed.updatedAt !== staged.initialUpdatedAt) {
              throw new TraceError(ERR.CONFLICT, '原授权计划身份或预检版本已变化，请重新预检')
            }
            const current = await this.storage.readPlan(planResolution.path)
            if (current.updated_at !== staged.initialUpdatedAt ||
              (planResolution.planId && current.plan_id !== planResolution.planId)) {
              throw new TraceError(ERR.CONFLICT, '目标计划身份或预检版本已变化，请重新预检')
            }
            const references = await this.references.commitAgentImpact({ library_id: planResolution.libraryId, preview,
              decisions: asReferenceDecisions(decision) }, this.storage,
            { ...rootCommitBinding,
              target: { path: planResolution.path, directoryIdentity: planResolution.directoryIdentity,
                planId: planResolution.planId, updatedAt: staged.initialUpdatedAt } })
            const saved = await verifyCommittedSideEffect(() => this.storage.readPlan(planResolution.path))
            return { content: serialized({ ok: true, deleted: true, path: planResolution.path, result: references }), afterUpdatedAt: saved.updated_at }
          }
          const refreshed = await this.targets.refreshGrantForMessage({ setId: planResolution.setId, ref: planResolution.ref }, userMessageId, rootSnapshot)
          if (!isPlanResolution(refreshed) || refreshed.path !== planResolution.path ||
            refreshed.directoryIdentity !== planResolution.directoryIdentity || refreshed.planId !== planResolution.planId ||
            refreshed.libraryId !== planResolution.libraryId) {
            throw new TraceError(ERR.CONFLICT, '原授权计划身份已变化，请重新预检')
          }
          const expectedRevision = committedPlanRevisions.get(planResolution.path) ?? staged.initialUpdatedAt
          if (refreshed.updatedAt !== expectedRevision) throw new TraceError(ERR.CONFLICT, '计划版本已变化，请重新预检')
          const current = await this.storage.readPlan(planResolution.path)
          if (current.updated_at !== expectedRevision || (refreshed.planId && current.plan_id !== refreshed.planId)) {
            throw new TraceError(ERR.CONFLICT, '计划版本或身份已变化，请重新预检')
          }
          const next = structuredClone(after)
          next.updated_at = expectedRevision
          const saved = await this.references.saveAgentPlan(this.storage, planResolution.path, next, writeRootSnapshot, {
            path: planResolution.path, directoryIdentity: planResolution.directoryIdentity,
            planId: planResolution.planId, updatedAt: expectedRevision
          }, () => this.targets.assertActiveLibrarySnapshot(rootSnapshot))
          committedPlanRevisions.set(planResolution.path, saved.updated_at)
          return { content: serialized({ ok: true, path: planResolution.path, updated_at: saved.updated_at }), afterUpdatedAt: saved.updated_at,
            ...(isUndoableTool(name) ? { undoStatus: 'available' as const } : {}) }
        }
      }
    }

    if (name === 'plan.rename') {
      const resolution = target('target_ref')
      if (!isPlanResolution(resolution)) throw new TraceError(ERR.VALIDATION, '改名目标不是计划')
      if (args.expected_revision !== resolution.revision) throw new TraceError(ERR.CONFLICT, '目标版本不匹配')
      const newName = strictName(args.new_name)
      validateAgentAuditedPath(pathWithNewName(resolution.path, newName))
      const preview = await this.references.previewImpact({ library_id: resolution.libraryId, operation: 'rename-plan', path: resolution.path, new_name: newName })
      return { ...prepared(async (decision) => {
        const result = await this.references.commitAgentImpact({ library_id: resolution.libraryId, preview, rename_action: decision?.renameAction }, this.storage,
          { ...rootCommitBinding,
            target: { path: resolution.path, directoryIdentity: resolution.directoryIdentity,
              planId: resolution.planId, updatedAt: resolution.updatedAt } })
        const path = result.path ?? `${resolution.path.slice(0, resolution.path.lastIndexOf('/') + 1)}${newName}`
        const renamed = await verifyCommittedSideEffect(() => this.targets.captureAuditedTarget(rootSnapshot, path, 'plan'))
        return { content: serialized({ ok: true, path }), ...(renamed.updatedAt ? { afterUpdatedAt: renamed.updatedAt } : {}),
          undoStatus: 'available', targetPath: path, targetDirectoryIdentity: renamed.directoryIdentity,
          ...(renamed.planId ? { targetPlanId: renamed.planId } : {}) }
      }, [change('path', resolution.path, `${resolution.path.slice(0, resolution.path.lastIndexOf('/') + 1)}${newName}`)], resolution, true), referencePreview: preview }
    }
    if (name === 'folder.rename' || name === 'folder.trash') {
      const resolution = target('target_ref')
      if (!isFolderResolution(resolution)) throw new TraceError(ERR.VALIDATION, '目标不是文件夹')
      if (args.expected_revision !== resolution.revision) throw new TraceError(ERR.CONFLICT, '目标版本不匹配')
      const newName = name === 'folder.rename' ? strictName(args.new_name) : undefined
      if (newName !== undefined) validateAgentAuditedPath(pathWithNewName(resolution.path, newName))
      const preview = await this.references.previewAgentFolderOperation({ operation: name === 'folder.rename' ? 'rename' : 'trash', path: resolution.path,
        ...(newName !== undefined ? { new_name: newName } : {}) }, this.storage)
      if (newName !== undefined && preview.destination_path !== pathWithNewName(resolution.path, newName)) {
        throw new TraceError(ERR.CONFLICT, '文件夹重命名预览目标已变化')
      }
      if (preview.destination_path !== undefined) validateAgentAuditedPath(preview.destination_path)
      return { ...prepared(async (decision) => {
        const result = await this.references.commitAgentFolderOperation({ token: preview.token,
          ...(name === 'folder.rename' ? { rename_action: decision?.renameAction } : { decisions: asReferenceDecisions(decision) }) },
        this.storage, rootCommitBinding)
        if (name === 'folder.rename') {
          const path = result.path ?? preview.destination_path
          const renamed = await verifyCommittedSideEffect(async () => {
            if (!path) throw new Error('The committed folder rename has no verifiable target path')
            return this.targets.captureAuditedTarget(rootSnapshot, path, 'folder')
          })
          return { content: serialized({ ok: true, path }), undoStatus: 'available', targetPath: path,
            targetDirectoryIdentity: renamed.directoryIdentity, targetStableId: renamed.directoryIdentity }
        }
        return { content: serialized({ ok: true, trash_entry_id: result.trash_entry_id ?? null }),
          undoStatus: result.trash_entry_id ? 'available' : 'unavailable',
          ...(result.trash_entry_id ? { trashEntryId: result.trash_entry_id } : {}) }
      }, [change(name === 'folder.rename' ? 'path' : 'trash', resolution.path, name === 'folder.rename' ? preview.destination_path ?? null : 'trash')], resolution, true), folderPreview: preview }
    }
    if (name === 'plan.move' || name === 'folder.move') {
      const resolution = target('target_ref')
      const parent = target('parent_ref')
      if (args.expected_revision !== resolution.revision || !isFolderResolution(parent)) throw new TraceError(ERR.CONFLICT, '移动目标或父文件夹版本不匹配')
      if (name === 'plan.move' && !isPlanResolution(resolution) || name === 'folder.move' && !isFolderResolution(resolution)) throw new TraceError(ERR.VALIDATION, '移动目标类型无效')
      const preview = await this.references.previewAgentMove({ path: resolution.path ?? '', target_parent_path: parent.path }, this.storage)
      if (typeof preview.destination_path !== 'string') throw new TraceError(ERR.PATH_UNSAFE, '移动预览目标路径无效')
      validateAgentAuditedPath(preview.destination_path)
      return { ...prepared(async () => {
        const result = await this.references.commitAgentMove(preview.token, this.storage, rootCommitBinding)
        const movedKind = name === 'plan.move' ? 'plan' : 'folder'
        const moved = await verifyCommittedSideEffect(() => this.targets.captureAuditedTarget(rootSnapshot, result.path, movedKind))
        return { content: serialized({ ok: true, path: result.path }), ...(moved.updatedAt ? { afterUpdatedAt: moved.updatedAt } : {}),
          undoStatus: 'available', targetPath: result.path, targetDirectoryIdentity: moved.directoryIdentity,
          ...(moved.planId ? { targetPlanId: moved.planId } : {}) }
      }, [change('path', resolution.path, preview.destination_path)], resolution, true), movePreview: preview }
    }
    if (name === 'plan.trash') {
      const resolution = target('target_ref')
      if (!isPlanResolution(resolution) || args.expected_revision !== resolution.revision) throw new TraceError(ERR.CONFLICT, '回收站目标版本不匹配')
      const preview = await this.references.previewImpact({ library_id: resolution.libraryId, operation: 'delete-plan', path: resolution.path })
      return { ...prepared(async (decision) => {
        const result = await this.references.commitAgentImpact({ library_id: resolution.libraryId, preview, decisions: asReferenceDecisions(decision) }, this.storage,
          { ...rootCommitBinding,
            target: { path: resolution.path, directoryIdentity: resolution.directoryIdentity,
              planId: resolution.planId, updatedAt: resolution.updatedAt } })
        return { content: serialized({ ok: true, trash_entry_id: result.trash_entry_id ?? null }),
          undoStatus: result.trash_entry_id ? 'available' : 'unavailable',
          ...(result.trash_entry_id ? { trashEntryId: result.trash_entry_id } : {}) }
      }, [change('trash', null, resolution.path)], resolution, true), referencePreview: preview }
    }
    if (name === 'trash.restore' || name === 'trash.purge') {
      const resolution = target('trash_entry_ref')
      if (resolution.kind !== 'trash' || args.manifest_revision !== resolution.manifestRevision) throw new TraceError(ERR.CONFLICT, '回收站条目版本不匹配')
      let destination: TrashRestoreDestination | undefined
      if (name === 'trash.restore' && typeof args.destination_parent_ref === 'string') {
        const parent = target('destination_parent_ref')
        if (!isFolderResolution(parent)) throw new TraceError(ERR.VALIDATION, '恢复位置必须是文件夹')
        destination = { parent_path: parent.path, name: typeof args.new_name === 'string' ? strictName(args.new_name) : resolution.name }
        validateAgentAuditedPath(pathWithNewName(destination.parent_path, destination.name))
      }
      const preview = await this.targets.previewTrashOperation({ setId: resolution.setId, ref: resolution.ref }, name === 'trash.restore' ? 'restore' : 'purge', userMessageId, destination)
      if (preview.entry_id !== resolution.entryId) throw new TraceError(ERR.CONFLICT, '回收站条目授权已变化')
      if (name === 'trash.restore') {
        if (typeof preview.restore_relative_path !== 'string') throw new TraceError(ERR.PATH_UNSAFE, '恢复目标路径无效')
        validateAgentAuditedPath(preview.restore_relative_path)
      }
      return { ...prepared(async (decision) => {
        if (name === 'trash.purge' && decision?.strongConfirmation !== true) throw new TraceError(ERR.CONFIRMATION_REQUIRED, '永久清除必须二次强确认')
        const result = name === 'trash.restore'
          ? await this.references.commitTrashRestore(this.storage, preview.confirmation_token, rootCommitBinding)
          : await this.references.commitTrashPurge(this.storage, preview.confirmation_token, rootCommitBinding)
        return { content: serialized({ ok: true, operation: name, path: result.path ?? null }) }
      }, [change(name === 'trash.restore' ? 'restore' : 'purge', resolution.name, preview.restore_relative_path ?? null)], resolution, true), trashPreview: preview }
    }
    throw new TraceError(ERR.VALIDATION, '工具尚未启用')
  }

  private applyPlanCall(name: AgentToolName, args: JsonRecord, document: PlanDocument): void {
    const findComponent = (id: string): Component => {
      const found = document.components.filter((item) => item.id === id)
      if (found.length !== 1 || !EDITABLE_AGENT_COMPONENT_TYPES.has(found[0].type)) {
        throw new TraceError(ERR.PATH_NOT_FOUND, '支持的组件不存在或不可通用编辑')
      }
      return found[0]
    }
    const clear = (record: JsonRecord, fields: unknown): void => {
      if (!Array.isArray(fields)) return
      for (const field of fields) {
        if (typeof field !== 'string') throw new TraceError(ERR.VALIDATION, '清空字段无效')
        delete record[field]
      }
    }
    const patchComponent = (component: Component, patch: JsonRecord | undefined, clearFields: unknown): void => {
      const payload = component.payload as unknown as JsonRecord
      const fieldsByType: Record<Exclude<ComponentType, 'plan_reference'>, string[]> = {
        single_plan: ['title', 'done', 'summary', 'due_date'], multi_plan: ['title', 'summary'], task_list: ['title'],
        task_detail: ['title', 'description', 'planned_at', 'status', 'note'], note: ['content'], mood: ['score', 'text', 'mood_date'],
        heading: ['title', 'size'], custom: ['content', 'source']
      }
      if (component.type === 'plan_reference') throw new TraceError(ERR.VALIDATION, '计划引用不能作为通用组件编辑')
      const allowed = fieldsByType[component.type as Exclude<ComponentType, 'plan_reference'>]
      if (patch) for (const [field, value] of Object.entries(patch)) {
        if (field === 'remark') component.remark = value as string
        else {
          if (!allowed.includes(field)) throw new TraceError(ERR.VALIDATION, '字段不适用于该组件类型')
          if (field === 'status' && component.type === 'task_detail') {
            const detail = payload as unknown as TaskItem
            if (detail.status !== value) applyStatusChange(detail, value as TaskItem['status'])
          } else payload[field] = value
        }
      }
      if (Array.isArray(clearFields)) {
        for (const field of clearFields) {
          if (field === 'remark') delete component.remark
          else {
            if (typeof field !== 'string' || !allowed.includes(field)) throw new TraceError(ERR.VALIDATION, '清空字段不适用于该组件类型')
            delete payload[field]
          }
        }
      }
    }

    if (name === 'component.add') {
      const type = args.type as Exclude<ComponentType, 'plan_reference'>
      const payload = structuredClone(args.payload as JsonRecord)
      const now = new Date(this.now()).toISOString()
      if (type === 'single_plan' && typeof payload.done !== 'boolean') payload.done = false
      if (type === 'single_plan' || type === 'task_detail' || type === 'note' || type === 'mood') payload.created_at = now
      if (type === 'task_detail' && !payload.status) payload.status = 'not_started'
      if (type === 'task_list') payload.items = []
      if (type === 'multi_plan') payload.options = []
      document.components.push({ id: uuid32(), type, payload: payload as unknown as ComponentPayload,
        ...(typeof args.remark === 'string' ? { remark: args.remark } : {}) })
      return
    }
    if (name === 'component.update') {
      const component = findComponent(String(args.component_id))
      patchComponent(component, agentRecord(args.patch) ? args.patch : undefined, args.clear_fields)
      return
    }
    if (name === 'component.delete') {
      const component = findComponent(String(args.component_id))
      document.components = document.components.filter((item) => item !== component)
      return
    }
    if (name === 'task.add' || name === 'task.update' || name === 'task.delete') {
      const list = findComponent(String(args.list_component_id))
      if (list.type !== 'task_list') throw new TraceError(ERR.VALIDATION, '任务操作只支持任务列表组件')
      const payload = list.payload as unknown as { title: string; items: TaskItem[] }
      if (!Array.isArray(payload.items)) throw new TraceError(ERR.FORMAT_INVALID, '任务列表内容无效')
      if (name === 'task.add') {
        const item: TaskItem = { id: uuid32(), title: String(args.title), status: 'not_started' }
        if (typeof args.planned_at === 'string') item.planned_at = args.planned_at
        if (typeof args.note === 'string') item.note = args.note
        payload.items.push(item)
        return
      }
      const item = payload.items.find((entry) => entry.id === args.task_id)
      if (!item) throw new TraceError(ERR.PATH_NOT_FOUND, '任务不存在')
      if (name === 'task.delete') payload.items = payload.items.filter((entry) => entry !== item)
      else {
        const patch = agentRecord(args.patch) ? args.patch : undefined
        if (patch?.title !== undefined) item.title = patch.title as string
        if (patch?.status !== undefined && patch.status !== item.status) applyStatusChange(item, patch.status as TaskItem['status'])
        if (patch?.planned_at !== undefined) item.planned_at = patch.planned_at as string
        if (patch?.note !== undefined) item.note = patch.note as string
        clear(item as unknown as JsonRecord, args.clear_fields)
      }
      return
    }
    if (name === 'multi_option.add' || name === 'multi_option.update' || name === 'multi_option.delete') {
      const component = findComponent(String(args.component_id))
      if (component.type !== 'multi_plan') throw new TraceError(ERR.VALIDATION, '选项操作只支持多选计划组件')
      const payload = component.payload as unknown as { options: Array<{ id: string; text: string; checked: boolean }> }
      if (!Array.isArray(payload.options)) throw new TraceError(ERR.FORMAT_INVALID, '多选计划内容无效')
      if (name === 'multi_option.add') payload.options.push({ id: uuid32(), text: String(args.text), checked: false })
      else {
        const option = payload.options.find((entry) => entry.id === args.option_id)
        if (!option) throw new TraceError(ERR.PATH_NOT_FOUND, '选项不存在')
        if (name === 'multi_option.delete') payload.options = payload.options.filter((entry) => entry !== option)
        else {
          if (typeof args.text === 'string') option.text = args.text
          if (typeof args.checked === 'boolean') option.checked = args.checked
        }
      }
    }
  }

  private planCallDiff(name: AgentToolName, args: JsonRecord, before: PlanDocument, after: PlanDocument): AgentOperationValueChange[] {
    const id = typeof args.component_id === 'string' ? args.component_id : typeof args.list_component_id === 'string' ? args.list_component_id : undefined
    const beforeComponent = id ? before.components.find((component) => component.id === id) : undefined
    const afterComponent = id ? after.components.find((component) => component.id === id) : undefined
    if (name === 'component.add') return [change('component', null, after.components.at(-1))]
    if (name === 'component.delete') return [change('component', beforeComponent, null)]
    if (name === 'component.update') return [change('component', beforeComponent, afterComponent)]
    if (name.startsWith('task.')) return [change('task_list.items', (beforeComponent?.payload as { items?: unknown[] } | undefined)?.items, (afterComponent?.payload as { items?: unknown[] } | undefined)?.items)]
    if (name.startsWith('multi_option.')) return [change('multi_plan.options', (beforeComponent?.payload as { options?: unknown[] } | undefined)?.options, (afterComponent?.payload as { options?: unknown[] } | undefined)?.options)]
    return [change('components', before.components, after.components)]
  }

  private validateDecisions(decisions: AgentOperationDecision[], operations: PreparedOperation[]): Map<string, AgentOperationDecision> {
    if (decisions.length > operations.length || decisions.some((item) => !agentRecord(item) || typeof item.callId !== 'string') ||
      new Set(decisions.map((item) => item.callId)).size !== decisions.length) throw new TraceError(ERR.VALIDATION, '操作决定无效')
    const preparedByCall = new Map(operations.map((item) => [item.call.id, item]))
    for (const prepared of operations) {
      const references = prepared.folderPreview?.references ?? prepared.referencePreview?.references ?? []
      if (references.length === 0) continue
      const decision = decisions.find((item) => item.callId === prepared.call.id)
      const needsRenameChoice = prepared.call.name.endsWith('.rename') || prepared.call.name === 'plan.rename'
      const needsReferenceChoices = prepared.call.name.endsWith('.trash') || prepared.call.name === 'plan.trash' ||
        prepared.call.name === 'component.delete'
      if (needsRenameChoice && decision?.renameAction === undefined) {
        throw new TraceError(ERR.CONFIRMATION_REQUIRED, '请明确选择是否更新计划引用')
      }
      if (needsReferenceChoices && (decision?.referenceDecisions?.length ?? 0) !== references.length) {
        throw new TraceError(ERR.CONFIRMATION_REQUIRED, '请逐条处理全部关联引用')
      }
    }
    for (const decision of decisions) {
      const prepared = preparedByCall.get(decision.callId)
      if (!prepared) throw new TraceError(ERR.VALIDATION, '操作决定不属于当前批次')
      if (decision.renameAction !== undefined && decision.renameAction !== 'update' && decision.renameAction !== 'keep') throw new TraceError(ERR.VALIDATION, '改名引用决定无效')
      const preview = prepared.folderPreview
      const impact = prepared.referencePreview
      const refs = preview?.references ?? impact?.references ?? []
      if (refs.length > 0 && (prepared.call.name.endsWith('.rename') || prepared.call.name === 'plan.rename') && decision.renameAction === undefined) {
        throw new TraceError(ERR.CONFIRMATION_REQUIRED, '请明确选择是否更新计划引用')
      }
      if (refs.length > 0 && (prepared.call.name.endsWith('.trash') || prepared.call.name === 'plan.trash' || prepared.call.name === 'component.delete')) {
        const selected = decision.referenceDecisions ?? []
        if (selected.length !== refs.length) throw new TraceError(ERR.CONFIRMATION_REQUIRED, '请逐条处理全部关联引用')
        const allowed = new Set(refs.map((item) => `${item.source_path}\0${item.source_component_id}`))
        const seen = new Set<string>()
        for (const item of selected) {
          const key = `${item.sourcePath}\0${item.sourceComponentId}`
          if (!allowed.has(key) || seen.has(key) || (item.action === 'replace') !== Boolean(item.replacement)) throw new TraceError(ERR.VALIDATION, '引用决定与冻结预览不匹配')
          seen.add(key)
        }
      }
      if (prepared.call.name === 'trash.purge' && decision.strongConfirmation !== true) throw new TraceError(ERR.CONFIRMATION_REQUIRED, '永久清除必须二次强确认')
      if (decision.strongConfirmation !== undefined && typeof decision.strongConfirmation !== 'boolean') throw new TraceError(ERR.VALIDATION, '强确认状态无效')
    }
    return new Map(decisions.map((item) => [item.callId, item]))
  }

  private async execute(batchId: string, pending: PendingBatch, decisions: Map<string, AgentOperationDecision>, confirmationSource: 'user' | 'policy' = 'policy'): Promise<AgentOperationBatch> {
    const startedAt = new Date(this.now()).toISOString()
    let latestAudit = await this.updateBatch(pending.sessionId, batchId, (batch) => {
      batch.status = 'executing'; batch.confirmationSource = confirmationSource; batch.updatedAt = startedAt
    })
    const results: Array<AgentOperationAuditItem & { output?: string }> = []
    let failedIndex = -1
    let reconciliationResult: AgentOperationBatch | undefined
    const recordUnknownOutcome = async (index: number, operation: PreparedOperation, reason: ReconciliationReason,
      completedAt: string, replaceLastResult: boolean): Promise<AgentOperationBatch> => {
      failedIndex = index
      const unknown: AgentOperationAuditItem = { ...operation.audit, status: 'outcome-unknown',
        confirmationSource: operation.needsConfirmation ? confirmationSource : 'policy', undoStatus: 'unavailable',
        changes: [], errorCategory: 'storage', reconciliationReason: reason, completedAt }
      const output = reconciliationRequiredResult(reason)
      if (replaceLastResult && results.length > 0) results[results.length - 1] = { ...unknown, output }
      else results.push({ ...unknown, output })
      const notExecuted = pending.operations.slice(index + 1).map((remaining) => ({ ...remaining.audit,
        status: 'not-executed' as const, confirmationSource: 'none' as const, completedAt, output: errorResult('conflict') }))
      results.push(...notExecuted)
      const nextAudit = structuredClone(latestAudit)
      nextAudit.status = 'reconciliation-required'
      nextAudit.updatedAt = completedAt
      nextAudit.operations[index] = unknown
      for (let next = index + 1; next < nextAudit.operations.length; next += 1) {
        nextAudit.operations[next] = { ...nextAudit.operations[next], status: 'not-executed', confirmationSource: 'none', completedAt }
      }
      try {
        latestAudit = await this.updateBatch(pending.sessionId, batchId, (batch) => {
          batch.operations[index] = unknown
          for (let next = index + 1; next < batch.operations.length; next += 1) {
            batch.operations[next] = { ...batch.operations[next], status: 'not-executed', confirmationSource: 'none', completedAt }
          }
          batch.status = 'reconciliation-required'
          batch.updatedAt = completedAt
        })
        nextAudit.status = latestAudit.status
        nextAudit.updatedAt = latestAudit.updatedAt
        nextAudit.operations = latestAudit.operations
      } catch {
        // The durable executing/ready record remains a replay guard, including through attempt ancestry.
      }
      return nextAudit
    }
    for (const [index, operation] of pending.operations.entries()) {
      let result: ExecutionResult
      try {
        await this.targets.assertActiveLibrarySnapshot(pending.rootSnapshot)
        if (pending.attemptOf) {
          const latestSession = await this.conversations.sessions.read(pending.sessionId)
          this.assertPendingAttemptCurrent(latestSession.operationBatches, batchId, pending, operation.call.id)
        }
        result = await operation.execute(decisions.get(operation.call.id))
      } catch (error) {
        if (error instanceof PostSideEffectVerificationError) {
          reconciliationResult = await recordUnknownOutcome(index, operation, error.reconciliationReason,
            new Date(this.now()).toISOString(), false)
          break
        }
        failedIndex = index
        const category = safeErrorCategory(error)
        const completedAt = new Date(this.now()).toISOString()
        const failed = { ...operation.audit, status: 'failed' as const, confirmationSource: operation.needsConfirmation ? confirmationSource : 'policy', errorCategory: category, completedAt }
        results.push({ ...failed, output: errorResult(category) })
        const notExecuted = pending.operations.slice(index + 1).map((remaining) => ({ ...remaining.audit,
          status: 'not-executed' as const, confirmationSource: 'none' as const, completedAt, output: errorResult(category) }))
        results.push(...notExecuted)
        latestAudit = await this.updateBatch(pending.sessionId, batchId, (batch) => {
          batch.operations[index] = failed
          for (let next = index + 1; next < batch.operations.length; next += 1) {
            batch.operations[next] = { ...batch.operations[next], status: 'not-executed', confirmationSource: 'none', completedAt }
          }
          batch.status = 'execution-failed'; batch.updatedAt = completedAt
        })
        break
      }

      const completedAt = new Date(this.now()).toISOString()
      const completed = { ...operation.audit, status: 'succeeded' as const, confirmationSource: operation.needsConfirmation ? confirmationSource : 'policy',
        ...(result.afterUpdatedAt ? { afterUpdatedAt: result.afterUpdatedAt } : {}),
        ...(result.undoStatus ? { undoStatus: result.undoStatus } : {}),
        ...(result.targetKind ? { targetKind: result.targetKind } : {}),
        ...(result.targetPath ? { targetPath: result.targetPath } : {}),
        ...(result.targetStableId ? { targetStableId: result.targetStableId } : {}),
        ...(result.targetDirectoryIdentity ? { targetDirectoryIdentity: result.targetDirectoryIdentity } : {}),
        ...(result.targetPlanId ? { targetPlanId: result.targetPlanId } : {}),
        ...(result.trashEntryId ? { trashEntryId: result.trashEntryId } : {}), completedAt }
      results.push({ ...completed, output: result.content })
      try {
        await this.recordAttemptSuccess(pending.sessionId, batchId, index, completed, pending, completedAt)
      } catch {
        reconciliationResult = await recordUnknownOutcome(index, operation, 'success-audit-persistence-failed', completedAt, true)
        break
      }
      latestAudit = structuredClone(latestAudit)
      latestAudit.operations[index] = completed
      latestAudit.updatedAt = completedAt
    }
    if (failedIndex < 0) {
      const completedAt = new Date(this.now()).toISOString()
      latestAudit = await this.updateBatch(pending.sessionId, batchId, (batch) => { batch.status = 'awaiting-outbound-preview'; batch.updatedAt = completedAt })
    }
    if (pending.appendToolResults) {
      try { await this.appendResults(pending.sessionId, pending.assistantMessageId, results) }
      catch (error) { if (!reconciliationResult) throw error }
    }
    if (reconciliationResult) return reconciliationResult
    return this.readBatch({ sessionId: pending.sessionId, batchId })
  }

  private prunePending(): void {
    for (const [id, item] of this.pending) if (!this.claimedBatches.has(id) && item.expiresAt <= this.now()) {
      this.pending.delete(id)
      this.releaseSourceKeys(item.reservedSourceKeys ?? [])
    }
  }

  private reservePendingSlot(batchId: string): void {
    this.prunePending()
    if (this.pending.has(batchId) || this.pendingSlotReservations.has(batchId)) {
      throw new TraceError(ERR.STATE_MACHINE, '操作批次待确认槽位重复')
    }
    if (this.pending.size + this.pendingSlotReservations.size >= MAX_PENDING_BATCHES) throw new PendingCapacityError()
    this.pendingSlotReservations.add(batchId)
  }

  private installPending(batchId: string, pending: PendingBatch): void {
    if (!this.pendingSlotReservations.has(batchId) || this.pending.has(batchId)) {
      throw new TraceError(ERR.STATE_MACHINE, '操作批次待确认槽位状态无效')
    }
    this.pending.set(batchId, pending)
    this.pendingSlotReservations.delete(batchId)
  }

  private releasePendingSlotReservation(batchId: string): void {
    this.pendingSlotReservations.delete(batchId)
  }

  private releaseSourceKeys(keys: readonly string[]): void {
    keys.forEach((key) => this.reservedSourceOperations.delete(key))
  }
}
