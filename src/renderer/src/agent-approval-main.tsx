import React from 'react'
import ReactDOM from 'react-dom/client'
import { AgentApprovalWindow } from './views/agent-approval/AgentApprovalWindow'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode><AgentApprovalWindow /></React.StrictMode>
)
