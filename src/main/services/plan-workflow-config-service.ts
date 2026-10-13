import { promises as fs } from 'node:fs'
import { ERR, TraceError } from '../../shared/errors'
import { validateWorkflowNameTemplate } from '../../shared/plan-workflow-naming'
import type {
  PlanWorkflowConfig,
  WorkflowContentComponentTemplate,
  WorkflowContentTemplate,
  WorkflowDestination,
  WorkflowNameRule,
  WorkflowOutput,
  WorkflowPreset,
  WorkflowScope
} from '../../shared/plan-workflow-types'
import { validateNoteText, validatePlanName, validateTitle } from '../../shared/validation'
import { PlanRepository } from './plan-repository'
import { assertRealPathWithinRoot, resolveWithin } from './path-safety'

const CONFIG_REL_PATH = '.trace/plan-workflows.json'
const MAX_CONFIG_BYTES = 1_048_576
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const CONTENT_TYPES = new Set(['heading', 'note', 'task_list', 'plan_reference', 'mood'])

function emptyConfig(): PlanWorkflowConfig {
  return { format_version: '1', name_rules: [], content_templates: [], presets: [] }
}

function invalidStoredConfig(): TraceError {
  return new TraceError(ERR.FORMAT_INVALID, '计划工作流配置损坏，原文件已保留')
}

function reject(message: string): never {
  throw new TraceError(ERR.VALIDATION, message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function requireKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
  const allowed = new Set([...required, ...optional])
  if (required.some((key) => !Object.hasOwn(value, key)) || Object.keys(value).some((key) => !allowed.has(key))) {
    reject('工作流配置含缺失或未知字段')
  }
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) reject(`${label}无效`)
  return value
}

function relativePath(value: unknown, label: string, requireCategory = false): string {
  if (typeof value !== 'string') reject(`${label}必须为文本`)
  if (value.startsWith('/') || value.includes('\\') || /^[A-Za-z]:/.test(value)) {
    throw new TraceError(ERR.PATH_UNSAFE, `${label}必须为标准相对路径`)
  }
  if (value === '') {
    if (requireCategory) reject(`${label}不能为空`)
    return value
  }
  const segments = value.split('/')
  if (segments.some((segment) => segment === '' || segment.startsWith('.'))) {
    throw new TraceError(ERR.PATH_UNSAFE, `${label}包含无效路径段`)
  }
  if (requireCategory && segments.length !== 1) reject(`${label}必须为计划库顶层分类`)
  for (const segment of segments) validatePlanName(segment)
  return value
}

function parseScope(value: unknown, allowDirectory: boolean): WorkflowScope {
  if (!isRecord(value) || typeof value.kind !== 'string') reject('预设作用域无效')
  if (value.kind === 'global') {
    requireKeys(value, ['kind'])
    return { kind: 'global' }
  }
  if (value.kind === 'category') {
    requireKeys(value, ['kind', 'path'])
    return { kind: 'category', path: relativePath(value.path, '分类路径', true) }
  }
  if (allowDirectory && value.kind === 'directory') {
    requireKeys(value, ['kind', 'path'])
    return { kind: 'directory', path: relativePath(value.path, '目录路径') }
  }
  return reject('预设作用域类型无效')
}

function parseDestination(value: unknown): WorkflowDestination {
  if (!isRecord(value) || typeof value.kind !== 'string') reject('生成项目标目录规则无效')
  if (value.kind === 'selected') {
    requireKeys(value, ['kind'])
    return { kind: 'selected' }
  }
  if (value.kind === 'fixed') {
    requireKeys(value, ['kind', 'path'])
    return { kind: 'fixed', path: relativePath(value.path, '目标目录') }
  }
  return reject('生成项目标目录规则无效')
}

function parseComponent(value: unknown): WorkflowContentComponentTemplate {
  if (!isRecord(value)) reject('内容模板组件无效')
  requireKeys(value, ['type', 'title'], ['prompt', 'reference_output_key'])
  if (typeof value.type !== 'string' || !CONTENT_TYPES.has(value.type)) reject('内容模板组件类型无效')
  if (typeof value.title !== 'string') reject('内容模板组件标题无效')
  validateTitle(value.title, '组件标题')
  if (value.prompt !== undefined) {
    if (typeof value.prompt !== 'string') reject('内容模板提示文字无效')
    validateNoteText(value.prompt, '提示文字')
  }
  if (value.type === 'plan_reference') {
    identifier(value.reference_output_key, '引用生成项 ID')
  } else if (value.reference_output_key !== undefined) {
    reject('只有计划引用组件可设置引用生成项')
  }
  return {
    type: value.type as WorkflowContentComponentTemplate['type'],
    title: value.title,
    ...(value.prompt === undefined ? {} : { prompt: value.prompt }),
    ...(value.type === 'plan_reference' ? { reference_output_key: value.reference_output_key as string } : {})
  }
}

export function validateWorkflowContentComponents(value: unknown): WorkflowContentComponentTemplate[] {
  if (!Array.isArray(value) || value.length > 100) reject('内容模板组件列表无效')
  return value.map(parseComponent)
}

function parseContentTemplate(value: unknown): WorkflowContentTemplate {
  if (!isRecord(value)) reject('内容模板无效')
  requireKeys(value, ['id', 'name', 'components'])
  const id = identifier(value.id, '内容模板 ID')
  if (typeof value.name !== 'string') reject('内容模板名称无效')
  validateTitle(value.name, '内容模板名称')
  if (!Array.isArray(value.components)) reject('内容模板组件必须为列表')
  return { id, name: value.name, components: value.components.map(parseComponent) }
}

function parseOutput(value: unknown): WorkflowOutput {
  if (!isRecord(value)) reject('工作流生成项无效')
  requireKeys(value, ['id', 'destination', 'name_template_mode', 'content_template_id', 'repeat'], ['name_template', 'workflow_kind'])
  const id = identifier(value.id, '生成项 ID')
  const destination = parseDestination(value.destination)
  if (value.name_template_mode !== 'explicit' && value.name_template_mode !== 'inherit') {
    reject('命名模板模式无效')
  }
  if (value.name_template_mode === 'explicit') {
    validateWorkflowNameTemplate(value.name_template)
  } else if (value.name_template !== undefined) {
    reject('沿用目录规则时不能另存显式模板')
  }
  if (value.repeat !== 'once' && value.repeat !== 'each_day') reject('生成次数规则无效')
  if (value.workflow_kind !== undefined && value.workflow_kind !== 'regular' && value.workflow_kind !== 'week' && value.workflow_kind !== 'day') {
    reject('生成项工作流类型无效')
  }
  if (value.workflow_kind === 'week' && value.repeat !== 'once') reject('周计划生成项只能生成一次')
  return {
    id,
    destination,
    name_template_mode: value.name_template_mode,
    ...(value.name_template_mode === 'explicit' ? { name_template: value.name_template as string } : {}),
    content_template_id: identifier(value.content_template_id, '内容模板引用'),
    repeat: value.repeat,
    ...(value.workflow_kind === undefined ? {} : { workflow_kind: value.workflow_kind })
  }
}

function parsePreset(value: unknown): WorkflowPreset {
  if (!isRecord(value)) reject('工作流预设无效')
  requireKeys(value, ['id', 'name', 'scope', 'enabled', 'is_default', 'outputs'])
  const id = identifier(value.id, '预设 ID')
  if (typeof value.name !== 'string') reject('预设名称无效')
  validateTitle(value.name, '预设名称')
  if (typeof value.enabled !== 'boolean' || typeof value.is_default !== 'boolean') reject('预设启用状态无效')
  if (!Array.isArray(value.outputs) || value.outputs.length === 0) reject('预设至少需要一个生成项')
  const outputs = value.outputs.map(parseOutput)
  requireUnique(outputs.map((output) => output.id), '同一预设的生成项 ID')
  return { id, name: value.name, scope: parseScope(value.scope, true), enabled: value.enabled, is_default: value.is_default, outputs }
}

function parseNameRule(value: unknown): WorkflowNameRule {
  if (!isRecord(value)) reject('命名规则无效')
  requireKeys(value, ['id', 'scope', 'enabled', 'template'])
  const scope = parseScope(value.scope, false)
  if (scope.kind === 'directory') reject('准确目录名称规则仍由旧配置维护')
  if (typeof value.enabled !== 'boolean') reject('命名规则启用状态无效')
  validateWorkflowNameTemplate(value.template)
  return { id: identifier(value.id, '命名规则 ID'), scope, enabled: value.enabled, template: value.template as string }
}

function requireUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) reject(`${label}重复`)
}

function scopeKey(scope: WorkflowScope): string {
  return scope.kind === 'global' ? 'global' : `${scope.kind}:${scope.path}`
}

export function validatePlanWorkflowConfig(value: unknown): PlanWorkflowConfig {
  if (!isRecord(value)) reject('工作流配置无效')
  requireKeys(value, ['format_version', 'name_rules', 'content_templates', 'presets'])
  if (value.format_version !== '1') reject('不支持的工作流配置版本')
  if (!Array.isArray(value.name_rules) || !Array.isArray(value.content_templates) || !Array.isArray(value.presets)) {
    reject('工作流配置列表无效')
  }
  const nameRules = value.name_rules.map(parseNameRule)
  const contentTemplates = value.content_templates.map(parseContentTemplate)
  const presets = value.presets.map(parsePreset)
  requireUnique(nameRules.map((rule) => rule.id), '命名规则 ID')
  requireUnique(nameRules.map((rule) => scopeKey(rule.scope)), '命名规则作用域')
  requireUnique(contentTemplates.map((template) => template.id), '内容模板 ID')
  requireUnique(presets.map((preset) => preset.id), '预设 ID')
  requireUnique(presets.filter((preset) => preset.is_default).map((preset) => scopeKey(preset.scope)), '默认预设作用域')
  const contentIds = new Set(contentTemplates.map((template) => template.id))
  for (const preset of presets) {
    for (const output of preset.outputs) {
      if (!contentIds.has(output.content_template_id)) reject('生成项引用了不存在的内容模板')
    }
  }
  return { format_version: '1', name_rules: nameRules, content_templates: contentTemplates, presets }
}

export class PlanWorkflowConfigService {
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly repository: PlanRepository) {}

  suggestions(): PlanWorkflowConfig {
    return createWorkflowSuggestions()
  }

  async load(rootAbs: string): Promise<PlanWorkflowConfig> {
    const traceExists = await this.validateTraceDirectory(rootAbs)
    if (!traceExists) return emptyConfig()
    const path = resolveWithin(rootAbs, CONFIG_REL_PATH).abs
    let raw: string
    try {
      const stat = await fs.lstat(path)
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_CONFIG_BYTES) throw invalidStoredConfig()
      await assertRealPathWithinRoot(rootAbs, path)
      raw = await fs.readFile(path, 'utf8')
    } catch (error) {
      if (error instanceof TraceError) throw error
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyConfig()
      throw error
    }
    try {
      return validatePlanWorkflowConfig(JSON.parse(raw) as unknown)
    } catch {
      throw invalidStoredConfig()
    }
  }

  async save(rootAbs: string, input: unknown): Promise<PlanWorkflowConfig> {
    const config = validatePlanWorkflowConfig(input)
    return this.serialize(async () => {
      await this.load(rootAbs)
      await this.validateExistingPaths(rootAbs, config)
      await this.writeConfig(rootAbs, config)
      return config
    })
  }

  async removePreset(rootAbs: string, presetId: string): Promise<PlanWorkflowConfig> {
    identifier(presetId, '预设 ID')
    return this.serialize(async () => {
      const current = await this.load(rootAbs)
      const next: PlanWorkflowConfig = {
        ...current,
        presets: current.presets.filter((preset) => preset.id !== presetId)
      }
      if (next.presets.length === current.presets.length) return current
      await this.writeConfig(rootAbs, next)
      return next
    })
  }

  private async validateExistingPaths(rootAbs: string, config: PlanWorkflowConfig): Promise<void> {
    const paths = new Set<string>()
    for (const rule of config.name_rules) if (rule.scope.kind === 'category') paths.add(rule.scope.path)
    for (const preset of config.presets) {
      if (preset.scope.kind !== 'global') paths.add(preset.scope.path)
      for (const output of preset.outputs) {
        if (output.destination.kind === 'fixed') paths.add(output.destination.path)
      }
    }
    for (const path of paths) {
      const resolved = resolveWithin(rootAbs, path)
      if (resolved.rel !== path) throw new TraceError(ERR.PATH_UNSAFE, '计划目录路径不规范')
      let stat: Awaited<ReturnType<typeof fs.stat>>
      try {
        stat = await fs.stat(resolved.abs)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new TraceError(ERR.PATH_NOT_FOUND, `工作流目录不存在：${path}`)
        }
        throw error
      }
      if (!stat.isDirectory()) throw new TraceError(ERR.PATH_NOT_FOUND, `工作流目录不是文件夹：${path}`)
      await assertRealPathWithinRoot(rootAbs, resolved.abs)
    }
  }

  private async writeConfig(rootAbs: string, config: PlanWorkflowConfig): Promise<void> {
    const traceExists = await this.validateTraceDirectory(rootAbs)
    if (!traceExists) await assertRealPathWithinRoot(rootAbs, rootAbs)
    const path = resolveWithin(rootAbs, CONFIG_REL_PATH).abs
    await this.repository.writeAppJson(path, config)
  }

  private async validateTraceDirectory(rootAbs: string): Promise<boolean> {
    const path = resolveWithin(rootAbs, '.trace').abs
    try {
      const stat = await fs.lstat(path)
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new TraceError(ERR.PATH_UNSAFE, '工作流配置目录路径不安全')
      }
      await assertRealPathWithinRoot(rootAbs, path)
      return true
    } catch (error) {
      if (error instanceof TraceError) throw error
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.writeQueue.then(operation)
    this.writeQueue = current.then(() => undefined, () => undefined)
    return current
  }
}

function createWorkflowSuggestions(): PlanWorkflowConfig {
  const single = (id: string, contentTemplateId: string): WorkflowOutput => ({
    id,
    destination: { kind: 'selected' },
    name_template_mode: 'inherit',
    content_template_id: contentTemplateId,
    repeat: 'once'
  })
  return {
    format_version: '1',
    name_rules: [],
    content_templates: [
      { id: 'basic', name: '当前文件夹计划', components: [{ type: 'heading', title: '目标' }, { type: 'note', title: '目标说明' }, { type: 'task_list', title: '任务' }, { type: 'note', title: '过程记录' }] },
      { id: 'project', name: '项目或功能计划', components: [{ type: 'heading', title: '项目目标' }, { type: 'note', title: '背景与目标' }, { type: 'task_list', title: '阶段任务' }, { type: 'note', title: '完成标准' }, { type: 'note', title: '过程记录' }] },
      { id: 'future', name: '未来计划', components: [{ type: 'heading', title: '未来目标' }, { type: 'note', title: '目标说明' }, { type: 'task_list', title: '下一步' }, { type: 'note', title: '补充记录' }] },
      { id: 'week', name: '周计划', components: [{ type: 'heading', title: '本周目标' }, { type: 'note', title: '七天分配' }, { type: 'note', title: '待分配与交接' }, { type: 'note', title: '周末复盘' }] },
      { id: 'day', name: '日计划', components: [{ type: 'heading', title: '当天重点' }, { type: 'task_list', title: '执行任务' }, { type: 'note', title: '过程记录' }, { type: 'note', title: '收尾复盘' }] }
    ],
    presets: [
      { id: 'current-folder', name: '当前文件夹计划', scope: { kind: 'global' }, enabled: false, is_default: false, outputs: [single('single', 'basic')] },
      { id: 'project', name: '项目或功能计划', scope: { kind: 'category', path: 'Feature_Plan' }, enabled: false, is_default: false, outputs: [single('single', 'project')] },
      { id: 'future', name: '未来计划', scope: { kind: 'category', path: 'Future_Plan' }, enabled: false, is_default: false, outputs: [single('single', 'future')] },
      { id: 'week-and-days', name: '周与日联动', scope: { kind: 'category', path: 'Weekly_Plan' }, enabled: false, is_default: false, outputs: [
        { id: 'week', destination: { kind: 'fixed', path: 'Weekly_Plan' }, name_template_mode: 'explicit', name_template: '{this.folder_name}_{week_start}-{week_end}', content_template_id: 'week', repeat: 'once', workflow_kind: 'week' },
        { id: 'days', destination: { kind: 'fixed', path: 'Daily_Plan' }, name_template_mode: 'explicit', name_template: '{this.folder_name}_{date}', content_template_id: 'day', repeat: 'each_day', workflow_kind: 'day' }
      ] }
    ]
  }
}
