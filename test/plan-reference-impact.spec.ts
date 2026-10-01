import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PlanRepository } from '../src/main/services/plan-repository'
import { PlanReferenceService } from '../src/main/services/plan-reference-service'
import { StorageService } from '../src/main/services/storage-service'
import { bus } from '../src/main/services/event-bus'
import { ERR } from '../src/shared/errors'
import type { Component, PlanDocument } from '../src/shared/plan-types'

const TARGET_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const SOURCE_ID = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const REF_ID = 'cccccccccccccccccccccccccccccccc'
const EXTRA_REF_ID = 'dddddddddddddddddddddddddddddddd'
const COMPONENT_ID = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const REPLACEMENT_ID = 'ffffffffffffffffffffffffffffffff'

function document(planId: string, components: Component[] = []): PlanDocument {
  return {
    format_version: '1', plan_id: planId,
    created_at: '2026-09-30T00:00:00.000Z', updated_at: '2026-09-30T00:00:00.000Z',
    components
  }
}

function reference(id: string, targetPlanId = TARGET_ID, targetComponentId?: string): Component {
  return { id, type: 'plan_reference', payload: {
    mode: targetComponentId ? 'embed' : 'link', target_plan_id: targetPlanId,
    ...(targetComponentId ? { target_component_id: targetComponentId } : {}),
    target_path_snapshot: 'Target', target_name_snapshot: 'Target'
  } }
}

describe('reference impact workflow', () => {
  let root: string
  let libraryId: string
  let repo: PlanRepository
  let storage: StorageService
  let references: PlanReferenceService

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'trace-impact-'))
    repo = new PlanRepository()
    libraryId = (await repo.ensureLibraryRoot(root)).library_id
    storage = new StorageService(repo)
    storage.setRoot(root)
    references = new PlanReferenceService(repo, () => root)
    references.activateRoot(root)
  })

  afterEach(async () => {
    references.dispose()
    await fs.rm(root, { recursive: true, force: true })
  })

  async function plan(path: string, doc: PlanDocument): Promise<void> {
    await fs.mkdir(join(root, path), { recursive: true })
    await repo.writePlanAtomic(root, path, doc)
    bus.emit('trace:plan-changed', { path })
  }

  it('previews surviving references for a plan rename and updates their display snapshots', async () => {
    await plan('Target', document(TARGET_ID))
    await plan('Source', document(SOURCE_ID, [reference(REF_ID)]))
    const preview = await references.previewImpact({
      library_id: libraryId, operation: 'rename-plan', path: 'Target', new_name: 'Renamed'
    })
    expect(preview.references).toEqual([expect.objectContaining({
      source_path: 'Source', source_component_id: REF_ID, target_plan_id: TARGET_ID
    })])
    await references.commitImpact({
      library_id: libraryId, preview, rename_action: 'update'
    }, storage)
    expect((await repo.readPlan(root, 'Source')).components[0].payload).toMatchObject({
      target_plan_id: TARGET_ID, target_path_snapshot: 'Renamed', target_name_snapshot: 'Renamed'
    })
    expect(await repo.readPlan(root, 'Renamed')).toMatchObject({ plan_id: TARGET_ID })
  })

  it('keeps existing display snapshots when the user chooses not to update on rename', async () => {
    await plan('Target', document(TARGET_ID))
    await plan('Source', document(SOURCE_ID, [reference(REF_ID)]))
    const preview = await references.previewImpact({
      library_id: libraryId, operation: 'rename-plan', path: 'Target', new_name: 'Renamed'
    })
    await references.commitImpact({ library_id: libraryId, preview, rename_action: 'keep' }, storage)
    expect((await repo.readPlan(root, 'Source')).components[0].payload).toMatchObject({
      target_plan_id: TARGET_ID, target_path_snapshot: 'Target', target_name_snapshot: 'Target'
    })
    expect(await repo.readPlan(root, 'Renamed')).toMatchObject({ plan_id: TARGET_ID })
  })

  it('rejects a stale delete preview after an inbound reference is added', async () => {
    await plan('Target', document(TARGET_ID))
    await plan('Source', document(SOURCE_ID, [reference(REF_ID)]))
    const preview = await references.previewImpact({
      library_id: libraryId, operation: 'delete-plan', path: 'Target'
    })
    await storage.appendComponent('Source', reference(EXTRA_REF_ID))
    await expect(references.commitImpact({
      library_id: libraryId, preview, decisions: [{
        source_path: 'Source', source_component_id: REF_ID, action: 'keep'
      }]
    }, storage)).rejects.toMatchObject({ code: ERR.CONFLICT })
    expect(await repo.readPlan(root, 'Target')).toMatchObject({ plan_id: TARGET_ID })
  })

  it('excludes references deleted within the same plan subtree', async () => {
    await plan('Group/Target', document(TARGET_ID))
    await plan('Group/Source', document(SOURCE_ID, [reference(REF_ID)]))
    const preview = await references.previewImpact({
      library_id: libraryId, operation: 'delete-plan', path: 'Group'
    })
    expect(preview.references).toEqual([])
  })

  it('includes surviving same-plan inbound references when deleting a component', async () => {
    const heading: Component = { id: COMPONENT_ID, type: 'heading', payload: { title: 'Title', size: 18 } }
    await plan('Target', document(TARGET_ID, [heading, reference(REF_ID, TARGET_ID, COMPONENT_ID)]))
    const preview = await references.previewImpact({
      library_id: libraryId, operation: 'delete-component', path: 'Target', component_id: COMPONENT_ID
    })
    expect(preview.references).toEqual([expect.objectContaining({
      source_path: 'Target', source_component_id: REF_ID, target_component_id: COMPONENT_ID
    })])
  })

  it('allows a legacy component ID to use the same delete workflow when it has no valid incoming references', async () => {
    await plan('Target', document(TARGET_ID, [
      { id: 'heading-1', type: 'heading', payload: { title: 'Legacy', size: 18 } }
    ]))
    const preview = await references.previewImpact({
      library_id: libraryId, operation: 'delete-component', path: 'Target', component_id: 'heading-1'
    })
    expect(preview.references).toEqual([])
    await references.commitImpact({ library_id: libraryId, preview, decisions: [] }, storage)
    expect((await repo.readPlan(root, 'Target')).components).toEqual([])
  })

  it('deletes a reference card without requiring it to be a native reference target', async () => {
    await plan('Target', document(TARGET_ID))
    await plan('Source', document(SOURCE_ID, [reference(REF_ID)]))
    const preview = await references.previewImpact({
      library_id: libraryId, operation: 'delete-component', path: 'Source', component_id: REF_ID
    })
    expect(preview.references).toEqual([])
    await references.commitImpact({ library_id: libraryId, preview, decisions: [] }, storage)
    expect((await repo.readPlan(root, 'Source')).components).toEqual([])
    expect(await repo.readPlan(root, 'Target')).toMatchObject({ plan_id: TARGET_ID })
  })

  it('uses the selected language fallback when an untitled native component is renamed', async () => {
    await plan('Target', document(TARGET_ID, [
      { id: COMPONENT_ID, type: 'heading', payload: { title: 'Old title', size: 18 } }
    ]))
    await plan('Source', document(SOURCE_ID, [reference(REF_ID, TARGET_ID, COMPONENT_ID)]))
    const target = await repo.readPlan(root, 'Target')
    const preview = await references.previewImpact({
      library_id: libraryId, operation: 'rename-component', path: 'Target', component_id: COMPONENT_ID,
      new_title: '', expected_updated_at: target.updated_at, locale: 'en-US'
    })
    await references.commitImpact({ library_id: libraryId, preview, rename_action: 'update' }, storage)
    expect((await repo.readPlan(root, 'Source')).components[0].payload).toMatchObject({
      target_name_snapshot: 'Heading'
    })
    expect((await repo.readPlan(root, 'Target')).components[0].payload).toMatchObject({ title: '' })
  })

  it('writes a component title and its same-plan inbound snapshot in one atomic document write', async () => {
    const heading: Component = { id: COMPONENT_ID, type: 'heading', payload: { title: 'Old title', size: 18 } }
    await plan('Target', document(TARGET_ID, [heading, reference(REF_ID, TARGET_ID, COMPONENT_ID)]))
    const target = await repo.readPlan(root, 'Target')
    const preview = await references.previewImpact({
      library_id: libraryId, operation: 'rename-component', path: 'Target', component_id: COMPONENT_ID,
      new_title: 'New title', expected_updated_at: target.updated_at
    })
    const writes = vi.spyOn(storage, 'savePlan')
    await references.commitImpact({ library_id: libraryId, preview, rename_action: 'update' }, storage)
    expect(writes.mock.calls.filter(([path]) => path === 'Target')).toHaveLength(1)
    const current = await repo.readPlan(root, 'Target')
    expect(current.components[0].payload).toMatchObject({ title: 'New title' })
    expect(current.components[1].payload).toMatchObject({ target_name_snapshot: 'New title' })
  })

  it('lets each surviving reference choose its own replacement or remain visibly missing', async () => {
    await plan('Target', document(TARGET_ID))
    await plan('Replacement', document(REPLACEMENT_ID))
    await plan('Source', document(SOURCE_ID, [reference(REF_ID), reference(EXTRA_REF_ID)]))
    const preview = await references.previewImpact({
      library_id: libraryId, operation: 'delete-plan', path: 'Target'
    })
    await references.commitImpact({ library_id: libraryId, preview, decisions: [
      { source_path: 'Source', source_component_id: REF_ID, action: 'replace', replacement: { path: 'Replacement' } },
      { source_path: 'Source', source_component_id: EXTRA_REF_ID, action: 'keep' }
    ] }, storage)
    const source = await repo.readPlan(root, 'Source')
    expect(source.components[0].payload).toMatchObject({ target_plan_id: REPLACEMENT_ID, target_path_snapshot: 'Replacement' })
    expect(source.components[1].payload).toMatchObject({ target_plan_id: TARGET_ID, target_name_snapshot: 'Target' })
    expect(await references.resolve({ library_id: libraryId, plan_id: TARGET_ID })).toEqual({ status: 'missing' })
  })

  it('assigns a stable ID to a validated legacy replacement before deleting the old target', async () => {
    await plan('Target', document(TARGET_ID))
    const legacy = document(REPLACEMENT_ID)
    delete legacy.plan_id
    await plan('Replacement', legacy)
    await plan('Source', document(SOURCE_ID, [reference(REF_ID)]))
    const preview = await references.previewImpact({
      library_id: libraryId, operation: 'delete-plan', path: 'Target'
    })
    await references.commitImpact({ library_id: libraryId, preview, decisions: [{
      source_path: 'Source', source_component_id: REF_ID, action: 'replace', replacement: { path: 'Replacement' }
    }] }, storage)
    const assignedId = (await repo.readPlan(root, 'Replacement')).plan_id
    expect(assignedId).toMatch(/^[0-9a-f]{32}$/)
    expect((await repo.readPlan(root, 'Source')).components[0].payload).toMatchObject({ target_plan_id: assignedId })
  })

  it('rejects a non-native embed replacement before touching the target or source', async () => {
    const heading: Component = { id: COMPONENT_ID, type: 'heading', payload: { title: 'Title', size: 18 } }
    await plan('Target', document(TARGET_ID, [heading]))
    await plan('Source', document(SOURCE_ID, [reference(REF_ID, TARGET_ID, COMPONENT_ID)]))
    await plan('Replacement', document(REPLACEMENT_ID, [reference(EXTRA_REF_ID)]))
    const preview = await references.previewImpact({
      library_id: libraryId, operation: 'delete-component', path: 'Target', component_id: COMPONENT_ID
    })
    await expect(references.commitImpact({ library_id: libraryId, preview, decisions: [{
      source_path: 'Source', source_component_id: REF_ID, action: 'replace',
      replacement: { path: 'Replacement', component_id: EXTRA_REF_ID }
    }] }, storage)).rejects.toMatchObject({ code: ERR.VALIDATION })
    expect((await repo.readPlan(root, 'Target')).components).toContainEqual(heading)
    expect((await repo.readPlan(root, 'Source')).components[0].payload).toMatchObject({ target_plan_id: TARGET_ID })
  })

  it('stops before deleting after a later source write fails and retries only remaining old-target references', async () => {
    await plan('Target', document(TARGET_ID))
    await plan('Replacement', document(REPLACEMENT_ID))
    await plan('SourceA', document(SOURCE_ID, [reference(REF_ID)]))
    await plan('SourceB', document('11111111111111111111111111111111', [reference(EXTRA_REF_ID)]))
    const preview = await references.previewImpact({
      library_id: libraryId, operation: 'delete-plan', path: 'Target'
    })
    const original = storage.savePlan.bind(storage)
    const fault = vi.spyOn(storage, 'savePlan').mockImplementation(async (path, doc, expected) => {
      if (path === 'SourceB') throw new Error('injected write failure')
      return original(path, doc, expected)
    })
    await expect(references.commitImpact({ library_id: libraryId, preview, decisions: preview.references.map((ref) => ({
      source_path: ref.source_path, source_component_id: ref.source_component_id,
      action: 'replace' as const, replacement: { path: 'Replacement' }
    })) }, storage)).rejects.toMatchObject({ code: ERR.SAVE_FAILED })
    fault.mockRestore()
    expect((await repo.readPlan(root, 'Target')).plan_id).toBe(TARGET_ID)
    expect((await repo.readPlan(root, 'SourceA')).components[0].payload).toMatchObject({ target_plan_id: REPLACEMENT_ID })
    expect((await repo.readPlan(root, 'SourceB')).components[0].payload).toMatchObject({ target_plan_id: TARGET_ID })

    const retry = await references.previewImpact({ library_id: libraryId, operation: 'delete-plan', path: 'Target' })
    expect(retry.references.map((ref) => ref.source_path)).toEqual(['SourceB'])
    await references.commitImpact({ library_id: libraryId, preview: retry, decisions: [{
      source_path: 'SourceB', source_component_id: EXTRA_REF_ID, action: 'replace', replacement: { path: 'Replacement' }
    }] }, storage)
    expect(await references.resolve({ library_id: libraryId, plan_id: TARGET_ID })).toEqual({ status: 'missing' })
  })

  it('writes a component deletion and its same-plan inbound replacement together', async () => {
    const heading: Component = { id: COMPONENT_ID, type: 'heading', payload: { title: 'Title', size: 18 } }
    await plan('Target', document(TARGET_ID, [heading, reference(REF_ID, TARGET_ID, COMPONENT_ID)]))
    await plan('Replacement', document(REPLACEMENT_ID, [
      { id: EXTRA_REF_ID, type: 'heading', payload: { title: 'Other', size: 18 } }
    ]))
    const preview = await references.previewImpact({
      library_id: libraryId, operation: 'delete-component', path: 'Target', component_id: COMPONENT_ID
    })
    const writes = vi.spyOn(storage, 'savePlan')
    await references.commitImpact({ library_id: libraryId, preview, decisions: [{
      source_path: 'Target', source_component_id: REF_ID, action: 'replace',
      replacement: { path: 'Replacement', component_id: EXTRA_REF_ID }
    }] }, storage)
    expect(writes.mock.calls.filter(([path]) => path === 'Target')).toHaveLength(1)
    const current = await repo.readPlan(root, 'Target')
    expect(current.components).toHaveLength(1)
    expect(current.components[0].payload).toMatchObject({ target_plan_id: REPLACEMENT_ID, target_component_id: EXTRA_REF_ID })
  })
})
