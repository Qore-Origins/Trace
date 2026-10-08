import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type {
  AgentContextEntry,
  AgentOutboundPreview,
  AgentProfile,
  AgentProfileList,
  AgentRequestEvent,
  AgentRequestIdentity,
  AgentSession,
  AgentSessionSummary,
  AgentTargetSelection
} from '@shared/agent-types'

export type StateSetter<T> = Dispatch<SetStateAction<T>>

export interface AgentSessionState {
  profiles: AgentProfileList
  setProfiles: StateSetter<AgentProfileList>
  sessions: AgentSessionSummary[]
  setSessions: StateSetter<AgentSessionSummary[]>
  session: AgentSession | null
  setSession: StateSetter<AgentSession | null>
  loading: boolean
  setLoading: StateSetter<boolean>
  busy: boolean
  setBusy: StateSetter<boolean>
  error: string
  setError: StateSetter<string>
  draft: string
  setDraft: StateSetter<string>
  sources: AgentContextEntry[]
  setSources: StateSetter<AgentContextEntry[]>
  targets: AgentTargetSelection[]
  setTargets: StateSetter<AgentTargetSelection[]>
  targetPickerOpen: boolean
  setTargetPickerOpen: StateSetter<boolean>
  targetGrantSet: MutableRefObject<string | null>
  activeId: MutableRefObject<string | null>
  readEpoch: MutableRefObject<number>
  refreshEpoch: MutableRefObject<number>
  live: MutableRefObject<boolean>
  sessionRef: MutableRefObject<AgentSession | null>
  identities: MutableRefObject<Map<string, AgentRequestIdentity>>
  earlyEvent: MutableRefObject<AgentRequestEvent | null>
}

export interface AgentPreviewState {
  pickerOpen: boolean
  setPickerOpen: StateSetter<boolean>
  previewOpen: boolean
  setPreviewOpen: StateSetter<boolean>
  preview: AgentOutboundPreview | null
  setPreview: StateSetter<AgentOutboundPreview | null>
  previewLoading: boolean
  setPreviewLoading: StateSetter<boolean>
  includeHistory: boolean
  setIncludeHistory: StateSetter<boolean>
  partialIds: string[]
  setPartialIds: StateSetter<string[]>
  previewEpoch: MutableRefObject<number>
  previewToken: MutableRefObject<string | null>
  sending: MutableRefObject<boolean>
}

export interface AgentChatState extends AgentSessionState, AgentPreviewState {
  settingsOpen: boolean
}

export interface AgentChatLifecycle {
  readSession: (id: string) => Promise<void>
  refresh: () => Promise<void>
  cancelPreview: () => Promise<void>
  closePreview: () => void
}

export interface AgentChatController extends AgentChatState, AgentChatLifecycle {
  currentProfile: AgentProfile | undefined
  streamingMessage: AgentSession['messages'][number] | undefined
  operate: (action: () => Promise<void>) => Promise<void>
  createSession: () => void
  switchSession: (id: string) => void
  deleteSession: () => void
  changeProfile: (profileId: string) => void
  stop: () => void
  makePreview: (
    entries?: AgentContextEntry[],
    history?: boolean,
    partials?: string[]
  ) => Promise<void>
  confirmSend: () => void
}
