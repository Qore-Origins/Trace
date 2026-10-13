import { ERR, TraceError } from './errors'
import type { PlanDocument, PlanWorkflowMetadata } from './plan-types'
import { isUuid32, validateDueDate, validateNoteText, validatePlanName, validateTitle } from './validation'

const DAY_MS = 86_400_000
const WEEK_DAYS = 7

function invalid(message: string): never {
  throw new TraceError(ERR.VALIDATION, message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function keysMatch(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key))
}

function validateCalendarDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) invalid(`${label}格式无效`)
  validateDueDate(value)
  return value
}

function validateIsoTimestamp(value: unknown, label: string): void {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    invalid(`${label}无效`)
  }
}

export function validatePlanWorkflowMetadata(value: unknown): asserts value is PlanWorkflowMetadata {
  if (!isRecord(value)) invalid('计划工作流元数据无效')
  if (value.kind === 'day') {
    if (!keysMatch(value, ['kind', 'target_date'], ['week_plan_id'])) invalid('日计划工作流元数据字段无效')
    validateCalendarDate(value.target_date, '日计划目标日期')
    if (value.week_plan_id !== undefined && (typeof value.week_plan_id !== 'string' || !isUuid32(value.week_plan_id))) {
      invalid('关联周计划 ID 无效')
    }
    return
  }
  if (value.kind === 'week') {
    if (!keysMatch(value, ['kind', 'status', 'start_date', 'end_date', 'day_plan_ids'])) invalid('周计划工作流元数据字段无效')
    if (value.status !== 'draft' && value.status !== 'active' && value.status !== 'closed') {
      invalid('周计划状态无效')
    }
    const start = validateCalendarDate(value.start_date, '周计划起始日')
    const end = validateCalendarDate(value.end_date, '周计划结束日')
    const dayCount = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS) + 1
    if (dayCount !== WEEK_DAYS) invalid('周计划周期必须恰好为连续七天')
    if (!isRecord(value.day_plan_ids)) invalid('日计划关联表无效')
    for (const [date, planId] of Object.entries(value.day_plan_ids)) {
      validateCalendarDate(date, '关联日计划日期')
      if (date < start || date > end || typeof planId !== 'string' || !isUuid32(planId)) {
        invalid('日计划关联表包含无效日期或计划 ID')
      }
    }
    return
  }
  invalid('未知的计划工作流类型')
}

export function validateWorkflowDocumentForCreation(value: unknown): asserts value is PlanDocument {
  if (!isRecord(value) || !keysMatch(value, ['format_version', 'created_at', 'updated_at', 'components'], ['plan_id', 'due_date', 'workflow'])) {
    invalid('新计划文档结构无效')
  }
  if (value.format_version !== '1' || (value.plan_id !== undefined && (typeof value.plan_id !== 'string' || !isUuid32(value.plan_id)))) {
    invalid('新计划文档版本或 ID 无效')
  }
  if (value.workflow !== undefined && value.plan_id === undefined) invalid('关联工作流计划必须有稳定计划 ID')
  validateIsoTimestamp(value.created_at, '创建时间')
  validateIsoTimestamp(value.updated_at, '更新时间')
  if (value.due_date !== undefined) validateCalendarDate(value.due_date, '计划截止日期')
  if (value.workflow !== undefined) validatePlanWorkflowMetadata(value.workflow)
  if (!Array.isArray(value.components)) invalid('新计划组件列表无效')

  const ids = new Set<string>(value.plan_id === undefined ? [] : [value.plan_id])
  for (const component of value.components) {
    if (!isRecord(component) || !keysMatch(component, ['id', 'type', 'payload'], ['remark']) ||
      typeof component.id !== 'string' || !isUuid32(component.id) || ids.has(component.id) ||
      !isRecord(component.payload)) {
      invalid('新计划组件结构或 ID 无效')
    }
    ids.add(component.id)
    if (component.remark !== undefined) {
      if (typeof component.remark !== 'string') invalid('组件备注无效')
      validateNoteText(component.remark, '组件备注')
    }
    validateInitialComponent(component.type, component.payload, ids)
  }
}

function validateInitialComponent(type: unknown, payload: Record<string, unknown>, ids: Set<string>): void {
  if (type === 'heading') {
    if (!keysMatch(payload, ['title', 'size']) || typeof payload.title !== 'string' ||
      typeof payload.size !== 'number' || !Number.isInteger(payload.size) || payload.size < 1 || payload.size > 6) {
      invalid('标题组件无效')
    }
    validateTitle(payload.title)
    return
  }
  if (type === 'note') {
    if (!keysMatch(payload, ['content', 'created_at']) || typeof payload.content !== 'string') invalid('记录组件无效')
    validateNoteText(payload.content)
    validateIsoTimestamp(payload.created_at, '记录创建时间')
    return
  }
  if (type === 'task_list') {
    if (!keysMatch(payload, ['title', 'items']) || typeof payload.title !== 'string' || !Array.isArray(payload.items)) {
      invalid('任务列表组件无效')
    }
    validateTitle(payload.title)
    for (const item of payload.items) validateInitialTask(item, ids)
    return
  }
  if (type === 'mood') {
    if (!keysMatch(payload, ['score', 'text', 'mood_date', 'created_at']) || payload.score !== null || typeof payload.text !== 'string') {
      invalid('心情组件无效')
    }
    validateNoteText(payload.text)
    validateCalendarDate(payload.mood_date, '心情日期')
    validateIsoTimestamp(payload.created_at, '心情创建时间')
    return
  }
  if (type === 'plan_reference') {
    if (!keysMatch(payload, ['mode', 'target_plan_id', 'target_path_snapshot', 'target_name_snapshot'], ['target_component_id']) ||
      (payload.mode !== 'link' && payload.mode !== 'embed') ||
      typeof payload.target_plan_id !== 'string' || !isUuid32(payload.target_plan_id) ||
      typeof payload.target_path_snapshot !== 'string' || typeof payload.target_name_snapshot !== 'string') {
      invalid('计划引用组件无效')
    }
    validatePlanName(payload.target_name_snapshot)
    if (payload.target_component_id !== undefined && (typeof payload.target_component_id !== 'string' || !isUuid32(payload.target_component_id))) {
      invalid('计划引用组件目标 ID 无效')
    }
    return
  }
  invalid('新计划包含不支持的组件类型')
}

function validateInitialTask(value: unknown, ids: Set<string>): void {
  if (!isRecord(value) || !keysMatch(value, ['id', 'title', 'status'], ['planned_at', 'note']) ||
    typeof value.id !== 'string' || !isUuid32(value.id) || ids.has(value.id) ||
    typeof value.title !== 'string' || value.status !== 'not_started') {
    invalid('初始任务无效')
  }
  validateTitle(value.title, '任务标题')
  if (value.planned_at !== undefined) validateCalendarDate(value.planned_at, '任务日期')
  if (value.note !== undefined) {
    if (typeof value.note !== 'string') invalid('任务备注无效')
    validateNoteText(value.note, '任务备注')
  }
  ids.add(value.id)
}
