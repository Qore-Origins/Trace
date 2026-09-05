// 任务三态状态机（LLD §6.3）：not_started ↔ in_progress ↔ done，允许回退
import type { TaskStatus } from './plan-types'
import { ERR, TraceError } from './errors'

const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  not_started: ['in_progress'],
  in_progress: ['not_started', 'done'],
  done: ['in_progress']
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) {
    throw new TraceError(ERR.STATE_MACHINE, '任务状态不允许该变更')
  }
}

// 应用状态变更：done 写入 completed_at，回退清除（契约 §8.1 定稿）
export function applyStatusChange(current: { status: TaskStatus; completed_at?: string }, next: TaskStatus): void {
  assertTransition(current.status, next)
  current.status = next
  if (next === 'done') current.completed_at = new Date().toISOString()
  else current.completed_at = undefined
}

// 逾期判定（展示层，不落盘）：计划时间早于今天且未完成
export function isOverdue(status: TaskStatus, plannedAt?: string, todayLocal = new Date()): boolean {
  if (!plannedAt || status === 'done') return false
  const today = todayLocal.toISOString().slice(0, 10)
  return plannedAt < today
}
