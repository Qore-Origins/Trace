// 树纯逻辑测试：箭头数据驱动语义（2026-09-06 U1 修复的行为锚点，2026-09-07 迁移 flattenTree）
// + dnd-kit 三分区落点换算（intentOf / computeTreeMove）
import { describe, it, expect } from 'vitest'
import { flattenTree, intentOf, computeTreeMove, kindOf, type FlatNode } from '../src/renderer/src/components/tree-utils'
import type { PlanTreeNode } from '../src/shared/ipc-contract'

const n = (path: string, name: string, has_children: boolean, kind: 'plan' | 'folder' = 'plan'): PlanTreeNode => ({
  path,
  name,
  has_children,
  order: 0,
  kind
})

describe('flattenTree（箭头数据驱动）', () => {
  it('has_children=true 且未加载 → hasChildren=true（箭头交懒加载），展开后子层为空但不崩', () => {
    const rows = flattenTree({ '': [n('A', 'A', true)] }, { '': true }, [''])
    const a = rows.find((r) => r.path === 'A')
    expect(a?.hasChildren).toBe(true)
    expect(a?.loaded).toBe(false)
    expect(rows.filter((r) => r.depth === 2)).toEqual([]) // 未加载 → 无子行
  })
  it('has_children=false → 无箭头；展开键存在也不下钻', () => {
    const rows = flattenTree({ '': [n('B', 'B', false)] }, { '': true }, ['', 'B'])
    expect(rows).toHaveLength(2) // 根 + B，无子行
    expect(rows.find((r) => r.path === 'B')?.hasChildren).toBe(false)
  })
  it('空文件夹新建子项后（has_children 翻 true）→ 箭头出现（U1 行为锚点）', () => {
    const before = flattenTree({ '': [n('F', 'F', false)] }, { '': true }, [''])
    expect(before.find((r) => r.path === 'F')?.hasChildren).toBe(false)
    const after = flattenTree({ '': [n('F', 'F', true)], F: [n('F/P', 'P', false)] }, { '': true, F: true }, ['', 'F'])
    const f = after.find((r) => r.path === 'F')
    expect(f?.hasChildren).toBe(true)
    expect(after.find((r) => r.path === 'F/P')?.depth).toBe(2)
  })
  it('根箭头数据驱动：空库已加载 → 无箭头；未加载 → 保守显示', () => {
    expect(flattenTree({ '': [] }, { '': true }, []).find((r) => r.path === '')?.hasChildren).toBe(false)
    expect(flattenTree({}, {}, []).find((r) => r.path === '')?.hasChildren).toBe(true)
  })
  it('折叠层不产出子行（DFS 只走展开层）', () => {
    const rows = flattenTree(
      { '': [n('A', 'A', true)], A: [n('A/x', 'x', false)] },
      { '': true, A: true },
      ['']
    )
    expect(rows.some((r) => r.path === 'A/x')).toBe(false)
  })
})

describe('kindOf', () => {
  it('按路径取 kind，缺失回退 plan', () => {
    const map = { '': [n('A', 'A', false, 'folder'), n('B', 'B', false)] }
    expect(kindOf(map, 'A')).toBe('folder')
    expect(kindOf(map, 'B')).toBe('plan')
    expect(kindOf(map, 'missing')).toBe('plan')
  })
})

describe('intentOf（三分区）', () => {
  it('上 1/3=before，中 1/3=into，下 1/3=after', () => {
    expect(intentOf(2, 30)).toBe('before')
    expect(intentOf(15, 30)).toBe('into')
    expect(intentOf(28, 30)).toBe('after')
  })
})

describe('computeTreeMove（精确索引换算）', () => {
  const map = {
    '': [n('A', 'A', false), n('B', 'B', false), n('C', 'C', false)],
    B: [n('B/x', 'x', false), n('B/y', 'y', false)]
  }
  const row = (path: string, name: string, kind: FlatNode['kind']): FlatNode => ({
    path, name, kind, hasChildren: false, depth: 1, expanded: false, loaded: true
  })
  it('前插/后插按目标索引换算（不同父：索引不变）', () => {
    const before = computeTreeMove('B/x', row('B', 'B', 'plan'), 'before', map)
    const after = computeTreeMove('B/x', row('B', 'B', 'plan'), 'after', map)
    expect(before).toEqual({ dragPath: 'B/x', targetParent: '', orderIndex: 1 })
    expect(after).toEqual({ dragPath: 'B/x', targetParent: '', orderIndex: 2 })
  })
  it('同父拖拽先剔除源自身再算索引（主进程 remove 先于 insert）', () => {
    // A 拖到 C 后：剔除 A 后 C 索引=1 → orderIndex=2
    expect(computeTreeMove('A', row('C', 'C', 'plan'), 'after', map)).toEqual({ dragPath: 'A', targetParent: '', orderIndex: 2 })
    // C 拖到 B 前：剔除 C 后 B 索引=1 → orderIndex=1
    expect(computeTreeMove('C', row('B', 'B', 'plan'), 'before', map)).toEqual({ dragPath: 'C', targetParent: '', orderIndex: 1 })
  })
  it('入内部 → 目标父 + 末尾（MAX）', () => {
    expect(computeTreeMove('A', row('B', 'B', 'plan'), 'into', map)).toEqual({
      dragPath: 'A', targetParent: 'B', orderIndex: Number.MAX_SAFE_INTEGER
    })
  })
  it('根只接收入内部（= 顶层末尾）；前/后与自拖返回 null', () => {
    const root = row('', '计划库（源头）', 'root')
    expect(computeTreeMove('A', root, 'into', map)).toEqual({ dragPath: 'A', targetParent: '', orderIndex: Number.MAX_SAFE_INTEGER })
    expect(computeTreeMove('A', root, 'before', map)).toBeNull()
    expect(computeTreeMove('A', row('A', 'A', 'plan'), 'before', map)).toBeNull()
  })
  it('目标不在兄弟列表（跨层新父未加载）→ 保守末尾（按剔除源后的兄弟数）', () => {
    expect(computeTreeMove('A', row('Z', 'Z', 'plan'), 'before', map)).toEqual({
      dragPath: 'A', targetParent: '', orderIndex: 2
    })
  })
})
