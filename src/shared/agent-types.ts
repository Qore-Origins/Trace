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
