// 任务状态机测试（LLD §6.3）：合法转换/非法转换/completed_at 维护/逾期判定
import { describe, it, expect } from 'vitest'
import { canTransition, applyStatusChange, isOverdue } from '../src/shared/task-state'
import { TraceError, ERR } from '../src/shared/errors'

describe('状态机转换', () => {
  it('合法：not_started → in_progress', () => {
    expect(canTransition('not_started', 'in_progress')).toBe(true)
  })
  it('合法：in_progress → done / not_started（回退）', () => {
    expect(canTransition('in_progress', 'done')).toBe(true)
    expect(canTransition('in_progress', 'not_started')).toBe(true)
  })
  it('合法：done → in_progress（回退）', () => {
    expect(canTransition('done', 'in_progress')).toBe(true)
  })
  it('非法：not_started → done（越级）', () => {
    expect(canTransition('not_started', 'done')).toBe(false)
  })
  it('非法：done → not_started（跨态回退）', () => {
    expect(canTransition('done', 'not_started')).toBe(false)
  })
})

describe('applyStatusChange', () => {
  it('进入 done 写入 completed_at', () => {
    const task = { status: 'in_progress' as const, completed_at: undefined }
    applyStatusChange(task, 'done')
    expect(task.status).toBe('done')
    expect(task.completed_at).toBeTruthy()
  })
  it('回退清除 completed_at（契约 §8.1 定稿）', () => {
    const task = { status: 'done' as const, completed_at: '2026-09-05T00:00:00Z' }
    applyStatusChange(task, 'in_progress')
    expect(task.status).toBe('in_progress')
    expect(task.completed_at).toBeUndefined()
  })
  it('越级抛 STATE_MACHINE(21)', () => {
    const task = { status: 'not_started' as const, completed_at: undefined }
    expect(() => applyStatusChange(task, 'done')).toThrowError(new TraceError(ERR.STATE_MACHINE, '任务状态不允许该变更'))
  })
})

describe('isOverdue（展示层）', () => {
  const today = new Date('2026-09-05T12:00:00Z')
  it('计划时间已过且未完成 → 逾期', () => {
    expect(isOverdue('not_started', '2026-09-04', today)).toBe(true)
  })
  it('已完成 → 不逾期', () => {
    expect(isOverdue('done', '2026-09-01', today)).toBe(false)
  })
  it('无计划时间 → 不逾期', () => {
    expect(isOverdue('not_started', undefined, today)).toBe(false)
  })
})
