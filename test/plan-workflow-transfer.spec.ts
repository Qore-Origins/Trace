import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PlanRepository } from '../src/main/services/plan-repository'
import { PlanReferenceService } from '../src/main/services/plan-reference-service'
import { StorageService } from '../src/main/services/storage-service'
import { TransferService } from '../src/main/services/transfer-service'
import type { PlanDocument, TaskListPayload } from '../src/shared/plan-types'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))) })

describe('workflow bundle identity', () => {
  it('remaps week, day, and handoff plan IDs inside an imported bundle, then resolves a renamed day', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'trace-workflow-transfer-'))
    roots.push(root)
    const repository = new PlanRepository()
    await repository.ensureLibraryRoot(root)
    const storage = new StorageService(repository)
    storage.setRoot(root)
    const transfer = new TransferService(repository, storage.treeCache, () => root)
    await storage.createPlan('', 'Bundle')
    const weekId = 'a'.repeat(32)
    const dayIds = Array.from({ length: 7 }, (_unused, index) => String(index + 2).repeat(32))
    const dates = Array.from({ length: 7 }, (_unused, index) => `2026-10-${String(index + 12).padStart(2, '0')}`)
    await storage.createPlan('Bundle', 'Week')
    const week = await storage.readPlan('Bundle/Week')
    week.plan_id = weekId
    week.workflow = { kind: 'week', status: 'draft', start_date: dates[0], end_date: dates[6],
      day_plan_ids: Object.fromEntries(dates.map((date, index) => [date, dayIds[index]])) }
    await storage.savePlan('Bundle/Week', week, week.updated_at)
    for (let index = 0; index < 7; index += 1) {
      const path = `Bundle/Day${index + 1}`
      await storage.createPlan('Bundle', `Day${index + 1}`)
      const day = await storage.readPlan(path)
      day.plan_id = dayIds[index]
      day.workflow = { kind: 'day', target_date: dates[index], week_plan_id: weekId }
      if (index < 2) day.components = [{ id: String(index + 9).repeat(32), type: 'task_list', payload: {
        title: '执行任务', items: index === 0 ? [{ id: 'b'.repeat(32), title: '旧项', status: 'moved',
          moved_to_plan_id: dayIds[1], moved_to_task_id: 'c'.repeat(32) }] : [{
          id: 'c'.repeat(32), title: '新项', status: 'not_started', source_plan_id: dayIds[0], source_task_id: 'b'.repeat(32)
        }]
      } }]
      await storage.savePlan(path, day, day.updated_at)
    }
    const bundle = join(root, 'workflow.plan')
    await transfer.exportPlan('Bundle', bundle)
    await transfer.importPlan('', bundle)
    const importedWeek = await storage.readPlan('Bundle (2)/Week')
    expect(importedWeek.plan_id).not.toBe(weekId)
    expect(importedWeek.workflow?.kind).toBe('week')
    if (importedWeek.workflow?.kind !== 'week') throw new Error('Missing imported week metadata')
    const importedDays: PlanDocument[] = []
    for (let index = 0; index < 7; index += 1) {
      const day = await storage.readPlan(`Bundle (2)/Day${index + 1}`)
      importedDays.push(day)
      expect(day.plan_id).not.toBe(dayIds[index])
      expect(day.workflow).toMatchObject({ kind: 'day', week_plan_id: importedWeek.plan_id, target_date: dates[index] })
      expect(importedWeek.workflow.day_plan_ids[dates[index]]).toBe(day.plan_id)
    }
    const moved = (importedDays[0].components[0].payload as TaskListPayload).items[0]
    const received = (importedDays[1].components[0].payload as TaskListPayload).items[0]
    expect(moved.moved_to_plan_id).toBe(importedDays[1].plan_id)
    expect(received.source_plan_id).toBe(importedDays[0].plan_id)
    const firstRevision = importedDays[0].updated_at
    await storage.renamePlan('Bundle (2)/Day1', 'Renamed day', firstRevision)
    const references = new PlanReferenceService(repository, () => root)
    references.activateRoot(root)
    try {
      const libraryId = (await repository.readLibraryMeta(root)).library_id
      expect(await references.resolve({ library_id: libraryId, plan_id: importedWeek.workflow.day_plan_ids[dates[0]] }))
        .toMatchObject({ status: 'found', target: { path: 'Bundle (2)/Renamed day' } })
    } finally { references.dispose() }
  })
})
