import { promises as fs } from 'node:fs'
import { ERR, TraceError } from '../../shared/errors'
import type { PlanTreeNode } from '../../shared/ipc-contract'
import type { PlanWorkflowConfig, WorkflowCommitRequest, WorkflowLibraryState, WorkflowPeriod, WorkflowPeriodSuggestionRequest, WorkflowPreview, WorkflowPreviewRequest } from '../../shared/plan-workflow-types'
import { isUuid32, uuid32 } from '../../shared/validation'
import { compileWorkflowDocument } from './plan-workflow-content'
import { PlanWorkflowConfigService } from './plan-workflow-config-service'
import { PlanWorkflowResolver } from './plan-workflow-resolver'
import { resolveWorkflowPreset } from './plan-workflow-rule-service'
import { PlanRepository, type AgentLibraryMutationGuard } from './plan-repository'
import { assertRealPathWithinRoot, resolveWithin } from './path-safety'
import { StorageService } from './storage-service'

interface ActiveLibrary {
  root: string
  libraryId: string
  rootRealPath: string
  rootIdentity: string
}

const DAY_MS = 86_400_000
const WEEK_LAST_DAY_OFFSET = 6

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
}

export class PlanWorkflowService {
  constructor(
    private readonly storage: StorageService,
    private readonly repository: PlanRepository,
    private readonly configs: PlanWorkflowConfigService,
    private readonly resolver: PlanWorkflowResolver
  ) {}

  async list(): Promise<WorkflowLibraryState> {
    const active = await this.activeLibrary()
    const config = await this.configs.load(active.root)
    await this.assertActive(active)
    return { library_id: active.libraryId, config, suggestions: this.configs.suggestions() }
  }

  async save(libraryId: string, input: unknown): Promise<PlanWorkflowConfig> {
    const active = await this.activeLibrary(libraryId)
    const saved = await this.configs.save(active.root, input)
    await this.assertActive(active)
    return saved
  }

  async remove(libraryId: string, presetId: string): Promise<PlanWorkflowConfig> {
    const active = await this.activeLibrary(libraryId)
    const saved = await this.configs.removePreset(active.root, presetId)
    await this.assertActive(active)
    return saved
  }

  async preview(input: WorkflowPreviewRequest): Promise<WorkflowPreview> {
    if (!exactKeys(input, ['library_id', 'draft'])) {
      throw new TraceError(ERR.VALIDATION, '工作流预览请求无效')
    }
    const active = await this.activeLibrary(input.library_id)
    const preview = await this.resolver.previewWorkflow(active.root, input.draft)
    await this.assertActive(active)
    return preview
  }

  async suggestPeriod(input: WorkflowPeriodSuggestionRequest): Promise<WorkflowPeriod | null> {
    if (!exactKeys(input, ['library_id', 'selected_path']) || typeof input.selected_path !== 'string') {
      throw new TraceError(ERR.VALIDATION, '周计划周期建议请求无效')
    }
    const active = await this.activeLibrary(input.library_id)
    const selected = resolveWithin(active.root, input.selected_path)
    if (selected.rel !== input.selected_path) throw new TraceError(ERR.PATH_UNSAFE, '所选目录路径不规范')
    await assertRealPathWithinRoot(active.root, selected.abs)
    const config = await this.configs.load(active.root)
    const match = resolveWorkflowPreset(config, selected.rel)
    if (match.kind !== 'matched') return null
    const weekOutput = match.preset.outputs.find((output) => output.workflow_kind === 'week')
    if (!weekOutput) return null
    const weekPath = weekOutput.destination.kind === 'fixed' ? weekOutput.destination.path : selected.rel
    const directory = resolveWithin(active.root, weekPath)
    await assertRealPathWithinRoot(active.root, directory.abs)
    let latestEnd: string | null = null
    for (const name of await this.repository.listPlanDirs(active.root, weekPath)) {
      const path = [weekPath, name].filter(Boolean).join('/')
      let document: Awaited<ReturnType<PlanRepository['readPlan']>>
      try { document = await this.repository.readPlan(active.root, path) } catch (error) {
        if (error instanceof TraceError && error.code === ERR.PATH_NOT_FOUND) continue
        throw error
      }
      if (document.workflow?.kind === 'week' && (!latestEnd || document.workflow.end_date > latestEnd)) {
        latestEnd = document.workflow.end_date
      }
    }
    await this.assertActive(active)
    if (!latestEnd) return null
    const start = new Date(Date.parse(`${latestEnd}T00:00:00Z`) + DAY_MS)
    const end = new Date(start.getTime() + WEEK_LAST_DAY_OFFSET * DAY_MS)
    return { start_date: start.toISOString().slice(0, 10), end_date: end.toISOString().slice(0, 10) }
  }

  async commit(input: WorkflowCommitRequest): Promise<PlanTreeNode> {
    if (!exactKeys(input, ['library_id', 'draft', 'revision_token']) ||
      typeof input.revision_token !== 'string' || !/^[a-f0-9]{64}$/.test(input.revision_token)) {
      throw new TraceError(ERR.VALIDATION, '工作流提交请求无效')
    }
    const active = await this.activeLibrary(input.library_id)
    const preview = await this.resolver.previewWorkflow(active.root, input.draft)
    await this.assertActive(active)
    if (preview.revision_token !== input.revision_token) {
      throw new TraceError(ERR.CONFLICT, '工作流预览已过期，请刷新后再创建')
    }
    if (preview.state !== 'ready' || preview.outputs.length !== 1 || !preview.preset_id) {
      throw new TraceError(ERR.VALIDATION, '请选择单计划工作流预设并完成预览')
    }
    const output = preview.outputs[0]
    if (output.conflicts.length > 0 || output.name === null || output.relative_path === null) {
      throw new TraceError(ERR.CONFLICT, '目标计划存在冲突，请刷新预览并处理')
    }
    if (output.workflow_kind === 'week') {
      throw new TraceError(ERR.VALIDATION, '周计划需要通过周日联动批次创建')
    }
    const document = compileWorkflowDocument(output, {
      planId: uuid32(),
      ...(output.workflow_kind === 'day'
        ? { workflow: { kind: 'day' as const, target_date: output.target_date ?? '' } }
        : {})
    })
    const guard = this.mutationGuard(active)
    await guard.assertCurrent()
    return this.storage.createPlanDocument(output.destination_path, output.name, document, guard)
  }

  private async activeLibrary(expectedId?: string): Promise<ActiveLibrary> {
    if (expectedId !== undefined && !isUuid32(expectedId)) {
      throw new TraceError(ERR.VALIDATION, '计划库身份无效')
    }
    const root = this.storage.getRootAbs()
    if (!root) throw new TraceError(ERR.STATE_MACHINE, '请先打开计划库')
    const [library, rootRealPath, stat] = await Promise.all([
      this.repository.readLibraryMeta(root), fs.realpath(root), fs.stat(root)
    ])
    if (!isUuid32(library.library_id)) throw new TraceError(ERR.FORMAT_INVALID, '计划库身份无效')
    if (expectedId !== undefined && library.library_id !== expectedId) {
      throw new TraceError(ERR.CONFLICT, '计划库已切换，请重新预览')
    }
    const active = {
      root, libraryId: library.library_id, rootRealPath,
      rootIdentity: `${stat.dev}:${stat.ino}`
    }
    await this.assertActive(active)
    return active
  }

  private async assertActive(active: ActiveLibrary): Promise<void> {
    if (this.storage.getRootAbs() !== active.root) {
      throw new TraceError(ERR.CONFLICT, '计划库已切换，请重新预览')
    }
    const [library, rootRealPath, stat] = await Promise.all([
      this.repository.readLibraryMeta(active.root), fs.realpath(active.root), fs.stat(active.root)
    ])
    if (this.storage.getRootAbs() !== active.root || library.library_id !== active.libraryId ||
      rootRealPath !== active.rootRealPath || `${stat.dev}:${stat.ino}` !== active.rootIdentity) {
      throw new TraceError(ERR.CONFLICT, '计划库身份已变化，请重新预览')
    }
  }

  private mutationGuard(active: ActiveLibrary): AgentLibraryMutationGuard {
    return {
      rootDirectoryIdentity: active.rootIdentity,
      rootGeneration: 0,
      assertCurrent: () => this.assertActive(active),
      assertBeforeMutation: () => this.assertActive(active)
    }
  }
}
