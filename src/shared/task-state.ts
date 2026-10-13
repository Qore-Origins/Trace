// 任务状态机：未开始 / 进行中 / 完成；跨周交接的 moved 是终态。
import type { TaskStatus } from './plan-types'
import { ERR, TraceError } from './errors'

const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  not_started: ['in_progress', 'moved'],
  in_progress: ['not_started', 'done', 'moved'],
  done: ['in_progress'],
  moved: []
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return Array.isArray(TRANSITIONS[from]) && TRANSITIONS[from].includes(to)
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

// 计划日期已过：供完成态保留逾期标签布局槽位，不代表任务仍然逾期
export function isPastPlannedDate(plannedAt?: string, todayLocal = new Date()): boolean {
  if (!plannedAt) return false
  const today = todayLocal.toISOString().slice(0, 10)
  return plannedAt < today
}

// 逾期判定（展示层，不落盘）：计划时间早于今天且未完成
export function isOverdue(status: TaskStatus, plannedAt?: string, todayLocal = new Date()): boolean {
  return status !== 'done' && status !== 'moved' && isPastPlannedDate(plannedAt, todayLocal)
}
