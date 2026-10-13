import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { ERR, TraceError } from '../../shared/errors'
import type { PlanDocument, TaskItem, TaskListPayload } from '../../shared/plan-types'
import type {
  WorkflowBatchCommitRequest, WorkflowBatchConfirmation, WorkflowBatchItemResult, WorkflowBatchResult,
  WorkflowBatchResumeRequest, WorkflowBatchSummary, WorkflowPreviewOutput
} from '../../shared/plan-workflow-types'
import { isUuid32, uuid32 } from '../../shared/validation'
import { compileWorkflowDocument } from './plan-workflow-content'
import { PlanWorkflowResolver } from './plan-workflow-resolver'
import { PlanRepository, type AgentLibraryMutationGuard } from './plan-repository'
import { assertRealPathWithinRoot, resolveWithin } from './path-safety'
import { StorageService } from './storage-service'

const JOURNAL_DIR = '.trace/plan-workflow-batches'
const JOURNAL_ID = /^[a-f0-9]{32}$/
const DAY_MS = 86_400_000

interface LibrarySnapshot {
  root: string
  libraryId: string
  rootReal: string
  rootIdentity: string
}

interface JournalItem {
  output: WorkflowPreviewOutput
  planId: string
  action: 'create' | 'reuse'
  existingPath?: string
  mergeTasks: boolean
  taskIds: Record<string, string>
  newTaskListId: string
  status: WorkflowBatchItemResult['status']
  error?: string
}

interface BatchJournal {
  format_version: '1'
  operation_id: string
  library_id: string
  root_real: string
  root_identity: string
  input_signature: string
  created_at: string
  items: JournalItem[]
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function outputPath(item: JournalItem): string {
  const path = item.action === 'reuse' ? item.existingPath : item.output.relative_path
  if (!path) throw new TraceError(ERR.VALIDATION, '批次目标计划路径无效')
  return path
}

function dateRange(start: string, end: string): string[] {
  const startMs = Date.parse(`${start}T00:00:00Z`)
  const endMs = Date.parse(`${end}T00:00:00Z`)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs - startMs !== 6 * DAY_MS) {
    throw new TraceError(ERR.VALIDATION, '周计划周期必须恰好包含七天')
  }
  return Array.from({ length: 7 }, (_unused, index) => new Date(startMs + index * DAY_MS).toISOString().slice(0, 10))
}

export class PlanWorkflowBatchService {
  constructor(
    private readonly storage: StorageService,
    private readonly repository: PlanRepository,
    private readonly resolver: PlanWorkflowResolver
  ) {}

  async commit(input: WorkflowBatchCommitRequest): Promise<WorkflowBatchResult> {
    if (!plainRecord(input) || !Array.isArray(input.confirmations) || typeof input.revision_token !== 'string' ||
      !/^[a-f0-9]{64}$/.test(input.revision_token)) throw new TraceError(ERR.VALIDATION, '批次提交请求无效')
    const active = await this.snapshot(input.library_id)
    const preview = await this.resolver.previewWorkflow(active.root, input.draft)
    await this.assertCurrent(active)
    if (preview.revision_token !== input.revision_token || preview.library_id !== active.libraryId) {
      throw new TraceError(ERR.CONFLICT, '周日预览已变化，请重新预览')
    }
    if (preview.state !== 'ready' || !preview.preset_id) throw new TraceError(ERR.VALIDATION, '请选择周日工作流预设')
    const weekOutputs = preview.outputs.filter((output) => output.workflow_kind === 'week')
    const dayOutputs = preview.outputs.filter((output) => output.workflow_kind === 'day')
    if (weekOutputs.length !== 1 || dayOutputs.length !== 7 || preview.outputs.length !== 8 || !weekOutputs[0].period) {
      throw new TraceError(ERR.VALIDATION, '周日工作流必须包含一份周计划和七份日计划')
    }
    const period = weekOutputs[0].period
    const dates = dateRange(period.start_date, period.end_date)
    if (new Set(dayOutputs.map((output) => output.target_date)).size !== 7 ||
      dayOutputs.some((output) => !output.target_date || !dates.includes(output.target_date))) {
      throw new TraceError(ERR.VALIDATION, '日计划日期与周计划周期不一致')
    }
    const existingDraft = await this.existingWeekDraft(active, weekOutputs[0])
    if (existingDraft) return existingDraft
    const signature = createHash('sha256').update(JSON.stringify({ library_id: active.libraryId, draft: input.draft,
      preset_id: preview.preset_id })).digest('hex')
    const prior = await this.findJournal(active, signature)
    if (prior) return this.result(prior)
    const confirmations = this.confirmationMap(input.confirmations, preview.outputs)
    const items: JournalItem[] = []
    for (const output of [...dayOutputs.sort((a, b) => a.target_date!.localeCompare(b.target_date!)), weekOutputs[0]]) {
      if (!output.relative_path || !output.name) throw new TraceError(ERR.VALIDATION, '批次中有未完成的名称')
      const confirmation = confirmations.get(output.key)
      const conflicts = output.conflicts
      if (conflicts.some((conflict) => conflict.code === 'duplicate_output' || conflict.code === 'missing_name')) {
        throw new TraceError(ERR.CONFLICT, '批次目标路径或名称冲突')
      }
      if (conflicts.length > 0 && !confirmation) throw new TraceError(ERR.CONFIRMATION_REQUIRED, '已有计划候选需要逐项确认')
      if (output.workflow_kind === 'week' && conflicts.length > 0) throw new TraceError(ERR.CONFLICT, '目标周计划已经存在')
      const action = confirmation?.action ?? 'create'
      if (action === 'create' && conflicts.some((conflict) => conflict.code === 'name_exists')) {
        throw new TraceError(ERR.NAME_CONFLICT, '目标目录已有同名计划')
      }
      if (action === 'reuse' && output.workflow_kind !== 'day') throw new TraceError(ERR.VALIDATION, '只允许复用已确认的日计划')
      if (action === 'reuse' && !confirmation?.existing_path) throw new TraceError(ERR.VALIDATION, '复用日计划必须指定现有路径')
      const candidatePaths = conflicts.flatMap((conflict) => conflict.existing_paths ?? [])
      if (action === 'reuse' && !candidatePaths.includes(confirmation!.existing_path!)) {
        throw new TraceError(ERR.CONFLICT, '复用路径不属于本次预览的候选')
      }
      if (action === 'reuse' && output.assigned_tasks.length > 0 && !confirmation?.merge_tasks) {
        throw new TraceError(ERR.CONFIRMATION_REQUIRED, '已有日计划有新分配任务，需要单独确认合并')
      }
      let planId = uuid32()
      let existingPath: string | undefined
      if (action === 'reuse') {
        existingPath = confirmation!.existing_path!
        const existing = await this.readExistingDay(active, existingPath, output.target_date!)
        planId = existing.plan_id ?? planId
      }
      items.push({ output, planId, action, ...(existingPath ? { existingPath } : {}),
        mergeTasks: confirmation?.merge_tasks === true,
        taskIds: Object.fromEntries(output.assigned_tasks.map((task) => [task.id, uuid32()])),
        newTaskListId: uuid32(), status: 'pending' })
    }
    const journal: BatchJournal = {
      format_version: '1', operation_id: randomUUID().replaceAll('-', ''), library_id: active.libraryId,
      root_real: active.rootReal, root_identity: active.rootIdentity, input_signature: signature,
      created_at: new Date().toISOString(), items
    }
    await this.saveJournal(active, journal)
    return this.run(active, journal)
  }

  async resume(input: WorkflowBatchResumeRequest): Promise<WorkflowBatchResult> {
    if (!plainRecord(input) || !isUuid32(input.library_id) || typeof input.operation_id !== 'string' || !JOURNAL_ID.test(input.operation_id)) {
      throw new TraceError(ERR.VALIDATION, '批次续做请求无效')
    }
    const active = await this.snapshot(input.library_id)
    const journal = await this.readJournal(active, input.operation_id)
    return this.run(active, journal)
  }

  async listPending(libraryId: string): Promise<WorkflowBatchSummary[]> {
    const active = await this.snapshot(libraryId)
    const journals = await this.listJournals(active)
    return journals.filter((journal) => this.result(journal).status === 'partial').map((journal) => {
      const week = journal.items.find((item) => item.output.workflow_kind === 'week')
      if (!week?.output.period) throw new TraceError(ERR.FORMAT_INVALID, '批次周计划记录损坏')
      return { operation_id: journal.operation_id, period: week.output.period,
        completed_count: journal.items.filter((item) => item.status === 'created' || item.status === 'reused').length,
        total_count: journal.items.length }
    })
  }

  private async run(active: LibrarySnapshot, journal: BatchJournal): Promise<WorkflowBatchResult> {
    const week = journal.items.find((item) => item.output.workflow_kind === 'week')
    if (!week?.output.period) throw new TraceError(ERR.FORMAT_INVALID, '批次周计划记录无效')
    const dayPlanIds = Object.fromEntries(journal.items.filter((item) => item.output.workflow_kind === 'day')
      .map((item) => [item.output.target_date!, item.planId]))
    for (const item of journal.items) {
      if (item.status !== 'created' && item.status !== 'reused') continue
      const current = await this.repository.readPlan(active.root, outputPath(item))
      if (current.plan_id !== item.planId) throw new TraceError(ERR.CONFLICT, '批次中已完成计划的身份已变化')
    }
    for (const item of journal.items) {
      if (item.status === 'created' || item.status === 'reused') continue
      try {
        await this.assertCurrent(active)
        if (item.action === 'reuse') await this.mergeExistingDay(active, item, week.planId)
        else await this.createOutput(active, item, week.planId, dayPlanIds, journal.items)
        item.status = item.action === 'reuse' ? 'reused' : 'created'
        delete item.error
        await this.saveJournal(active, journal)
      } catch (error) {
        item.status = 'failed'
        item.error = error instanceof TraceError ? error.message : '本项写入失败，请检查计划库后续做'
        await this.saveJournal(active, journal)
        break
      }
    }
    return this.result(journal)
  }

  private async createOutput(active: LibrarySnapshot, item: JournalItem, weekPlanId: string,
    dayPlanIds: Record<string, string>, items: JournalItem[]): Promise<void> {
    const path = outputPath(item)
    const destination = resolveWithin(active.root, path)
    await assertRealPathWithinRoot(active.root, destination.abs, { allowMissing: true })
    try {
      const existing = await this.repository.readPlan(active.root, path)
      if (existing.plan_id === item.planId) return
      throw new TraceError(ERR.CONFLICT, '批次目标位置被其他计划占用')
    } catch (error) {
      if (!(error instanceof TraceError) || error.code !== ERR.PATH_NOT_FOUND) throw error
    }
    const output = item.output
    const workflow = output.workflow_kind === 'day'
      ? { kind: 'day' as const, target_date: output.target_date!, week_plan_id: weekPlanId }
      : { kind: 'week' as const, status: 'draft' as const, start_date: output.period!.start_date,
        end_date: output.period!.end_date, day_plan_ids: dayPlanIds }
    const referenceTargets = Object.fromEntries(items.map((target) => [target.output.key, {
      planId: target.planId, path: outputPath(target), name: target.output.name ?? ''
    }]))
    const document = compileWorkflowDocument(output, { planId: item.planId, workflow, referenceTargets })
    await this.storage.createPlanDocument(output.destination_path, output.name!, document, this.guard(active))
  }

  private async mergeExistingDay(active: LibrarySnapshot, item: JournalItem, weekPlanId: string): Promise<void> {
    const output = item.output
    const path = outputPath(item)
    const current = await this.readExistingDay(active, path, output.target_date!)
    if (current.plan_id && current.plan_id !== item.planId) throw new TraceError(ERR.CONFLICT, '复用日计划身份已变化')
    if (current.workflow?.kind === 'day' && current.workflow.week_plan_id && current.workflow.week_plan_id !== weekPlanId) {
      throw new TraceError(ERR.CONFLICT, '复用日计划已关联另一份周计划')
    }
    const planned: TaskItem[] = output.assigned_tasks.map((task) => ({ id: item.taskIds[task.id], title: task.title,
      status: 'not_started', planned_at: output.target_date! }))
    const present = new Set(current.components.flatMap((component) => component.type === 'task_list'
      ? (component.payload as TaskListPayload).items.map((task) => task.id) : []))
    const metadataCurrent = current.plan_id === item.planId && current.workflow?.kind === 'day' &&
      current.workflow.week_plan_id === weekPlanId
    if (metadataCurrent && planned.every((task) => present.has(task.id))) return
    if (planned.some((task) => present.has(task.id))) throw new TraceError(ERR.CONFLICT, '复用日任务只有部分已写入，请人工核对')
    const updated: PlanDocument = structuredClone(current)
    updated.plan_id = item.planId
    updated.workflow = { kind: 'day', target_date: output.target_date!, week_plan_id: weekPlanId }
    const list = updated.components.find((component) => component.type === 'task_list')
    if (list) (list.payload as TaskListPayload).items.push(...planned)
    else updated.components.push({ id: item.newTaskListId, type: 'task_list', payload: { title: '执行任务', items: planned } })
    await this.storage.savePlan(path, updated, current.updated_at, this.guard(active))
  }

  private async readExistingDay(active: LibrarySnapshot, path: string, date: string): Promise<PlanDocument> {
    const resolved = resolveWithin(active.root, path)
    if (resolved.rel !== path || !path) throw new TraceError(ERR.PATH_UNSAFE, '复用日计划路径无效')
    await assertRealPathWithinRoot(active.root, resolved.abs)
    const existing = await this.repository.readPlan(active.root, path)
    if ((existing.plan_id !== undefined && !isUuid32(existing.plan_id)) ||
      (existing.workflow && (existing.workflow.kind !== 'day' || existing.workflow.target_date !== date))) {
      throw new TraceError(ERR.CONFLICT, '候选计划没有可确认的稳定日计划身份')
    }
    return existing
  }

  private async existingWeekDraft(active: LibrarySnapshot, output: WorkflowPreviewOutput): Promise<WorkflowBatchResult | null> {
    const path = output.relative_path
    if (!path || !output.conflicts.some((conflict) => conflict.code === 'name_exists')) return null
    const resolved = resolveWithin(active.root, path)
    await assertRealPathWithinRoot(active.root, resolved.abs)
    const document = await this.repository.readPlan(active.root, path)
    if (!document.plan_id || !isUuid32(document.plan_id) || document.workflow?.kind !== 'week' ||
      document.workflow.status !== 'draft' || document.workflow.start_date !== output.period?.start_date ||
      document.workflow.end_date !== output.period?.end_date) return null
    return { operation_id: '', status: 'existing_draft', items: [{ output_key: output.key, path,
      status: 'reused', plan_id: document.plan_id }] }
  }

  private confirmationMap(confirmations: WorkflowBatchConfirmation[], outputs: WorkflowPreviewOutput[]): Map<string, WorkflowBatchConfirmation> {
    const keys = new Set(outputs.map((output) => output.key))
    const map = new Map<string, WorkflowBatchConfirmation>()
    for (const item of confirmations) {
      if (!plainRecord(item) || typeof item.output_key !== 'string' || !keys.has(item.output_key) ||
        (item.action !== 'create' && item.action !== 'reuse') || map.has(item.output_key)) {
        throw new TraceError(ERR.VALIDATION, '批次确认项无效或重复')
      }
      map.set(item.output_key, item)
    }
    return map
  }

  private async snapshot(expectedLibraryId: string): Promise<LibrarySnapshot> {
    if (!isUuid32(expectedLibraryId)) throw new TraceError(ERR.VALIDATION, '计划库身份无效')
    const root = this.storage.getRootAbs()
    if (!root) throw new TraceError(ERR.STATE_MACHINE, '请先打开计划库')
    const [meta, rootReal, stat] = await Promise.all([this.repository.readLibraryMeta(root), fs.realpath(root), fs.stat(root)])
    if (meta.library_id !== expectedLibraryId) throw new TraceError(ERR.CONFLICT, '计划库已切换')
    const snapshot = { root, libraryId: expectedLibraryId, rootReal, rootIdentity: `${stat.dev}:${stat.ino}` }
    await this.assertCurrent(snapshot)
    return snapshot
  }

  private async assertCurrent(active: LibrarySnapshot): Promise<void> {
    if (this.storage.getRootAbs() !== active.root) throw new TraceError(ERR.CONFLICT, '计划库已切换')
    const [meta, rootReal, stat] = await Promise.all([this.repository.readLibraryMeta(active.root), fs.realpath(active.root), fs.stat(active.root)])
    if (this.storage.getRootAbs() !== active.root || meta.library_id !== active.libraryId ||
      rootReal !== active.rootReal || `${stat.dev}:${stat.ino}` !== active.rootIdentity) {
      throw new TraceError(ERR.CONFLICT, '计划库身份已变化')
    }
  }

  private guard(active: LibrarySnapshot): AgentLibraryMutationGuard {
    return { rootDirectoryIdentity: active.rootIdentity, rootGeneration: 0,
      assertCurrent: () => this.assertCurrent(active), assertBeforeMutation: () => this.assertCurrent(active) }
  }

  private async saveJournal(active: LibrarySnapshot, journal: BatchJournal): Promise<void> {
    const directory = resolveWithin(active.root, JOURNAL_DIR).abs
    await this.assertCurrent(active)
    await assertRealPathWithinRoot(active.root, resolveWithin(active.root, '.trace').abs)
    try { await fs.mkdir(directory) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    await assertRealPathWithinRoot(active.root, directory)
    const path = resolveWithin(active.root, `${JOURNAL_DIR}/${journal.operation_id}.json`).abs
    await assertRealPathWithinRoot(active.root, path, { allowMissing: true })
    await this.repository.writeJsonAtomic(path, journal, this.guard(active))
  }

  private async readJournal(active: LibrarySnapshot, operationId: string): Promise<BatchJournal> {
    const path = resolveWithin(active.root, `${JOURNAL_DIR}/${operationId}.json`).abs
    await assertRealPathWithinRoot(active.root, path)
    const stat = await fs.lstat(path)
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 1_048_576) throw new TraceError(ERR.FORMAT_INVALID, '批次记录损坏')
    let value: unknown
    try { value = JSON.parse(await fs.readFile(path, 'utf8')) as unknown } catch { throw new TraceError(ERR.FORMAT_INVALID, '批次记录损坏') }
    if (!plainRecord(value) || value.format_version !== '1' || value.operation_id !== operationId ||
      value.library_id !== active.libraryId || value.root_real !== active.rootReal || value.root_identity !== active.rootIdentity ||
      !Array.isArray(value.items) || value.items.length !== 8) throw new TraceError(ERR.CONFLICT, '批次记录与当前计划库不一致')
    for (const item of value.items) {
      if (!plainRecord(item) || !plainRecord(item.output) || typeof item.planId !== 'string' || !isUuid32(item.planId) ||
        (item.action !== 'create' && item.action !== 'reuse') ||
        !['created', 'reused', 'pending', 'failed'].includes(String(item.status))) {
        throw new TraceError(ERR.FORMAT_INVALID, '批次记录项目损坏')
      }
      const output = item.output
      if (typeof output.relative_path !== 'string' || typeof output.destination_path !== 'string' ||
        typeof output.name !== 'string' || !Array.isArray(output.components) || !Array.isArray(output.assigned_tasks) ||
        (output.workflow_kind !== 'week' && output.workflow_kind !== 'day') ||
        typeof output.key !== 'string' || !Array.isArray(output.conflicts) ||
        !plainRecord(item.taskIds) || typeof item.newTaskListId !== 'string' || !isUuid32(item.newTaskListId)) {
        throw new TraceError(ERR.FORMAT_INVALID, '批次目标损坏')
      }
      const relative = resolveWithin(active.root, output.relative_path)
      const destination = resolveWithin(active.root, output.destination_path)
      if (relative.rel !== output.relative_path || destination.rel !== output.destination_path ||
        output.relative_path !== [output.destination_path, output.name].filter(Boolean).join('/')) {
        throw new TraceError(ERR.FORMAT_INVALID, '批次目标路径不一致')
      }
      if (item.action === 'reuse') {
        if (typeof item.existingPath !== 'string' || !item.existingPath ||
          resolveWithin(active.root, item.existingPath).rel !== item.existingPath) {
          throw new TraceError(ERR.FORMAT_INVALID, '批次复用路径损坏')
        }
      }
    }
    return value as unknown as BatchJournal
  }

  private async findJournal(active: LibrarySnapshot, signature: string): Promise<BatchJournal | null> {
    const journals = await this.listJournals(active)
    return journals.find((journal) => journal.input_signature === signature) ?? null
  }

  private async listJournals(active: LibrarySnapshot): Promise<BatchJournal[]> {
    const directory = resolveWithin(active.root, JOURNAL_DIR).abs
    let stat: Awaited<ReturnType<typeof fs.lstat>>
    try { stat = await fs.lstat(directory) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new TraceError(ERR.PATH_UNSAFE, '批次记录目录不安全')
    await assertRealPathWithinRoot(active.root, directory)
    const names = await fs.readdir(directory)
    const result: BatchJournal[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const operationId = name.slice(0, -5)
      if (!JOURNAL_ID.test(operationId)) throw new TraceError(ERR.FORMAT_INVALID, '批次记录文件名无效')
      result.push(await this.readJournal(active, operationId))
    }
    return result
  }

  private result(journal: BatchJournal): WorkflowBatchResult {
    const items: WorkflowBatchItemResult[] = journal.items.map((item) => ({ output_key: item.output.key,
      path: outputPath(item), status: item.status, plan_id: item.planId,
      ...(item.error ? { error: item.error } : {}) }))
    return { operation_id: journal.operation_id, status: items.every((item) => item.status === 'created' || item.status === 'reused')
      ? 'complete' : 'partial', items }
  }
}
