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
export interface AgentSession {
  id: string
  title: string
  profileId: string
  createdAt: string
  updatedAt: string
  revision: number
  messages: AgentMessage[]
  requests: AgentRequestProvenance[]
}
export type AgentSessionSummary = Omit<AgentSession, 'messages' | 'requests'>
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
export type AgentRequestEvent = AgentRequestIdentity & (
  | { type: 'delta'; text: string }
  | { type: 'terminal'; status: Exclude<AgentMessageStatus, 'streaming'>; marker: '【用户中断】' | '【异常中断】' | null; errorCategory: AgentRequestErrorCategory | null }
)
