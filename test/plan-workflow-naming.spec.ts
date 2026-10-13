import { describe, expect, it } from 'vitest'
import {
  renderWorkflowName,
  validateWorkflowNameTemplate
} from '../src/shared/plan-workflow-naming'

const baseContext = {
  libraryRoot: 'D:\\Desktop\\Plan',
  destinationPath: 'Feature_Plan/Qore/Trace',
  createdDate: '2026-10-11',
  targetDate: '2026-10-12',
  title: '迭代计划'
}

describe('plan workflow naming', () => {
  it('uses each output destination folder and the target date', () => {
    expect(renderWorkflowName('{this.folder_name}_{date}_{title}', baseContext)).toBe(
      'Trace_20261012_迭代计划'
    )
    expect(
      renderWorkflowName('{category_name}-{date_iso}-{year}{month}{day}', baseContext)
    ).toBe('Feature_Plan-2026-10-12-20261012')
    expect(
      renderWorkflowName('{this.folder_name}_{date}', {
        ...baseContext,
        destinationPath: 'Daily_Plan',
        targetDate: '2026-10-13'
      })
    ).toBe('Daily_Plan_20261013')
  })

  it('uses the library root folder name when the destination is the root', () => {
    expect(
      renderWorkflowName('{this.folder_name}-{category_name}', {
        ...baseContext,
        destinationPath: ''
      })
    ).toBe('Plan-Plan')
  })

  it('supports a week range without inferring a single target date', () => {
    const weekContext = {
      ...baseContext,
      destinationPath: 'Weekly_Plan',
      targetDate: undefined,
      weekStart: '2026-12-31',
      weekEnd: '2027-01-06'
    }
    expect(renderWorkflowName('{this.folder_name}_{week_start}-{week_end}', weekContext)).toBe(
      'Weekly_Plan_20261231-20270106'
    )
    expect(() => renderWorkflowName('{date}', weekContext)).toThrow()
  })

  it('accepts leap day, optional title, creation date and extended sequence', () => {
    expect(
      renderWorkflowName('{date}_{created_date}_{sequence}', {
        ...baseContext,
        title: undefined,
        targetDate: '2028-02-29',
        sequence: 101
      })
    ).toBe('20280229_20261011_101')
    expect(renderWorkflowName('{sequence}', { ...baseContext, sequence: 1 })).toBe('01')
  })

  it('does not reinterpret token-like text in a title', () => {
    expect(
      renderWorkflowName('{title}_{date}', { ...baseContext, title: '检查 {date} $&' })
    ).toBe('检查 {date} $&_20261012')
  })

  it('rejects unknown tokens, paths, missing fields and invalid dates', () => {
    for (const template of ['{unknown}', '../{title}', '{title}/x', '{title}\\x', '{date']) {
      expect(() => validateWorkflowNameTemplate(template)).toThrow()
    }
    expect(() => renderWorkflowName('{title}', { ...baseContext, title: undefined })).toThrow()
    expect(() => renderWorkflowName('{date}', { ...baseContext, targetDate: '2027-02-29' })).toThrow()
    expect(() => renderWorkflowName('{sequence}', baseContext)).toThrow()
    expect(() => renderWorkflowName('{title}', { ...baseContext, title: 'bad/name' })).toThrow()
    expect(() => renderWorkflowName('{title}', { ...baseContext, destinationPath: '../Plan' })).toThrow()
  })
})
