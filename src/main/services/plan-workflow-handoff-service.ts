import { promises as fs } from 'node:fs'
import { ERR, TraceError } from '../../shared/errors'
import type { PlanDocument, TaskItem, TaskListPayload } from '../../shared/plan-types'
import type { WorkflowHandoffMoveRequest, WorkflowHandoffMoveResult, WorkflowHandoffPreview } from '../../shared/plan-workflow-types'
import { isUuid32, uuid32 } from '../../shared/validation'
import { PlanReferenceService } from './plan-reference-service'
import { PlanRepository, type AgentLibraryMutationGuard } from './plan-repository'
import { StorageService } from './storage-service'

const DAY_MS = 86_400_000

interface ActiveLibrary {
  root: string
  libraryId: string
  rootReal: string
  rootIdentity: string
}

interface LocatedPlan {
  path: string
  document: PlanDocument
}

function taskList(document: PlanDocument): Array<{ payload: TaskListPayload; task: TaskItem }> {
  return document.components.flatMap((component) => component.type === 'task_list'
    ? (component.payload as TaskListPayload).items.map((task) => ({ payload: component.payload as TaskListPayload, task })) : [])
}

export class PlanWorkflowHandoffService {
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly storage: StorageService, private readonly repository: PlanRepository,
    private readonly references: PlanReferenceService) {}

  async preview(input: { library_id: string; week_plan_id: string }): Promise<WorkflowHandoffPreview> {
    if (!input || !isUuid32(input.library_id) || !isUuid32(input.week_plan_id)) {
      throw new TraceError(ERR.VALIDATION, '跨周交接预览请求无效')
    }
    const active = await this.snapshot(input.library_id)
    const next = await this.week(active, input.week_plan_id)
    const previous = await this.previousWeek(active, next.document)
    if (!previous) return { previous_week_plan_id: null, tasks: [] }
    const tasks: WorkflowHandoffPreview['tasks'] = []
    if (previous.document.workflow?.kind !== 'week') throw new TraceError(ERR.CONFLICT, '旧周计划元数据已变化')
    for (const [date, planId] of Object.entries(previous.document.workflow.day_plan_ids).sort(([a], [b]) => a.localeCompare(b))) {
      const day = await this.resolve(active, planId)
      if (day.document.workflow?.kind !== 'day' || day.document.workflow.target_date !== date ||
        day.document.workflow.week_plan_id !== previous.document.plan_id) {
        throw new TraceError(ERR.CONFLICT, '旧周与日计划关联不一致')
      }
      for (const { task } of taskList(day.document)) {
        if (task.status !== 'not_started' && task.status !== 'in_progress') continue
        if (!isUuid32(task.id)) throw new TraceError(ERR.FORMAT_INVALID, '旧日计划任务标识无效')
        tasks.push({ source_plan_id: planId, source_task_id: task.id, title: task.title, source_date: date })
      }
    }
    await this.assertCurrent(active)
    return { previous_week_plan_id: previous.document.plan_id ?? null, tasks }
  }

  async move(input: WorkflowHandoffMoveRequest): Promise<WorkflowHandoffMoveResult> {
    const previous = this.queue
    let release!: () => void
    this.queue = new Promise<void>((resolve) => { release = resolve })
    await previous
    try { return await this.moveNow(input) } finally { release() }
  }

  private async moveNow(input: WorkflowHandoffMoveRequest): Promise<WorkflowHandoffMoveResult> {
    if (!input || ![input.library_id, input.week_plan_id, input.source_plan_id, input.source_task_id]
      .every((id) => isUuid32(id)) || typeof input.target_date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.target_date)) {
      throw new TraceError(ERR.VALIDATION, '跨周交接请求无效')
    }
    const active = await this.snapshot(input.library_id)
    const next = await this.week(active, input.week_plan_id)
    const previous = await this.previousWeek(active, next.document)
    if (!previous || previous.document.workflow?.kind !== 'week' || next.document.workflow?.kind !== 'week') {
      throw new TraceError(ERR.CONFLICT, '找不到相邻旧周计划')
    }
    if (!Object.values(previous.document.workflow.day_plan_ids).includes(input.source_plan_id)) {
      throw new TraceError(ERR.VALIDATION, '源计划不属于相邻旧周')
    }
    const targetPlanId = next.document.workflow.day_plan_ids[input.target_date]
    if (!targetPlanId || !isUuid32(targetPlanId)) throw new TraceError(ERR.VALIDATION, '目标日期不属于新周')
    const source = await this.resolve(active, input.source_plan_id)
    const target = await this.resolve(active, targetPlanId)
    if (source.document.workflow?.kind !== 'day' || source.document.workflow.week_plan_id !== previous.document.plan_id ||
      target.document.workflow?.kind !== 'day' || target.document.workflow.week_plan_id !== next.document.plan_id ||
      target.document.workflow.target_date !== input.target_date) {
      throw new TraceError(ERR.CONFLICT, '日计划关联已变化')
    }
    const sourceMatches = taskList(source.document).filter(({ task }) => task.id === input.source_task_id)
    if (sourceMatches.length !== 1) throw new TraceError(ERR.CONFLICT, '源任务缺失或标识重复')
    const sourceTask = sourceMatches[0].task
    const copied: Array<{ planId: string; task: TaskItem }> = []
    for (const dayId of Object.values(next.document.workflow.day_plan_ids)) {
      const day = dayId === targetPlanId ? target : await this.resolve(active, dayId)
      for (const { task } of taskList(day.document)) {
        if (task.source_plan_id === input.source_plan_id && task.source_task_id === input.source_task_id) {
          copied.push({ planId: dayId, task })
        }
      }
    }
    if (copied.length > 1 || (copied.length === 1 && copied[0].planId !== targetPlanId)) {
      throw new TraceError(ERR.CONFLICT, '源任务已经交接到另一个目标日')
    }
    if (sourceTask.status === 'moved') {
      if (copied.length === 1 && sourceTask.moved_to_plan_id === targetPlanId &&
        sourceTask.moved_to_task_id === copied[0].task.id) {
        return { status: 'complete', source_plan_id: input.source_plan_id, source_task_id: input.source_task_id,
          target_plan_id: targetPlanId, target_task_id: copied[0].task.id }
      }
      throw new TraceError(ERR.CONFLICT, '源任务已经转移，目标关联不一致')
    }
    if (sourceTask.status !== 'not_started' && sourceTask.status !== 'in_progress') {
      throw new TraceError(ERR.CONFLICT, '已完成任务不能交接')
    }
    if (copied.length === 1 && copied[0].task.title !== sourceTask.title) {
      throw new TraceError(ERR.CONFLICT, '交接副本与源任务标题不一致，请人工核对')
    }
    let targetTaskId = copied[0]?.task.id
    if (!targetTaskId) {
      targetTaskId = uuid32()
      const targetDraft = structuredClone(target.document)
      const entry: TaskItem = { id: targetTaskId, title: sourceTask.title, status: sourceTask.status,
        planned_at: input.target_date, ...(sourceTask.note ? { note: sourceTask.note } : {}),
        source_plan_id: input.source_plan_id, source_task_id: input.source_task_id }
      const list = targetDraft.components.find((component) => component.type === 'task_list')
      if (list) (list.payload as TaskListPayload).items.push(entry)
      else targetDraft.components.push({ id: uuid32(), type: 'task_list', payload: { title: '执行任务', items: [entry] } })
      await this.assertCurrent(active)
      await this.storage.savePlan(target.path, targetDraft, target.document.updated_at, this.guard(active))
    }
    try {
      const sourceCurrent = await this.resolve(active, input.source_plan_id)
      if (sourceCurrent.document.updated_at !== source.document.updated_at) {
        throw new TraceError(ERR.CONFLICT, '目标已写入，但源计划版本已变化')
      }
      const sourceDraft = structuredClone(source.document)
      const moved = taskList(sourceDraft).find(({ task }) => task.id === input.source_task_id)?.task
      if (!moved) throw new TraceError(ERR.CONFLICT, '源任务已变化')
      moved.status = 'moved'
      delete moved.completed_at
      moved.moved_to_plan_id = targetPlanId
      moved.moved_to_task_id = targetTaskId
      await this.assertCurrent(active)
      await this.storage.savePlan(source.path, sourceDraft, source.document.updated_at, this.guard(active))
      return { status: 'complete', source_plan_id: input.source_plan_id, source_task_id: input.source_task_id,
        target_plan_id: targetPlanId, target_task_id: targetTaskId }
    } catch {
      return { status: 'partial', source_plan_id: input.source_plan_id, source_task_id: input.source_task_id,
        target_plan_id: targetPlanId, target_task_id: targetTaskId }
    }
  }

  private async week(active: ActiveLibrary, planId: string): Promise<LocatedPlan> {
    const week = await this.resolve(active, planId)
    if (week.document.workflow?.kind !== 'week') throw new TraceError(ERR.VALIDATION, '所选计划不是周计划')
    return week
  }

  private async previousWeek(active: ActiveLibrary, next: PlanDocument): Promise<LocatedPlan | null> {
    if (next.workflow?.kind !== 'week') throw new TraceError(ERR.VALIDATION, '所选计划不是周计划')
    const previousDate = new Date(Date.parse(`${next.workflow.start_date}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10)
    const candidates = (await this.references.search({ library_id: active.libraryId, query: '' })).targets
      .filter((candidate) => !candidate.component_id && candidate.plan_id && candidate.plan_id !== next.plan_id)
    const matches: LocatedPlan[] = []
    for (const candidate of candidates) {
      const document = await this.repository.readPlan(active.root, candidate.path)
      if (document.workflow?.kind === 'week' && document.workflow.end_date === previousDate) {
        matches.push({ path: candidate.path, document })
      }
    }
    if (matches.length > 1) throw new TraceError(ERR.CONFLICT, '相邻日期存在多份旧周计划')
    return matches[0] ?? null
  }

  private async resolve(active: ActiveLibrary, planId: string): Promise<LocatedPlan> {
    const result = await this.references.resolve({ library_id: active.libraryId, plan_id: planId })
    if (result.status !== 'found') throw new TraceError(ERR.CONFLICT, '周日目标缺失或稳定标识冲突')
    const document = await this.repository.readPlan(active.root, result.target.path)
    if (document.plan_id !== planId) throw new TraceError(ERR.CONFLICT, '计划身份已变化')
    return { path: result.target.path, document }
  }

  private async snapshot(libraryId: string): Promise<ActiveLibrary> {
    if (!isUuid32(libraryId)) throw new TraceError(ERR.VALIDATION, '计划库身份无效')
    const root = this.storage.getRootAbs()
    if (!root) throw new TraceError(ERR.STATE_MACHINE, '请先打开计划库')
    const [meta, real, stat] = await Promise.all([this.repository.readLibraryMeta(root), fs.realpath(root), fs.stat(root)])
    if (meta.library_id !== libraryId) throw new TraceError(ERR.CONFLICT, '计划库已切换')
    return { root, libraryId, rootReal: real, rootIdentity: `${stat.dev}:${stat.ino}` }
  }

  private async assertCurrent(active: ActiveLibrary): Promise<void> {
    if (this.storage.getRootAbs() !== active.root) throw new TraceError(ERR.CONFLICT, '计划库已切换')
    const [meta, real, stat] = await Promise.all([this.repository.readLibraryMeta(active.root), fs.realpath(active.root), fs.stat(active.root)])
    if (meta.library_id !== active.libraryId || real !== active.rootReal ||
      `${stat.dev}:${stat.ino}` !== active.rootIdentity || this.storage.getRootAbs() !== active.root) {
      throw new TraceError(ERR.CONFLICT, '计划库身份已变化')
    }
  }

  private guard(active: ActiveLibrary): AgentLibraryMutationGuard {
    return { rootDirectoryIdentity: active.rootIdentity, rootGeneration: 0,
      assertCurrent: () => this.assertCurrent(active), assertBeforeMutation: () => this.assertCurrent(active) }
  }
}
