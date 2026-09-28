import { describe, expect, it } from 'vitest'
import {
  BUILT_IN_PLAN_NAME_TEMPLATES,
  formatPlanNameTemplate,
  validatePlanNameTemplate
} from '../src/shared/plan-name-templates'

describe('built-in plan name templates', () => {
  it('provides the six approved parent-folder patterns', () => {
    expect(BUILT_IN_PLAN_NAME_TEMPLATES).toEqual([
      { parent_path: 'Daily_Plan', template: 'Daily-Plan_{date}_{title}' },
      { parent_path: 'Future_Plan', template: 'Future_Plan-{date}-{title}' },
      { parent_path: 'Weekly_Plan', template: 'Weekly_Plan_{date}_{title}' },
      { parent_path: 'Short-Term_Plan', template: 'Short-Term_Plan_{date}_{title}' },
      { parent_path: 'Medium-Term_Plan', template: 'Medium-Term_Plan_{date}_{title}' },
      { parent_path: 'Long-Term_Plan', template: 'Long-Term_Plan_{date}_{title}' }
    ])
  })

  it('formats the local date and preserves the title text', () => {
    const result = formatPlanNameTemplate('Daily-Plan_{date}_{title}_done', ' 复盘  ', new Date(2026, 8, 28, 23, 59))

    expect(result).toBe('Daily-Plan_20260928_ 复盘  _done')
  })

  it('allows the date token to be omitted and does not reinterpret title text', () => {
    expect(formatPlanNameTemplate('{title}_done', 'Section {date} $&')).toBe('Section {date} $&_done')
  })

  it('requires exactly one title token and rejects unknown or malformed tokens', () => {
    for (const template of ['Daily_{date}', '{title}_{title}', '{title}_{month}', '{title']) {
      expect(() => validatePlanNameTemplate(template)).toThrow()
    }
  })

  it('rejects blank titles and formatted names that violate plan-name rules', () => {
    expect(() => formatPlanNameTemplate('{title}', '   ')).toThrow()
    expect(() => formatPlanNameTemplate('Plan_{title}', 'bad/name')).toThrow()
    expect(() => formatPlanNameTemplate('Plan_{title}', 'ends.')).toThrow()
  })
})
