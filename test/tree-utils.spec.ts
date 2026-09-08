// 树纯逻辑测试：箭头数据驱动语义（2026-09-06 U1 修复的行为锚点，2026-09-07 迁移 flattenTree）
// + optimisticMove（松手即落位）；2026-09-08 拖拽语义定稿（不排序）→ 三分区落点测试随实现退役
import { describe, it, expect } from 'vitest'
import { flattenTree, optimisticMove, kindOf } from '../src/renderer/src/components/tree-utils'
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

describe('optimisticMove（乐观换位，消除松手弹回；2026-09-08 定稿：统一 name-sort 插入）', () => {
  it('跨父移入已加载计划 → 按 name-sort 插入，节点 path 迁移', () => {
    const map = { '': [n('A', 'A', false), n('P', 'P', true)], P: [n('P/x', 'x', false), n('P/y', 'y', false)] }
    const r = optimisticMove(map, { '': true, P: true }, 'A', 'P')
    expect(r?.childrenMap[''].map((x) => x.name)).toEqual(['P'])
    expect(r?.childrenMap.P.map((x) => x.path)).toEqual(['P/A', 'P/x', 'P/y'])
  })
  it('跨父移入已加载文件夹 → 按 name-sort 插入（对齐权威刷新位）', () => {
    const map = {
      '': [n('c', 'c', false), n('F', 'F', true, 'folder')],
      F: [n('F/b', 'b', false), n('F/d', 'd', false)]
    }
    const r = optimisticMove(map, { '': true, F: true }, 'c', 'F')
    expect(r?.childrenMap.F.map((x) => x.name)).toEqual(['b', 'c', 'd'])
  })
  it('同父移动（UI 已拦截，防御性路径）→ name-sort 原位', () => {
    const map = { '': [n('F', 'F', true, 'folder')], F: [n('F/a', 'a', false), n('F/b', 'b', false), n('F/c', 'c', false)] }
    const r = optimisticMove(map, { '': true, F: true }, 'F/c', 'F')
    expect(r?.childrenMap.F.map((x) => x.name)).toEqual(['a', 'b', 'c'])
  })
  it('目标层未加载 → 旧位移除、目标层不预插（折叠中不可见）', () => {
    const map = { '': [n('A', 'A', false), n('F', 'F', true, 'folder')] } // F 从未展开
    const r = optimisticMove(map, { '': true }, 'A', 'F')
    expect(r?.childrenMap[''].map((x) => x.name)).toEqual(['F'])
    expect(r?.childrenMap.F).toBeUndefined()
  })
  it('已加载子树随迁：键前缀与后代节点 path 一并迁移，旧键清除', () => {
    const map = {
      '': [n('G', 'G', true), n('T', 'T', false)],
      G: [n('G/k', 'k', true)],
      'G/k': [n('G/k/leaf', 'leaf', false)]
    }
    const r = optimisticMove(map, { '': true, G: true, 'G/k': true }, 'G', 'T')
    expect(r?.childrenMap[''].map((x) => x.name)).toEqual(['T'])
    expect(r?.childrenMap['T/G']?.[0]?.path).toBe('T/G/k')
    expect(r?.childrenMap['T/G/k']?.[0]?.path).toBe('T/G/k/leaf')
    expect(r?.childrenMap.G).toBeUndefined()
    expect(r?.loaded['T/G']).toBe(true)
  })
  it('跨父移入空文件夹（has_children=false）→ 目标行置真（flattenTree 才下钻渲染）', () => {
    const map = { '': [n('A', 'A', false), n('F', 'F', false, 'folder')], F: [] }
    const r = optimisticMove(map, { '': true, F: true }, 'A', 'F')
    expect(r?.childrenMap.F.map((x) => x.path)).toEqual(['F/A'])
    expect(r?.childrenMap[''].find((x) => x.name === 'F')?.has_children).toBe(true)
  })
  it('节点不在已加载视图 → null（不可乐观，交由 IPC 后权威刷新）', () => {
    expect(optimisticMove({}, {}, 'X', '')).toBeNull()
  })
})
