import { describe, expect, it } from 'vitest'
import { todayDateStr, validateDueDate } from '../src/shared/validation'
import { ERR, TraceError } from '../src/shared/errors'

describe('validateDueDate', () => {
  it('合法 YYYY-MM-DD 通过', () => {
    expect(() => validateDueDate('2026-09-10')).not.toThrow()
  })
  it('清除（undefined/空串）通过', () => {
    expect(() => validateDueDate(undefined)).not.toThrow()
    expect(() => validateDueDate('')).not.toThrow()
  })
  it('非法：格式错/不存在日期/非字符串', () => {
    expect(() => validateDueDate('20260910')).toThrow(TraceError)
    expect(() => validateDueDate('2026-13-01')).toThrow(TraceError)
    expect(() => validateDueDate('2026-02-30')).toThrow(TraceError)
    expect(() => validateDueDate(20260910)).toThrow(TraceError)
  })
})

describe('todayDateStr', () => {
  it('返回本地今天 YYYY-MM-DD 且可被 validateDueDate 通过', () => {
    const s = todayDateStr()
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(() => validateDueDate(s)).not.toThrow()
  })
})
