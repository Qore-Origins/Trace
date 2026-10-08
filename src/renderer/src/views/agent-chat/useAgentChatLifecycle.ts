import { useEffect } from 'react'
import type {
  AgentRequestEvent,
  AgentRequestIdentity,
  AgentSession,
  AgentSessionSummary
} from '@shared/agent-types'
import { invoke, onEvent } from '../../ipc-client'
import { useTranslation } from '../../i18n'
import type { AgentChatLifecycle, AgentChatState } from './types'

type Translate = ReturnType<typeof useTranslation>['t']

export function useAgentChatLifecycle(state: AgentChatState): AgentChatLifecycle {
  const { t } = useTranslation()
  const readSession = (id: string): Promise<void> => readAgentSession({ state, id })
  const refresh = (): Promise<void> => refreshAgentData({ state, readSession, t })
  const cancelPreview = (): Promise<void> => cancelPreviewToken(state)
  const closePreview = (): void => closePreviewModal({ state, cancelPreview, t })

  useAgentUnmount({ state, cancelPreview })
  useSettingsRefresh({ state, refresh, closePreview })
  useRequestEvents({ state, readSession, t })
  useEffect(() => onEvent('trace:agent-operation', (event) => {
    if (!state.live.current || event.sessionId !== state.activeId.current) return
    void readSession(event.sessionId).catch(() => {
      if (state.live.current) state.setError(t('agentChat.failed'))
    })
  }), [])
  return { readSession, refresh, cancelPreview, closePreview }
}

function useAgentUnmount({
  state,
  cancelPreview
}: {
  state: AgentChatState
  cancelPreview: () => Promise<void>
}): void {
  useEffect(() => {
    state.live.current = true
    return () => {
      state.live.current = false
      state.readEpoch.current += 1
      state.refreshEpoch.current += 1
      state.previewEpoch.current += 1
      void cancelPreview().catch(() => undefined)
    }
  }, [])
}

function useSettingsRefresh({
  state,
  refresh,
  closePreview
}: {
  state: AgentChatState
  refresh: () => Promise<void>
  closePreview: () => void
}): void {
  useEffect(() => {
    if (!state.settingsOpen) {
      void refresh()
      return
    }
    state.refreshEpoch.current += 1
    closePreview()
    state.setPickerOpen(false)
    state.setTargetPickerOpen(false)
  }, [state.settingsOpen])
}

function useRequestEvents({
  state,
  readSession,
  t
}: {
  state: AgentChatState
  readSession: (id: string) => Promise<void>
  t: Translate
}): void {
  useEffect(() => onEvent('trace:agent-request', (event) => {
    handleRequestEvent({ state, event, readSession, t })
  }), [])
}

function handleRequestEvent({
  state,
  event,
  readSession,
  t
}: {
  state: AgentChatState
  event: AgentRequestEvent
  readSession: (id: string) => Promise<void>
  t: Translate
}): void {
  if (!state.live.current || event.sessionId !== state.activeId.current) return
  const known = state.identities.current.get(event.sessionId)
  const persisted = state.sessionRef.current?.messages.find((item) => (
    item.id === event.assistantId
      && item.requestId === event.requestId
      && item.status === 'streaming'
  ))
  if (!matchesRequest(known, event) && !persisted) {
    state.earlyEvent.current = event
    return
  }
  void readSession(event.sessionId).catch(() => {
    if (state.live.current && state.activeId.current === event.sessionId) {
      state.setError(t('agentChat.failed'))
    }
  })
  if (event.type === 'terminal') handleTerminalEvent({ state, event })
}

function matchesRequest(
  known: AgentRequestIdentity | undefined,
  event: AgentRequestEvent
): boolean {
  return known?.requestId === event.requestId && known.assistantId === event.assistantId
}

function handleTerminalEvent({
  state,
  event
}: {
  state: AgentChatState
  event: AgentRequestEvent
}): void {
  state.identities.current.delete(event.sessionId)
  void invoke('agent:session:list')
    .then((items) => {
      if (state.live.current) state.setSessions(items)
    })
    .catch(() => undefined)
}

async function readAgentSession({ state, id }: { state: AgentChatState; id: string }): Promise<void> {
  const epoch = ++state.readEpoch.current
  let result = await invoke('agent:session:read', { id })
  if (!isCurrentSessionRead({ state, id, epoch })) return
  const pending = state.earlyEvent.current
  if (isPersistedEarlyEvent({ pending, id, result })) {
    state.earlyEvent.current = null
    result = await invoke('agent:session:read', { id })
  }
  if (isCurrentSessionRead({ state, id, epoch })) {
    state.sessionRef.current = result
    state.setSession(result)
  }
}

function isCurrentSessionRead({
  state,
  id,
  epoch
}: {
  state: AgentChatState
  id: string
  epoch: number
}): boolean {
  return state.live.current
    && state.activeId.current === id
    && epoch === state.readEpoch.current
}

function isPersistedEarlyEvent({
  pending,
  id,
  result
}: {
  pending: AgentRequestEvent | null
  id: string
  result: AgentSession
}): boolean {
  return pending?.sessionId === id && result.messages.some((item) => (
    item.id === pending.assistantId && item.requestId === pending.requestId
  ))
}

async function refreshAgentData({
  state,
  readSession,
  t
}: {
  state: AgentChatState
  readSession: (id: string) => Promise<void>
  t: Translate
}): Promise<void> {
  const epoch = ++state.refreshEpoch.current
  state.setLoading(true)
  state.setError('')
  try {
    const [profiles, sessions] = await Promise.all([
      invoke('agent:profile:list'),
      invoke('agent:session:list')
    ])
    if (!state.live.current || epoch !== state.refreshEpoch.current) return
    state.setProfiles(profiles)
    state.setSessions(sessions)
    updateActiveSession({ state, sessions })
    if (state.activeId.current) await readSession(state.activeId.current)
  } catch {
    if (state.live.current && epoch === state.refreshEpoch.current) {
      state.setError(t('agentChat.failed'))
    }
  } finally {
    if (state.live.current && epoch === state.refreshEpoch.current) state.setLoading(false)
  }
}

function updateActiveSession({
  state,
  sessions
}: {
  state: AgentChatState
  sessions: AgentSessionSummary[]
}): void {
  if (state.activeId.current && !sessions.some((item) => item.id === state.activeId.current)) {
    state.activeId.current = null
    state.setSession(null)
  }
  if (!state.activeId.current && sessions[0]) state.activeId.current = sessions[0].id
}

async function cancelPreviewToken(state: AgentChatState): Promise<void> {
  const token = state.previewToken.current
  const setId = state.targetGrantSet.current
  state.previewToken.current = null
  state.targetGrantSet.current = null
  if (token) await invoke('agent:preview:cancel', { token })
  if (setId) await invoke('agent:target:release', { setId })
}

function closePreviewModal({
  state,
  cancelPreview,
  t
}: {
  state: AgentChatState
  cancelPreview: () => Promise<void>
  t: Translate
}): void {
  if (state.sending.current) return
  state.previewEpoch.current += 1
  state.setPreviewOpen(false)
  state.setPreview(null)
  state.setPreviewLoading(false)
  void cancelPreview().catch(() => {
    if (state.live.current) state.setError(t('agentChat.previewFailed'))
  })
}
