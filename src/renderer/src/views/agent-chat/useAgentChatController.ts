import type { AgentChatController } from './types'
import { useAgentAuthorization } from './useAgentAuthorization'
import { useAgentChatActions } from './useAgentChatActions'
import { useAgentChatLifecycle } from './useAgentChatLifecycle'
import { useAgentChatState } from './useAgentChatState'

export function useAgentChatController(): AgentChatController {
  const state = useAgentChatState()
  const lifecycle = useAgentChatLifecycle(state)
  const currentProfile = state.profiles.profiles.find((profile) => (
    profile.id === state.session?.profileId
  ))
  const streamingMessage = state.session?.messages.find((message) => (
    message.role === 'assistant' && message.status === 'streaming'
  ))
  const actions = useAgentChatActions({ state, lifecycle, streamingMessage })
  const authorization = useAgentAuthorization({
    state,
    lifecycle,
    currentProfile,
    operate: actions.operate
  })

  return {
    ...state,
    ...lifecycle,
    ...actions,
    ...authorization,
    currentProfile,
    streamingMessage
  }
}
