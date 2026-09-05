// 名称校验 + 路径安全 + 循环校验测试
import { describe, it, expect } from 'vitest'
import { validatePlanName, validateTitle, uuid32, isUuid32 } from '../src/shared/validation'
import { TraceError, ERR } from '../src/shared/errors'
import { normalizeRel, resolveWithin, isSelfOrDescendant, parentRel, normalizeRelSafe } from '../src/main/services/path-safety'

describe('validatePlanName', () => {
  it.each(['学期计划', '2026-A', 'a b.c', '中文名-255以内'])('合法名称 %s 通过', (n) => {
    expect(() => validatePlanName(n)).not.toThrow()
  })
  it.each(['', '   ', 'a/b', 'a\\b', 'a:b', 'a*b', '?', '"x"', '<x>', 'a|b', 'x.'.padEnd(256, 'a'), 'name.', 'name ', 'con'])(
    '非法名称 %s 拒绝',
    (n) => {
      expect(() => validatePlanName(n)).toThrow(TraceError)
    }
  )
})

describe('validateTitle', () => {
  it('空标题拒绝', () => expect(() => validateTitle('')).toThrow(TraceError))
  it('超长拒绝', () => expect(() => validateTitle('a'.repeat(201))).toThrow(TraceError))
  it('正常通过', () => expect(() => validateTitle('写周报')).not.toThrow())
})

describe('uuid32', () => {
  it('生成 32 位 hex 且自验通过', () => {
    const id = uuid32()
    expect(id.length).toBe(32)
    expect(isUuid32(id)).toBe(true)
  })
})

describe('normalizeRel', () => {
  it('空/斜杠归一', () => {
    expect(normalizeRel('')).toBe('')
    expect(normalizeRel('/a/b/')).toBe('a/b')
    expect(normalizeRel('a\\b')).toBe('a/b')
  })
  it('.. 在安全规范化时拒绝（主进程入口防线）', () => {
    expect(() => normalizeRelSafe('a/../b')).toThrow(TraceError)
  })
})

describe('resolveWithin（Windows 风格分隔）', () => {
  const root = 'C:\\Plans\\Trace'
  it('根内路径解析', () => {
    const r = resolveWithin(root, '学期/周计划')
    expect(r.rel).toBe('学期/周计划')
    expect(r.abs.startsWith(root)).toBe(true)
  })
  it('空串=根', () => {
    expect(resolveWithin(root, '').abs).toBe(root)
  })
})

describe('isSelfOrDescendant（LLD §6.2）', () => {
  it('拖入自身 → true', () => {
    expect(isSelfOrDescendant('a', 'a')).toBe(true)
  })
  it('拖入子孙 → true', () => {
    expect(isSelfOrDescendant('a', 'a/b')).toBe(true)
    expect(isSelfOrDescendant('a', 'a/b/c')).toBe(true)
  })
  it('拖到别处/根 → false', () => {
    expect(isSelfOrDescendant('a', 'ab')).toBe(false) // 前缀非段边界
    expect(isSelfOrDescendant('a', '')).toBe(false)
    expect(isSelfOrDescendant('', 'a')).toBe(false)
  })
})

describe('parentRel', () => {
  it('层级回退', () => {
    expect(parentRel('a/b/c')).toBe('a/b')
    expect(parentRel('a')).toBe('')
    expect(parentRel('')).toBe('')
  })
})
