import type { TraceBridge } from './index'
import type { AgentApprovalBridge } from '../shared/agent-types'

declare global {
  interface Window {
    trace: TraceBridge
    traceAgentApproval?: AgentApprovalBridge
  }
}

export {}
