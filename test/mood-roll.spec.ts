// mood-roll-machine 结构单测：布局规范串 + 列 phys 状态机（demo 边界矩阵镜像）
// 覆盖：小数进位/跨整数进位/结构增长/结构缩减/同值 noop/短路径方向/复制槽链式回归/浮点 norm
import { describe, expect, it } from 'vitest'
import { CENTER, initRollState, stepRoll } from '../src/renderer/src/components/mood-roll-machine'

describe('mood-roll-machine', () => {
  it('小数进位：45.29 + 0.01 → 显示 45.30（保留进位尾0，十分位/百分位同时滚）', () => {
    const st = initRollState('45.29')
    const { commit, state } = stepRoll(st, 45.3)
    expect(commit.action).toBe('roll')
    expect(state.str).toBe('45.30')
    // 十分位 2→3（phys +1），百分位 9→0（短路径 +1 绕行）
    expect(commit.transitions[2]).toEqual({ from: 2, to: 3, phys: CENTER + 3, rows: 120, rebuildCol: false })
    expect(commit.transitions[3]).toEqual({ from: 9, to: 0, phys: CENTER + 10, rows: 120, rebuildCol: false })
  })

  it('跨整数进位：45.9 + 0.1 → 显示 46.0（整数位不变，小数位保留）', () => {
    const st = initRollState('45.9')
    const { commit, state } = stepRoll(st, 46)
    expect(commit.action).toBe('roll')
    expect(state.str).toBe('46.0')
    expect(commit.transitions[1]).toEqual({ from: 5, to: 6, phys: CENTER + 6, rows: 120, rebuildCol: false })
    expect(commit.transitions[2]).toEqual({ from: 9, to: 0, phys: CENTER + 10, rows: 120, rebuildCol: false })
  })

  it('结构增长：50 → 50.1 insert（先建补齐起点 50.0，小数列 0→1 滚入）', () => {
    const st = initRollState('50')
    const { commit, state } = stepRoll(st, 50.1)
    expect(commit.action).toBe('insert')
    expect(commit.buildStr).toBe('50.0')
    expect(commit.requireReflow).toBe(true)
    expect(state.str).toBe('50.1')
    expect(commit.transitions).toHaveLength(3)
    expect(commit.transitions[2]).toEqual({ from: 0, to: 1, phys: CENTER + 1, rows: 120, rebuildCol: false })
  })

  it('进位+新列：99.9 → 100 insert（新前导列 0→1，三列 9→0 同时滚）', () => {
    const st = initRollState('99.9')
    const { commit, state } = stepRoll(st, 100)
    expect(commit.action).toBe('insert')
    expect(commit.buildStr).toBe('099.9')
    expect(state.str).toBe('100.0')
    expect(commit.transitions[0]).toEqual({ from: 0, to: 1, phys: CENTER + 1, rows: 120, rebuildCol: false })
    expect(commit.transitions[1]).toEqual({ from: 9, to: 0, phys: CENTER + 10, rows: 120, rebuildCol: false })
    expect(commit.transitions[3]).toEqual({ from: 9, to: 0, phys: CENTER + 10, rows: 120, rebuildCol: false })
  })

  it('结构缩减：100 → 99 shrink（共同大结构滚动 100→099，完成后移除前导列；不再瞬时重建）', () => {
    const st = initRollState('100')
    const { commit, state } = stepRoll(st, 99)
    expect(commit.action).toBe('shrink')
    expect(commit.buildStr).toBe('')
    expect(commit.removeCols).toBe(1)
    // 100 → 099：百位 1→0，十位/个位 0→9（反向绕行各 -1）
    expect(commit.transitions[0]).toEqual({ from: 1, to: 0, phys: CENTER, rows: 120, rebuildCol: false })
    expect(commit.transitions[1]).toEqual({ from: 0, to: 9, phys: CENTER - 1, rows: 120, rebuildCol: false })
    expect(commit.transitions[2]).toEqual({ from: 0, to: 9, phys: CENTER - 1, rows: 120, rebuildCol: false })
    expect(state.str).toBe('99')
    expect(state.cols).toHaveLength(2)
  })

  it('结构缩减+小数位保留：100 → 99.9 shrink（先补出 100.0 起点再滚，removeCols=1）', () => {
    const st = initRollState('100')
    const { commit, state } = stepRoll(st, 99.9)
    expect(commit.action).toBe('shrink')
    expect(commit.buildStr).toBe('100.0')
    expect(commit.requireReflow).toBe(true)
    expect(commit.removeCols).toBe(1)
    expect(commit.transitions).toHaveLength(4)
    expect(state.str).toBe('99.9')
    expect(state.cols).toHaveLength(3)
  })

  it('shrink 链式：shrink 后值再变走 roll（状态列数已对齐）', () => {
    let st = initRollState('100')
    ;({ state: st } = stepRoll(st, 99))
    const { commit, state: st2 } = stepRoll(st, 98)
    expect(commit.action).toBe('roll')
    expect(st2.str).toBe('98')
    expect(st2.cols).toHaveLength(2)
  })

  it('同值 noop：显示 45.30 时目标 45.3 规范等价，不重复滚动', () => {
    const st = initRollState('45.30')
    const { commit } = stepRoll(st, 45.3)
    expect(commit.action).toBe('noop')
  })

  it('短路径方向：0→9 反向绕行只滚 1 格（phys -1），9→0 正向只滚 1 格（phys +1）', () => {
    const st = initRollState('0.0')
    const r1 = stepRoll(st, 9).commit
    expect(r1.transitions[0]).toEqual({ from: 0, to: 9, phys: CENTER - 1, rows: 120, rebuildCol: false })
    const r2 = stepRoll(initRollState('9.9'), 0).commit
    expect(r2.transitions[0]).toEqual({ from: 9, to: 0, phys: CENTER + 10, rows: 120, rebuildCol: false })
  })

  it('复制槽链式回归：45.29→45.30 进位后，45.30→45.31 百分位只滚 1 格（phys 续增，非按数字重算空跳）', () => {
    let st = initRollState('45.29')
    ;({ state: st } = stepRoll(st, 45.3))
    const { commit } = stepRoll(st, 45.31)
    expect(commit.action).toBe('roll')
    expect(commit.transitions[3]).toEqual({ from: 0, to: 1, phys: CENTER + 11, rows: 120, rebuildCol: false })
  })

  it('浮点 norm：50.12000000001 不串化进格式决策（显示 50.12）', () => {
    const st = initRollState('50')
    const { commit, state } = stepRoll(st, 50.12000000001)
    expect(commit.action).toBe('insert')
    expect(state.str).toBe('50.12')
  })
})
