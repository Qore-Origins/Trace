// SearchOverlay（§3.6 溯源浮层）：输入即查（300ms 防抖）→ 分段结果 → 点击回溯（树展开+组件脉冲）
import { useEffect, useMemo, useRef } from 'react'
import { Empty, Spin } from 'antd'
import { useSearchStore } from '../stores/search-store'
import { useAppStore } from '../stores/app-store'
import type { SearchHit } from '@shared/ipc-contract'

const SCOPE_LABEL: Record<SearchHit['scope'], string> = { plan: '计划', task: '任务', note: '注释' }

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
      <mark key={i} style={{ background: 'var(--trace-bg)', color: 'var(--trace-700)', borderRadius: 2, padding: '0 1px' }}>
        {text.slice(s, e)}
      </mark>
    )
    pos = e
  })
  if (pos < text.length) out.push(text.slice(pos))
  return out
}

export default function SearchOverlay(): React.JSX.Element {
  const { open, keywords, hits, querying, setOpen, setKeywords, locate } = useSearchStore()
  const indexState = useAppStore((s) => s.indexState)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 30)
      return () => clearTimeout(t)
    }
  }, [open])

  const kws = useMemo(() => keywords.trim().split(/\s+/).filter(Boolean), [keywords])

  if (!open) return <></>

  const grouped = {
    plan: hits.filter((h) => h.scope === 'plan'),
    task: hits.filter((h) => h.scope === 'task'),
    note: hits.filter((h) => h.scope === 'note')
  }
  const empty = !querying && keywords.trim() !== '' && hits.length === 0

  return (
    <>
      <div className="search-mask" onClick={() => setOpen(false)} />
      <div className="search-overlay">
        <input
          ref={inputRef}
          className="o-input"
          placeholder="沿迹回望…（多词 AND；Enter 无需按）"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
            if (e.key === 'Enter' && hits.length > 0) void locate(hits[0])
          }}
        />
        <div className="o-body">
          {keywords.trim() === '' ? (
            <div className="o-empty">输入关键词开始溯源；命中后点击即回到源头</div>
          ) : empty ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未命中——试试更短的关键词" />
          ) : (
            <>
              {indexState === 'building' && <div className="o-building">索引构建中，结果可能不全…</div>}
              {(Object.keys(grouped) as Array<keyof typeof grouped>).map((scope) =>
                grouped[scope].length === 0 ? null : (
                  <div key={scope}>
                    <div className="o-section">
                      {SCOPE_LABEL[scope]}（{grouped[scope].length}）
                    </div>
                    {grouped[scope].map((h, i) => (
                      <div key={`${h.path}:${h.component_id ?? ''}:${i}`} className="o-item" onClick={() => void locate(h)}>
                        <div className="o-title">{highlight(h.snippet, kws)}</div>
                        <div className="o-path">{h.path.split('/').join(' › ')}</div>
                      </div>
                    ))}
                  </div>
                )
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
