// diary-view-utils 单测：月网格（周一起始/占位格）+ 统计聚合（无 mood 日不参与均分/打卡/趋势）
// 日历事实为硬编码定值（UTC 推算验证过），不复用实现逻辑，避免测试与实现同源互证
import { describe, expect, it } from 'vitest'
import type { DiaryMonthEntry } from '../src/shared/ipc-contract'
import { aggregateStats, buildMonthGrid, startOfMonth } from '../src/renderer/src/views/diary-view-utils'

function entry(date: string, score: number | null, compCount: number): DiaryMonthEntry {
  return { date, score, notePreview: '', compCount }
}

describe('buildMonthGrid', () => {
  it('2026-09 首日=周二 → 前导 1 占位格 + 30 日格（总 31）', () => {
    const cells = buildMonthGrid(2026, 9)
    expect(cells).toHaveLength(31)
    expect(cells[0]).toEqual({ day: 0 })
    expect(cells[1].day).toBe(1)
    expect(cells[30].day).toBe(30)
    expect(cells.filter((c) => c.day === 0)).toHaveLength(1) // 仅前导 1 格，无其他占位
  })
  it('2026-06 首日=周一 → 无前导格，直接 1 起', () => {
    const cells = buildMonthGrid(2026, 6)
    expect(cells).toHaveLength(30)
    expect(cells[0].day).toBe(1)
  })
  it('2028-02 闰年 29 天（首日周二 → 前导 1，总 30）', () => {
    const cells = buildMonthGrid(2028, 2)
    expect(cells).toHaveLength(30)
    expect(cells[29].day).toBe(29)
  })
  it('2026-02 首日=周日 → 前导 6 格，末格=28（总 34）', () => {
    const cells = buildMonthGrid(2026, 2)
    expect(cells).toHaveLength(34)
    expect(cells[5].day).toBe(0)
    expect(cells[6].day).toBe(1)
    expect(cells[7].day).toBe(2)
    expect(cells[33].day).toBe(28)
  })
  it('2026-12 尾月 31 天（首日周二 → 前导 1，总 32）', () => {
    const cells = buildMonthGrid(2026, 12)
    expect(cells).toHaveLength(32)
    expect(cells[31].day).toBe(31)
  })
})

describe('aggregateStats', () => {
  // 7 天中 6 天有 mood、1 天无（09-08 删了 mood 卡仍剩 2 组件）——口径见各用例名
  const entries: DiaryMonthEntry[] = [
    entry('2026-09-03', 34, 5),
    entry('2026-09-01', 44, 4),
    entry('2026-09-08', null, 2),
    entry('2026-09-06', 72, 3),
    entry('2026-09-09', 55, 3),
    entry('2026-09-05', 66, 3),
    entry('2026-09-02', 58, 3)
  ]

  it('6 有分 1 无：avg=6 日均值四舍五入、daysCount=6、trend 6 点按日期升序', () => {
    const s = aggregateStats(entries)
    expect(s.avg).toBe(55) // (44+58+34+66+72+55)/6 = 54.83 → 55
    expect(s.daysCount).toBe(6)
    expect(s.trend).toHaveLength(6)
    expect(s.trend.map((p) => p.date)).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-05',
      '2026-09-06',
      '2026-09-09'
    ])
    expect(s.trend[0]).toEqual({ date: '2026-09-01', score: 44 })
  })
  it('compCount 汇总当月全部日计划组件（无 mood 日有真实组件也计入 → 23）', () => {
    expect(aggregateStats(entries).compCount).toBe(23) // 4+3+5+3+3+2+3；若只计有分日则 21
  })
  it('与输入顺序无关（倒序输入结果一致）', () => {
    const s = aggregateStats([...entries].reverse())
    expect(s).toEqual(aggregateStats(entries))
  })
  it('空数组：avg null / daysCount 0 / compCount 0 / trend 空', () => {
    expect(aggregateStats([])).toEqual({ avg: null, daysCount: 0, compCount: 0, trend: [] })
  })
  it('全部无分：avg null、trend 空、打卡 0（compCount 仍汇总真实组件）', () => {
    const s = aggregateStats([entry('2026-09-01', null, 1), entry('2026-09-02', null, 0)])
    expect(s.avg).toBeNull()
    expect(s.daysCount).toBe(0)
    expect(s.trend).toEqual([])
    expect(s.compCount).toBe(1)
  })
  it('.5 进位：50 与 51 → avg 51', () => {
    expect(aggregateStats([entry('2026-09-01', 50, 0), entry('2026-09-02', 51, 0)]).avg).toBe(51)
  })
})

describe('startOfMonth', () => {
  it('归属三值：早于 (year,month) → -1；当月内（含首/末日）→ 0；晚于月末 → 1', () => {
    expect(startOfMonth('2026-08-31', 2026, 9)).toBe(-1)
    expect(startOfMonth('2026-09-01', 2026, 9)).toBe(0)
    expect(startOfMonth('2026-09-30', 2026, 9)).toBe(0)
    expect(startOfMonth('2026-10-01', 2026, 9)).toBe(1)
  })
  it('跨年 12 月：边界按次年 1 月比较', () => {
    expect(startOfMonth('2026-11-30', 2026, 12)).toBe(-1)
    expect(startOfMonth('2026-12-31', 2026, 12)).toBe(0)
    expect(startOfMonth('2027-01-01', 2026, 12)).toBe(1)
  })
  it('1 月边界：去年 12-31 早于 2026-01', () => {
    expect(startOfMonth('2025-12-31', 2026, 1)).toBe(-1)
    expect(startOfMonth('2026-02-01', 2026, 1)).toBe(1)
  })
  it('单参数意义：key 为 2026-09-09（当日）时属于 2026-09', () => {
    expect(startOfMonth('2026-09-09', 2026, 9)).toBe(0)
  })
})
