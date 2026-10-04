import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { AGENT_APPROVAL_IPC } from '../../shared/agent-types'
import type { AgentApprovalWindowService } from '../services/agent-approval-window-service'

export function registerAgentApprovalIpc(
  service: AgentApprovalWindowService,
  ipc: Pick<typeof ipcMain, 'handle' | 'removeHandler'> = ipcMain
): () => void {
  ipc.handle(AGENT_APPROVAL_IPC.getSnapshot, (event: IpcMainInvokeEvent) =>
    service.getSnapshot(event.sender, event.senderFrame))
  ipc.handle(AGENT_APPROVAL_IPC.confirm, (event: IpcMainInvokeEvent) =>
    service.confirm(event.sender, event.senderFrame))
  ipc.handle(AGENT_APPROVAL_IPC.cancel, (event: IpcMainInvokeEvent) =>
    service.cancel(event.sender, event.senderFrame))

  return () => {
    ipc.removeHandler(AGENT_APPROVAL_IPC.getSnapshot)
    ipc.removeHandler(AGENT_APPROVAL_IPC.confirm)
    ipc.removeHandler(AGENT_APPROVAL_IPC.cancel)
  }
}
