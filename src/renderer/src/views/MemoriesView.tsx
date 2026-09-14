// MemoriesView（F2 回忆视图）：独立页三区块——那年今日 / 里程碑 / 随机回忆 + 右列当日预览
// 形态照 demo/memories-view-demo.html 定稿；数据走 diary:memories / diary:day；样式走语义 token（双主题）
import { useEffect, useRef, useState } from 'react'
import { Spin } from 'antd'
import type { TFunction } from 'i18next'
import { getMessage } from '../antd-host'
import { invoke } from '../ipc-client'
import { ClientError } from '../ipc-client'
import { useTranslation } from '../i18n'
import { todayDateStr } from '@shared/validation'
import type { DiaryDaySummary, DiaryMemoryEntry, DiaryMemoryMilestone } from '@shared/ipc-contract'
import { scoreColor } from '../components/cards'
import TopBar from '../components/TopBar'

interface MemoriesPayload {
  today: string
  history: DiaryMemoryEntry[]
  onthisday: DiaryMemoryEntry[]
  milestones: DiaryMemoryMilestone[]
  random: DiaryMemoryEntry | null
}

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

function MemoryCard(props: {
  entry: DiaryMemoryEntry
  badge: string
  selected: boolean
  onSelect: (date: string) => void
}): React.JSX.Element {
  const { entry, badge, selected, onSelect } = props
  const { t } = useTranslation()
  return (
    <div
      className={`mem-card${selected ? ' selected' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(entry.date)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(entry.date)
        }
      }}
    >
      <div className="mem-head">
        <span className="mem-years">{badge}</span>
        <span className="mem-date">{entry.date}</span>
      </div>
      {entry.score !== null ? (
        <div className="mem-score" style={{ color: scoreColor(entry.score) }}>
          {entry.score}
          <small>{t('diary.scoreUnit')}</small>
        </div>
      ) : (
        <div className="mem-score none">–</div>
      )}
      {entry.notePreview && <div className="mem-note">{entry.notePreview}</div>}
      <div className="mem-days">{t('diary.compsCount', { count: entry.compCount })}</div>
    </div>
  )
}

function MemoryDayComponentCard({ comp }: { comp: DiaryDaySummary['components'][number] }): React.JSX.Element {
  const { t } = useTranslation()
  const label = kindLabel(t, comp.kind, comp.label)
  if (comp.kind === 'mood') {
    const score = comp.excerpt === '' ? Number.NaN : Number(comp.excerpt)
    const color = Number.isFinite(score) ? scoreColor(score) : undefined
    return (
      <div className="mem-pv-card">
        <div className="k">{label}</div>
        <div className="t" style={color ? { color } : undefined}>
          {comp.excerpt ? `${comp.excerpt} ${t('diary.scoreUnit')}` : '–'}
        </div>
      </div>
    )
  }
  if (comp.kind === 'heading') {
    return <div className="mem-pv-card"><div className="k">{label}</div></div>
  }
  return (
    <div className="mem-pv-card">
      <div className="k">{label}</div>
      {comp.excerpt && <div className="t">{comp.excerpt}</div>}
    </div>
  )
}

export default function MemoriesView({ onOpenInTree }: { onOpenInTree: (date: string) => void }): React.JSX.Element {
  const { t } = useTranslation()
  const [data, setData] = useState<MemoriesPayload | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [daySummary, setDaySummary] = useState<DiaryDaySummary | null>(null)
  const [randomCard, setRandomCard] = useState<DiaryMemoryEntry | null>(null)
  const dayReq = useRef(0)

  // 挂载拉取回忆数据（失败 toast + 空态兜底）
  useEffect(() => {
    let alive = true
    invoke('diary:memories', {})
      .then((r) => {
        if (!alive) return
        setData(r)
        setRandomCard(r.random)
      })
      .catch((e: unknown) => {
        if (alive) getMessage().error(e instanceof ClientError ? e.message : t('errors.opFailed'))
      })
    return () => {
      alive = false
    }
  }, [t])

  const selectDay = (date: string): void => {
    const id = ++dayReq.current
    setSelected(date)
    setDaySummary(null)
    invoke('diary:day', { date })
      .then((s) => {
        if (dayReq.current === id) setDaySummary(s)
      })
      .catch(() => {
        if (dayReq.current === id) setDaySummary({ date, components: [] }) // 失败降级空态（防永久 spinner）
      })
  }

  const roll = (): void => {
    if (!data) return
    const pool = data.history
    if (pool.length === 0) return
    setRandomCard(pool[Math.floor(Math.random() * pool.length)])
  }

  const yearsAgo = (date: string): string => t('memories.yearsAgo', {
    years: Number(todayDateStr().slice(0, 4)) - Number(date.slice(0, 4))
  })

  return (
    <div className="memories">
      <TopBar />
      <div className="memories-body">
      <div className="memories-main">
        <div className="memories-inner">
          <div className="mem-section">
            <div className="mem-sec-title">
              <h2>{t('memories.onthisday')}</h2>
              <span className="sub">
                {t('memories.onthisdaySub', {
                  month: Number(todayDateStr().slice(5, 7)),
                  day: Number(todayDateStr().slice(8, 10))
                })}
              </span>
            </div>
            {data && data.onthisday.length > 0 ? (
              <div className="mem-grid">
                {data.onthisday.map((e) => (
                  <MemoryCard
                    key={e.date}
                    entry={e}
                    badge={yearsAgo(e.date)}
                    selected={selected === e.date}
                    onSelect={selectDay}
                  />
                ))}
              </div>
            ) : (
              <div className="mem-empty">{t('memories.emptyOnthisday')}</div>
            )}
          </div>

          <div className="mem-section">
            <div className="mem-sec-title">
              <h2>{t('memories.milestones')}</h2>
              <span className="sub">{t('memories.milestonesSub')}</span>
            </div>
            {data && data.milestones.length > 0 ? (
              <div className="mem-grid">
                {data.milestones.map((m) => (
                  <MemoryCard
                    key={m.date}
                    entry={m}
                    badge={t('memories.daysAgo', { days: m.days })}
                    selected={selected === m.date}
                    onSelect={selectDay}
                  />
                ))}
              </div>
            ) : (
              <div className="mem-empty">{t('memories.emptyMilestones')}</div>
            )}
          </div>

          <div className="mem-section">
            <div className="mem-sec-title">
              <h2>{t('memories.random')}</h2>
              <span className="sub">{t('memories.randomSub')}</span>
              <button type="button" className="mem-roll" onClick={roll}>
                {t('memories.roll')}
              </button>
            </div>
            {randomCard ? (
              <div className="mem-grid">
                <MemoryCard
                  entry={randomCard}
                  badge={t('memories.randomBadge')}
                  selected={selected === randomCard.date}
                  onSelect={selectDay}
                />
              </div>
            ) : (
              <div className="mem-empty">{t('memories.emptyAll')}</div>
            )}
          </div>
        </div>
      </div>
      <div className="memories-preview">
        <div className="mem-pv-title">{selected ? `${selected} · ${t('diary.preview')}` : t('memories.previewHint')}</div>
        {selected ? (
          daySummary === null ? (
            <Spin size="small" />
          ) : daySummary.components.length === 0 ? (
            <div className="mem-pv-empty">{t('diary.emptyDay')}</div>
          ) : (
            <>
              {daySummary.components.map((c, i) => (
                <MemoryDayComponentCard key={`${c.kind}-${i}`} comp={c} />
              ))}
              <button type="button" className="mem-pv-open" onClick={() => onOpenInTree(selected)}>
                {t('diary.openInTree')}
              </button>
            </>
          )
        ) : (
          <div className="mem-pv-empty">{t('memories.previewHint')}</div>
        )}
      </div>
      </div>
    </div>
  )
}
