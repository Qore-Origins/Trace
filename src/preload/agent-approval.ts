import { contextBridge, ipcRenderer } from 'electron'
import {
  AGENT_APPROVAL_IPC,
  type AgentApprovalBridge,
  type AgentApprovalChannelName,
  type AgentApprovalChannels,
  type TraceResult
} from '../shared/ipc-contract'

function invoke<K extends AgentApprovalChannelName>(
  channel: K
): Promise<TraceResult<AgentApprovalChannels[K]['res']>> {
  return ipcRenderer.invoke(channel) as Promise<TraceResult<AgentApprovalChannels[K]['res']>>
}

const bridge: AgentApprovalBridge = Object.freeze({
  getSnapshot: async () => {
    const result = await invoke(AGENT_APPROVAL_IPC.getSnapshot)
    return result.ok ? result.data : null
  },
  confirm: async () => {
    const result = await invoke(AGENT_APPROVAL_IPC.confirm)
    return result.ok && result.data === true
  },
  cancel: async () => {
    const result = await invoke(AGENT_APPROVAL_IPC.cancel)
    return result.ok && result.data === true
  }
})

contextBridge.exposeInMainWorld('traceAgentApproval', bridge)
