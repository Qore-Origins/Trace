// TransferService 测试：.plan roundtrip / 冲突改名 / zip 穿越防护 / MD 迁入解析
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
import { bus } from '../src/main/services/event-bus'
import { PlanReferenceService } from '../src/main/services/plan-reference-service'

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

  it('announces remapped stable IDs without making the existing targets ambiguous', async () => {
    await storage.createPlan('', 'Reference bundle')
    await storage.createPlan('Reference bundle', 'Nested')
    const expectedIds = [
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    ]
    for (const [path, planId] of [
      ['Reference bundle', expectedIds[0]],
      ['Reference bundle/Nested', expectedIds[1]]
    ] as const) {
      const document = await storage.readPlan(path)
      document.plan_id = planId
      await storage.savePlan(path, document, document.updated_at)
    }

    const saveTo = join(root, 'references.plan')
    await transfer.exportPlan('Reference bundle', saveTo)
    const libraryId = (await repo.readLibraryMeta(root)).library_id
    const references = new PlanReferenceService(repo, () => root)
    references.activateRoot(root)
    await expect(references.resolve({ library_id: libraryId, plan_id: expectedIds[0] }))
      .resolves.toMatchObject({ status: 'found' })
    const events: string[][] = []
    const off = bus.on('trace:reference-target-changed', (event) => events.push(event.plan_ids))
    try {
      await transfer.importPlan('', saveTo)
      await expect(references.resolve({ library_id: libraryId, plan_id: expectedIds[0] }))
        .resolves.toMatchObject({ status: 'found', target: { path: 'Reference bundle' } })
      await transfer.importMarkdown('', [{ name: 'Daily_Plan-20261001-Without ID.md', content: '# Plain markdown' }])
    } finally {
      off()
      references.dispose()
      await fs.rm(saveTo, { force: true })
    }

    const importedIds = await Promise.all(['Reference bundle (2)', 'Reference bundle (2)/Nested']
      .map(async (path) => (await storage.readPlan(path)).plan_id as string))
    expect(importedIds.every((id) => !expectedIds.includes(id))).toBe(true)
    expect(events).toEqual([[...importedIds].sort()])
  })

  it('remaps internal plan and component references while preserving external targets and optional fields', async () => {
    await storage.createPlan('', 'Bundle')
    await storage.createPlan('Bundle', 'Child')
    const parentId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const childId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    const externalId = 'cccccccccccccccccccccccccccccccc'
    const componentId = 'dddddddddddddddddddddddddddddddd'
    const parent = await storage.readPlan('Bundle')
    parent.plan_id = parentId
    parent.due_date = '2026-10-09'
    parent.components = [
      { id: 'internal-plan', type: 'plan_reference', remark: '**kept**', payload: {
        mode: 'link', target_plan_id: childId, target_path_snapshot: 'Bundle/Child', target_name_snapshot: 'Custom name'
      } },
      { id: 'internal-component', type: 'plan_reference', payload: {
        mode: 'embed', target_plan_id: childId, target_component_id: componentId,
        target_path_snapshot: 'Bundle/Child', target_name_snapshot: 'Saved component'
      } },
      { id: 'external-plan', type: 'plan_reference', payload: {
        mode: 'link', target_plan_id: externalId, target_path_snapshot: 'Deleted', target_name_snapshot: 'Deleted'
      } }
    ]
    const child = await storage.readPlan('Bundle/Child')
    child.plan_id = childId
    child.components = [{ id: componentId, type: 'custom', remark: '# Remark', payload: { content: '**raw**', source: 'Imported source' } }]
    await storage.savePlan('Bundle', parent, parent.updated_at)
    await storage.savePlan('Bundle/Child', child, child.updated_at)
    const originalParent = await storage.readPlan('Bundle')
    const originalChild = await storage.readPlan('Bundle/Child')
    const bundleFile = join(root, 'roundtrip.plan')
    await transfer.exportPlan('Bundle', bundleFile)

    await transfer.importPlan('', bundleFile)

    const importedParent = await storage.readPlan('Bundle (2)')
    const importedChild = await storage.readPlan('Bundle (2)/Child')
    expect(importedParent.plan_id).not.toBe(parentId)
    expect(importedChild.plan_id).not.toBe(childId)
    const expectedParent = structuredClone(originalParent)
    expectedParent.plan_id = importedParent.plan_id
    for (const component of expectedParent.components.slice(0, 2)) {
      ;(component.payload as { target_plan_id: string }).target_plan_id = importedChild.plan_id as string
    }
    expect(importedParent).toEqual(expectedParent)
    expect(importedChild).toEqual({ ...originalChild, plan_id: importedChild.plan_id })
    const references = new PlanReferenceService(repo, () => root)
    references.activateRoot(root)
    try {
      const libraryId = (await repo.readLibraryMeta(root)).library_id
      await expect(references.resolve({ library_id: libraryId, plan_id: importedChild.plan_id as string, component_id: componentId }))
        .resolves.toMatchObject({ status: 'found', target: { path: 'Bundle (2)/Child' } })
      await expect(references.resolve({ library_id: libraryId, plan_id: externalId })).resolves.toEqual({ status: 'missing' })
    } finally { references.dispose() }
  })

  it.each(['malformed-json', 'invalid-id', 'duplicate-id', 'aliased-path', 'file-as-directory', 'invalid-reference'])
    ('preflights the entire bundle and rejects %s before creating any target directory', async (fault) => {
      const valid: PlanDocument = { format_version: '1', plan_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', components: [] }
      const invalid = structuredClone(valid)
      if (fault === 'invalid-id') invalid.plan_id = 'not-an-id'
      if (fault === 'invalid-reference') invalid.components = [{ id: 'reference', type: 'plan_reference', payload: {
        mode: 'link', target_plan_id: 'bad', target_path_snapshot: 'Target', target_name_snapshot: 'Target'
      } }]
      const enc = new TextEncoder()
      const entries: Record<string, Uint8Array> = {
        'manifest.json': enc.encode(JSON.stringify({ type: 'trace-plan-bundle', format_version: '1', name: 'Bundle' })),
        'Bundle/plan.json': enc.encode(JSON.stringify(valid)),
        'Bundle/Child/plan.json': enc.encode(fault === 'malformed-json' ? '{' : JSON.stringify(invalid))
      }
      if (fault === 'aliased-path') {
        delete entries['Bundle/Child/plan.json']
        entries['Bundle/./plan.json'] = enc.encode(JSON.stringify(valid))
      } else if (fault === 'file-as-directory') {
        delete entries['Bundle/Child/plan.json']
        invalid.plan_id = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
        entries['Bundle/plan.json/Child/plan.json'] = enc.encode(JSON.stringify(invalid))
      } else if (fault !== 'duplicate-id') {
        invalid.plan_id = fault === 'invalid-id' ? 'not-an-id' : 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
        entries['Bundle/Child/plan.json'] = enc.encode(fault === 'malformed-json' ? '{' : JSON.stringify(invalid))
      }
      const bundleFile = join(root, 'invalid.plan')
      await fs.writeFile(bundleFile, zipSync(entries))
      const before = await fs.readdir(root)
      await expect(transfer.importPlan('', bundleFile)).rejects.toBeInstanceOf(TraceError)
      expect(await fs.readdir(root)).toEqual(before)
    })

  it('rejects a library-external destination junction before writing', async () => {
    await makePlan('Source', 'keep')
    const bundleFile = join(root, 'safe.plan')
    await transfer.exportPlan('Source', bundleFile)
    const outside = await fs.mkdtemp(join(tmpdir(), 'trace-xfer-outside-'))
    try {
      await fs.symlink(outside, join(root, 'Linked'), process.platform === 'win32' ? 'junction' : 'dir')
      await expect(transfer.importPlan('Linked', bundleFile)).rejects.toMatchObject({ code: ERR.PATH_UNSAFE })
      expect(await fs.readdir(outside)).toEqual([])
    } finally {
      await fs.unlink(join(root, 'Linked'))
      await fs.rm(outside, { recursive: true, force: true })
    }
  })

  it('retains non-conflicting stable IDs and external missing targets when importing after deletion', async () => {
    await storage.createPlan('', 'Source')
    const source = await storage.readPlan('Source')
    source.plan_id = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    source.components = [{ id: 'ref', type: 'plan_reference', payload: { mode: 'link',
      target_plan_id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', target_path_snapshot: 'Deleted', target_name_snapshot: 'Missing' } }]
    await storage.savePlan('Source', source, source.updated_at)
    const original = await storage.readPlan('Source')
    const bundleFile = join(root, 'deleted.plan')
    await transfer.exportPlan('Source', bundleFile)
    await storage.deletePlan('Source', true)
    await transfer.importPlan('', bundleFile)
    expect(await storage.readPlan('Source')).toEqual(original)
  })

  it('does not export a linked plan file outside the library', async () => {
    await storage.createFolder('', 'LinkedFile')
    const outside = await fs.mkdtemp(join(tmpdir(), 'trace-xfer-export-outside-'))
    try {
      const secretFile = join(outside, 'plan.json')
      await fs.writeFile(secretFile, JSON.stringify({ format_version: '1', created_at: '', updated_at: '', components: [] }))
      await fs.symlink(secretFile, join(root, 'LinkedFile', 'plan.json'), 'file')
      const exportFile = join(root, 'unsafe-export.plan')
      await expect(transfer.exportPlan('LinkedFile', exportFile)).rejects.toMatchObject({ code: ERR.PATH_UNSAFE })
      await expect(fs.access(exportFile)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await fs.unlink(join(root, 'LinkedFile', 'plan.json'))
      await fs.rm(outside, { recursive: true, force: true })
    }
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
  it('invalidates reference search once when a same-level import fails after a plan was written', async () => {
    const firstPath = 'Daily_Plan/20261001-Partial first'
    const references = new PlanReferenceService(repo, () => root)
    references.activateRoot(root)
    const libraryId = (await repo.readLibraryMeta(root)).library_id
    await expect(references.search({ library_id: libraryId, query: 'Partial first' }))
      .resolves.toEqual({ targets: [] })

    const originalWritePlanAtomic = repo.writePlanAtomic.bind(repo)
    let writeCount = 0
    const writePlanSpy = vi.spyOn(repo, 'writePlanAtomic').mockImplementation(async (writeRoot, rel, document) => {
      writeCount += 1
      if (writeCount === 2) throw new Error('simulated second write failure')
      await originalWritePlanAtomic(writeRoot, rel, document)
    })
    const changedPaths: string[] = []
    const unsubscribe = bus.on('trace:plan-changed', ({ path }) => changedPaths.push(path))
    try {
      await expect(transfer.importMarkdown('', [
        { name: 'Daily_Plan-20261001-Partial first.md', content: '# First plan' },
        { name: 'Daily_Plan-20261002-Partial second.md', content: '# Second plan' }
      ])).rejects.toThrow('simulated second write failure')

      expect(writeCount).toBe(2)
      await expect(storage.readPlan(firstPath)).resolves.toMatchObject({
        components: expect.arrayContaining([
          expect.objectContaining({ payload: expect.objectContaining({ title: 'Partial first' }) })
        ])
      })
      const refreshedCandidates = await references.search({ library_id: libraryId, query: 'Partial first' })
      expect(refreshedCandidates.targets.some((target) => target.path === firstPath)).toBe(true)
      expect(changedPaths).toEqual(['Daily_Plan'])

      changedPaths.length = 0
      await transfer.importMarkdown('', [
        { name: 'Daily_Plan-20261003-Complete first.md', content: '# First complete plan' },
        { name: 'Daily_Plan-20261004-Complete second.md', content: '# Second complete plan' }
      ])
      expect(changedPaths).toEqual(['Daily_Plan'])
    } finally {
      unsubscribe()
      writePlanSpy.mockRestore()
      references.dispose()
    }
  })

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
