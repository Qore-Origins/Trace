// DiaryView（日记深化 Task 4，2026-09-10）：统计条 → 月历热力 → 时间线/当日预览
// 布局与交互抄 demo/diary-view-demo.html（方案定稿形态）；数据全部经 IPC（diary:ensure/month/day），renderer 不触 fs
// 「在树中打开」为占位回调 onOpenInTree（Task 5 复用回溯定位接线）；顶栏导航入口亦为 Task 5
import { useEffect, useMemo, useRef, useState } from 'react'
import { Spin, message } from 'antd'
import type { TFunction } from 'i18next'
import TopBar from '../components/TopBar'
import { invoke, ClientError } from '../ipc-client'
import { i18n, useTranslation } from '../i18n'
import type { DiaryDayComponent, DiaryDaySummary, DiaryMonthEntry } from '@shared/ipc-contract'
import { todayDateStr } from '@shared/validation'
import { aggregateStats, buildMonthGrid } from './diary-view-utils'
import { scoreColor } from '../components/cards'

const TREND_W = 180
const TREND_H = 34

interface DiaryViewProps {
  /** 在树中打开该日计划（Task 5 接线；未提供时 console 占位） */
  onOpenInTree?: (date: string) => void
}

// 今日所在年月（month 1-12，与 diary:month 载荷一致；纯本地时钟）
function currentYearMonth(): { year: number; month: number } {
  const d = new Date()
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

function dateKey(year: number, month: number, day: number): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${year}-${p(month)}-${p(day)}`
}

// 组件 kind → 渲染标签（契约 label 仅 heading 有值且为占位文案，视图层统一 i18n 映射）
function kindLabel(t: TFunction, kind: string, label: string): string {
  switch (kind) {
    case 'mood': return t('diary.moodLabel')
    case 'note': return t('diary.summaryLabel')
    case 'heading': return t('content.insertHeading')
    case 'task_list': return t('cards.kindTaskList')
    case 'task_detail': return t('cards.kindTaskDetail')
    case 'single_plan': return t('cards.kindSinglePlan')
    case 'multi_plan': return t('cards.kindMultiPlan')
    case 'custom': return t('cards.customLabel')
    default: return label || t('diary.componentLabel')
  }
}

// 当日预览单组件卡：mood=大字分数（scoreColor）；heading=仅标签（excerpt 为占位 'heading'）；其余=标签+摘要
function DayComponentCard({ comp }: { comp: DiaryDayComponent }): React.JSX.Element {
  const { t } = useTranslation()
  const label = kindLabel(t, comp.kind, comp.label)
  if (comp.kind === 'mood') {
    // excerpt=分数文本（如 '45'）；空文本不得 Number('')=0 误染冷色
    const score = comp.excerpt === '' ? Number.NaN : Number(comp.excerpt)
    const color = Number.isFinite(score) ? scoreColor(score) : undefined
    return (
      <div className="diary-pre-card">
        <div className="k">{label}</div>
        <div className="t big" style={color ? { color } : undefined}>
          {comp.excerpt ? `${comp.excerpt} ${t('diary.scoreUnit')}` : '–'}
        </div>
      </div>
    )
  }
  if (comp.kind === 'heading') {
    return (
      <div className="diary-pre-card">
        <div className="k">{label}</div>
      </div>
    )
  }
  return (
    <div className="diary-pre-card">
      <div className="k">{label}</div>
      {comp.excerpt && <div className="t">{comp.excerpt}</div>}
    </div>
  )
}

export default function DiaryView({ onOpenInTree }: DiaryViewProps): React.JSX.Element {
  const { t } = useTranslation()
  const today = todayDateStr()
  const initial = useMemo(currentYearMonth, [])
  const [year, setYear] = useState(initial.year)
  const [month, setMonth] = useState(initial.month)
  const [entries, setEntries] = useState<DiaryMonthEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [daySummary, setDaySummary] = useState<DiaryDaySummary | null>(null)
  const dayReq = useRef(0) // 日摘要请求序号：快速切换时丢弃过期响应

  // 挂载/切月：确保日记根（幂等）→ 拉当月条目；切月同时清空当日预览
  useEffect(() => {
    let alive = true
    setLoading(true)
    setSelected(null)
    setDaySummary(null)
    void invoke('diary:ensure', {})
      .then(() => invoke('diary:month', { year, month }))
      .then((res) => {
        if (alive) setEntries(res.entries)
      })
      .catch((e) => {
        if (alive) message.error(e instanceof ClientError ? e.message : i18n.t('errors.opFailed'))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [year, month])

  const entriesByDate = useMemo(() => new Map(entries.map((e) => [e.date, e])), [entries])
  // 时间线=当月条目日期倒序
  const monthEntries = useMemo(() => [...entries].sort((a, b) => (a.date < b.date ? 1 : -1)), [entries])
  const stats = useMemo(() => aggregateStats(entries), [entries])
  const grid = useMemo(() => buildMonthGrid(year, month), [year, month])

  // Task 5 接线前占位：仅 console 输出（数据本地，不触任何 store）
  const openInTree = onOpenInTree ?? ((date: string) => console.log('[DiaryView] 在树中打开（Task 5 接线）：', date))

  const selectDay = (date: string): void => {
    const id = ++dayReq.current
    setSelected(date)
    const entry = entriesByDate.get(date)
    if (!entry) {
      // 空记录日：本地空预览（不触 IPC——该日无 plan.json，diary:day 必失败）
      setDaySummary({ date, components: [] })
      return
    }
    setDaySummary(null)
    void invoke('diary:day', { date })
      .then((s) => {
        if (dayReq.current === id) setDaySummary(s)
      })
      .catch((e) => {
        if (dayReq.current !== id) return
        message.error(e instanceof ClientError ? e.message : i18n.t('errors.opFailed'))
      })
  }

  // 左/右切月：1-12 循环跨年（无边界限制）
  const shiftMonth = (delta: number): void => {
    const next = month + delta
    if (next > 12) {
      setYear(year + 1)
      setMonth(1)
    } else if (next < 1) {
      setYear(year - 1)
      setMonth(12)
    } else {
      setMonth(next)
    }
  }

  const trend = stats.trend

  return (
    <div className="diary">
      <TopBar />
      <div className="diary-main">
        <div className="diary-content">
          {loading ? (
            <div className="diary-loading">
              <Spin />
            </div>
          ) : (
            <>
              <div className="diary-stats">
                <div className="diary-stat">
                  <span className="k">{t('diary.statsAvg')}</span>
                  <span className="v">{stats.avg ?? '–'}</span>
                </div>
                <div className="diary-stat">
                  <span className="k">{t('diary.statsDays')}</span>
                  <span className="v">{stats.daysCount}</span>
                </div>
                <div className="diary-stat">
                  <span className="k">{t('diary.statsRecords')}</span>
                  <span className="v">
                    {stats.compCount}
                    <small>{t('diary.recordsUnit')}</small>
                  </span>
                </div>
                <div className="diary-trend">
                  <span className="k">{t('diary.trend')}</span>
                  <svg width={TREND_W} height={TREND_H} viewBox={`0 0 ${TREND_W} ${TREND_H}`} aria-hidden="true">
                    {trend.length > 1 && (
                      <>
                        <polyline
                          points={trend
                            .map((p, i) => `${6 + (i / (trend.length - 1)) * (TREND_W - 12)},${TREND_H - 8 - (p.score / 100) * (TREND_H - 14)}`)
                            .join(' ')}
                          fill="none"
                          stroke="var(--trace-500)"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                        />
                        <circle cx={6} cy={TREND_H - 8 - (trend[0].score / 100) * (TREND_H - 14)} r="2.2" fill="var(--trace-500)" />
                        <circle
                          cx={TREND_W - 6}
                          cy={TREND_H - 8 - (trend[trend.length - 1].score / 100) * (TREND_H - 14)}
                          r="2.2"
                          fill="var(--trace-500)"
                        />
                      </>
                    )}
                  </svg>
                </div>
              </div>
              <div className="diary-layout">
                <div className="diary-cal">
                  <div className="diary-cal-head">
                    <span className="diary-cal-month">{t('diary.calMonth', { year, month })}</span>
                    <div className="diary-cal-navwrap">
                      <button type="button" className="diary-cal-nav" onClick={() => shiftMonth(-1)}>
                        {t('diary.monthPrev')}
                      </button>
                      <button type="button" className="diary-cal-nav" onClick={() => shiftMonth(1)}>
                        {t('diary.monthNext')}
                      </button>
                    </div>
                  </div>
                  <div className="diary-week-row">
                    {t('diary.weekdays')
                      .split(',')
                      .map((w) => (
                        <div key={w}>{w}</div>
                      ))}
                  </div>
                  <div className="diary-cal-grid">
                    {grid.map((cell, i) => {
                      if (cell.day === 0) return <div key={`blank-${i}`} className="diary-cal-day blank" />
                      const key = dateKey(year, month, cell.day)
                      const entry = entriesByDate.get(key)
                      const isFuture = key > today
                      const cls = [
                        'diary-cal-day',
                        key === today ? 'today' : '',
                        isFuture ? 'future' : '',
                        entry ? 'has' : '',
                        selected === key ? 'selected' : ''
                      ]
                        .filter(Boolean)
                        .join(' ')
                      const clickable = !isFuture
                      return (
                        <div
                          key={key}
                          className={cls}
                          role={clickable ? 'button' : undefined}
                          tabIndex={clickable ? 0 : undefined}
                          onClick={clickable ? () => selectDay(key) : undefined}
                          onKeyDown={
                            clickable
                              ? (e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    selectDay(key)
                                  }
                                }
                              : undefined
                          }
                        >
                          <div className="diary-dnum">{cell.day}</div>
                          {entry && entry.score !== null && (
                            <div className="diary-score" style={{ color: scoreColor(entry.score) }}>
                              {entry.score}
                              <small>{t('diary.scoreUnit')}</small>
                            </div>
                          )}
                          {entry && entry.score === null && <div className="diary-score none">–</div>}
                          {entry && entry.compCount > 0 && (
                            <div className="diary-comps">{t('diary.compsCount', { count: entry.compCount })}</div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  <div className="diary-cal-foot">{t('diary.calHint')}</div>
                </div>
                <div className="diary-tl">
                  <div className="diary-tl-head">
                    <button
                      type="button"
                      className={`diary-tl-back${selected ? ' show' : ''}`}
                      onClick={() => {
                        dayReq.current++ // 作废在途日摘要请求（响应晚到时不得写入）
                        setSelected(null)
                        setDaySummary(null)
                      }}
                    >
                      {t('diary.back')}
                    </button>
                    <span className="diary-tl-title">{selected ? `${selected} · ${t('diary.preview')}` : t('diary.monthLabel')}</span>
                  </div>
                  <div className="diary-tl-list">
                    {selected ? (
                      daySummary === null ? (
                        <div className="diary-pre-loading">
                          <Spin size="small" />
                        </div>
                      ) : (
                        <div className="diary-pre">
                          {daySummary.components.length === 0 ? (
                            <div className="diary-tl-empty">{t('diary.emptyDay')}</div>
                          ) : (
                            daySummary.components.map((c, i) => <DayComponentCard key={`${c.kind}-${i}`} comp={c} />)
                          )}
                          <button type="button" className="diary-pre-open" onClick={() => openInTree(selected)}>
                            {t('diary.openInTree')}
                          </button>
                        </div>
                      )
                    ) : monthEntries.length === 0 ? (
                      <div className="diary-tl-empty">{t('diary.emptyMonth')}</div>
                    ) : (
                      monthEntries.map((e) => (
                        <div
                          key={e.date}
                          className="diary-tl-item"
                          role="button"
                          tabIndex={0}
                          onClick={() => selectDay(e.date)}
                          onKeyDown={(ev) => {
                            if (ev.key === 'Enter' || ev.key === ' ') {
                              ev.preventDefault()
                              selectDay(e.date)
                            }
                          }}
                        >
                          <span className="d">{e.date.slice(5)}</span>
                          <span
                            className="dot"
                            style={e.score !== null ? { background: scoreColor(e.score), color: '#fff' } : undefined}
                          >
                            {e.score ?? '–'}
                          </span>
                          <span className="s">{e.notePreview || t('diary.compsCount', { count: e.compCount })}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
