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
