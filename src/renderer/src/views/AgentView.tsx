import { i18n } from '../i18n'
import { agentChatEnUS } from '../i18n/locales/agent-chat-en-US'
import { agentChatZhCN } from '../i18n/locales/agent-chat-zh-CN'
import AgentChatPage from './agent-chat/AgentChatPage'
import { useAgentChatController } from './agent-chat/useAgentChatController'

i18n.addResourceBundle('zh-CN', 'translation', { agentChat: agentChatZhCN }, true, true)
i18n.addResourceBundle('en-US', 'translation', { agentChat: agentChatEnUS }, true, true)

export default function AgentView(): React.JSX.Element {
  const chat = useAgentChatController()
  return <AgentChatPage chat={chat} />
}
