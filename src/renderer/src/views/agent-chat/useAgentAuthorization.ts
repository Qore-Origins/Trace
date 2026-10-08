import type {
  AgentContextEntry,
  AgentOutboundPreview,
  AgentProfile,
  AgentRequestIdentity
} from '@shared/agent-types'
import { invoke } from '../../ipc-client'
import { useTranslation } from '../../i18n'
import type { AgentChatLifecycle, AgentChatState } from './types'

type Translate = ReturnType<typeof useTranslation>['t']
type Operation = (action: () => Promise<void>) => Promise<void>

interface AuthorizationContext {
  state: AgentChatState
  lifecycle: AgentChatLifecycle
  currentProfile: AgentProfile | undefined
  operate: Operation
}

export interface AgentAuthorization {
  closePreview: () => void
  makePreview: (
    entries?: AgentContextEntry[],
    history?: boolean,
    partials?: string[]
  ) => Promise<void>
  confirmSend: () => void
}

export function useAgentAuthorization(context: AuthorizationContext): AgentAuthorization {
  const { t } = useTranslation()
  const { state, lifecycle, currentProfile, operate } = context
  const makePreview = (
    entries = state.sources,
    history = state.includeHistory,
    partials = state.partialIds
  ): Promise<void> => createOutboundPreview({
    state,
    currentProfile,
    cancelPreview: lifecycle.cancelPreview,
    entries,
    history,
    partials,
    t
  })
  const confirmSend = (): void => confirmOutboundPreview({
    state,
    readSession: lifecycle.readSession,
    operate,
    t
  })

  return { closePreview: lifecycle.closePreview, makePreview, confirmSend }
}

async function createOutboundPreview({
  state,
  currentProfile,
  cancelPreview,
  entries,
  history,
  partials,
  t
}: {
  state: AgentChatState
  currentProfile: AgentProfile | undefined
  cancelPreview: () => Promise<void>
  entries: AgentContextEntry[]
  history: boolean
  partials: string[]
  t: Translate
}): Promise<void> {
  if (!state.session || !currentProfile || currentProfile.keyStatus === 'missing') return
  const epoch = ++state.previewEpoch.current
  const sessionId = state.session.id
  state.setPreviewOpen(true)
  state.setPreviewLoading(true)
  state.setPreview(null)
  state.setError('')
  try {
    await cancelPreview()
    if (!isPreviewOperationCurrent(state, epoch)) return
    const grant = state.targets.length
      ? await invoke('agent:target:grant', { targets: state.targets })
      : null
    if (!isPreviewOperationCurrent(state, epoch)) {
      if (grant) await invoke('agent:target:release', { setId: grant.id })
      return
    }
    state.targetGrantSet.current = grant?.id ?? null
    const preview = await invoke('agent:preview:create', {
      sessionId,
      message: state.draft,
      selections: entries.map(({ kind, path }) => ({ kind, path })),
      includeHistory: history,
      includePartialMessageIds: partials,
      ...(grant ? { targetGrantSetId: grant.id, targetRefs: grant.targets.map((target) => target.ref) } : {})
    })
    await applyPreviewResult({ state, epoch, sessionId, preview })
  } catch {
    if (isPreviewOperationCurrent(state, epoch)) {
      state.setError(t('agentChat.previewFailed'))
    }
  } finally {
    if (isPreviewOperationCurrent(state, epoch)) {
      state.setPreviewLoading(false)
    }
  }
}

function isPreviewOperationCurrent(state: AgentChatState, epoch: number): boolean {
  return state.live.current && epoch === state.previewEpoch.current
}

async function applyPreviewResult({
  state,
  epoch,
  sessionId,
  preview
}: {
  state: AgentChatState
  epoch: number
  sessionId: string
  preview: AgentOutboundPreview
}): Promise<void> {
  if (!isCurrentPreview({ state, epoch, sessionId })) {
    await invoke('agent:preview:cancel', { token: preview.token })
    return
  }
  state.previewToken.current = preview.token
  state.setPreview(preview)
}

function isCurrentPreview({
  state,
  epoch,
  sessionId
}: {
  state: AgentChatState
  epoch: number
  sessionId: string
}): boolean {
  return state.live.current
    && epoch === state.previewEpoch.current
    && state.activeId.current === sessionId
}

function confirmOutboundPreview({
  state,
  readSession,
  operate,
  t
}: {
  state: AgentChatState
  readSession: (id: string) => Promise<void>
  operate: Operation
  t: Translate
}): void {
  const preview = state.preview
  if (!isSendablePreview(state, preview)) return
  state.sending.current = true
  void operate(async () => {
    state.previewToken.current = null
    state.targetGrantSet.current = null
    state.previewEpoch.current += 1
    await sendApprovedPreview({ state, preview, readSession, t })
  })
}

function isSendablePreview(
  state: AgentChatState,
  preview: AgentOutboundPreview | null
): preview is AgentOutboundPreview {
  return !!preview
    && !state.previewLoading
    && !state.busy
    && preview.token === state.previewToken.current
}

async function sendApprovedPreview({
  state,
  preview,
  readSession,
  t
}: {
  state: AgentChatState
  preview: AgentOutboundPreview
  readSession: (id: string) => Promise<void>
  t: Translate
}): Promise<void> {
  try {
    const identity = await invoke('agent:request:send', {
      token: preview.token,
      sessionId: preview.sessionId
    })
    await applyRequestIdentity({ state, identity, readSession })
  } catch {
    await handleSendFailure({ state, sessionId: preview.sessionId, readSession, t })
  } finally {
    state.sending.current = false
    if (state.live.current) {
      state.setPreviewOpen(false)
      state.setPreview(null)
    }
  }
}

async function applyRequestIdentity({
  state,
  identity,
  readSession
}: {
  state: AgentChatState
  identity: AgentRequestIdentity
  readSession: (id: string) => Promise<void>
}): Promise<void> {
  state.identities.current.set(identity.sessionId, identity)
  if (!state.live.current || state.activeId.current !== identity.sessionId) return
  state.setDraft('')
  state.setSources([])
  state.setTargets([])
  state.setPartialIds([])
  await readSession(identity.sessionId)
  if (state.live.current) state.setSessions(await invoke('agent:session:list'))
}

async function handleSendFailure({
  state,
  sessionId,
  readSession,
  t
}: {
  state: AgentChatState
  sessionId: string
  readSession: (id: string) => Promise<void>
  t: Translate
}): Promise<void> {
  if (!state.live.current) return
  state.setError(t('agentChat.previewFailed'))
  await readSession(sessionId).catch(() => undefined)
}
