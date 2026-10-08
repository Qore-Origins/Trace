import type { AgentSession } from '@shared/agent-types'
import { getModal } from '../../antd-host'
import { invoke } from '../../ipc-client'
import { useTranslation } from '../../i18n'
import type { AgentChatLifecycle, AgentChatState } from './types'

type Translate = ReturnType<typeof useTranslation>['t']
type Operation = (action: () => Promise<void>) => Promise<void>

interface ActionContext {
  state: AgentChatState
  lifecycle: AgentChatLifecycle
  streamingMessage: AgentSession['messages'][number] | undefined
  operate: Operation
  t: Translate
}

export interface AgentSessionActions {
  operate: Operation
  createSession: () => void
  switchSession: (id: string) => void
  deleteSession: () => void
  changeProfile: (profileId: string) => void
  stop: () => void
}

export function useAgentChatActions({
  state,
  lifecycle,
  streamingMessage
}: {
  state: AgentChatState
  lifecycle: AgentChatLifecycle
  streamingMessage: AgentSession['messages'][number] | undefined
}): AgentSessionActions {
  const { t } = useTranslation()
  const operate: Operation = (action) => runOperation({ state, action, t })
  const context: ActionContext = { state, lifecycle, streamingMessage, operate, t }

  return {
    operate,
    createSession: () => createAgentSession(context),
    switchSession: (id) => switchAgentSession({ ...context, id }),
    deleteSession: () => deleteAgentSession(context),
    changeProfile: (profileId) => changeAgentProfile({ ...context, profileId }),
    stop: () => stopAgentRequest({ ...context })
  }
}

async function runOperation({
  state,
  action,
  t
}: {
  state: AgentChatState
  action: () => Promise<void>
  t: Translate
}): Promise<void> {
  state.setBusy(true)
  state.setError('')
  try {
    await action()
  } catch {
    if (state.live.current) state.setError(t('agentChat.failed'))
  } finally {
    if (state.live.current) state.setBusy(false)
  }
}

function createAgentSession({
  state,
  operate,
  t
}: {
  state: AgentChatState
  operate: Operation
  t: Translate
}): void {
  const profileId = state.profiles.defaultProfileId ?? state.profiles.profiles[0]?.id
  if (!profileId) return
  void operate(async () => {
    const session = await invoke('agent:session:create', {
      title: t('agentChat.newSession'),
      profileId
    })
    if (!state.live.current) return
    state.activeId.current = session.id
    state.readEpoch.current += 1
    state.setSession(session)
    resetConversationDraft(state)
    state.setSessions(await invoke('agent:session:list'))
  })
}

function resetConversationDraft(state: AgentChatState): void {
  state.setDraft('')
  state.setSources([])
  state.setTargets([])
  state.setIncludeHistory(true)
  state.setPartialIds([])
}

function switchAgentSession({
  state,
  lifecycle,
  operate,
  id
}: ActionContext & {
  id: string
}): void {
  state.activeId.current = id
  state.setSession(null)
  resetConversationDraft(state)
  void operate(() => lifecycle.readSession(id))
}

function deleteAgentSession({ state, lifecycle, operate, t }: ActionContext): void {
  if (!state.session) return
  const id = state.session.id
  getModal().confirm({
    title: t('agentChat.deleteTitle'),
    content: t('agentChat.deleteWarning'),
    okText: t('agentChat.delete'),
    cancelText: t('agentChat.cancel'),
    onOk: () => operate(async () => {
      await invoke('agent:session:delete', { id })
      if (!state.live.current) return
      state.activeId.current = null
      state.readEpoch.current += 1
      state.setSession(null)
      await lifecycle.refresh()
    })
  })
}

function changeAgentProfile({
  state,
  operate,
  profileId
}: ActionContext & { profileId: string }): void {
  if (!state.session) return
  const sessionId = state.session.id
  const title = state.session.title
  void operate(async () => {
    const session = await invoke('agent:session:update', {
      id: sessionId,
      title,
      profileId
    })
    if (state.live.current && state.activeId.current === sessionId) {
      state.setSession(session)
    }
    if (state.live.current) state.setSessions(await invoke('agent:session:list'))
  })
}

function stopAgentRequest({
  state,
  lifecycle,
  streamingMessage,
  operate
}: ActionContext): void {
  if (!state.session || !streamingMessage) return
  const sessionId = state.session.id
  void operate(async () => {
    await invoke('agent:request:cancel', {
      sessionId,
      requestId: streamingMessage.requestId
    })
    if (state.activeId.current === sessionId) await lifecycle.readSession(sessionId)
  })
}
