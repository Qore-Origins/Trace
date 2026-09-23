// SearchOverlay（§3.6 溯源浮层）：输入即查（300ms 防抖）→ 分段结果 → 点击回溯（树展开+组件脉冲）
import { useEffect, useMemo, useRef, useState } from 'react'
import { Empty, Spin } from 'antd'
import { useSearchStore } from '../stores/search-store'
import { useAppStore } from '../stores/app-store'
import { useTranslation } from '../i18n'
import type { SearchHit } from '@shared/ipc-contract'

const SEARCH_PAGE_SIZE = 100

function highlight(text: string, keywords: string[]): React.ReactNode[] {
  if (!text) return []
  const kws = keywords.filter(Boolean)
  if (kws.length === 0) return [text]
  const lower = text.toLowerCase()
  const marks: Array<[number, number]> = []
  for (const kw of kws) {
    let idx = lower.indexOf(kw.toLowerCase())
    while (idx !== -1) {
      marks.push([idx, idx + kw.length])
      idx = lower.indexOf(kw.toLowerCase(), idx + kw.length)
    }
  }
  if (marks.length === 0) return [text]
  marks.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const m of marks) {
    const last = merged[merged.length - 1]
    if (last && m[0] <= last[1]) last[1] = Math.max(last[1], m[1])
    else merged.push([...m] as [number, number])
  }
  const out: React.ReactNode[] = []
  let pos = 0
  merged.forEach(([s, e], i) => {
    if (s > pos) out.push(text.slice(pos, s))
    out.push(
      <mark key={i} style={{ background: 'var(--trace-bg)', color: 'var(--link)', borderRadius: 2, padding: '0 1px' }}>
        {text.slice(s, e)}
      </mark>
    )
    pos = e
  })
  if (pos < text.length) out.push(text.slice(pos))
  return out
}

export default function SearchOverlay(): React.JSX.Element {
  const { t } = useTranslation()
  const open = useSearchStore((s) => s.open)
  const keywords = useSearchStore((s) => s.keywords)
  const hits = useSearchStore((s) => s.hits)
  const querying = useSearchStore((s) => s.querying)
  const setOpen = useSearchStore((s) => s.setOpen)
  const setKeywords = useSearchStore((s) => s.setKeywords)
  const locate = useSearchStore((s) => s.locate)
  const indexState = useAppStore((s) => s.indexState)
  const inputRef = useRef<HTMLInputElement>(null)
  const [page, setPage] = useState<{ hits: SearchHit[]; count: number } | null>(null)
  const visibleCount = page?.hits === hits ? page.count : SEARCH_PAGE_SIZE

  useEffect(() => {
    if (open) {
      const t0 = setTimeout(() => inputRef.current?.focus(), 30)
      return () => clearTimeout(t0)
    }
  }, [open])

  const kws = useMemo(() => keywords.trim().split(/\s+/).filter(Boolean), [keywords])
  const { grouped, totals } = useMemo(() => {
    const grouped: Record<SearchHit['scope'], SearchHit[]> = { plan: [], task: [], note: [] }
    const totals: Record<SearchHit['scope'], number> = { plan: 0, task: 0, note: 0 }
    hits.forEach((hit, index) => {
      totals[hit.scope]++
      if (index < visibleCount) grouped[hit.scope].push(hit)
    })
    return { grouped, totals }
  }, [hits, visibleCount])

  if (!open) return <></>

  const scopeLabel = (scope: SearchHit['scope']): string =>
    scope === 'plan' ? t('search.scopePlan') : scope === 'task' ? t('search.scopeTask') : t('search.scopeNote')

  const empty = !querying && keywords.trim() !== '' && hits.length === 0

  return (
    <>
      <div className="search-mask" onClick={() => setOpen(false)} />
      <div className="search-overlay" onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          setOpen(false)
        }
      }}>
        <input
          ref={inputRef}
          className="o-input"
          placeholder={t('search.inputPlaceholder')}
          value={keywords}
          onChange={(e) => {
            setPage(null)
            setKeywords(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
            if (e.key === 'Enter' && hits.length > 0) void locate(hits[0])
          }}
        />
        <div className="o-body">
          {keywords.trim() === '' ? (
            <div className="o-empty">{t('search.startHint')}</div>
          ) : empty ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('search.noHit')} />
          ) : (
            <>
              {indexState === 'building' && <div className="o-building">{t('search.buildingHint')}</div>}
              {(Object.keys(grouped) as Array<keyof typeof grouped>).map((scope) =>
                grouped[scope].length === 0 ? null : (
                  <div key={scope}>
                    <div className="o-section">
                      {scopeLabel(scope)}（{totals[scope]}）
                    </div>
                    {grouped[scope].map((h, i) => (
                      <button key={`${h.path}:${h.component_id ?? ''}:${i}`} type="button" className="o-item"
                        onClick={() => void locate(h)}>
                        <div className="o-title">{highlight(h.snippet, kws)}</div>
                        <div className="o-path">{h.path.split('/').join(' › ')}</div>
                      </button>
                    ))}
                  </div>
                )
              )}
              {hits.length > SEARCH_PAGE_SIZE && (
                <div className="o-pagination">
                  <span>{t('search.resultCount', { visible: Math.min(visibleCount, hits.length), total: hits.length })}</span>
                  {visibleCount < hits.length && <button type="button" className="o-more" onClick={() => setPage({ hits, count: visibleCount + SEARCH_PAGE_SIZE })}>{t('search.loadMore')}</button>}
                </div>
              )}
            </>
          )}
          {querying && keywords.trim() !== '' && (
            <div className="o-building">
              <Spin size="small" />
            </div>
          )}
        </div>
      </div>
    </>
  )
}
