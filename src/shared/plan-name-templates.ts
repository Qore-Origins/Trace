import { ERR, TraceError } from './errors'
import { validatePlanName, validateTitle } from './validation'

export interface PlanNameTemplateDefinition {
  parent_path: string
  template: string
}

export interface PlanNameTemplateRule {
  parent_path: string
  template: string
  source: 'default' | 'custom'
}

export interface PlanNameTemplateSettings {
  rules: PlanNameTemplateRule[]
  disabled_default_paths: string[]
}

export interface PlanNameTemplateConfig {
  format_version: '1'
  templates: Record<string, string>
  disabled_default_paths: string[]
}

export const BUILT_IN_PLAN_NAME_TEMPLATES = [
  { parent_path: 'Daily_Plan', template: 'Daily-Plan_{date}_{title}' },
  { parent_path: 'Future_Plan', template: 'Future_Plan-{date}-{title}' },
  { parent_path: 'Weekly_Plan', template: 'Weekly_Plan_{date}_{title}' },
  { parent_path: 'Short-Term_Plan', template: 'Short-Term_Plan_{date}_{title}' },
  { parent_path: 'Medium-Term_Plan', template: 'Medium-Term_Plan_{date}_{title}' },
  { parent_path: 'Long-Term_Plan', template: 'Long-Term_Plan_{date}_{title}' }
] as const satisfies readonly PlanNameTemplateDefinition[]

const TEMPLATE_TOKEN = /\{([^{}]+)\}/g
const VALIDATION_TITLE = 'x'
const VALIDATION_DATE = '20000101'

export function validatePlanNameTemplate(template: unknown): asserts template is string {
  if (typeof template !== 'string' || template.trim().length === 0) {
    throw new TraceError(ERR.VALIDATION, '计划名称模板不能为空')
  }

  let titleCount = 0
  let hasUnknownToken = false
  for (const match of template.matchAll(TEMPLATE_TOKEN)) {
    if (match[1] === 'title') titleCount += 1
    else if (match[1] !== 'date') hasUnknownToken = true
  }

  if (/[{}]/.test(template.replace(TEMPLATE_TOKEN, '')) || hasUnknownToken) {
    throw new TraceError(ERR.VALIDATION, '模板仅支持 {date} 和 {title} 占位符')
  }
  if (titleCount !== 1) {
    throw new TraceError(ERR.VALIDATION, '模板必须且只能包含一个 {title} 占位符')
  }

  const sampleName = template
    .replace(/\{date\}/g, VALIDATION_DATE)
    .replace(/\{title\}/g, VALIDATION_TITLE)
  validatePlanName(sampleName)
}

export function formatPlanNameTemplate(template: unknown, title: unknown, date = new Date()): string {
  validatePlanNameTemplate(template)
  if (typeof title !== 'string') throw new TraceError(ERR.VALIDATION, '标题必须为文本')
  validateTitle(title, '标题')
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TraceError(ERR.VALIDATION, '日期无效')
  }

  const localDate = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`
  const result = template
    .replace(/\{date\}/g, localDate)
    .replace(/\{title\}/g, () => title)
  validatePlanName(result)
  return result
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}
