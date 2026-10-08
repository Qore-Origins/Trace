import { AGENT_MAX_TOOL_CALLS_PER_REQUEST, type AgentChatToolCall, type AgentCompletedToolCall } from '../../shared/agent-types'
import type { ComponentType, TaskStatus } from '../../shared/plan-types'
import { ERR, TraceError } from '../../shared/errors'
import { isUuid32, validateDueDate, validateNoteText, validatePlanName, validateScore, validateTitle } from '../../shared/validation'
import type { AgentProviderTool } from './agent-provider'

const MAX_ARGUMENT_BYTES = 128 * 1024
const MAX_COMPONENT_TEXT = 20_000
const MAX_TITLE = 200
const MAX_REF_LENGTH = 128
const MAX_CALL_ID_LENGTH = 256
const TOOL_CALL_ID = /^[A-Za-z0-9_-]{1,256}$/
const TARGET_REF = /^[A-Za-z0-9_-]{32,128}$/
const PLAN_REVISION = /^sha256:[0-9a-f]{64}$/
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const TASK_STATUSES = new Set<TaskStatus>(['not_started', 'in_progress', 'done'])
const COMPONENT_TYPES = new Set<Exclude<ComponentType, 'plan_reference'>>([
  'single_plan', 'multi_plan', 'task_list', 'task_detail', 'note', 'mood', 'heading', 'custom'
])

type JsonRecord = Record<string, unknown>
type ComponentWriteType = Exclude<ComponentType, 'plan_reference'>

export type AgentToolName =
  | 'plan.list_children' | 'plan.read' | 'plan.create' | 'folder.create'
  | 'component.add' | 'component.update' | 'component.delete'
  | 'task.add' | 'task.update' | 'task.delete'
  | 'multi_option.add' | 'multi_option.update' | 'multi_option.delete'
  | 'plan.rename' | 'folder.rename' | 'plan.move' | 'folder.move'
  | 'plan.trash' | 'folder.trash' | 'trash.list' | 'trash.restore' | 'trash.purge'

const stringSchema = (maxLength: number, minLength = 0) => ({ type: 'string', minLength, maxLength })
const refSchema = () => stringSchema(MAX_REF_LENGTH, 32)
const revisionSchema = () => ({ type: 'string', minLength: 71, maxLength: 71 })
const dateSchema = () => ({ type: 'string', minLength: 10, maxLength: 10 })
const nullableScoreSchema = () => ({ type: ['number', 'null'], minimum: 0, maximum: 100 })
const enumSchema = (values: readonly string[]) => ({ type: 'string', enum: [...values] })
const objectSchema = (properties: Record<string, Record<string, unknown>>, required: string[] = []) => ({
  type: 'object', properties, required, additionalProperties: false
})
const arraySchema = (items: Record<string, unknown>, maxItems: number) => ({ type: 'array', items, minItems: 1, maxItems, additionalItems: false })

const editablePayloadProperties: Record<string, Record<string, unknown>> = {
  title: stringSchema(MAX_TITLE, 1), done: { type: 'boolean' }, summary: stringSchema(MAX_COMPONENT_TEXT),
  due_date: dateSchema(), description: stringSchema(MAX_COMPONENT_TEXT), planned_at: dateSchema(),
  status: enumSchema(['not_started', 'in_progress', 'done']), note: stringSchema(MAX_COMPONENT_TEXT),
  content: stringSchema(MAX_COMPONENT_TEXT, 1), score: nullableScoreSchema(),
  text: stringSchema(MAX_COMPONENT_TEXT), mood_date: dateSchema(), size: { type: 'integer', minimum: 14, maximum: 32 },
  source: stringSchema(MAX_COMPONENT_TEXT), remark: stringSchema(MAX_COMPONENT_TEXT)
}
const componentPayloadSchema = objectSchema(editablePayloadProperties)
const componentPatchSchema = objectSchema(editablePayloadProperties)
const componentClearFields = ['summary', 'due_date', 'description', 'planned_at', 'note', 'source', 'remark'] as const
const componentTypeValues = [...COMPONENT_TYPES]

function tool(name: AgentToolName, description: string, properties: Record<string, Record<string, unknown>>, required: string[]): AgentProviderTool {
  return { type: 'function', function: { name, description, parameters: objectSchema(properties, required) } }
}

const TOOLS: readonly AgentProviderTool[] = [
  tool('plan.list_children', '列出用户已授权文件夹的直接子项，不递归。', { folder_ref: refSchema() }, ['folder_ref']),
  tool('plan.read', '读取用户已授权计划的结构化组件；未知旧组件只读保留。', { plan_ref: refSchema() }, ['plan_ref']),
  tool('plan.create', '在根目录或指定文件夹创建计划；只提供名称后缀，完整名称由模板生成。', { parent_ref: refSchema(), name_part: stringSchema(MAX_TITLE, 1) }, ['name_part']),
  tool('folder.create', '在根目录或指定文件夹创建空文件夹。', { parent_ref: refSchema(), name: stringSchema(MAX_TITLE, 1) }, ['name']),
  tool('component.add', '向计划追加一个支持的非引用组件；ID 与系统时间由 Trace 生成。', {
    plan_ref: refSchema(), expected_updated_at: stringSchema(64, 24), type: enumSchema(componentTypeValues),
    payload: componentPayloadSchema, remark: stringSchema(MAX_COMPONENT_TEXT)
  }, ['plan_ref', 'expected_updated_at', 'type', 'payload']),
  tool('component.update', '更新一个已知非引用组件的明确字段；通过 clear_fields 清空可选字段。', {
    plan_ref: refSchema(), component_id: stringSchema(32, 32), expected_updated_at: stringSchema(64, 24),
    patch: componentPatchSchema, clear_fields: arraySchema(enumSchema(componentClearFields), componentClearFields.length)
  }, ['plan_ref', 'component_id', 'expected_updated_at']),
  tool('component.delete', '删除一个明确指定的已知非引用组件；关联影响必须先预览。', {
    plan_ref: refSchema(), component_id: stringSchema(32, 32), expected_updated_at: stringSchema(64, 24)
  }, ['plan_ref', 'component_id', 'expected_updated_at']),
  tool('task.add', '向 task_list 追加一项任务；ID、状态与完成时间由 Trace 管理。', {
    plan_ref: refSchema(), list_component_id: stringSchema(32, 32), expected_updated_at: stringSchema(64, 24),
    title: stringSchema(MAX_TITLE, 1), planned_at: dateSchema(), note: stringSchema(MAX_COMPONENT_TEXT)
  }, ['plan_ref', 'list_component_id', 'expected_updated_at', 'title']),
  tool('task.update', '更新 task_list 中一条明确任务；完成时间由任务状态机维护。', {
    plan_ref: refSchema(), list_component_id: stringSchema(32, 32), task_id: stringSchema(32, 32),
    expected_updated_at: stringSchema(64, 24),
    patch: objectSchema({ title: stringSchema(MAX_TITLE, 1), status: enumSchema(['not_started', 'in_progress', 'done']), planned_at: dateSchema(), note: stringSchema(MAX_COMPONENT_TEXT) }),
    clear_fields: arraySchema(enumSchema(['planned_at', 'note']), 2)
  }, ['plan_ref', 'list_component_id', 'task_id', 'expected_updated_at']),
  tool('task.delete', '删除 task_list 中一条明确任务。', {
    plan_ref: refSchema(), list_component_id: stringSchema(32, 32), task_id: stringSchema(32, 32), expected_updated_at: stringSchema(64, 24)
  }, ['plan_ref', 'list_component_id', 'task_id', 'expected_updated_at']),
  tool('multi_option.add', '向 multi_plan 追加一个选项；ID 由 Trace 生成。', {
    plan_ref: refSchema(), component_id: stringSchema(32, 32), expected_updated_at: stringSchema(64, 24), text: stringSchema(MAX_COMPONENT_TEXT, 1)
  }, ['plan_ref', 'component_id', 'expected_updated_at', 'text']),
  tool('multi_option.update', '更新 multi_plan 中一条明确选项。', {
    plan_ref: refSchema(), component_id: stringSchema(32, 32), option_id: stringSchema(32, 32), expected_updated_at: stringSchema(64, 24),
    text: stringSchema(MAX_COMPONENT_TEXT, 1), checked: { type: 'boolean' }
  }, ['plan_ref', 'component_id', 'option_id', 'expected_updated_at']),
  tool('multi_option.delete', '删除 multi_plan 中一条明确选项。', {
    plan_ref: refSchema(), component_id: stringSchema(32, 32), option_id: stringSchema(32, 32), expected_updated_at: stringSchema(64, 24)
  }, ['plan_ref', 'component_id', 'option_id', 'expected_updated_at']),
  tool('plan.rename', '重命名计划；变更经过引用影响预览与并发复核。', {
    target_ref: refSchema(), expected_revision: revisionSchema(), new_name: stringSchema(255, 1)
  }, ['target_ref', 'expected_revision', 'new_name']),
  tool('folder.rename', '重命名文件夹；计划子树的引用影响由 Trace 处理。', {
    target_ref: refSchema(), expected_revision: revisionSchema(), new_name: stringSchema(255, 1)
  }, ['target_ref', 'expected_revision', 'new_name']),
  tool('plan.move', '移动计划到用户已授权父文件夹；变更需冻结预览。', {
    target_ref: refSchema(), expected_revision: revisionSchema(), parent_ref: refSchema()
  }, ['target_ref', 'expected_revision', 'parent_ref']),
  tool('folder.move', '移动文件夹到用户已授权父文件夹；变更需冻结预览。', {
    target_ref: refSchema(), expected_revision: revisionSchema(), parent_ref: refSchema()
  }, ['target_ref', 'expected_revision', 'parent_ref']),
  tool('plan.trash', '将计划移入本库回收站；引用影响须逐条决定。', { target_ref: refSchema(), expected_revision: revisionSchema() }, ['target_ref', 'expected_revision']),
  tool('folder.trash', '将文件夹及其子树移入本库回收站；引用影响须逐条决定。', { target_ref: refSchema(), expected_revision: revisionSchema() }, ['target_ref', 'expected_revision']),
  tool('trash.list', '只读返回本条消息明确授权的一个回收站条目；不会枚举整个回收站，也不授权恢复或清除。', { trash_entry_ref: refSchema() }, ['trash_entry_ref']),
  tool('trash.restore', '恢复已显式授权的回收站条目；冲突时必须由用户指定新位置或名称。', {
    trash_entry_ref: refSchema(), manifest_revision: { type: 'integer', minimum: 1 },
    destination_parent_ref: refSchema(), new_name: stringSchema(255, 1)
  }, ['trash_entry_ref', 'manifest_revision']),
  tool('trash.purge', '永久清除一个明确回收站条目；始终需要二次强确认。', {
    trash_entry_ref: refSchema(), manifest_revision: { type: 'integer', minimum: 1 }
  }, ['trash_entry_ref', 'manifest_revision'])
]

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function assertExactKeys(value: unknown, required: readonly string[], optional: readonly string[] = []): asserts value is JsonRecord {
  if (!isRecord(value)) throw invalidArguments()
  const keys = Reflect.ownKeys(value)
  const allowed = new Set([...required, ...optional])
  if (keys.length < required.length || keys.length > required.length + optional.length ||
    keys.some((key) => typeof key !== 'string' || !allowed.has(key)) || required.some((key) => !Object.hasOwn(value, key))) {
    throw invalidArguments()
  }
}

function invalidArguments(): TraceError {
  return new TraceError(ERR.VALIDATION, '小沅工具参数无效或超出允许范围')
}

function assertString(value: unknown, maxLength: number, minLength = 0): asserts value is string {
  if (typeof value !== 'string' || value.length < minLength || value.length > maxLength) throw invalidArguments()
}

function assertRef(value: unknown): asserts value is string {
  assertString(value, MAX_REF_LENGTH, 32)
  if (!TARGET_REF.test(value)) throw invalidArguments()
}

function assertUuid(value: unknown): asserts value is string {
  assertString(value, 32, 32)
  if (!isUuid32(value)) throw invalidArguments()
}

function assertUpdatedAt(value: unknown): asserts value is string {
  assertString(value, 64, 24)
  if (!ISO_TIMESTAMP.test(value) || !Number.isFinite(Date.parse(value))) throw invalidArguments()
}

function assertRevision(value: unknown): asserts value is string {
  assertString(value, 71, 71)
  if (!PLAN_REVISION.test(value)) throw invalidArguments()
}

function assertDate(value: unknown): asserts value is string {
  validateDueDate(value)
}

function assertText(value: unknown, allowEmpty = true): asserts value is string {
  assertString(value, MAX_COMPONENT_TEXT, allowEmpty ? 0 : 1)
  validateNoteText(value)
}

function assertTitle(value: unknown): asserts value is string {
  assertString(value, MAX_TITLE, 1)
  validateTitle(value)
}

function assertPlanName(value: unknown): asserts value is string {
  assertString(value, 255, 1)
  validatePlanName(value)
}

function assertStatus(value: unknown): asserts value is TaskStatus {
  if (typeof value !== 'string' || !TASK_STATUSES.has(value as TaskStatus)) throw invalidArguments()
}

function assertScore(value: unknown): asserts value is number | null {
  if (value === null) return
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.round(value * 100) !== value * 100) throw invalidArguments()
  validateScore(value)
}

function validatePayload(type: ComponentWriteType, value: unknown): asserts value is JsonRecord {
  const requiredByType: Record<ComponentWriteType, string[]> = {
    single_plan: ['title'], multi_plan: ['title'], task_list: ['title'], task_detail: ['title'],
    note: ['content'], mood: ['score', 'text', 'mood_date'], heading: ['title', 'size'], custom: ['content']
  }
  const allowedByType: Record<ComponentWriteType, string[]> = {
    single_plan: ['title', 'done', 'summary', 'due_date'],
    multi_plan: ['title', 'summary'], task_list: ['title'],
    task_detail: ['title', 'description', 'planned_at', 'status', 'note'],
    note: ['content'], mood: ['score', 'text', 'mood_date'], heading: ['title', 'size'], custom: ['content', 'source']
  }
  assertExactKeys(value, requiredByType[type], allowedByType[type].filter((key) => !requiredByType[type].includes(key)))
  for (const [key, item] of Object.entries(value)) validateComponentField(key, item)
}

function validateComponentField(key: string, value: unknown): void {
  switch (key) {
    case 'title': assertTitle(value); return
    case 'done': if (typeof value !== 'boolean') throw invalidArguments(); return
    case 'summary': case 'description': case 'note': case 'content': case 'text': case 'source': case 'remark': assertText(value); return
    case 'due_date': case 'planned_at': case 'mood_date': assertDate(value); return
    case 'status': assertStatus(value); return
    case 'score': assertScore(value); return
    case 'size': if (typeof value !== 'number' || !Number.isInteger(value) || value < 14 || value > 32) throw invalidArguments(); return
    default: throw invalidArguments()
  }
}

function validateComponentPatch(value: unknown): void {
  if (!isRecord(value)) throw invalidArguments()
  const allowed = Object.keys(editablePayloadProperties)
  if (Reflect.ownKeys(value).length === 0 || Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !allowed.includes(key))) throw invalidArguments()
  for (const [key, item] of Object.entries(value)) validateComponentField(key, item)
}

function validateClearFields(value: unknown, allowed: readonly string[]): void {
  if (!Array.isArray(value) || value.length < 1 || value.length > allowed.length ||
    value.some((item) => typeof item !== 'string' || !allowed.includes(item)) || new Set(value).size !== value.length) throw invalidArguments()
}

function validateArgs(name: AgentToolName, args: unknown): asserts args is JsonRecord {
  const keys: Record<AgentToolName, { required: string[]; optional?: string[] }> = {
    'plan.list_children': { required: ['folder_ref'] }, 'plan.read': { required: ['plan_ref'] },
    'plan.create': { required: ['name_part'], optional: ['parent_ref'] }, 'folder.create': { required: ['name'], optional: ['parent_ref'] },
    'component.add': { required: ['plan_ref', 'expected_updated_at', 'type', 'payload'], optional: ['remark'] },
    'component.update': { required: ['plan_ref', 'component_id', 'expected_updated_at'], optional: ['patch', 'clear_fields'] },
    'component.delete': { required: ['plan_ref', 'component_id', 'expected_updated_at'] },
    'task.add': { required: ['plan_ref', 'list_component_id', 'expected_updated_at', 'title'], optional: ['planned_at', 'note'] },
    'task.update': { required: ['plan_ref', 'list_component_id', 'task_id', 'expected_updated_at'], optional: ['patch', 'clear_fields'] },
    'task.delete': { required: ['plan_ref', 'list_component_id', 'task_id', 'expected_updated_at'] },
    'multi_option.add': { required: ['plan_ref', 'component_id', 'expected_updated_at', 'text'] },
    'multi_option.update': { required: ['plan_ref', 'component_id', 'option_id', 'expected_updated_at'], optional: ['text', 'checked'] },
    'multi_option.delete': { required: ['plan_ref', 'component_id', 'option_id', 'expected_updated_at'] },
    'plan.rename': { required: ['target_ref', 'expected_revision', 'new_name'] },
    'folder.rename': { required: ['target_ref', 'expected_revision', 'new_name'] },
    'plan.move': { required: ['target_ref', 'expected_revision', 'parent_ref'] },
    'folder.move': { required: ['target_ref', 'expected_revision', 'parent_ref'] },
    'plan.trash': { required: ['target_ref', 'expected_revision'] }, 'folder.trash': { required: ['target_ref', 'expected_revision'] },
    'trash.list': { required: ['trash_entry_ref'] },
    'trash.restore': { required: ['trash_entry_ref', 'manifest_revision'], optional: ['destination_parent_ref', 'new_name'] },
    'trash.purge': { required: ['trash_entry_ref', 'manifest_revision'] }
  }
  const definition = keys[name]
  assertExactKeys(args, definition.required, definition.optional)

  for (const key of ['plan_ref', 'folder_ref', 'target_ref', 'parent_ref', 'trash_entry_ref', 'destination_parent_ref']) {
    if (Object.hasOwn(args, key)) assertRef(args[key])
  }
  for (const key of ['component_id', 'list_component_id', 'task_id', 'option_id']) {
    if (Object.hasOwn(args, key)) assertUuid(args[key])
  }
  for (const key of ['expected_updated_at']) if (Object.hasOwn(args, key)) assertUpdatedAt(args[key])
  for (const key of ['expected_revision']) if (Object.hasOwn(args, key)) assertRevision(args[key])
  if (Object.hasOwn(args, 'manifest_revision') && (!Number.isSafeInteger(args.manifest_revision) || Number(args.manifest_revision) < 1)) throw invalidArguments()

  if (name === 'plan.create') {
    assertTitle(args.name_part)
  } else if (name === 'folder.create' || name === 'plan.rename' || name === 'folder.rename' || name === 'trash.restore' && Object.hasOwn(args, 'new_name')) {
    assertPlanName(name === 'folder.create' ? args.name : args.new_name ?? args.name)
  } else if (name === 'component.add') {
    if (typeof args.type !== 'string' || !COMPONENT_TYPES.has(args.type as ComponentWriteType)) throw invalidArguments()
    validatePayload(args.type as ComponentWriteType, args.payload)
    if (Object.hasOwn(args, 'remark')) assertText(args.remark)
  } else if (name === 'component.update') {
    if (Object.hasOwn(args, 'patch')) validateComponentPatch(args.patch)
    if (Object.hasOwn(args, 'clear_fields')) validateClearFields(args.clear_fields, componentClearFields)
    if (!Object.hasOwn(args, 'patch') && !Object.hasOwn(args, 'clear_fields')) throw invalidArguments()
    if (Object.hasOwn(args, 'patch') && Object.hasOwn(args, 'clear_fields') &&
      (args.clear_fields as string[]).some((field) => Object.hasOwn(args.patch as JsonRecord, field))) throw invalidArguments()
  } else if (name === 'task.add') {
    assertTitle(args.title)
    if (Object.hasOwn(args, 'planned_at')) assertDate(args.planned_at)
    if (Object.hasOwn(args, 'note')) assertText(args.note)
  } else if (name === 'task.update') {
    if (Object.hasOwn(args, 'patch')) {
      assertExactKeys(args.patch, [], ['title', 'status', 'planned_at', 'note'])
      if (Object.keys(args.patch).length === 0) throw invalidArguments()
      if (Object.hasOwn(args.patch, 'title')) assertTitle(args.patch.title)
      if (Object.hasOwn(args.patch, 'status')) assertStatus(args.patch.status)
      if (Object.hasOwn(args.patch, 'planned_at')) assertDate(args.patch.planned_at)
      if (Object.hasOwn(args.patch, 'note')) assertText(args.patch.note)
    }
    if (Object.hasOwn(args, 'clear_fields')) validateClearFields(args.clear_fields, ['planned_at', 'note'])
    if (!Object.hasOwn(args, 'patch') && !Object.hasOwn(args, 'clear_fields')) throw invalidArguments()
  } else if (name === 'multi_option.add') {
    assertText(args.text, false)
  } else if (name === 'multi_option.update') {
    if (Object.hasOwn(args, 'text')) assertText(args.text, false)
    if (Object.hasOwn(args, 'checked') && typeof args.checked !== 'boolean') throw invalidArguments()
    if (!Object.hasOwn(args, 'text') && !Object.hasOwn(args, 'checked')) throw invalidArguments()
  }
}

/** Returns fresh copies so provider serialization cannot mutate the application registry. */
export function getAgentToolDefinitions(): readonly AgentProviderTool[] {
  return structuredClone(TOOLS)
}

/** Parses and validates a complete provider batch before any operation is staged. */
export function parseAgentToolCalls(calls: readonly AgentChatToolCall[]): AgentCompletedToolCall[] {
  if (!Array.isArray(calls) || calls.length < 1 || calls.length > AGENT_MAX_TOOL_CALLS_PER_REQUEST) throw invalidArguments()
  const seenIds = new Set<string>()
  return calls.map((call) => {
    if (!isRecord(call) || Reflect.ownKeys(call).length !== 3 || call.type !== 'function') throw invalidArguments()
    const functionCall = call.function
    if (!isRecord(functionCall) || Reflect.ownKeys(functionCall).length !== 2 ||
      typeof call.id !== 'string' || call.id.length > MAX_CALL_ID_LENGTH || !TOOL_CALL_ID.test(call.id) || seenIds.has(call.id) ||
      typeof functionCall.name !== 'string' || typeof functionCall.arguments !== 'string' ||
      Buffer.byteLength(functionCall.arguments, 'utf8') > MAX_ARGUMENT_BYTES) throw invalidArguments()
    const definition = TOOLS.find((candidate) => candidate.function.name === functionCall.name)
    if (!definition) throw invalidArguments()
    let args: unknown
    try { args = JSON.parse(functionCall.arguments) } catch { throw invalidArguments() }
    validateArgs(functionCall.name as AgentToolName, args)
    seenIds.add(call.id)
    return { id: call.id, name: functionCall.name, arguments: args }
  })
}
