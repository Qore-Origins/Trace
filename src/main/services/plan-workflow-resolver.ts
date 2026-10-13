import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { ERR, TraceError } from '../../shared/errors'
import { renderWorkflowName, type WorkflowNameContext } from '../../shared/plan-workflow-naming'
import type {
  PlanWorkflowConfig,
  WorkflowAssignedTask,
  WorkflowDraftInput,
  WorkflowPeriod,
  WorkflowPreset,
  WorkflowPreview,
  WorkflowPreviewConflict,
  WorkflowPreviewOutput
} from '../../shared/plan-workflow-types'
import { isUuid32, validatePlanName, validateTitle } from '../../shared/validation'
import { PlanNameTemplateService } from './plan-name-template-service'
import { PlanWorkflowConfigService, validateWorkflowContentComponents } from './plan-workflow-config-service'
import { resolveNameRule, resolveWorkflowPreset } from './plan-workflow-rule-service'
import { PlanRepository } from './plan-repository'
import { assertRealPathWithinRoot, resolveWithin } from './path-safety'

const MAX_DAILY_OUTPUTS = 7
const MAX_SEQUENCE_CANDIDATES = 10_000
const DAY_MS = 86_400_000

interface FolderSnapshot {
  names: Set<string>
  signature: string
}

export class PlanWorkflowResolver {
  constructor(
    private readonly repository: PlanRepository,
    private readonly configs: PlanWorkflowConfigService,
    private readonly nameTemplates: PlanNameTemplateService,
    private readonly now: () => Date = () => new Date()
  ) {}

  async previewWorkflow(rootAbs: string, input: WorkflowDraftInput): Promise<WorkflowPreview> {
    input = normalizeDraftInput(input)
    const selectedPath = validateRelativeFolder(input.selected_path)
    await assertExistingFolder(rootAbs, selectedPath)
    const meta = await this.repository.readLibraryMeta(rootAbs)
    if (!isUuid32(meta.library_id)) throw new TraceError(ERR.FORMAT_INVALID, '计划库身份无效')
    const config = await this.configs.load(rootAbs)
    const legacy = await this.nameTemplates.get(rootAbs)
    const createdDate = localDate(this.now())
    const periodDays = input.period ? expandPeriod(input.period) : undefined
    if (input.target_date !== undefined) validateCalendarDate(input.target_date, '目标日期')
    const tasks = validateAssignedTasks(input.tasks ?? [], periodDays)

    let preset: WorkflowPreset | undefined
    let candidates: WorkflowPreview['candidates']
    if (input.preset_id) {
      preset = config.presets.find((item) => item.id === input.preset_id && item.enabled)
      if (!preset) throw new TraceError(ERR.VALIDATION, '选定的工作流预设不存在或已停用')
    } else {
      const match = resolveWorkflowPreset(config, selectedPath)
      if (match.kind === 'matched') preset = match.preset
      if (match.kind === 'candidates') candidates = match.presets.map(({ id, name }) => ({ id, name }))
    }

    const rootReal = await fs.realpath(rootAbs)
    const rootStat = await fs.stat(rootAbs)
    const folders = new Map<string, FolderSnapshot>()
    const weekSnapshots = new Map<string, Array<{ path: string; start: string; end: string; updatedAt: string }>>()
    const outputs: WorkflowPreviewOutput[] = []
    const plannedPaths = new Set<string>()
    if (preset) {
      for (const output of preset.outputs) {
        const dates = output.repeat === 'each_day'
          ? periodDays ?? missingPeriod()
          : [input.target_date]
        for (const targetDate of dates) {
          const key = targetDate && output.repeat === 'each_day'
            ? `${output.id}:${targetDate}`
            : output.id
          const destinationPath = validateRelativeFolder(input.destination_overrides?.[key] ??
            (output.destination.kind === 'selected' ? selectedPath : output.destination.path))
          const folder = await readFolderSnapshot(rootAbs, destinationPath, folders)
          const nameResult = resolveOutputName({
            output,
            input,
            key,
            targetDate,
            destinationPath,
            rootAbs,
            createdDate,
            folder,
            plannedPaths,
            config,
            legacy
          })
          const relativePath = nameResult.name === null
            ? null
            : [destinationPath, nameResult.name].filter(Boolean).join('/')
          const conflicts: WorkflowPreviewConflict[] = [...nameResult.conflicts]
          if (relativePath && folder.names.has(nameResult.name!)) {
            conflicts.push({ code: 'name_exists', message: '同名计划目录已存在', existing_paths: [relativePath] })
          }
          if (relativePath && plannedPaths.has(relativePath)) {
            conflicts.push({ code: 'duplicate_output', message: '本次工作流生成项的目标路径重复' })
          }
          if (relativePath) plannedPaths.add(relativePath)
          if (output.repeat === 'each_day' && targetDate) {
            const candidatesForDate = sameDateCandidates(folder.names, targetDate, nameResult.name)
            if (candidatesForDate.length > 0) {
              conflicts.push({
                code: 'same_date_candidate',
                message: '发现同日期旧计划候选，需要人工确认是否复用',
                existing_paths: candidatesForDate.map((name) => [destinationPath, name].filter(Boolean).join('/'))
              })
            }
          }
          if (output.workflow_kind === 'week' && input.period) {
            let weeks = weekSnapshots.get(destinationPath)
            if (!weeks) {
              weeks = await readWeekSnapshots(rootAbs, destinationPath, this.repository)
              weekSnapshots.set(destinationPath, weeks)
            }
            const overlapping = weeks.filter((week) => week.start <= input.period!.end_date && week.end >= input.period!.start_date)
            if (overlapping.length > 0) conflicts.push({ code: 'period_overlap',
              message: '目标周期与已有周计划重叠', existing_paths: overlapping.map((week) => week.path) })
          }
          const content = config.content_templates.find((template) => template.id === output.content_template_id)
          if (!content) throw new TraceError(ERR.FORMAT_INVALID, '预设引用的内容模板不存在')
          outputs.push({
            key,
            output_id: output.id,
            workflow_kind: output.workflow_kind ?? 'regular',
            destination_path: destinationPath,
            name: nameResult.name,
            relative_path: relativePath,
            name_rule_source: nameResult.source,
            ...(targetDate ? { target_date: targetDate } : {}),
            ...(input.period && output.repeat === 'once' ? { period: input.period } : {}),
            components: input.component_overrides?.[key] ?? content.components.map((component) => ({ ...component })),
            assigned_tasks: tasksForOutput(tasks, targetDate, output.repeat === 'each_day', input.period !== undefined),
            conflicts
          })
        }
      }
    }
    const outputKeys = new Set(outputs.map((output) => output.key))
    for (const key of [...Object.keys(input.manual_names ?? {}), ...Object.keys(input.destination_overrides ?? {}), ...Object.keys(input.component_overrides ?? {})]) {
      if (!outputKeys.has(key)) throw new TraceError(ERR.VALIDATION, '预览修改项不对应当前生成项')
    }

    const revisionToken = createHash('sha256').update(JSON.stringify({
      libraryId: meta.library_id,
      rootReal,
      rootIdentity: [rootStat.dev, rootStat.ino],
      createdDate,
      selectedPath,
      input,
      config,
      legacy,
      folders: [...folders.entries()].map(([path, folder]) => [path, folder.signature]),
      weekSnapshots: [...weekSnapshots.entries()],
      outputs: outputs.map(({ relative_path, conflicts }) => ({ relative_path, conflicts }))
    })).digest('hex')
    return {
      state: preset ? 'ready' : candidates ? 'candidates' : 'none',
      library_id: meta.library_id,
      ...(preset ? { preset_id: preset.id } : {}),
      ...(candidates ? { candidates } : {}),
      outputs,
      revision_token: revisionToken
    }
  }
}

async function readWeekSnapshots(rootAbs: string, destinationPath: string, repository: PlanRepository): Promise<Array<{
  path: string; start: string; end: string; updatedAt: string
}>> {
  const snapshots: Array<{ path: string; start: string; end: string; updatedAt: string }> = []
  for (const name of await repository.listPlanDirs(rootAbs, destinationPath)) {
    const path = [destinationPath, name].filter(Boolean).join('/')
    await assertRealPathWithinRoot(rootAbs, resolveWithin(rootAbs, path).abs)
    let document: Awaited<ReturnType<PlanRepository['readPlan']>>
    try { document = await repository.readPlan(rootAbs, path) } catch (error) {
      if (error instanceof TraceError && error.code === ERR.PATH_NOT_FOUND) continue
      throw error
    }
    if (document.workflow?.kind === 'week') snapshots.push({ path, start: document.workflow.start_date,
      end: document.workflow.end_date, updatedAt: document.updated_at })
  }
  return snapshots
}

type NameResolution = {
  name: string | null
  source: WorkflowPreviewOutput['name_rule_source']
  conflicts: WorkflowPreviewConflict[]
}

function resolveOutputName(args: {
  output: WorkflowPreset['outputs'][number]
  input: WorkflowDraftInput
  key: string
  targetDate: string | undefined
  destinationPath: string
  rootAbs: string
  createdDate: string
  folder: FolderSnapshot
  plannedPaths: Set<string>
  config: PlanWorkflowConfig
  legacy: Awaited<ReturnType<PlanNameTemplateService['get']>>
}): NameResolution {
  const { output, input, key, targetDate, destinationPath, rootAbs, createdDate, folder, plannedPaths, config, legacy } = args
  if (input.manual_names && Object.hasOwn(input.manual_names, key)) {
    const manualName = input.manual_names[key]
    if (!manualName) return { name: null, source: 'manual', conflicts: [{ code: 'missing_name', message: '需要输入完整计划名称' }] }
    validatePlanName(manualName)
    return { name: manualName, source: 'manual', conflicts: [] }
  }
  const inherited = output.name_template_mode === 'inherit'
    ? resolveNameRule(config, legacy, destinationPath)
    : undefined
  const template = output.name_template_mode === 'explicit' ? output.name_template : inherited?.template
  const source: NameResolution['source'] = template && !inherited ? 'preset' : inherited?.source ?? 'manual'
  if (!template) {
    const manualName = input.manual_names?.[key] ?? input.title
    if (!manualName) {
      return { name: null, source: 'manual', conflicts: [{ code: 'missing_name', message: '需要输入完整计划名称' }] }
    }
    validatePlanName(manualName)
    return { name: manualName, source: 'manual', conflicts: [] }
  }

  const context: WorkflowNameContext = {
    libraryRoot: rootAbs,
    destinationPath,
    createdDate,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(targetDate !== undefined ? { targetDate } : {}),
    ...(input.period ? { weekStart: input.period.start_date, weekEnd: input.period.end_date } : {})
  }
  try {
    if (!template.includes('{sequence}')) {
      return { name: renderWorkflowName(template, context), source, conflicts: [] }
    }
    for (let sequence = 1; sequence <= MAX_SEQUENCE_CANDIDATES; sequence += 1) {
      const name = renderWorkflowName(template, { ...context, sequence })
      const relativePath = [destinationPath, name].filter(Boolean).join('/')
      if (!folder.names.has(name) && !plannedPaths.has(relativePath)) {
        return { name, source, conflicts: [] }
      }
    }
    throw new TraceError(ERR.NAME_CONFLICT, '目标目录的可用序号已耗尽')
  } catch (error) {
    if (error instanceof TraceError && error.code === ERR.VALIDATION && error.message.includes('缺少必要输入')) {
      return { name: null, source, conflicts: [{ code: 'missing_name', message: error.message }] }
    }
    throw error
  }
}

function tasksForOutput(
  tasks: WorkflowAssignedTask[],
  targetDate: string | undefined,
  eachDay: boolean,
  hasPeriod: boolean
): WorkflowAssignedTask[] {
  if (eachDay) return tasks.filter((task) => task.target_date === targetDate).map((task) => ({ ...task }))
  if (hasPeriod) return tasks.filter((task) => task.target_date === undefined).map((task) => ({ ...task }))
  return tasks.map((task) => ({ ...task }))
}

function validateAssignedTasks(tasks: WorkflowAssignedTask[], periodDays?: string[]): WorkflowAssignedTask[] {
  if (!Array.isArray(tasks)) throw new TraceError(ERR.VALIDATION, '任务分配必须为列表')
  const ids = new Set<string>()
  return tasks.map((task) => {
    if (!task || typeof task !== 'object' || typeof task.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(task.id)) {
      throw new TraceError(ERR.VALIDATION, '任务分配 ID 无效')
    }
    if (ids.has(task.id)) throw new TraceError(ERR.VALIDATION, '任务分配 ID 重复')
    ids.add(task.id)
    if (typeof task.title !== 'string') throw new TraceError(ERR.VALIDATION, '任务标题必须为文本')
    validateTitle(task.title, '任务标题')
    if (task.target_date !== undefined) {
      validateCalendarDate(task.target_date, '任务目标日期')
      if (periodDays && !periodDays.includes(task.target_date)) {
        throw new TraceError(ERR.VALIDATION, '任务日期不在本次周期内')
      }
    }
    return {
      id: task.id,
      title: task.title,
      ...(task.target_date === undefined ? {} : { target_date: task.target_date })
    }
  })
}

function normalizeDraftInput(input: WorkflowDraftInput): WorkflowDraftInput {
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.selected_path !== 'string') {
    throw new TraceError(ERR.VALIDATION, '工作流预览输入无效')
  }
  if (input.preset_id !== undefined && (typeof input.preset_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(input.preset_id))) {
    throw new TraceError(ERR.VALIDATION, '预设 ID 无效')
  }
  if (input.title !== undefined && typeof input.title !== 'string') {
    throw new TraceError(ERR.VALIDATION, '计划标题必须为文本')
  }
  if (input.target_date !== undefined && typeof input.target_date !== 'string') {
    throw new TraceError(ERR.VALIDATION, '目标日期必须为文本')
  }
  if (input.period !== undefined && (
    !input.period || typeof input.period !== 'object' ||
    typeof input.period.start_date !== 'string' || typeof input.period.end_date !== 'string'
  )) {
    throw new TraceError(ERR.VALIDATION, '计划周期无效')
  }
  if (input.manual_names !== undefined && (
    !input.manual_names || typeof input.manual_names !== 'object' || Array.isArray(input.manual_names) ||
    Object.values(input.manual_names).some((name) => typeof name !== 'string')
  )) {
    throw new TraceError(ERR.VALIDATION, '手动名称列表无效')
  }
  if (input.destination_overrides !== undefined && (
    !input.destination_overrides || typeof input.destination_overrides !== 'object' || Array.isArray(input.destination_overrides) ||
    Object.values(input.destination_overrides).some((path) => typeof path !== 'string')
  )) throw new TraceError(ERR.VALIDATION, '目标目录修改列表无效')
  if (input.component_overrides !== undefined && (
    !input.component_overrides || typeof input.component_overrides !== 'object' || Array.isArray(input.component_overrides)
  )) throw new TraceError(ERR.VALIDATION, '组件修改列表无效')
  const componentOverrides = input.component_overrides === undefined ? undefined : Object.fromEntries(
    Object.entries(input.component_overrides).map(([key, value]) => [key, validateWorkflowContentComponents(value)])
  )
  if (input.tasks !== undefined && !Array.isArray(input.tasks)) {
    throw new TraceError(ERR.VALIDATION, '任务分配必须为列表')
  }
  const title = input.title?.trim() ? input.title : undefined
  if (title !== undefined) validateTitle(title, '计划标题')
  const targetDate = input.target_date === '' ? undefined : input.target_date
  return {
    selected_path: input.selected_path,
    ...(input.preset_id ? { preset_id: input.preset_id } : {}),
    ...(title ? { title } : {}),
    ...(targetDate ? { target_date: targetDate } : {}),
    ...(input.period ? { period: { start_date: input.period.start_date, end_date: input.period.end_date } } : {}),
    ...(input.manual_names ? { manual_names: { ...input.manual_names } } : {}),
    ...(input.destination_overrides ? { destination_overrides: { ...input.destination_overrides } } : {}),
    ...(componentOverrides ? { component_overrides: componentOverrides } : {}),
    ...(input.tasks ? { tasks: input.tasks } : {})
  }
}

function sameDateCandidates(names: Set<string>, date: string, finalName: string | null): string[] {
  const compact = date.replaceAll('-', '')
  return [...names].filter((name) => name !== finalName && (name.includes(compact) || name.includes(date))).sort()
}

async function readFolderSnapshot(rootAbs: string, rel: string, cache: Map<string, FolderSnapshot>): Promise<FolderSnapshot> {
  const prior = cache.get(rel)
  if (prior) return prior
  const abs = await assertExistingFolder(rootAbs, rel)
  const [entries, stat] = await Promise.all([fs.readdir(abs, { withFileTypes: true }), fs.stat(abs)])
  const names = entries.map((entry) => entry.name).sort()
  const snapshot = { names: new Set(names), signature: JSON.stringify([stat.dev, stat.ino, stat.mtimeMs, names]) }
  cache.set(rel, snapshot)
  return snapshot
}

async function assertExistingFolder(rootAbs: string, rel: string): Promise<string> {
  const abs = resolveWithin(rootAbs, rel).abs
  try {
    const stat = await fs.stat(abs)
    if (!stat.isDirectory()) throw new TraceError(ERR.PATH_NOT_FOUND, '工作流目标目录不是文件夹')
  } catch (error) {
    if (error instanceof TraceError) throw error
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new TraceError(ERR.PATH_NOT_FOUND, '工作流目标目录不存在')
    }
    throw error
  }
  await assertRealPathWithinRoot(rootAbs, abs)
  return abs
}

function validateRelativeFolder(value: string): string {
  if (typeof value !== 'string' || value.startsWith('/') || value.includes('\\') || /^[A-Za-z]:/.test(value)) {
    throw new TraceError(ERR.PATH_UNSAFE, '工作流目录必须为标准相对路径')
  }
  if (value !== '') {
    const segments = value.split('/')
    if (segments.some((segment) => segment === '' || segment.startsWith('.'))) {
      throw new TraceError(ERR.PATH_UNSAFE, '工作流目录包含无效路径段')
    }
    for (const segment of segments) validatePlanName(segment)
  }
  return value
}

function missingPeriod(): never {
  throw new TraceError(ERR.VALIDATION, '逐日生成需要明确的起止日期')
}

function expandPeriod(period: WorkflowPeriod): string[] {
  if (!period || typeof period !== 'object') throw new TraceError(ERR.VALIDATION, '周期无效')
  const start = validateCalendarDate(period.start_date, '周期起始日')
  const end = validateCalendarDate(period.end_date, '周期结束日')
  const count = Math.round((end - start) / DAY_MS) + 1
  if (count < 1 || count > MAX_DAILY_OUTPUTS) {
    throw new TraceError(ERR.VALIDATION, '逐日生成周期必须为连续一至七天')
  }
  return Array.from({ length: count }, (_unused, index) => new Date(start + index * DAY_MS).toISOString().slice(0, 10))
}

function validateCalendarDate(value: string, label: string): number {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) {
    throw new TraceError(ERR.VALIDATION, `${label}格式无效`)
  }
  const [year, month, day] = value.split('-').map(Number)
  const timestamp = Date.UTC(year, month - 1, day)
  if (new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new TraceError(ERR.VALIDATION, `${label}不是有效日历日期`)
  }
  return timestamp
}

function localDate(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TraceError(ERR.VALIDATION, '创建日期无效')
  }
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}
