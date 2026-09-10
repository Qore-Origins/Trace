// clampTreeWidth 单测：树侧边栏拖拽宽度约束（min/max 夹逼 + 取整 + 边界值）
import { describe, expect, it } from 'vitest'
import { clampTreeWidth, TREE_WIDTH_MAX, TREE_WIDTH_MIN } from '../src/renderer/src/stores/pref-store'

describe('clampTreeWidth', () => {
  it('区间内取整', () => {
    expect(clampTreeWidth(300.4)).toBe(300)
    expect(clampTreeWidth(300.6)).toBe(301)
  })

  it('下限夹逼（拖到过窄）', () => {
    expect(clampTreeWidth(0)).toBe(TREE_WIDTH_MIN)
    expect(clampTreeWidth(-50)).toBe(TREE_WIDTH_MIN)
  })

  it('上限夹逼（拖到过宽）', () => {
    expect(clampTreeWidth(2000)).toBe(TREE_WIDTH_MAX)
  })

  it('边界值原样通过', () => {
    expect(clampTreeWidth(TREE_WIDTH_MIN)).toBe(TREE_WIDTH_MIN)
    expect(clampTreeWidth(TREE_WIDTH_MAX)).toBe(TREE_WIDTH_MAX)
  })
})
