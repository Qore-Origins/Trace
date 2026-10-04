import { contextBridge, ipcRenderer } from 'electron'
import { AGENT_APPROVAL_IPC, type AgentApprovalBridge } from '../shared/agent-types'

const bridge: AgentApprovalBridge = Object.freeze({
  getSnapshot: () => ipcRenderer.invoke(AGENT_APPROVAL_IPC.getSnapshot),
  confirm: () => ipcRenderer.invoke(AGENT_APPROVAL_IPC.confirm),
  cancel: () => ipcRenderer.invoke(AGENT_APPROVAL_IPC.cancel)
})

contextBridge.exposeInMainWorld('traceAgentApproval', bridge)
