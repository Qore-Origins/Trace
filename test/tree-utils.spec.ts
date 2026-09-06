// 树构建纯逻辑测试：叶子/箭头数据驱动语义（2026-09-06 U1 修复的行为锚点）
import { describe, it, expect } from 'vitest'
import { buildTreeData, kindOf } from '../src/renderer/src/components/tree-utils'
import type { PlanTreeNode } from '../src/shared/ipc-contract'

const n = (path: string, name: string, has_children: boolean, kind: 'plan' | 'folder' = 'plan'): PlanTreeNode => ({
  path,
  name,
  has_children,
  order: 0,
  kind
})

describe('buildTreeData（箭头/叶子数据驱动）', () => {
  it('has_children=true 且未加载 → children=undefined（箭头交 loadData），非叶子', () => {
    const data = buildTreeData({ '': [n('A', 'A', true)] }, { '': true })
    const a = data[0].children?.[0]
    expect(a?.isLeaf).toBe(false)
    expect(a?.children).toBeUndefined()
  })
  it('has_children=false → isLeaf=true，children=[]（无箭头）', () => {
    const data = buildTreeData({ '': [n('B', 'B', false)] }, { '': true })
    const b = data[0].children?.[0]
    expect(b?.isLeaf).toBe(true)
    expect(b?.children).toEqual([])
  })
  it('空文件夹新建子项后（has_children 翻 true）→ 箭头出现（U1 行为锚点）', () => {
    const before = buildTreeData({ '': [n('F', 'F', false)] }, { '': true })
    expect(before[0].children?.[0].isLeaf).toBe(true)
    // 创建子项 → 父层列表刷新为 has_children=true
    const after = buildTreeData({ '': [n('F', 'F', true)], F: [n('F/P', 'P', false)] }, { '': true, F: true })
    const f = after[0].children?.[0]
    expect(f?.isLeaf).toBe(false)
    expect(f?.children?.[0]?.key).toBe('F/P')
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
