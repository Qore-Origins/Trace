import type { IpcMainInvokeEvent } from 'electron'
import { AGENT_APPROVAL_IPC, type AgentApprovalChannelName, type AgentApprovalChannels } from '../../shared/ipc-contract'
import type { AgentApprovalWindowService } from '../services/agent-approval-window-service'

type Handler<K extends AgentApprovalChannelName> = (
  payload: AgentApprovalChannels[K]['req'],
  event: IpcMainInvokeEvent
) => Promise<AgentApprovalChannels[K]['res']>

type Register = <K extends AgentApprovalChannelName>(name: K, handler: Handler<K>) => void
type Remove = (name: AgentApprovalChannelName) => void

export function registerAgentApprovalIpc(
  service: AgentApprovalWindowService,
  register: Register,
  remove: Remove
): () => void {
  register(AGENT_APPROVAL_IPC.getSnapshot, async (_payload, event) =>
    service.getSnapshot(event.sender, event.senderFrame))
  register(AGENT_APPROVAL_IPC.confirm, async (_payload, event) =>
    service.confirm(event.sender, event.senderFrame))
  register(AGENT_APPROVAL_IPC.cancel, async (_payload, event) =>
    service.cancel(event.sender, event.senderFrame))

  return () => {
    remove(AGENT_APPROVAL_IPC.getSnapshot)
    remove(AGENT_APPROVAL_IPC.confirm)
    remove(AGENT_APPROVAL_IPC.cancel)
  }
}
