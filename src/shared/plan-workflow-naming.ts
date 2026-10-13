import { ERR, TraceError } from './errors'
import { validatePlanName, validateTitle } from './validation'

const WORKFLOW_NAME_TOKENS = [
  'this.folder_name',
  'category_name',
  'title',
  'date',
  'date_iso',
  'year',
  'month',
  'day',
  'week_start',
  'week_end',
  'created_date',
  'sequence'
] as const

export type WorkflowNameToken = (typeof WORKFLOW_NAME_TOKENS)[number]

export interface WorkflowNameContext {
  libraryRoot: string
  destinationPath: string
  createdDate: string
  title?: string
  targetDate?: string
  weekStart?: string
  weekEnd?: string
  sequence?: number
}

export interface TemplateValidationResult {
  tokens: readonly WorkflowNameToken[]
}

const TOKEN_PATTERN = /\{([^{}]+)\}/g
const SAMPLE_VALUES: Record<WorkflowNameToken, string> = {
  'this.folder_name': 'Folder',
  category_name: 'Category',
  title: 'Title',
  date: '20000101',
  date_iso: '2000-01-01',
  year: '2000',
  month: '01',
  day: '01',
  week_start: '20000101',
  week_end: '20000107',
  created_date: '20000101',
  sequence: '01'
}
const TOKEN_SET: ReadonlySet<string> = new Set(WORKFLOW_NAME_TOKENS)

export function validateWorkflowNameTemplate(template: unknown): TemplateValidationResult {
  if (typeof template !== 'string' || template.trim().length === 0) {
    throw new TraceError(ERR.VALIDATION, '计划名称模板不能为空')
  }

  const tokens: WorkflowNameToken[] = []
  for (const match of template.matchAll(TOKEN_PATTERN)) {
    const token = match[1]
    if (!TOKEN_SET.has(token)) {
      throw new TraceError(ERR.VALIDATION, `未知的计划名称变量：{${token}}`)
    }
    tokens.push(token as WorkflowNameToken)
  }
  if (/[{}]/.test(template.replace(TOKEN_PATTERN, ''))) {
    throw new TraceError(ERR.VALIDATION, '计划名称模板包含无效的大括号')
  }

  const sample = template.replace(TOKEN_PATTERN, (_match, token: WorkflowNameToken) => SAMPLE_VALUES[token])
  validatePlanName(sample)
  return { tokens }
}

export function renderWorkflowName(template: string, context: WorkflowNameContext): string {
  validateWorkflowNameTemplate(template)
  const destination = parseDestination(context.destinationPath, context.libraryRoot)
  const createdDate = parseCalendarDate(context.createdDate, '创建日期')
  const targetDate = context.targetDate
    ? parseCalendarDate(context.targetDate, '目标日期')
    : undefined
  const weekStart = context.weekStart
    ? parseCalendarDate(context.weekStart, '周期起始日')
    : undefined
  const weekEnd = context.weekEnd ? parseCalendarDate(context.weekEnd, '周期结束日') : undefined
  if (weekStart && weekEnd && weekStart.iso > weekEnd.iso) {
    throw new TraceError(ERR.VALIDATION, '周期结束日不能早于起始日')
  }

  const values: Partial<Record<WorkflowNameToken, string>> = {
    'this.folder_name': destination.folderName,
    category_name: destination.categoryName,
    created_date: createdDate.compact
  }
  if (context.title !== undefined) {
    validateTitle(context.title, '标题')
    values.title = context.title
  }
  if (targetDate) {
    values.date = targetDate.compact
    values.date_iso = targetDate.iso
    values.year = targetDate.year
    values.month = targetDate.month
    values.day = targetDate.day
  }
  if (weekStart) values.week_start = weekStart.compact
  if (weekEnd) values.week_end = weekEnd.compact
  if (context.sequence !== undefined) {
    if (!Number.isSafeInteger(context.sequence) || context.sequence < 1) {
      throw new TraceError(ERR.VALIDATION, '计划序号必须为正整数')
    }
    values.sequence = String(context.sequence).padStart(2, '0')
  }

  const result = template.replace(TOKEN_PATTERN, (_match, token: WorkflowNameToken) => {
    const value = values[token]
    if (value === undefined) {
      throw new TraceError(ERR.VALIDATION, `计划名称变量 {${token}} 缺少必要输入`)
    }
    return value
  })
  validatePlanName(result)
  return result
}

function parseDestination(
  destinationPath: string,
  libraryRoot: string
): { folderName: string; categoryName: string } {
  if (typeof destinationPath !== 'string' || typeof libraryRoot !== 'string') {
    throw new TraceError(ERR.VALIDATION, '计划目标目录无效')
  }
  const rootSegments = libraryRoot.replace(/\\/g, '/').split('/').filter(Boolean)
  const rootName = rootSegments.at(-1)
  if (!rootName) throw new TraceError(ERR.VALIDATION, '计划库根目录无效')
  const normalized = destinationPath.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new TraceError(ERR.PATH_UNSAFE, '计划目标目录必须位于当前计划库内')
  }
  if (normalized === '') return { folderName: rootName, categoryName: rootName }

  const segments = normalized.split('/')
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new TraceError(ERR.PATH_UNSAFE, '计划目标目录无效')
    }
    validatePlanName(segment)
  }
  return { folderName: segments.at(-1)!, categoryName: segments[0] }
}

function parseCalendarDate(
  value: string,
  label: string
): { iso: string; compact: string; year: string; month: string; day: string } {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) {
    throw new TraceError(ERR.VALIDATION, `${label}格式无效`)
  }
  const [year, month, day] = value.split('-')
  const candidate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  if (candidate.toISOString().slice(0, 10) !== value) {
    throw new TraceError(ERR.VALIDATION, `${label}无效`)
  }
  return { iso: value, compact: `${year}${month}${day}`, year, month, day }
}
