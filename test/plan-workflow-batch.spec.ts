import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ERR } from '../src/shared/errors'
import type { PlanWorkflowConfig, WorkflowDraftInput } from '../src/shared/plan-workflow-types'
import type { PlanDocument } from '../src/shared/plan-types'
import { PlanRepository } from '../src/main/services/plan-repository'
import { StorageService } from '../src/main/services/storage-service'
import { PlanNameTemplateService } from '../src/main/services/plan-name-template-service'
import { PlanWorkflowConfigService } from '../src/main/services/plan-workflow-config-service'
import { PlanWorkflowResolver } from '../src/main/services/plan-workflow-resolver'
import { PlanWorkflowBatchService } from '../src/main/services/plan-workflow-batch-service'
import { PlanWorkflowService } from '../src/main/services/plan-workflow-service'
import { PlanWorkflowHandoffService } from '../src/main/services/plan-workflow-handoff-service'
import { PlanReferenceService } from '../src/main/services/plan-reference-service'

// The batch cases perform several durable writes; allow for filesystem load in a full suite.
vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 })

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))) })

function config(): PlanWorkflowConfig {
  return { format_version: '1', name_rules: [], content_templates: [
    { id: 'week', name: '周', components: [{ type: 'heading', title: '本周目标' }] },
    { id: 'day', name: '日', components: [{ type: 'task_list', title: '执行任务' }] }
  ], presets: [{ id: 'week', name: '周日联动', scope: { kind: 'category', path: 'Weekly_Plan' }, enabled: true, is_default: true,
    outputs: [
      { id: 'week', destination: { kind: 'fixed', path: 'Weekly_Plan' }, name_template_mode: 'explicit',
        name_template: '{this.folder_name}_{week_start}-{week_end}', content_template_id: 'week', repeat: 'once', workflow_kind: 'week' },
      { id: 'days', destination: { kind: 'fixed', path: 'Daily_Plan' }, name_template_mode: 'explicit',
        name_template: '{this.folder_name}_{date}', content_template_id: 'day', repeat: 'each_day', workflow_kind: 'day' }
    ] }] }
}

async function setup(linkFn?: (source: string, target: string) => Promise<void>) {
  const root = await fs.mkdtemp(join(tmpdir(), 'trace-workflow-batch-'))
  roots.push(root)
  await fs.mkdir(join(root, 'Weekly_Plan'))
  await fs.mkdir(join(root, 'Daily_Plan'))
  const repository = new PlanRepository(linkFn ? { linkFn } : undefined)
  await repository.ensureLibraryRoot(root)
  const storage = new StorageService(repository)
  storage.setRoot(root)
  const configs = new PlanWorkflowConfigService(repository)
  await configs.save(root, config())
  const resolver = new PlanWorkflowResolver(repository, configs, new PlanNameTemplateService(repository), () => new Date(2026, 9, 11))
  const batch = new PlanWorkflowBatchService(storage, repository, resolver)
  const libraryId = (await repository.readLibraryMeta(root)).library_id
  const draft: WorkflowDraftInput = { selected_path: 'Weekly_Plan', period: { start_date: '2026-12-31', end_date: '2027-01-06' },
    tasks: [{ id: 'assigned', title: '整理资料', target_date: '2027-01-01' }] }
  const service = new PlanWorkflowService(storage, repository, configs, resolver)
  const references = new PlanReferenceService(repository, () => storage.getRootAbs())
  references.activateRoot(root)
  const handoff = new PlanWorkflowHandoffService(storage, repository, references)
  return { root, repository, storage, resolver, batch, service, handoff, libraryId, draft }
}

async function adjacentWeeks() {
  const context = await setup()
  const firstPreview = await context.resolver.previewWorkflow(context.root, context.draft)
  const first = await context.batch.commit({ library_id: context.libraryId, draft: context.draft,
    revision_token: firstPreview.revision_token, confirmations: [] })
  expect(first.status).toBe('complete')
  const nextDraft: WorkflowDraftInput = { selected_path: 'Weekly_Plan',
    period: { start_date: '2027-01-07', end_date: '2027-01-13' } }
  const nextPreview = await context.resolver.previewWorkflow(context.root, nextDraft)
  const next = await context.batch.commit({ library_id: context.libraryId, draft: nextDraft,
    revision_token: nextPreview.revision_token, confirmations: [] })
  expect(next.status).toBe('complete')
  const firstWeek = first.items.find((item) => item.output_key === 'week')!
  const nextWeek = next.items.find((item) => item.output_key === 'week')!
  const source = first.items.find((item) => item.output_key === 'days:2027-01-01')!
  const target = next.items.find((item) => item.output_key === 'days:2027-01-07')!
  const sourceDoc = await context.repository.readPlan(context.root, source.path)
  const sourceTask = (sourceDoc.components.find((component) => component.type === 'task_list')!.payload as { items: Array<{ id: string }> }).items[0]
  return { ...context, firstWeek, nextWeek, source, target, sourceTask }
}

describe('week and day workflow batch', () => {
  it('creates seven day plans, including empty days, before a linked draft week', async () => {
    const { root, resolver, batch, service, libraryId, draft } = await setup()
    const preview = await resolver.previewWorkflow(root, draft)
    const result = await batch.commit({ library_id: libraryId, draft, revision_token: preview.revision_token, confirmations: [] })
    expect(result.status).toBe('complete')
    expect(result.items).toHaveLength(8)
    expect(result.items.map((item) => item.status)).toEqual(Array(8).fill('created'))
    const week = JSON.parse(await fs.readFile(join(root, 'Weekly_Plan', 'Weekly_Plan_20261231-20270106', 'plan.json'), 'utf8')) as PlanDocument
    expect(week.workflow).toMatchObject({ kind: 'week', status: 'draft', start_date: '2026-12-31', end_date: '2027-01-06' })
    expect(week.workflow?.kind === 'week' ? Object.keys(week.workflow.day_plan_ids) : []).toHaveLength(7)
    const first = JSON.parse(await fs.readFile(join(root, 'Daily_Plan', 'Daily_Plan_20261231', 'plan.json'), 'utf8')) as PlanDocument
    expect(first.workflow).toMatchObject({ kind: 'day', target_date: '2026-12-31', week_plan_id: week.plan_id })
    expect((first.components[0].payload as { items: unknown[] }).items).toEqual([])
    const second = JSON.parse(await fs.readFile(join(root, 'Daily_Plan', 'Daily_Plan_20270101', 'plan.json'), 'utf8')) as PlanDocument
    expect((second.components[0].payload as { items: Array<{ title: string; planned_at: string }> }).items)
      .toMatchObject([{ title: '整理资料', planned_at: '2027-01-01' }])
    expect(await service.suggestPeriod({ library_id: libraryId, selected_path: 'Weekly_Plan' }))
      .toEqual({ start_date: '2027-01-07', end_date: '2027-01-13' })
    const reopened = await resolver.previewWorkflow(root, draft)
    const draftResult = await batch.commit({ library_id: libraryId, draft, revision_token: reopened.revision_token, confirmations: [] })
    expect(draftResult).toMatchObject({ status: 'existing_draft', items: [{ path: 'Weekly_Plan/Weekly_Plan_20261231-20270106' }] })
    const overlap = await resolver.previewWorkflow(root, { selected_path: 'Weekly_Plan',
      period: { start_date: '2027-01-05', end_date: '2027-01-11' } })
    expect(overlap.outputs[0].conflicts).toContainEqual(expect.objectContaining({ code: 'period_overlap' }))
  })

  it('requires explicit confirmation to reuse a dated candidate and merge assigned tasks', async () => {
    const { root, repository, storage, resolver, batch, libraryId, draft } = await setup()
    const existing = await storage.createPlan('Daily_Plan', '旧日计划-20270101')
    const preview = await resolver.previewWorkflow(root, draft)
    expect(preview.outputs.find((item) => item.target_date === '2027-01-01')?.conflicts[0].code).toBe('same_date_candidate')
    await expect(batch.commit({ library_id: libraryId, draft, revision_token: preview.revision_token, confirmations: [] }))
      .rejects.toMatchObject({ code: ERR.CONFIRMATION_REQUIRED })
    await expect(batch.commit({ library_id: libraryId, draft, revision_token: preview.revision_token, confirmations: [
      { output_key: 'days:2027-01-01', action: 'reuse', existing_path: existing.path }
    ] })).rejects.toMatchObject({ code: ERR.CONFIRMATION_REQUIRED })
    const result = await batch.commit({ library_id: libraryId, draft, revision_token: preview.revision_token, confirmations: [
      { output_key: 'days:2027-01-01', action: 'reuse', existing_path: existing.path, merge_tasks: true }
    ] })
    expect(result.status).toBe('complete')
    expect(result.items.find((item) => item.output_key === 'days:2027-01-01')).toMatchObject({ status: 'reused', path: existing.path })
    const merged = await repository.readPlan(root, existing.path)
    expect(merged.plan_id).toMatch(/^[a-f0-9]{32}$/)
    expect(merged.workflow).toMatchObject({ kind: 'day', target_date: '2027-01-01' })
    expect(merged.components.find((component) => component.type === 'task_list')).toMatchObject({ payload: { items: [{ title: '整理资料' }] } })
  })

  it('reports partial writes and resumes without duplicating already created plans', async () => {
    let writes = 0
    let failOnce = true
    const { root, resolver, batch, libraryId, draft } = await setup(async (source, target) => {
      writes += 1
      if (failOnce && writes === 4) { failOnce = false; throw Object.assign(new Error('busy'), { code: 'EPERM' }) }
      await fs.link(source, target)
    })
    const preview = await resolver.previewWorkflow(root, draft)
    const partial = await batch.commit({ library_id: libraryId, draft, revision_token: preview.revision_token, confirmations: [] })
    expect(partial.status).toBe('partial')
    expect(partial.items.filter((item) => item.status === 'created')).toHaveLength(3)
    expect(partial.items.find((item) => item.status === 'failed')?.error).toBeDefined()
    expect(await batch.listPending(libraryId)).toMatchObject([{ operation_id: partial.operation_id,
      completed_count: 3, total_count: 8 }])
    const complete = await batch.resume({ library_id: libraryId, operation_id: partial.operation_id })
    expect(complete.status).toBe('complete')
    expect(await batch.listPending(libraryId)).toEqual([])
    expect(new Set(complete.items.map((item) => item.plan_id)).size).toBe(8)
    expect((await fs.readdir(join(root, 'Daily_Plan'))).length).toBe(7)
  })
})

describe('cross-week handoff', () => {
  it('keeps unfinished source tasks until an explicit move, then links both sides', async () => {
    const { root, repository, handoff, libraryId, nextWeek, source, target, sourceTask } = await adjacentWeeks()
    const preview = await handoff.preview({ library_id: libraryId, week_plan_id: nextWeek.plan_id })
    expect(preview.tasks).toMatchObject([{ source_plan_id: source.plan_id, source_task_id: sourceTask.id,
      title: '整理资料', source_date: '2027-01-01' }])
    const before = await repository.readPlan(root, target.path)
    expect((before.components[0].payload as { items: unknown[] }).items).toEqual([])
    const input = { library_id: libraryId, week_plan_id: nextWeek.plan_id,
      source_plan_id: source.plan_id, source_task_id: sourceTask.id, target_date: '2027-01-07' }
    const result = await handoff.move(input)
    expect(result).toMatchObject({ status: 'complete', target_plan_id: target.plan_id })
    const old = await repository.readPlan(root, source.path)
    expect((old.components[0].payload as { items: unknown[] }).items).toMatchObject([{
      status: 'moved', moved_to_plan_id: target.plan_id, moved_to_task_id: result.target_task_id
    }])
    const next = await repository.readPlan(root, target.path)
    expect((next.components[0].payload as { items: unknown[] }).items).toMatchObject([{
      id: result.target_task_id, source_plan_id: source.plan_id, source_task_id: sourceTask.id,
      planned_at: '2027-01-07'
    }])
    expect(await handoff.move(input)).toEqual(result)
    expect((await handoff.preview({ library_id: libraryId, week_plan_id: nextWeek.plan_id })).tasks).toEqual([])
  })

  it('reports a partial write and finishes the source marker on retry without a duplicate target', async () => {
    const { root, repository, storage, handoff, libraryId, nextWeek, source, target, sourceTask } = await adjacentWeeks()
    const save = storage.savePlan.bind(storage)
    let failSource = true
    const spy = vi.spyOn(storage, 'savePlan').mockImplementation((path, document, expected, guard) => {
      if (path === source.path && failSource) { failSource = false; throw new Error('source write interrupted') }
      return save(path, document, expected, guard)
    })
    try {
      const input = { library_id: libraryId, week_plan_id: nextWeek.plan_id,
        source_plan_id: source.plan_id, source_task_id: sourceTask.id, target_date: '2027-01-07' }
      const partial = await handoff.move(input)
      expect(partial.status).toBe('partial')
      expect((await repository.readPlan(root, source.path)).components[0].payload).toMatchObject({ items: [{ status: 'not_started' }] })
      const completed = await handoff.move(input)
      expect(completed).toMatchObject({ status: 'complete', target_task_id: partial.target_task_id })
      const next = await repository.readPlan(root, target.path)
      expect((next.components[0].payload as { items: unknown[] }).items).toHaveLength(1)
    } finally { spy.mockRestore() }
  })
})
