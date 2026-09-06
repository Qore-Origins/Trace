// TransferService 测试：.plan roundtrip / 冲突改名 / zip 穿越防护 / MD 迁入解析
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { zipSync } from 'fflate'
import { PlanRepository } from '../src/main/services/plan-repository'
import { StorageService } from '../src/main/services/storage-service'
import { TransferService, parseMdFileName, markdownToPlanDocument } from '../src/main/services/transfer-service'
import { TreeCache } from '../src/main/services/tree-cache'
import { TraceError, ERR } from '../src/shared/errors'
import type { PlanDocument, Component } from '../src/shared/plan-types'

let root: string
let repo: PlanRepository
let storage: StorageService
let transfer: TransferService

beforeEach(async () => {
  root = join(tmpdir(), `trace-xfer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
  await fs.mkdir(root, { recursive: true })
  repo = new PlanRepository()
  await repo.ensureLibraryRoot(root)
  storage = new StorageService(repo)
  storage.setRoot(root)
  transfer = new TransferService(repo, storage.treeCache, () => root)
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function makePlan(path: string, taskTitle: string, sub?: string): Promise<void> {
  await storage.createPlan(...(path.includes('/') ? ([path.slice(0, path.lastIndexOf('/')), path.slice(path.lastIndexOf('/') + 1)] as const) : ['', path] as const))
  const doc = await storage.readPlan(path)
  const comp: Component = {
    id: 'c1',
    type: 'task_list',
    payload: { title: '任务', items: [{ id: 't1', title: taskTitle, status: 'not_started' }] }
  }
  doc.components.push(comp)
  await storage.savePlan(path, doc, doc.updated_at)
  if (sub) await storage.createPlan(path, sub)
}

describe('.plan 导出/导入 roundtrip', () => {
  it('导出含子树 → 导入到新位置 → 内容一致', async () => {
    await makePlan('学期A', '写周报', '子计划B')
    const saveTo = join(root, '..', `out-${Date.now()}.plan`)
    const rep = await transfer.exportPlan('学期A', saveTo)
    expect(rep.plans).toBe(2) // 学期A + 子计划B
    expect(rep.tasks).toBe(1)

    const imp = await transfer.importPlan('', saveTo)
    expect(imp.plans).toBe(2)
    expect(imp.imported[0].path).toBe('学期A (2)')
    const doc = await storage.readPlan('学期A (2)')
    expect(doc.components.some((c) => c.type === 'task_list')).toBe(true)
    expect(await storage.treeGetChildren('学期A (2)').then((ns) => ns.map((n) => n.name))).toEqual(['子计划B'])
    await fs.rm(saveTo, { force: true })
  })

  it('非 .plan 文件 → FORMAT_INVALID(14)', async () => {
    const bad = join(root, 'bad.plan')
    await fs.writeFile(bad, 'not a zip')
    await expect(transfer.importPlan('', bad)).rejects.toMatchObject({ code: ERR.FORMAT_INVALID })
  })

  it('manifest 类型不符 → 拒绝（任意 zip 不当计划包）', async () => {
    const fake = zipSync({ 'manifest.json': new TextEncoder().encode(JSON.stringify({ type: 'other' })), 'x/plan.json': new TextEncoder().encode('{}') })
    const p = join(root, 'fake.plan')
    await fs.writeFile(p, fake)
    await expect(transfer.importPlan('', p)).rejects.toMatchObject({ code: ERR.FORMAT_INVALID })
  })

  it('zip 路径穿越条目 → PATH_UNSAFE(11)', async () => {
    const evil = zipSync({
      'manifest.json': new TextEncoder().encode(JSON.stringify({ type: 'trace-plan-bundle', format_version: '1', name: 'x' })),
      'x/../../evil.txt': new TextEncoder().encode('boom')
    })
    const p = join(root, 'evil.plan')
    await fs.writeFile(p, evil)
    await expect(transfer.importPlan('', p)).rejects.toMatchObject({ code: ERR.PATH_UNSAFE })
  })
})

describe('Markdown 迁入', () => {
  it('文件名解析：类型段含连字符 + 日期 + 标题', () => {
    expect(parseMdFileName('Long-Term_Plan-20260101-买房')).toEqual({ level: 'Long-Term_Plan', ymd: '20260101', title: '买房' })
    expect(parseMdFileName('随手记')).toBeNull()
  })

  it('清单+保底：checkbox→任务列表（分组），其余→注释，标题→单选计划', () => {
    const md = [
      '# Daily_Plan-20260901-心情还行',
      '##### 创建时间 ：2026-09-01 22:53:26',
      '---',
      '### 一、任务',
      '**麒麟OS Agent**',
      '- [ ] 调查并解决VM问题',
      '- [x] 稿子',
      '今日心情：中',
      ''
    ].join('\n')
    const report = { tasks: 0, notes: 0 }
    const doc = markdownToPlanDocument('心情还行', '20260901', md, report)
    expect(report.tasks).toBe(2)
    expect(report.notes).toBe(1)
    // 首组件=单选计划（计划本体）
    expect(doc.components[0].type).toBe('single_plan')
    const tl = doc.components.find((c) => c.type === 'task_list') as { payload: { title: string; items: Array<{ title: string; status: string }> } }
    expect(tl.payload.title).toBe('麒麟OS Agent')
    expect(tl.payload.items.map((i) => i.status)).toEqual(['not_started', 'done'])
    const note = doc.components.find((c) => c.type === 'note') as { payload: { content: string } }
    expect(note.payload.content).toContain('今日心情')
  })

  it('端到端：迁入两个 md → 层级文件夹+计划落盘', async () => {
    const r = await transfer.importMarkdown('', [
      { name: 'Daily_Plan-20260901-心情还行.md', content: '- [ ] 任务甲' },
      { name: 'Weekly_Plan-20260902-第三十六周.md', content: '## 计划\n- [x] 已完成事项' }
    ])
    expect(r.plans).toBe(2)
    const top = await storage.treeGetChildren('')
    expect(top.map((n) => n.name)).toEqual(['Daily_Plan', 'Weekly_Plan'])
    const dailyDoc = await storage.readPlan('Daily_Plan/20260901-心情还行')
    expect(dailyDoc.components.some((c) => c.type === 'task_list')).toBe(true)
  })

  it('同名自动改名', async () => {
    await transfer.importMarkdown('', [{ name: 'Daily_Plan-20260901-心情还行.md', content: '- [ ] A' }])
    const r2 = await transfer.importMarkdown('', [{ name: 'Daily_Plan-20260901-心情还行.md', content: '- [ ] B' }])
    expect(r2.imported[0].path).toBe('Daily_Plan/20260901-心情还行 (2)')
  })
})
