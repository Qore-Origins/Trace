// 事件通道类型（主进程 → 渲染器；接口设计文档 §2.4）
import type { PlantUmlStatusDto } from './plantuml-types'
import type { AgentOperationEvent, AgentRequestEvent } from './agent-types'

// 仅传状态，错误细节可能含正文/本机路径，统一由 renderer 提供本地化文案。
export type DiaryAutomationStatus =
  | { state: 'running' | 'complete'; retryable: false }
  | { state: 'error'; retryable: true }

export interface TraceEventsContract {
  'trace:plan-changed': { path: string }
  'trace:reference-target-changed': { plan_ids: string[] }
  'trace:save-status': { path: string; saved: boolean; at: string }
  'trace:fs-external-change': { paths: string[]; type: 'created' | 'changed' | 'removed' }
  'trace:index-status': { state: 'building' | 'ready' | 'error'; progress?: number }
  'trace:window-state': { maximized: boolean }
  'trace:plantuml-status': PlantUmlStatusDto
  'trace:diary-automation-status': DiaryAutomationStatus
  'trace:agent-request': AgentRequestEvent
  'trace:agent-operation': AgentOperationEvent
}
