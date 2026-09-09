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

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** (year, month) 的月首日 key，如 2026-09 → '2026-09-01' */
function monthStartKey(year: number, month: number): string {
  return `${year}-${pad2(month)}-01`
}

/** (year, month) 次月首日 key（跨年进位），如 2026-12 → '2027-01-01' */
function nextMonthStartKey(year: number, month: number): string {
  return month === 12 ? `${year + 1}-01-01` : `${year}-${pad2(month + 1)}-01`
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
 * 月统计聚合。口径：均分/打卡/趋势只统计有 mood 分（score 非 null）的日——无记录天不按 0 计；
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

/**
 * 日期归属判定（日期比较辅助，按定长 ISO 字符串比较、不做 Date 换算）：
 * key 早于 (year, month) → -1；key 落在该月（含首/末日）→ 0；key 晚于该月 → 1。
 * 例：startOfMonth('2026-08-31', 2026, 9) → -1；startOfMonth('2026-09-09', 2026, 9) → 0。
 */
export function startOfMonth(key: string, year: number, month: number): number {
  if (key < monthStartKey(year, month)) return -1
  if (key >= nextMonthStartKey(year, month)) return 1
  return 0
}
