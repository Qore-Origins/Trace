export type AgentProtocol = 'openai-chat-completions'
export type AgentCapabilityStatus = 'untested' | 'passed' | 'failed' | 'needs-retest'
export type AgentKeyStatus = 'missing' | 'saved' | 'session-only'

export interface AgentCapability {
  status: AgentCapabilityStatus
  testedAt: string | null
  errorCategory: string | null
}

export interface AgentProfile {
  id: string
  name: string
  presetId: string | null
  protocol: AgentProtocol
  endpoint: string
  model: string
  keyStatus: AgentKeyStatus
  capability: AgentCapability
}

export interface AgentProfileInput {
  name: string
  endpoint: string
  model: string
  presetId?: string | null
}

export interface AgentProfileList {
  profiles: AgentProfile[]
  defaultProfileId: string | null
}

export interface AgentProviderPreset {
  id: string
  name: string
  category: 'direct' | 'aggregator'
  protocol: AgentProtocol
  endpoint: string
  model: string
  note: string
  documentationUrl: string
}

/** The only request material shown by the isolated outbound-approval window. */
export interface AgentApprovalRequestSnapshot {
  endpoint: string
  model: string
  serializedBody: string
}

export type AgentMessageStatus = 'complete' | 'streaming' | 'user-interrupted' | 'error-interrupted'
export interface AgentChatToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}
export interface AgentCompletedToolCall { id: string; name: string; arguments: Record<string, unknown> }
export interface AgentMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: AgentChatToolCall[]
  toolCallId?: string
  status: AgentMessageStatus
  createdAt: string
  requestId: string
}
export interface AgentContextSelection { kind: 'plan' | 'diary'; path: string }
export interface AgentContextSource extends AgentContextSelection {
  libraryId: string
  version: string
  updatedAt: string
}
export interface AgentContextEntry extends AgentContextSource { content: string }
export interface AgentTarget {
  id: string
  name: string
  presetId: string | null
  protocol: AgentProtocol
  endpoint: string
  model: string
}
export type AgentTargetKind = 'plan' | 'folder' | 'trash'
export type AgentTargetSelection =
  | { kind: 'plan'; path: string }
  | { kind: 'folder'; path: string }
  | { kind: 'trash'; entryId: string }
export interface AgentTargetGrantInput { targets: AgentTargetSelection[] }
export interface AgentTargetGrant {
  ref: string
  kind: AgentTargetKind
  path: string | null
  name: string
  revision: string
  expiresAt: string
}
export interface AgentTargetGrantSet {
  id: string
  expiresAt: string
  targets: AgentTargetGrant[]
}
export interface AgentTargetValidationInput { setId: string; ref: string }
export interface AgentTargetGrantReleaseInput { setId: string }
export interface AgentTargetChildrenInput extends AgentTargetValidationInput {}
export interface AgentTargetChild { path: string; name: string; kind: 'plan' | 'folder' }

export type AgentPermissionMode = 'confirm' | 'restricted' | 'unrestricted'
export interface AgentPermissionPolicy { mode: AgentPermissionMode }
export interface AgentRequestProvenance {
  id: string
  profileId: string
  profileName: string
  presetId: string | null
  model: string
  requestedAt: string
  sources: AgentContextSource[]
  toolRounds?: number
  toolCallCount?: number
}

export type AgentOperationBatchStatus =
  | 'preflight-failed' | 'pending-confirmation' | 'executing'
  | 'awaiting-outbound-preview' | 'completed' | 'execution-failed' | 'reconciliation-required' | 'cancelled'
export type AgentOperationItemStatus = 'ready' | 'succeeded' | 'failed' | 'outcome-unknown' | 'not-executed' | 'cancelled'
export type AgentOperationConfirmationSource = 'user' | 'policy' | 'none'
export type AgentOperationErrorCategory = 'validation' | 'authorization' | 'conflict' | 'not-found' | 'name-conflict' | 'storage' | 'internal'
export type AgentOperationAttemptKind = 'retry' | 'continue' | 'undo'
export interface AgentOperationValueChange {
  field: string
  before: string | null
  after: string | null
}
export interface AgentOperationAuditItem {
  callId: string
  operation: string
  status: AgentOperationItemStatus
  targetKind?: 'plan' | 'folder' | 'trash'
  targetPath?: string
  targetStableId?: string
  targetDirectoryIdentity?: string
  targetPlanId?: string
  trashEntryId?: string
  componentId?: string
  libraryId: string
  rootHash: string
  rootGeneration: number
  beforeUpdatedAt?: string
  afterUpdatedAt?: string
  changes: AgentOperationValueChange[]
  requiredConfirmation: boolean
  confirmationSource: AgentOperationConfirmationSource
  reversible: boolean
  undoStatus: 'unavailable' | 'available' | 'undone' | 'stale'
  reconciliationReason?: 'success-audit-persistence-failed' | 'post-side-effect-verification-failed' | 'process-interrupted'
  errorCategory?: AgentOperationErrorCategory
  resolvedByAttempt?: string
  createdAt: string
  completedAt?: string
}
export interface AgentOperationBatchAudit {
  id: string
  requestId: string
  assistantMessageId: string
  userMessageId: string
  createdAt: string
  updatedAt: string
  policyMode: AgentPermissionMode
  attemptOf?: string
  attemptKind?: AgentOperationAttemptKind
  status: AgentOperationBatchStatus
  confirmationSource: AgentOperationConfirmationSource
  requiredConfirmation: boolean
  operations: AgentOperationAuditItem[]
}
export interface AgentOperationReferencePreviewItem {
  callId: string
  sourcePath: string
  sourceComponentId: string
  mode: 'link' | 'embed'
  targetNameSnapshot: string
  allowedActions: Array<'update' | 'keep' | 'replace'>
}
export interface AgentOperationSubtreePreviewEntry {
  relativePath: string
  kind: 'folder' | 'plan'
  planId?: string
}
export interface AgentOperationAffectedSubtreePreview {
  callId: string
  targetPath: string
  entries: AgentOperationSubtreePreviewEntry[]
}
export interface AgentOperationTrashPreviewItem {
  callId: string
  operation: 'restore' | 'purge'
  entryId: string
  name: string
  originalRelativePath: string
  restoreRelativePath: string | null
  planCount: number
  referenceCount: number
}
export interface AgentOperationConfirmationPreview {
  references: AgentOperationReferencePreviewItem[]
  affectedSubtrees?: AgentOperationAffectedSubtreePreview[]
  trashOperations?: AgentOperationTrashPreviewItem[]
}
export interface AgentOperationBatch extends AgentOperationBatchAudit {
  confirmationPreview?: AgentOperationConfirmationPreview
}
export interface AgentOperationBatchReadInput { sessionId: string; batchId: string }
export interface AgentOperationDecision {
  callId: string
  renameAction?: 'update' | 'keep'
  referenceDecisions?: Array<{
    sourcePath: string
    sourceComponentId: string
    action: 'keep' | 'replace'
    replacement?: { path: string; componentId?: string }
  }>
  strongConfirmation?: boolean
}
export interface AgentOperationBatchConfirmInput {
  sessionId: string
  batchId: string
  decisions?: AgentOperationDecision[]
}
export interface AgentOperationBatchCancelInput { sessionId: string; batchId: string }
export interface AgentOperationResumeInput { sessionId: string; batchId: string; callIds: string[] }
export interface AgentOperationUndoInput { sessionId: string; batchId: string; callId: string }
export interface AgentContinuationPreviewInput { sessionId: string; batchId: string }
export interface AgentOperationEvent {
  sessionId: string
  requestId: string
  batchId: string
  status: AgentOperationBatchStatus
}
export interface AgentSession {
  id: string
  title: string
  profileId: string
  createdAt: string
  updatedAt: string
  revision: number
  messages: AgentMessage[]
  requests: AgentRequestProvenance[]
  operationBatches: AgentOperationBatchAudit[]
}
export type AgentSessionSummary = Omit<AgentSession, 'messages' | 'requests' | 'operationBatches'>
export interface AgentSessionInput { title: string; profileId: string }
export interface AgentPreviewInput {
  sessionId: string
  message: string
  selections: AgentContextSelection[]
  includeHistory?: boolean
  includePartialMessageIds?: string[]
  targetGrantSetId?: string
  targetRefs?: string[]
}
export type AgentPreviewMessage =
  | { role: 'user' | 'system'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: AgentChatToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string }
export type AgentHistoryItem = AgentPreviewMessage & { messageId: string; kind: 'message' | 'interruption' }
export interface AgentOutboundPreview {
  token: string
  sessionId: string
  sessionRevision: number
  expiresAt: string
  target: AgentTarget
  message: string
  history: AgentHistoryItem[]
  contexts: AgentContextEntry[]
  messages: AgentPreviewMessage[]
  tools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }>
  toolChoice?: 'auto'
  targets?: AgentTargetGrant[]
}

export const AGENT_MAX_TOOL_ROUNDS_PER_REQUEST = 8
export const AGENT_MAX_TOOL_CALLS_PER_REQUEST = 20

export interface AgentRequestSendInput { token: string; sessionId: string }
export interface AgentRequestCancelInput { sessionId: string; requestId: string }
export interface AgentRequestIdentity extends AgentRequestCancelInput { assistantId: string }
export type AgentRequestErrorCategory = 'validation' | 'authentication' | 'http' | 'protocol' | 'limit' | 'timeout' | 'network' | 'storage'
// Compatibility re-export: the private IPC bridge contract itself lives in ipc-contract.ts.
export type { AgentApprovalBridge } from './ipc-contract'
export type AgentRequestEvent = AgentRequestIdentity & (
  | { type: 'delta'; text: string }
  | { type: 'terminal'; status: Exclude<AgentMessageStatus, 'streaming'>; marker: '【用户中断】' | '【异常中断】' | null; errorCategory: AgentRequestErrorCategory | null }
)
