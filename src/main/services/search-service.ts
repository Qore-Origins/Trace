// SearchService：溯源检索（SPIKE-1 定案=内存扫包含；LLD §2.2/§6.4）
// 索引=全量文档内存态；变更驱动防抖重建（规模 ≤1000 计划下毫秒级，正确性优先）
import type { PlanDocument, Component } from '../../shared/plan-types'
import type { SearchHit } from '../../shared/ipc-contract'
import { PlanRepository } from './plan-repository'
import { bus } from './event-bus'

type IndexState = 'building' | 'ready' | 'error'

interface IndexDoc {
  scope: 'plan' | 'task' | 'note'
  path: string
  component_id?: string
  text: string // 可检索全文（小写化比较）
  matched_field: string
  snippetSource: string
}

const REBUILD_DEBOUNCE_MS = 500
const MAX_HITS = 200

export class SearchService {
  private docs: IndexDoc[] = []
  private state: IndexState = 'building'
  private root: string | null = null
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null
  private offEvents: Array<() => void> = []

  constructor(private repo: PlanRepository) {}

  // 主进程装配时调用一次：订阅变更 + 启动构建
  start(root: string): void {
    this.root = root
    this.offEvents.push(
      bus.on('trace:plan-changed', () => this.scheduleRebuild()),
      bus.on('trace:fs-external-change', () => this.scheduleRebuild())
    )
    void this.rebuild()
  }

  stop(): void {
    for (const off of this.offEvents) off()
    this.offEvents = []
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer)
    this.root = null
  }

  getState(): IndexState {
    return this.state
  }

  get indexedCount(): number {
    return this.docs.length
  }

  private scheduleRebuild(): void {
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer)
    this.rebuildTimer = setTimeout(() => void this.rebuild(), REBUILD_DEBOUNCE_MS)
  }

  async rebuild(): Promise<void> {
    if (!this.root) return
    this.state = 'building'
    bus.emit('trace:index-status', { state: 'building' })
    try {
      const docs: IndexDoc[] = []
      await this.walk('', docs)
      this.docs = docs
      this.state = 'ready'
      bus.emit('trace:index-status', { state: 'ready' })
    } catch (e) {
      console.error('[search] rebuild failed', e)
      this.state = 'error'
      bus.emit('trace:index-status', { state: 'error' })
    }
  }

  private async walk(rel: string, docs: IndexDoc[]): Promise<void> {
    const names = await this.repo.listPlanDirs(this.root as string, rel)
    for (const name of names) {
      const path = rel === '' ? name : `${rel}/${name}`
      if (await this.repo.hasPlanFile(this.root as string, path)) {
        let doc: PlanDocument
        try {
          doc = await this.repo.readPlan(this.root as string, path)
        } catch {
          continue // 损坏文件跳过（降级：可检索其余）
        }
        this.indexPlanInto(path, doc, docs)
      }
      await this.walk(path, docs)
    }
  }

  // 单计划 → 索引项（供全量与测试复用）
  indexPlanInto(path: string, doc: PlanDocument, docs: IndexDoc[] = this.docs): void {
    // 计划名（文件夹名）
    const name = path.slice(path.lastIndexOf('/') + 1)
    docs.push({ scope: 'plan', path, text: name, matched_field: 'plan_name', snippetSource: name })
    for (const c of doc.components) {
      this.indexComponentInto(path, c, docs)
    }
  }

  private indexComponentInto(path: string, c: Component, docs: IndexDoc[]): void {
    const p = c.payload as unknown as Record<string, unknown>
    const str = (k: string): string => (typeof p[k] === 'string' ? (p[k] as string) : '')
    switch (c.type) {
      case 'single_plan': {
        const text = `${str('title')} ${str('summary')}`.trim()
        if (text) docs.push({ scope: 'plan', path, component_id: c.id, text, matched_field: 'title', snippetSource: str('title') })
        break
      }
      case 'multi_plan': {
        const options = Array.isArray(p.options) ? (p.options as Array<{ text?: string }>).map((o) => o.text ?? '').join(' ') : ''
        const text = `${str('title')} ${options}`.trim()
        if (text) docs.push({ scope: 'plan', path, component_id: c.id, text, matched_field: 'title', snippetSource: str('title') })
        break
      }
      case 'task_list': {
        const items = Array.isArray(p.items) ? (p.items as Array<{ id: string; title: string; note?: string }>) : []
        for (const t of items) {
          const text = `${t.title} ${t.note ?? ''}`.trim()
          if (text) docs.push({ scope: 'task', path, component_id: c.id, text, matched_field: 'task_title', snippetSource: t.title })
        }
        break
      }
      case 'task_detail': {
        const text = `${str('title')} ${str('description')} ${str('note')}`.trim()
        if (text) docs.push({ scope: 'task', path, component_id: c.id, text, matched_field: 'task_title', snippetSource: str('title') })
        break
      }
      case 'note': {
        const content = str('content')
        if (content) docs.push({ scope: 'note', path, component_id: c.id, text: content, matched_field: 'note_content', snippetSource: content })
        break
      }
      case 'mood': {
        const text = `${str('text')} ${str('mood_date')}`.trim()
        if (text) docs.push({ scope: 'note', path, component_id: c.id, text, matched_field: 'note_content', snippetSource: str('text') })
        break
      }
      case 'heading': {
        const text = str('title')
        if (text) docs.push({ scope: 'plan', path, component_id: c.id, text, matched_field: 'title', snippetSource: text })
        break
      }
      case 'custom': {
        const text = str('content')
        if (text) docs.push({ scope: 'note', path, component_id: c.id, text, matched_field: 'note_content', snippetSource: text })
        break
      }
      default:
        break // 未知类型容忍（契约向前兼容）
    }
  }

  // 关键词检索：多词 AND（包含匹配，不区分大小写）
  query(keywords: string[]): SearchHit[] {
    const kws = keywords.map((k) => k.trim().toLowerCase()).filter(Boolean)
    if (kws.length === 0 || this.state !== 'ready') return []
    const hits: SearchHit[] = []
    for (const d of this.docs) {
      const lower = d.text.toLowerCase()
      if (!kws.every((k) => lower.includes(k))) continue
      hits.push({
        scope: d.scope,
        path: d.path,
        component_id: d.component_id,
        snippet: makeSnippet(d.snippetSource, kws[0]),
        matched_field: d.matched_field
      })
      if (hits.length >= MAX_HITS) break
    }
    return hits
  }
}

function makeSnippet(source: string, firstKw: string): string {
  const idx = source.toLowerCase().indexOf(firstKw)
  if (idx === -1) return source.slice(0, 60)
  const start = Math.max(0, idx - 20)
  const end = Math.min(source.length, idx + firstKw.length + 40)
  return `${start > 0 ? '…' : ''}${source.slice(start, end)}${end < source.length ? '…' : ''}`
}
