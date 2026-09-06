// StorageService 集成测试：CRUD/排序/CAS/状态机/confirm/循环（真实临时目录）
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PlanRepository } from '../src/main/services/plan-repository'
import { StorageService } from '../src/main/services/storage-service'
import { TraceError, ERR } from '../src/shared/errors'
import type { PlanDocument, Component } from '../src/shared/plan-types'

let root: string
let service: StorageService

beforeEach(async () => {
  root = join(tmpdir(), `trace-svc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
  await fs.mkdir(root, { recursive: true })
  const repo = new PlanRepository()
  await repo.ensureLibraryRoot(root)
  service = new StorageService(repo)
  service.setRoot(root)
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function docOf(path: string): Promise<PlanDocument> {
  return JSON.parse(await fs.readFile(join(root, path, 'plan.json'), 'utf8')) as PlanDocument
}

function taskComponent(id: string, title: string): Component {
  return { id, type: 'task_list', payload: { title, items: [] } }
}

describe('createPlan / treeGetChildren', () => {
  it('创建后磁盘可见、树中可见', async () => {
    await service.createPlan('', '学期A')
    await expect(fs.access(join(root, '学期A', 'plan.json'))).resolves.toBeUndefined()
    const nodes = await service.treeGetChildren('')
    expect(nodes.map((n) => n.name)).toContain('学期A')
  })
  it('同级重名 → NAME_CONFLICT(12)', async () => {
    await service.createPlan('', 'A')
    await expect(service.createPlan('', 'A')).rejects.toMatchObject({ code: ERR.NAME_CONFLICT })
  })
  it('非法名 → VALIDATION(20)', async () => {
    await expect(service.createPlan('', 'a/b')).rejects.toThrow(TraceError)
  })
  it('children_order 排序生效（Sprint 排序契约）', async () => {
    await service.createPlan('', '甲')
    await service.createPlan('', '乙')
    await service.createPlan('', '丙')
    await service.resortChildren('', ['丙', '甲', '乙'])
    const nodes = await service.treeGetChildren('')
    expect(nodes.map((n) => n.name)).toEqual(['丙', '甲', '乙'])
  })
})

describe('文件夹容器（folder，无 plan.json）', () => {
  it('createFolder 只建目录不写 plan.json，树 kind=folder', async () => {
    await service.createFolder('', '归档')
    await expect(fs.access(join(root, '归档', 'plan.json'))).rejects.toThrow()
    const nodes = await service.treeGetChildren('')
    const folder = nodes.find((n) => n.name === '归档')
    expect(folder?.kind).toBe('folder')
    // 同层计划 kind=plan
    await service.createPlan('', 'A')
    expect((await service.treeGetChildren('')).find((n) => n.name === 'A')?.kind).toBe('plan')
  })
  it('同名冲突 → NAME_CONFLICT(12)', async () => {
    await service.createFolder('', 'X')
    await expect(service.createFolder('', 'X')).rejects.toMatchObject({ code: ERR.NAME_CONFLICT })
    await expect(service.createPlan('', 'X')).rejects.toMatchObject({ code: ERR.NAME_CONFLICT })
  })
})

describe('renamePlan / deletePlan', () => {
  it('重命名同步磁盘与父排序', async () => {
    await service.createPlan('', '旧名')
    await service.resortChildren('', ['旧名'])
    const r = await service.renamePlan('旧名', '新名')
    expect(r.path).toBe('新名')
    await expect(fs.access(join(root, '新名'))).resolves.toBeUndefined()
    await expect(fs.access(join(root, '旧名'))).rejects.toThrow()
    expect((await service.treeGetChildren('')).map((n) => n.name)).toEqual(['新名'])
  })
  it('删除未确认 → CONFIRMATION_REQUIRED(24)', async () => {
    await service.createPlan('', 'A')
    await expect(service.deletePlan('A', false)).rejects.toMatchObject({ code: ERR.CONFIRMATION_REQUIRED })
  })
  it('确认后递归删除', async () => {
    await service.createPlan('', 'A')
    await service.createPlan('A', '子')
    await service.deletePlan('A', true)
    await expect(fs.access(join(root, 'A'))).rejects.toThrow()
  })
})

describe('movePlan', () => {
  it('移动 + 循环拒绝', async () => {
    await service.createPlan('', 'A')
    await service.createPlan('', 'B')
    await service.movePlan('A', 'B', 0)
    expect(await service.treeGetChildren('B').then((ns) => ns.map((n) => n.name))).toEqual(['A'])

    await expect(service.movePlan('B/A', 'B/A', 0)).rejects.toMatchObject({ code: ERR.CIRCULAR_NESTING })
    await expect(service.movePlan('B', 'B/A', 0)).rejects.toMatchObject({ code: ERR.CIRCULAR_NESTING })
  })

  it('计划可拖入纯文件夹（容器）', async () => {
    await service.createPlan('', 'A')
    await service.createFolder('', '归档')
    await service.movePlan('A', '归档', 0)
    const kids = await service.treeGetChildren('归档')
    expect(kids.map((n) => n.name)).toEqual(['A'])
    expect(kids[0].kind).toBe('plan')
  })
  it('目标重名拒绝', async () => {
    await service.createPlan('', 'A')
    await service.createPlan('', 'B')
    await service.createPlan('B', 'X')
    await service.createPlan('A', 'X')
    await expect(service.movePlan('A/X', 'B', 0)).rejects.toMatchObject({ code: ERR.NAME_CONFLICT })
  })
})

describe('savePlan CAS', () => {
  it('expected_updated_at 不匹配 → CONFLICT(22)', async () => {
    await service.createPlan('', 'A')
    const doc = await service.readPlan('A')
    await expect(service.savePlan('A', doc, '2020-01-01T00:00:00Z')).rejects.toMatchObject({ code: ERR.CONFLICT })
  })
  it('匹配则写入并返回新 updated_at', async () => {
    await service.createPlan('', 'A')
    const doc = await service.readPlan('A')
    const before = doc.updated_at // 先存快照：writePlanAtomic 会原地更新 doc.updated_at
    const r = await service.savePlan('A', doc, before)
    expect(r.updated_at).not.toBe(before)
  })
})

describe('updateTask（组件+状态机）', () => {
  it('task_list 状态流转 + completed_at 维护', async () => {
    await service.createPlan('', 'A')
    const comp = taskComponent('c1', '本周')
    await service.appendComponent('A', comp)
    const item = { id: 't1', title: '写周报', status: 'not_started' as const }
    const doc1 = await service.readPlan('A')
    ;(doc1.components[0].payload as { items: unknown[] }).items.push(item)
    await service.savePlan('A', doc1, doc1.updated_at)

    // 直接走 updateTask：not_started → done 应拒绝（越级）
    await expect(service.updateTask('A', 'c1', 't1', { status: 'done' })).rejects.toThrow(TraceError)
    // not_started → in_progress → done
    await service.updateTask('A', 'c1', 't1', { status: 'in_progress' })
    await service.updateTask('A', 'c1', 't1', { status: 'done' })
    const doc2 = await docOf('A')
    const t = (doc2.components[0].payload as { items: Array<{ status: string; completed_at?: string }> }).items[0]
    expect(t.status).toBe('done')
    expect(t.completed_at).toBeTruthy()
  })
  it('任务不存在 → PATH_NOT_FOUND(10)', async () => {
    await service.createPlan('', 'A')
    await service.appendComponent('A', taskComponent('c1', '本周'))
    await expect(service.updateTask('A', 'c1', 'nope', { title: 'x' })).rejects.toMatchObject({ code: ERR.PATH_NOT_FOUND })
  })
})
