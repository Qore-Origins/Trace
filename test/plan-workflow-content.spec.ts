import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PlanRepository } from '../src/main/services/plan-repository'
import { StorageService } from '../src/main/services/storage-service'
import { compileWorkflowDocument } from '../src/main/services/plan-workflow-content'
import { validatePlanWorkflowMetadata } from '../src/shared/plan-workflow-validation'
import { ERR } from '../src/shared/errors'
import type { WorkflowPreviewOutput } from '../src/shared/plan-workflow-types'

const planId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const dayPlanId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const weekPlanId = 'cccccccccccccccccccccccccccccccc'
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

function output(): WorkflowPreviewOutput {
  return {
    key: 'days:2026-10-12',
    output_id: 'days',
    workflow_kind: 'day',
    destination_path: 'Daily_Plan',
    name: 'Daily_Plan_20261012',
    relative_path: 'Daily_Plan/Daily_Plan_20261012',
    name_rule_source: 'preset',
    target_date: '2026-10-12',
    components: [
      { type: 'heading', title: '当天重点' },
      { type: 'task_list', title: '执行任务' },
      { type: 'note', title: '过程记录', prompt: '记录实际进展' },
      { type: 'mood', title: '心情' },
      { type: 'plan_reference', title: '周计划入口', reference_output_key: 'week' }
    ],
    assigned_tasks: [{ id: 'source-one', title: '整理资料', target_date: '2026-10-12' }],
    conflicts: []
  }
}

function nextIdFactory(): () => string {
  let index = 1
  return () => String(index++).padStart(32, '0')
}

describe('workflow content compiler and document metadata', () => {
  it('compiles ordered components and assigns unique IDs with day task dates', () => {
    const document = compileWorkflowDocument(output(), {
      planId,
      now: new Date('2026-10-11T14:00:00.000Z'),
      idFactory: nextIdFactory(),
      workflow: { kind: 'day', target_date: '2026-10-12', week_plan_id: weekPlanId },
      referenceTargets: { week: { planId: weekPlanId, path: 'Weekly_Plan/Week', name: 'Week' } }
    })
    expect(document.plan_id).toBe(planId)
    expect(document.workflow).toEqual({ kind: 'day', target_date: '2026-10-12', week_plan_id: weekPlanId })
    expect(document.components.map((component) => component.type)).toEqual(['heading', 'task_list', 'note', 'mood', 'plan_reference'])
    expect(document.components[1].payload).toMatchObject({
      title: '执行任务',
      items: [{ title: '整理资料', status: 'not_started', planned_at: '2026-10-12' }]
    })
    expect(document.components[2].payload).toMatchObject({ content: '## 过程记录\n\n记录实际进展' })
    expect(document.components[4].payload).toMatchObject({ target_plan_id: weekPlanId, target_path_snapshot: 'Weekly_Plan/Week' })
    const ids = [planId, ...document.components.map((component) => component.id),
      ...(document.components[1].payload as { items: Array<{ id: string }> }).items.map((item) => item.id)]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('rejects unresolved references, invalid metadata and duplicate generated IDs', () => {
    expect(() => compileWorkflowDocument(output(), { planId, referenceTargets: {} })).toThrow()
    expect(() => validatePlanWorkflowMetadata({ kind: 'day', target_date: '2026-02-30' })).toThrow()
    expect(() => validatePlanWorkflowMetadata({ kind: 'week', status: 'draft', start_date: '2026-10-12', end_date: '2026-10-18', day_plan_ids: { '2026-10-13': 'bad-id' } })).toThrow()
    expect(() => compileWorkflowDocument({ ...output(), components: [{ type: 'heading', title: '目标' }] }, {
      planId, idFactory: () => planId
    })).toThrow()
  })

  it('keeps old documents readable but rejects invalid optional workflow metadata on read', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'trace-workflow-doc-'))
    roots.push(root)
    const repo = new PlanRepository()
    await repo.ensureLibraryRoot(root)
    await fs.mkdir(join(root, 'Old'))
    const base = { format_version: '1', created_at: '2026-10-11T00:00:00.000Z', updated_at: '2026-10-11T00:00:00.000Z', components: [] }
    await fs.writeFile(join(root, 'Old', 'plan.json'), JSON.stringify(base))
    await expect(repo.readPlan(root, 'Old')).resolves.toMatchObject(base)
    await fs.writeFile(join(root, 'Old', 'plan.json'), JSON.stringify({ ...base, workflow: { kind: 'day', target_date: 'bad' } }))
    await expect(repo.readPlan(root, 'Old')).rejects.toMatchObject({ code: ERR.FORMAT_INVALID })
  })

  it('creates a complete workflow document once and preserves an existing plan', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'trace-workflow-create-'))
    roots.push(root)
    const repo = new PlanRepository()
    await repo.ensureLibraryRoot(root)
    await fs.mkdir(join(root, 'Daily_Plan'))
    const storage = new StorageService(repo)
    storage.setRoot(root)
    const daily = { ...output(), components: output().components.filter((component) => component.type !== 'plan_reference') }
    const document = compileWorkflowDocument(daily, {
      planId: dayPlanId,
      workflow: { kind: 'day', target_date: '2026-10-12' },
      idFactory: nextIdFactory()
    })
    await expect(storage.createPlanDocument('Daily_Plan', 'Daily_Plan_20261012', document)).resolves.toMatchObject({ kind: 'plan' })
    const persisted = await repo.readPlan(root, 'Daily_Plan/Daily_Plan_20261012')
    expect(persisted.plan_id).toBe(dayPlanId)
    expect(persisted.components).toHaveLength(4)
    await expect(storage.createPlanDocument('Daily_Plan', 'Daily_Plan_20261012', document)).rejects.toMatchObject({ code: ERR.NAME_CONFLICT })
    expect((await repo.readPlan(root, 'Daily_Plan/Daily_Plan_20261012')).plan_id).toBe(dayPlanId)
  })
})
