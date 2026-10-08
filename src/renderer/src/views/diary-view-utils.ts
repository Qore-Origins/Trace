// diary-view-utils：DiaryView 纯视图逻辑（无 React / 无 fs——只做数据变换）
// 日期一律按 'YYYY-MM-DD' 定长 ISO 字符串处理（目录名=聚合键，与 diary-service 口径一致）
import type { DiaryMonthEntry } from '@shared/ipc-contract'

/** 月网格单元格：day=0 表示前导占位格；1..N 为当月日号 */
export interface MonthCell {
  day: number
}

/** 趋势点（score 必为有分日；数组按日期升序） */
export interface DiaryTrendPoint {
  date: string
  score: number
}

/** 月统计聚合结果 */
export interface DiaryStats {
  avg: number | null // 有分日均值四舍五入；无有分日 → null
  daysCount: number // 打卡天数=有 mood 分的天数
  compCount: number // 当月全部日计划组件总数（聚合键存在即有记录，无 mood 日真实组件也计入）
  trend: DiaryTrendPoint[] // 逐日趋势点（仅连有分日，升序）
}

/**
 * 月历网格（周一起首，对齐 diary-view-demo）：
 * 前导占位格（day=0）× 首日偏移，随后当月 1..月末日格；无尾部补格（末行留白由 CSS grid 处理）。
 * 周日历用 UTC 构造，避免本地时区/夏令时影响；month 按 1-12（与 diary:month 载荷一致）。
 */
export function buildMonthGrid(year: number, month: number): MonthCell[] {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  const lead = (firstWeekday + 6) % 7 // 周一=0 … 周日=6
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const cells: MonthCell[] = []
  for (let i = 0; i < lead; i++) cells.push({ day: 0 })
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d })
  return cells
}

/**
 * 月统计聚合。口径：均分/打卡/趋势只统计有 mood 分（score 非 null）的日；自动空日不按 0 计，真实 0 分仍计；
 * compCount 为当月全部日计划的组件总数；结果与 entries 输入顺序无关。
 */
export function aggregateStats(entries: DiaryMonthEntry[]): DiaryStats {
  const scored = entries.filter((e): e is DiaryMonthEntry & { score: number } => e.score !== null)
  const sum = scored.reduce((acc, e) => acc + e.score, 0)
  const avg = scored.length > 0 ? Math.round(sum / scored.length) : null
  const compCount = entries.reduce((acc, e) => acc + e.compCount, 0)
  const trend = scored
    .map((e) => ({ date: e.date, score: e.score }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return { avg, daysCount: scored.length, compCount, trend }
}

/** 年热力格子：date 为当日 'YYYY-MM-DD'；null 为前导占位（年首之前） */
export interface YearHeatmapCell {
  date: string | null
}

/** 年热力列（GitHub contributions 式）：每列一个自然周（周一起始），行 = 星期一…星期日 */
export type YearHeatmapColumn = YearHeatmapCell[]

function isoDate(d: Date): string {
  const q = (x: number): string => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${q(d.getMonth() + 1)}-${q(d.getDate())}`
}

/**
 * 年热力网格（周一起首，与月历同口径）：
 * 外层数组 = 自然周列（含年首前导 null 补位），内层 = 该周 7 格（周一起始）；
 * 无记录日也是合法格（渲染层按 entries 查询着色）。UTC 构造避免时区/夏令时影响。
 */
export function buildYearHeatmap(year: number): YearHeatmapColumn[] {
  const start = new Date(Date.UTC(year, 0, 1))
  const lead = (start.getUTCDay() + 6) % 7 // 周一=0 … 周日=6
  const end = new Date(Date.UTC(year + 1, 0, 0)) // 12-31
  const totalDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
  const columns: YearHeatmapColumn[] = []
  let column: YearHeatmapCell[] = Array.from({ length: lead }, () => ({ date: null }))
  for (let offset = 0; offset < totalDays; offset++) {
    const d = new Date(Date.UTC(year, 0, 1 + offset))
    column.push({ date: isoDate(d) })
    if (column.length === 7) {
      columns.push(column)
      column = []
    }
  }
  if (column.length > 0) columns.push(column)
  return columns
}
