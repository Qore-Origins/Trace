// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WeekPlanOverview from '../src/renderer/src/components/WeekPlanOverview'
import { i18n } from '../src/renderer/src/i18n'
import { useWorkspaceTabsStore } from '../src/renderer/src/stores/workspace-tabs-store'
import type { PlanDocument } from '../src/shared/plan-types'

const libraryId = '11111111111111111111111111111111'
const weekId = '22222222222222222222222222222222'
const dayIds = Array.from({ length: 7 }, (_unused, index) => String(index + 3).repeat(32))
const dates = Array.from({ length: 7 }, (_unused, index) => `2026-10-${String(index + 12).padStart(2, '0')}`)
let host: HTMLDivElement
let root: Root
let previousTrace: PropertyDescriptor | undefined
let previousAct: unknown
let handoffTasks: Array<{ source_plan_id: string; source_task_id: string; title: string; source_date: string }> = []
let movePayload: Record<string, unknown> | null = null
const originalTabs = useWorkspaceTabsStore.getState()
const originalLanguage = i18n.language

function week(): PlanDocument {
  return { format_version: '1', plan_id: weekId, created_at: '2026-10-10T00:00:00.000Z',
    updated_at: '2026-10-10T00:00:00.000Z', components: [], workflow: { kind: 'week', status: 'draft',
      start_date: dates[0], end_date: dates[6], day_plan_ids: Object.fromEntries(dates.map((date, index) => [date, dayIds[index]])) } }
}

beforeEach(async () => {
  previousAct = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  await i18n.changeLanguage('zh-CN')
  useWorkspaceTabsStore.setState({ library_id: libraryId })
  handoffTasks = []
  movePayload = null
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  previousTrace = Object.getOwnPropertyDescriptor(window, 'trace')
  Object.defineProperty(window, 'trace', { configurable: true, value: {
    invoke: async (channel: string, payload?: unknown) => {
      const request = payload as { plan_id?: string; path?: string; source_plan_id?: string; source_task_id?: string }
      if (channel === 'plan-workflow:previewHandoff') {
        return { ok: true, code: 0, data: { previous_week_plan_id: handoffTasks.length ? 'e'.repeat(32) : null, tasks: handoffTasks } }
      }
      if (channel === 'plan-workflow:moveTask') {
        movePayload = request as Record<string, unknown>
        handoffTasks = []
        return { ok: true, code: 0, data: { status: 'complete', source_plan_id: request.source_plan_id,
          source_task_id: request.source_task_id, target_plan_id: dayIds[0], target_task_id: 'f'.repeat(32) } }
      }
      if (channel === 'plan-reference:resolve') {
        if (request.plan_id === dayIds[6]) return { ok: true, code: 0, data: { status: 'missing' } }
        return { ok: true, code: 0, data: { status: 'found', target: {
          plan_id: request.plan_id, path: `Daily_Plan/${request.plan_id}` } } }
      }
      if (channel === 'storage:readPlan') {
        const index = dayIds.findIndex((id) => request.path?.endsWith(id))
        return { ok: true, code: 0, data: { format_version: '1', plan_id: dayIds[index],
          workflow: { kind: 'day', target_date: dates[index], week_plan_id: weekId }, components: [{
            id: 'a'.repeat(32), type: 'task_list', payload: { title: '执行任务', items: index === 0 ? [
              { id: 'b'.repeat(32), title: '完成', status: 'done' },
              { id: 'c'.repeat(32), title: '未完成', status: 'not_started' },
              { id: 'd'.repeat(32), title: '已转移', status: 'moved' }
            ] : [] }
          }] } }
      }
      throw new Error(`Unexpected channel: ${channel}`)
    }, on: () => () => undefined
  } })
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  useWorkspaceTabsStore.setState({ library_id: originalTabs.library_id })
  await i18n.changeLanguage(originalLanguage)
  if (previousTrace) Object.defineProperty(window, 'trace', previousTrace)
  else Reflect.deleteProperty(window, 'trace')
  if (previousAct === undefined) Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  else Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct)
})

describe('week plan overview', () => {
  it('shows seven dated entries, live task totals, and a missing target', async () => {
    await act(async () => root.render(createElement(WeekPlanOverview, { document: week(), libraryId })))
    const body = host.textContent ?? ''
    expect(body).toContain('草稿')
    for (const date of dates) expect(body).toContain(date)
    expect(body).toContain('1 / 2 项完成')
    expect(host.querySelectorAll('.week-plan-overview__day')).toHaveLength(7)
    expect(body).toContain('失效')
  })

  it('requires an explicit action before carrying an unfinished task into the new week', async () => {
    handoffTasks = [{ source_plan_id: 'e'.repeat(32), source_task_id: 'f'.repeat(32),
      title: '上一周未完成', source_date: '2026-10-11' }]
    await act(async () => root.render(createElement(WeekPlanOverview, { document: week(), libraryId })))
    expect(host.textContent).toContain('上一周未完成')
    expect(movePayload).toBeNull()
    const button = Array.from(host.querySelectorAll('button')).find((item) => item.textContent === '转移任务')
    expect(button).toBeDefined()
    await act(async () => button!.click())
    expect(movePayload).toMatchObject({ source_task_id: 'f'.repeat(32), target_date: dates[0] })
    expect(host.textContent).not.toContain('上一周未完成')
  })
})
