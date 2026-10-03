// PlanRepository 测试：原子写/损坏文件/EXDEV fallback/库初始化（真实临时目录）
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PlanRepository } from '../src/main/services/plan-repository'
import { TraceError, ERR } from '../src/shared/errors'
import type { PlanDocument } from '../src/shared/plan-types'

let root: string
let repo: PlanRepository

beforeEach(async () => {
  root = join(tmpdir(), `trace-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
  await fs.mkdir(root, { recursive: true })
  repo = new PlanRepository()
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

function sampleDoc(): PlanDocument {
  const now = new Date().toISOString()
  return { format_version: '1', created_at: now, updated_at: now, components: [] }
}

describe('ensureLibraryRoot', () => {
  it('首次创建 .trace/plan-library.json', async () => {
    const meta = await repo.ensureLibraryRoot(root)
    expect(meta.format_version).toBe('1')
    expect(meta.library_id).toMatch(/^[0-9a-f]{32}$/)
    await expect(fs.access(join(root, '.trace', 'plan-library.json'))).resolves.toBeUndefined()
  })
  it('二次加载返回同一 meta（幂等）', async () => {
    const a = await repo.ensureLibraryRoot(root)
    const b = await repo.ensureLibraryRoot(root)
    expect(b.library_id).toBe(a.library_id)
  })
})

describe('writePlanAtomic + readPlan', () => {
  it('serializes same-plan mutations and preserves both changes after a deferred write', async () => {
    const firstComponent = { id: 'a', type: 'note' as const, payload: { content: 'first', created_at: '2026-09-30T00:00:00.000Z' } }
    const secondComponent = { id: 'b', type: 'note' as const, payload: { content: 'second', created_at: '2026-09-30T00:00:00.000Z' } }
    let releaseWrite: () => void = () => {}
    let signalWrite: () => void = () => {}
    const held = new Promise<void>((resolve) => { releaseWrite = resolve })
    const started = new Promise<void>((resolve) => { signalWrite = resolve })
    let holdFirst = false
    const lockedRepo = new PlanRepository({
      renameFn: async (from, to) => {
        if (holdFirst && to === join(root, 'A', 'plan.json')) {
          holdFirst = false
          signalWrite()
          await held
        }
        await fs.rename(from, to)
      }
    })
    await fs.mkdir(join(root, 'A'))
    await lockedRepo.writePlanAtomic(root, 'A', sampleDoc())
    holdFirst = true
    const first = lockedRepo.mutatePlanAtomic(root, 'A', (current) => {
      current.components.push(firstComponent)
      return current
    })
    await started
    const second = lockedRepo.mutatePlanAtomic(root, 'A', (current) => {
      current.components.push(secondComponent)
      return current
    })
    releaseWrite()
    await Promise.all([first, second])

    expect((await lockedRepo.readPlan(root, 'A')).components.map((component) => component.id)).toEqual(['a', 'b'])
  })

  it('releases a plan lock after a failed mutation so a retry can write', async () => {
    await fs.mkdir(join(root, 'A'))
    await repo.writePlanAtomic(root, 'A', sampleDoc())
    await expect(repo.mutatePlanAtomic(root, 'A', () => { throw new Error('rejected update') }))
      .rejects.toThrow('rejected update')

    const saved = await repo.mutatePlanAtomic(root, 'A', (current) => {
      current.plan_id = '0123456789abcdef0123456789abcdef'
      return current
    })
    expect(saved.plan_id).toBe('0123456789abcdef0123456789abcdef')
    expect((await repo.readPlan(root, 'A')).plan_id).toBe(saved.plan_id)
  })

  it('round-trips legacy plans and new optional reference fields without dropping them', async () => {
    const legacy = sampleDoc()
    await repo.writePlanAtomic(root, '旧计划', legacy)
    expect(await repo.readPlan(root, '旧计划')).not.toHaveProperty('plan_id')

    const doc: PlanDocument = {
      ...sampleDoc(),
      plan_id: '0123456789abcdef0123456789abcdef',
      components: [{
        id: 'abcdef0123456789abcdef0123456789',
        type: 'plan_reference',
        remark: 'local remark',
        payload: {
          mode: 'link', target_plan_id: 'fedcba9876543210fedcba9876543210',
          target_path_snapshot: 'Old/Path', target_name_snapshot: 'Custom label'
        }
      }]
    }
    await repo.writePlanAtomic(root, '新计划', doc)
    const read = await repo.readPlan(root, '新计划')
    expect(read.plan_id).toBe(doc.plan_id)
    expect(read.components[0]).toEqual(doc.components[0])
    expect(structuredClone(JSON.parse(JSON.stringify(read))).components[0]).toEqual(doc.components[0])
  })

  it('keeps malformed references local and preserves their raw payload on save', async () => {
    const doc = sampleDoc()
    doc.components = [
      { id: '1', type: 'note', payload: { content: 'sibling', created_at: doc.created_at } },
      { id: '2', type: 'plan_reference', payload: { mode: 'unknown', target_plan_id: 'bad', target_path_snapshot: '', target_name_snapshot: '' } }
    ] as unknown as PlanDocument['components']
    await repo.writePlanAtomic(root, '坏引用', doc)
    const read = await repo.readPlan(root, '坏引用')
    expect(read.components).toEqual(doc.components)
    await repo.writePlanAtomic(root, '坏引用', read)
    expect((await repo.readPlan(root, '坏引用')).components).toEqual(doc.components)
  })

  it('rejects an invalid plan identity', async () => {
    const doc = sampleDoc()
    await fs.mkdir(join(root, '坏扩展'))
    await fs.writeFile(join(root, '坏扩展', 'plan.json'), JSON.stringify({ ...doc, plan_id: 17 }))
    await expect(repo.readPlan(root, '坏扩展')).rejects.toMatchObject({ code: ERR.FORMAT_INVALID })
  })

  it('rejects a null component in the document array', async () => {
    const doc = sampleDoc()
    await fs.mkdir(join(root, '空组件'))
    await fs.writeFile(join(root, '空组件', 'plan.json'), JSON.stringify({ ...doc, components: [null] }))
    await expect(repo.readPlan(root, '空组件')).rejects.toMatchObject({ code: ERR.FORMAT_INVALID })
  })

  it('keeps siblings readable and malformed remark data intact through read and save', async () => {
    const doc = sampleDoc()
    const components = [
      { id: '1', type: 'note', payload: { content: 'sibling', created_at: doc.created_at } },
      { id: '2', type: 'plan_reference', remark: 17, payload: { mode: 'unknown', target_plan_id: 'bad' } }
    ]
    await fs.mkdir(join(root, '坏备注'))
    await fs.writeFile(join(root, '坏备注', 'plan.json'), JSON.stringify({ ...doc, components }))
    const read = await repo.readPlan(root, '坏备注')
    expect(read.components).toEqual(components)
    await repo.writePlanAtomic(root, '坏备注', read)
    expect((await repo.readPlan(root, '坏备注')).components).toEqual(components)
  })
  it('写入后可读回且无临时文件残留', async () => {
    await repo.ensureLibraryRoot(root)
    await repo.writePlanAtomic(root, '计划A', sampleDoc())
    const doc = await repo.readPlan(root, '计划A')
    expect(doc.format_version).toBe('1')
    const files = await fs.readdir(join(root, '计划A'))
    expect(files).toEqual(['plan.json'])
  })
  it('updated_at 每次写入刷新（CAS 锚点）', async () => {
    await repo.ensureLibraryRoot(root)
    const doc = sampleDoc()
    await repo.writePlanAtomic(root, '计划A', doc)
    const v1 = (await repo.readPlan(root, '计划A')).updated_at
    await new Promise((r) => setTimeout(r, 5))
    await repo.writePlanAtomic(root, '计划A', doc)
    const v2 = (await repo.readPlan(root, '计划A')).updated_at
    expect(v2).not.toBe(v1)
  })
  it('读取不存在 → PATH_NOT_FOUND(10)', async () => {
    await expect(repo.readPlan(root, '无')).rejects.toMatchObject({ code: ERR.PATH_NOT_FOUND })
  })
  it('损坏 JSON → FORMAT_INVALID(14)', async () => {
    await fs.mkdir(join(root, '坏计划'))
    await fs.writeFile(join(root, '坏计划', 'plan.json'), '{"format_version":"1","trunc')
    await expect(repo.readPlan(root, '坏计划')).rejects.toThrow(TraceError)
  })
})

describe('moveDir EXDEV fallback（SPIKE-3 定案）', () => {
  it('rename 抛 EXDEV 时走 copy+rm，数据完整', async () => {
    await fs.mkdir(join(root, 'src', 'child'), { recursive: true })
    await fs.writeFile(join(root, 'src', 'plan.json'), '{"ok":true}')
    await fs.writeFile(join(root, 'src', 'child', 'n.txt'), 'x')

    const exdev = (): never => {
      const e = new Error('cross-device') as NodeJS.ErrnoException
      e.code = 'EXDEV'
      throw e
    }
    const repoExdev = new PlanRepository({ renameFn: exdev })
    await repoExdev.moveDir(join(root, 'src'), join(root, 'dst'))
    expect(await fs.readFile(join(root, 'dst', 'plan.json'), 'utf8')).toBe('{"ok":true}')
    expect(await fs.readFile(join(root, 'dst', 'child', 'n.txt'), 'utf8')).toBe('x')
    await expect(fs.access(join(root, 'src'))).rejects.toThrow()
  })
})

// 2026-09-10 用户反馈修复：目录级增删改移此前不登记内部写 → chokidar 回声触发
// fs-external-change → 渲染层 refreshAll（整树重载）。VS Code 借鉴：操作应局部生效、不重载树
describe('目录操作内部写登记（防 watch 回声整树重载）', () => {
  it('mkdirPlan：mkdir 前登记目标目录', async () => {
    const marks: string[] = []
    const r = new PlanRepository({ onInternalWrite: (p) => marks.push(p) })
    await r.mkdirPlan(root, '', 'a')
    expect(marks).toContain(join(root, 'a'))
  })

  it('rmRecursive：删除前登记被删目录（前缀抑制其内全部事件）', async () => {
    const marks: string[] = []
    const r = new PlanRepository({ onInternalWrite: (p) => marks.push(p) })
    await r.mkdirPlan(root, '', 'b')
    marks.length = 0
    await r.rmRecursive(root, 'b')
    expect(marks).toContain(join(root, 'b'))
  })

  it('moveDir：登记源与目标两侧（unlinkDir + addDir 回声都抑制）', async () => {
    const marks: string[] = []
    const r = new PlanRepository({ onInternalWrite: (p) => marks.push(p) })
    await r.mkdirPlan(root, '', 'c')
    marks.length = 0
    await r.moveDir(join(root, 'c'), join(root, 'd'))
    expect(marks).toContain(join(root, 'c'))
    expect(marks).toContain(join(root, 'd'))
  })

  it('renamePlanDir：经 moveDir 登记源与目标', async () => {
    const marks: string[] = []
    const r = new PlanRepository({ onInternalWrite: (p) => marks.push(p) })
    await r.mkdirPlan(root, '', 'e')
    marks.length = 0
    await r.renamePlanDir(root, 'e', 'f')
    expect(marks).toContain(join(root, 'e'))
    expect(marks).toContain(join(root, 'f'))
  })
})
