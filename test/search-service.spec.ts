// SearchService 测试：全量构建 / AND 检索 / 范围覆盖（计划名/任务/注释/组件标题）/ snippet
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PlanRepository } from '../src/main/services/plan-repository'
import { StorageService } from '../src/main/services/storage-service'
import { SearchService } from '../src/main/services/search-service'
import { bus } from '../src/main/services/event-bus'
import type { PlanDocument } from '../src/shared/plan-types'

let root: string
let storage: StorageService
let search: SearchService

beforeEach(async () => {
  root = join(tmpdir(), `trace-srch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
  await fs.mkdir(root, { recursive: true })
  const repo = new PlanRepository()
  await repo.ensureLibraryRoot(root)
  storage = new StorageService(repo)
  storage.setRoot(root)
  search = new SearchService(repo)

  // 语料：学期/子计划 + 五类组件
  await storage.createPlan('', '学期计划')
  await storage.createPlan('学期计划', 'Web 实训')
  await storage.createPlan('', '生活计划')
  await putDoc('学期计划', {
    components: [
      { id: 'c1', type: 'single_plan', payload: { title: '本期主线：技能大赛备赛', done: false, created_at: '2026-09-06T00:00:00Z' } },
      { id: 'c2', type: 'task_list', payload: { title: '本周任务', items: [
        { id: 't1', title: '写周报总结', status: 'not_started', note: '包含复盘' },
        { id: 't2', title: '整理 YOLO 目录', status: 'done' }
      ] } },
      { id: 'c3', type: 'note', payload: { content: '评审前置，返工减半', created_at: '2026-09-06T00:00:00Z' } }
    ]
  })
})

afterEach(async () => {
  search.stop()
  await fs.rm(root, { recursive: true, force: true })
})

async function putDoc(path: string, partial: Partial<PlanDocument>): Promise<void> {
  const doc = await storage.readPlan(path)
  Object.assign(doc, partial)
  await storage.savePlan(path, doc, doc.updated_at)
}

describe('SearchService（内存扫包含，SPIKE-1 定案）', () => {
  it('全量构建 + 状态事件 ready', async () => {
    const states: string[] = []
    const off = bus.on('trace:index-status', (p) => states.push(p.state))
    search.start(root)
    await waitReady()
    off()
    expect(states).toContain('ready')
    expect(search.getState()).toBe('ready')
    expect(search.indexedCount).toBeGreaterThanOrEqual(5) // 3 计划名 + 组件项
  })

  it('计划名命中（scope=plan）', async () => {
    search.start(root)
    await waitReady()
    const hits = search.query(['学期'])
    expect(hits.some((h) => h.scope === 'plan' && h.path === '学期计划' && h.matched_field === 'plan_name')).toBe(true)
  })

  it('任务标题与注释内容命中', async () => {
    search.start(root)
    await waitReady()
    expect(search.query(['周报']).some((h) => h.scope === 'task' && h.component_id === 'c2')).toBe(true)
    expect(search.query(['返工减半']).some((h) => h.scope === 'note' && h.component_id === 'c3')).toBe(true)
  })

  it('多词 AND：全含才命中', async () => {
    search.start(root)
    await waitReady()
    expect(search.query(['周报', '复盘']).length).toBe(1)
    expect(search.query(['周报', '不存在词']).length).toBe(0)
  })

  it('大小写不敏感（YOLO ↔ yolo）', async () => {
    search.start(root)
    await waitReady()
    expect(search.query(['yolo']).length).toBe(1)
  })

  it('变更驱动重建：新建计划后可检索（防抖 500ms）', async () => {
    search.start(root)
    await waitReady()
    await storage.createPlan('', '新计划归档')
    bus.emit('trace:plan-changed', { path: '新计划归档' })
    await new Promise((r) => setTimeout(r, 700))
    await waitReady()
    expect(search.query(['归档']).some((h) => h.path === '新计划归档')).toBe(true)
  })

  it('snippet 含命中词上下文', async () => {
    search.start(root)
    await waitReady()
    const hit = search.query(['评审前置'])[0]
    expect(hit.snippet).toContain('评审前置')
  })
})

function waitReady(): Promise<void> {
  return new Promise((resolve) => {
    const check = (): void => {
      if (search.getState() === 'ready') resolve()
      else setTimeout(check, 20)
    }
    check()
  })
}

describe('新组件类型索引（mood/heading/custom）', () => {
  it('三类组件入索引且 scope 正确', async () => {
    await putDoc('学期计划', {
      components: [
        { id: 'm1', type: 'mood', payload: { score: 88.5, text: '今天松弛，写了代码', mood_date: '2026-09-09', created_at: '2026-09-09T00:00:00Z' } },
        { id: 'h1', type: 'heading', payload: { title: '溯源计划本', size: 22 } },
        { id: 'x1', type: 'custom', payload: { content: '记录 python 代码片段，含**加粗**', source: '日常' } }
      ]
    })
    search.start(root)
    await waitReady()
    expect(search.query(['松弛']).some((h) => h.scope === 'note' && h.component_id === 'm1')).toBe(true)
    expect(search.query(['溯源计划本']).some((h) => h.scope === 'plan' && h.component_id === 'h1')).toBe(true)
    expect(search.query(['代码片段']).some((h) => h.scope === 'note' && h.component_id === 'x1')).toBe(true)
  })
})
