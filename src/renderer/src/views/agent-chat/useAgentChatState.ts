import { useRef, useState } from 'react'
import type {
  AgentContextEntry,
  AgentOutboundPreview,
  AgentProfileList,
  AgentRequestEvent,
  AgentRequestIdentity,
  AgentSession,
  AgentSessionSummary
} from '@shared/agent-types'
import { useUiStore } from '../../stores/ui-store'
import type { AgentChatState, AgentPreviewState, AgentSessionState } from './types'

export function useAgentChatState(): AgentChatState {
  const sessionState = useAgentSessionState()
  const previewState = useAgentPreviewState()
  const settingsOpen = useUiStore((state) => state.settingsOpen)
  return { ...sessionState, ...previewState, settingsOpen }
}

function useAgentSessionState(): AgentSessionState {
  const [profiles, setProfiles] = useState<AgentProfileList>({ profiles: [], defaultProfileId: null })
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([])
  const [session, setSession] = useState<AgentSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [sources, setSources] = useState<AgentContextEntry[]>([])
  const activeId = useRef<string | null>(null)
  const readEpoch = useRef(0)
  const refreshEpoch = useRef(0)
  const live = useRef(true)
  const sessionRef = useRef<AgentSession | null>(null)
  const identities = useRef(new Map<string, AgentRequestIdentity>())
  const earlyEvent = useRef<AgentRequestEvent | null>(null)

  return {
    profiles,
    setProfiles,
    sessions,
    setSessions,
    session,
    setSession,
    loading,
    setLoading,
    busy,
    setBusy,
    error,
    setError,
    draft,
    setDraft,
    sources,
    setSources,
    activeId,
    readEpoch,
    refreshEpoch,
    live,
    sessionRef,
    identities,
    earlyEvent
  }
}

function useAgentPreviewState(): AgentPreviewState {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [preview, setPreview] = useState<AgentOutboundPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [includeHistory, setIncludeHistory] = useState(true)
  const [partialIds, setPartialIds] = useState<string[]>([])
  const previewEpoch = useRef(0)
  const previewToken = useRef<string | null>(null)
  const sending = useRef(false)

  return {
    pickerOpen,
    setPickerOpen,
    previewOpen,
    setPreviewOpen,
    preview,
    setPreview,
    previewLoading,
    setPreviewLoading,
    includeHistory,
    setIncludeHistory,
    partialIds,
    setPartialIds,
    previewEpoch,
    previewToken,
    sending
  }
}
