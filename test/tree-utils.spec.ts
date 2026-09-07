// 树纯逻辑测试：箭头数据驱动语义（2026-09-06 U1 修复的行为锚点，2026-09-07 迁移 flattenTree）
// + dnd-kit 三分区落点换算（intentOf / computeTreeMove）
import { describe, it, expect } from 'vitest'
import { flattenTree, intentOf, computeTreeMove, applyHysteresis, optimisticMove, kindOf, type FlatNode } from '../src/renderer/src/components/tree-utils'
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

describe('intentOf（分区）', () => {
  it('三分区（文件夹/根）：上 1/3=before，中 1/3=into，下 1/3=after', () => {
    expect(intentOf(2, 30, true)).toBe('before')
    expect(intentOf(15, 30, true)).toBe('into')
    expect(intentOf(28, 30, true)).toBe('after')
  })
  it('两分区（计划行禁入内部）：上半=before，下半=after，无 into', () => {
    expect(intentOf(2, 30, false)).toBe('before')
    expect(intentOf(14, 30, false)).toBe('before')
    expect(intentOf(16, 30, false)).toBe('after')
    expect(intentOf(28, 30, false)).toBe('after')
  })
})

describe('applyHysteresis（分区滞回防抖）', () => {
  it('两分区：before 越过中点 4px 内保持，超过才切换', () => {
    // h=30 中点=15：off=18（越过 3px）仍 before；off=20（越过 5px）切 after
    expect(applyHysteresis({ id: 'A', intent: 'before' }, 'A', 'after', 18, 30, false)).toBe('before')
    expect(applyHysteresis({ id: 'A', intent: 'before' }, 'A', 'after', 20, 30, false)).toBe('after')
  })
  it('三分区：into 在上边界 4px 内保持，超过切 before', () => {
    // h=30 t1=10：off=8（进入 before 区 2px）仍 into；off=5（5px）切 before
    expect(applyHysteresis({ id: 'F', intent: 'into' }, 'F', 'before', 8, 30, true)).toBe('into')
    expect(applyHysteresis({ id: 'F', intent: 'into' }, 'F', 'before', 5, 30, true)).toBe('before')
  })
  it('三分区：before 越过下边界进入 into 区 4px 内保持', () => {
    // t1=10：off=13（越过 3px）仍 before；off=15 切 into
    expect(applyHysteresis({ id: 'F', intent: 'before' }, 'F', 'into', 13, 30, true)).toBe('before')
    expect(applyHysteresis({ id: 'F', intent: 'before' }, 'F', 'into', 15, 30, true)).toBe('into')
  })
  it('意图未变 / 目标行变了 / 无历史 → 直接返回原始意图', () => {
    expect(applyHysteresis({ id: 'A', intent: 'before' }, 'A', 'before', 25, 30, false)).toBe('before')
    expect(applyHysteresis({ id: 'A', intent: 'before' }, 'B', 'after', 25, 30, false)).toBe('after')
    expect(applyHysteresis(null, 'A', 'after', 25, 30, false)).toBe('after')
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
  it('入内部（文件夹目标）→ 目标父 + 末尾（MAX）', () => {
    expect(computeTreeMove('A', row('B', 'B', 'folder'), 'into', map)).toEqual({
      dragPath: 'A', targetParent: 'B', orderIndex: Number.MAX_SAFE_INTEGER
    })
  })
  it('计划目标不可入内部 → null（容器语义归文件夹，2026-09-07 定稿）', () => {
    expect(computeTreeMove('A', row('B', 'B', 'plan'), 'into', map)).toBeNull()
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

describe('optimisticMove（乐观换位，消除松手弹回）', () => {
  it('同父重排（顶层=顺序载体）→ 按精确索引换位', () => {
    const map = { '': [n('A', 'A', false), n('B', 'B', false), n('C', 'C', false)] }
    const r = optimisticMove(map, { '': true }, 'A', '', 2)
    expect(r?.childrenMap[''].map((x) => x.name)).toEqual(['B', 'C', 'A'])
  })
  it('跨父移入已加载计划 → 插到 orderIndex 位，节点 path 迁移', () => {
    const map = { '': [n('A', 'A', false), n('P', 'P', true)], P: [n('P/x', 'x', false), n('P/y', 'y', false)] }
    const r = optimisticMove(map, { '': true, P: true }, 'A', 'P', Number.MAX_SAFE_INTEGER)
    expect(r?.childrenMap[''].map((x) => x.name)).toEqual(['P'])
    expect(r?.childrenMap.P.map((x) => x.path)).toEqual(['P/x', 'P/y', 'P/A'])
  })
  it('跨父移入已加载文件夹 → 按 name-sort 插入（无顺序载体，对齐权威刷新位）', () => {
    const map = {
      '': [n('c', 'c', false), n('F', 'F', true, 'folder')],
      F: [n('F/b', 'b', false), n('F/d', 'd', false)]
    }
    const r = optimisticMove(map, { '': true, F: true }, 'c', 'F', 0)
    expect(r?.childrenMap.F.map((x) => x.name)).toEqual(['b', 'c', 'd'])
  })
  it('同父重排（文件夹父级=无载体）→ name-sort 原位（诚实呈现：顺序不持久化）', () => {
    const map = { '': [n('F', 'F', true, 'folder')], F: [n('F/a', 'a', false), n('F/b', 'b', false), n('F/c', 'c', false)] }
    const r = optimisticMove(map, { '': true, F: true }, 'F/c', 'F', 0)
    expect(r?.childrenMap.F.map((x) => x.name)).toEqual(['a', 'b', 'c'])
  })
  it('目标层未加载 → 旧位移除、目标层不预插（折叠中不可见）', () => {
    const map = { '': [n('A', 'A', false), n('F', 'F', true, 'folder')] } // F 从未展开
    const r = optimisticMove(map, { '': true }, 'A', 'F', Number.MAX_SAFE_INTEGER)
    expect(r?.childrenMap[''].map((x) => x.name)).toEqual(['F'])
    expect(r?.childrenMap.F).toBeUndefined()
  })
  it('已加载子树随迁：键前缀与后代节点 path 一并迁移，旧键清除', () => {
    const map = {
      '': [n('G', 'G', true), n('T', 'T', false)],
      G: [n('G/k', 'k', true)],
      'G/k': [n('G/k/leaf', 'leaf', false)]
    }
    const r = optimisticMove(map, { '': true, G: true, 'G/k': true }, 'G', 'T', Number.MAX_SAFE_INTEGER)
    expect(r?.childrenMap[''].map((x) => x.name)).toEqual(['T'])
    expect(r?.childrenMap['T/G']?.[0]?.path).toBe('T/G/k')
    expect(r?.childrenMap['T/G/k']?.[0]?.path).toBe('T/G/k/leaf')
    expect(r?.childrenMap.G).toBeUndefined()
    expect(r?.loaded['T/G']).toBe(true)
  })
  it('跨父移入空文件夹（has_children=false）→ 目标行置真（flattenTree 才下钻渲染）', () => {
    const map = { '': [n('A', 'A', false), n('F', 'F', false, 'folder')], F: [] }
    const r = optimisticMove(map, { '': true, F: true }, 'A', 'F', Number.MAX_SAFE_INTEGER)
    expect(r?.childrenMap.F.map((x) => x.path)).toEqual(['F/A'])
    expect(r?.childrenMap[''].find((x) => x.name === 'F')?.has_children).toBe(true)
  })
  it('节点不在已加载视图 → null（不可乐观，交由 IPC 后权威刷新）', () => {
    expect(optimisticMove({}, {}, 'X', '', 0)).toBeNull()
  })
})
