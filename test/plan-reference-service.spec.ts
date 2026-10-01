import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PlanRepository } from '../src/main/services/plan-repository'
import { PlanReferenceService } from '../src/main/services/plan-reference-service'
import type { Component, PlanDocument } from '../src/shared/plan-types'
import { ERR } from '../src/shared/errors'
import { bus } from '../src/main/services/event-bus'
import { StorageService } from '../src/main/services/storage-service'
import { vi } from 'vitest'

const NOTE_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const otherId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const fixedPlanId = 'cccccccccccccccccccccccccccccccc'

function document(components: Component[] = [], planId?: string): PlanDocument {
  return {
    format_version: '1', plan_id: planId,
    created_at: '2026-09-30T00:00:00.000Z', updated_at: '2026-09-30T00:00:00.000Z',
    components
  }
}

function note(id = NOTE_ID): Component {
  return { id, type: 'note', payload: { content: 'memo', created_at: '2026-09-30T00:00:00.000Z' } }
}

describe('PlanReferenceService', () => {
  const roots: string[] = []
  let root: string | null
  let repo: PlanRepository
  let service: PlanReferenceService
  let libraryId: string

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'trace-reference-'))
    roots.push(root)
    repo = new PlanRepository()
    libraryId = (await repo.ensureLibraryRoot(root)).library_id
    service = new PlanReferenceService(repo, () => root)
    service.activateRoot(root)
  })

  afterEach(async () => {
    service.dispose()
    await Promise.all(roots.splice(0).map((path) => fs.rm(path, { recursive: true, force: true })))
  })

  async function plan(path: string, doc: PlanDocument = document([note()])): Promise<void> {
    await fs.mkdir(join(root as string, path), { recursive: true })
    await repo.writePlanAtomic(root as string, path, doc)
  }

  it('searches and previews legacy plans without writing an ID, then assigns one at explicit commit', async () => {
    await plan('Legacy')
    const before = await fs.readFile(join(root as string, 'Legacy', 'plan.json'), 'utf8')

    expect((await service.search({ library_id: libraryId, query: 'Leg' })).targets)
      .toContainEqual(expect.objectContaining({ path: 'Legacy', plan_name: 'Legacy', component_id: NOTE_ID }))
    expect(await service.commitTarget({ library_id: libraryId, path: 'Legacy', component_id: NOTE_ID, mode: 'embed' }))
      .toMatchObject({ path: 'Legacy', component_id: NOTE_ID })
    const after = await repo.readPlan(root as string, 'Legacy')
    expect(after.plan_id).toMatch(/^[0-9a-f]{32}$/)
    expect(await service.commitTarget({ library_id: libraryId, path: 'Legacy', component_id: NOTE_ID, mode: 'embed' }))
      .toMatchObject({ plan_id: after.plan_id })
    expect(before).not.toContain('plan_id')
  })

  it('resolves the same target after rename and move, and reports missing plan or component', async () => {
    await plan('A', document([note()], fixedPlanId))
    expect(await service.resolve({ library_id: libraryId, plan_id: fixedPlanId, component_id: NOTE_ID }))
      .toMatchObject({ status: 'found', target: { path: 'A', component_id: NOTE_ID } })
    await fs.rename(join(root as string, 'A'), join(root as string, 'Renamed'))
    await fs.mkdir(join(root as string, 'Group'))
    await fs.rename(join(root as string, 'Renamed'), join(root as string, 'Group', 'Renamed'))
    expect(await service.resolve({ library_id: libraryId, plan_id: fixedPlanId, component_id: NOTE_ID }))
      .toMatchObject({ status: 'found', target: { path: 'Group/Renamed', component_id: NOTE_ID } })
    expect(await service.resolve({ library_id: libraryId, plan_id: fixedPlanId, component_id: otherId }))
      .toEqual({ status: 'missing' })
    expect(await service.resolve({ library_id: libraryId, plan_id: otherId })).toEqual({ status: 'missing' })
  })

  it('excludes reference components and duplicate component identities from eligible targets', async () => {
    const reference: Component = {
      id: otherId, type: 'plan_reference', payload: {
        mode: 'link', target_plan_id: fixedPlanId,
        target_path_snapshot: 'A', target_name_snapshot: 'A'
      }
    }
    await plan('A', document([note(), reference], fixedPlanId))
    const candidates = (await service.search({ library_id: libraryId, query: 'A' })).targets
    expect(candidates.some((candidate) => candidate.component_id === otherId)).toBe(false)
    expect(await service.resolve({ library_id: libraryId, plan_id: fixedPlanId, component_id: otherId }))
      .toEqual({ status: 'missing' })
    await expect(service.commitTarget({ library_id: libraryId, path: 'A', component_id: otherId, mode: 'embed' }))
      .rejects.toMatchObject({ code: ERR.VALIDATION })
    await plan('A', document([note(), note()], fixedPlanId))
    expect((await service.search({ library_id: libraryId, query: 'A' })).targets
      .some((candidate) => candidate.component_id === NOTE_ID)).toBe(false)
    expect(await service.resolve({ library_id: libraryId, plan_id: fixedPlanId, component_id: NOTE_ID }))
      .toEqual({ status: 'missing' })
  })

  it('returns an explicit conflict for duplicate plan identities instead of an arbitrary match', async () => {
    await plan('A', document([note()], fixedPlanId))
    await plan('B', document([note(otherId)], fixedPlanId))
    expect(await service.resolve({ library_id: libraryId, plan_id: fixedPlanId })).toEqual({ status: 'conflict' })
    await expect(service.commitTarget({ library_id: libraryId, path: 'A', mode: 'link' }))
      .rejects.toMatchObject({ code: ERR.CONFLICT })
  })

  it('continues past malformed plans while rejecting external directory and plan-file links', async () => {
    await plan('Safe', document([note()], fixedPlanId))
    await fs.mkdir(join(root as string, 'Broken'))
    await fs.writeFile(join(root as string, 'Broken', 'plan.json'), '{')
    const outside = await fs.mkdtemp(join(tmpdir(), 'trace-reference-outside-'))
    roots.push(outside)
    await fs.mkdir(join(outside, 'Secret'))
    await fs.writeFile(join(outside, 'Secret', 'plan.json'), JSON.stringify(document([note()], otherId)))
    await fs.symlink(join(outside, 'Secret'), join(root as string, 'Linked'), process.platform === 'win32' ? 'junction' : 'dir')
    await fs.mkdir(join(root as string, 'LinkedFile'))
    await fs.symlink(join(outside, 'Secret', 'plan.json'), join(root as string, 'LinkedFile', 'plan.json'), 'file')

    const paths = (await service.search({ library_id: libraryId, query: '' })).targets.map((target) => target.path)
    expect(paths).toContain('Safe')
    expect(paths).not.toContain('Broken')
    expect(paths).not.toContain('Linked')
    expect(paths).not.toContain('LinkedFile')
    expect(await service.resolve({ library_id: libraryId, plan_id: otherId })).toEqual({ status: 'missing' })
    await expect(service.commitTarget({ library_id: libraryId, path: 'Linked', mode: 'link' }))
      .rejects.toMatchObject({ code: ERR.PATH_UNSAFE })
    await expect(service.commitTarget({ library_id: libraryId, path: 'LinkedFile', mode: 'link' }))
      .rejects.toMatchObject({ code: ERR.PATH_UNSAFE })
  })

  it('invalidates derived inbound references after plan-change and external-change events', async () => {
    await plan('Source', document([], otherId))
    const request = { library_id: libraryId, plan_id: fixedPlanId }
    expect(await service.inbound(request)).toEqual({ references: [] })
    await plan('Source', document([{
      id: NOTE_ID, type: 'plan_reference', payload: {
        mode: 'link', target_plan_id: fixedPlanId,
        target_path_snapshot: 'Target', target_name_snapshot: 'Target'
      }
    }], otherId))
    bus.emit('trace:plan-changed', { path: 'Source' })
    expect(await service.inbound(request)).toMatchObject({ references: [{ source_path: 'Source', source_component_id: NOTE_ID }] })
    await plan('Source', document([], otherId))
    bus.emit('trace:fs-external-change', { paths: ['Source/plan.json'], type: 'changed' })
    expect(await service.inbound(request)).toEqual({ references: [] })
  })

  it('rejects a stale library request before writing or returning scan results', async () => {
    await plan('Legacy')
    const second = await fs.mkdtemp(join(tmpdir(), 'trace-reference-second-'))
    roots.push(second)
    const secondId = (await repo.ensureLibraryRoot(second)).library_id
    const pending = service.commitTarget({ library_id: libraryId, path: 'Legacy', mode: 'link' })
    root = second
    service.activateRoot(second)
    await expect(pending).rejects.toMatchObject({ code: ERR.CONFLICT })
    expect((await repo.readPlan(roots[0], 'Legacy')).plan_id).toBeUndefined()
    await expect(service.search({ library_id: libraryId, query: '' })).rejects.toMatchObject({ code: ERR.CONFLICT })
    expect(await service.search({ library_id: secondId, query: '' })).toEqual({ targets: [] })
  })

  it('does not duplicate a stable ID or rewrite a target on concurrent explicit commits', async () => {
    await plan('Legacy')
    const request = { library_id: libraryId, path: 'Legacy', mode: 'link' as const }
    const [first, second] = await Promise.all([service.commitTarget(request), service.commitTarget(request)])
    expect(first.plan_id).toBe(second.plan_id)
    expect((await repo.readPlan(root as string, 'Legacy')).plan_id).toBe(first.plan_id)
    const after = await fs.readFile(join(root as string, 'Legacy', 'plan.json'), 'utf8')
    await service.commitTarget(request)
    expect(await fs.readFile(join(root as string, 'Legacy', 'plan.json'), 'utf8')).toBe(after)
  })

  it('does not return a scan result after the active library changes', async () => {
    await plan('A')
    const second = await fs.mkdtemp(join(tmpdir(), 'trace-reference-switch-'))
    roots.push(second)
    await repo.ensureLibraryRoot(second)
    const pending = service.search({ library_id: libraryId, query: '' })
    root = second
    service.activateRoot(second)
    await expect(pending).rejects.toMatchObject({ code: ERR.CONFLICT })
  })

  it('keeps malformed component payloads local when scanning candidate names', async () => {
    await plan('Damaged', document([{ id: NOTE_ID, type: 'note', payload: null } as unknown as Component]))
    await plan('Healthy', document([note(otherId)]))
    expect((await service.search({ library_id: libraryId, query: 'Healthy' })).targets)
      .toContainEqual(expect.objectContaining({ path: 'Healthy', component_id: otherId }))
  })

  it('keeps a committed stable ID when a stale user save races the same plan', async () => {
    await plan('Target')
    service.dispose()
    let releaseWrite: () => void = () => {}
    let signalWrite: () => void = () => {}
    const writeHeld = new Promise<void>((resolve) => { releaseWrite = resolve })
    const writeStarted = new Promise<void>((resolve) => { signalWrite = resolve })
    let holdNextTargetWrite = true
    repo = new PlanRepository({
      renameFn: async (from, to) => {
        if (holdNextTargetWrite && to === join(root as string, 'Target', 'plan.json')) {
          holdNextTargetWrite = false
          signalWrite()
          await writeHeld
        }
        await fs.rename(from, to)
      }
    })
    service = new PlanReferenceService(repo, () => root)
    service.activateRoot(root as string)
    const storage = new StorageService(repo)
    storage.setRoot(root as string)
    const stale = await storage.readPlan('Target')
    const pendingReference = service.commitTarget({ library_id: libraryId, path: 'Target', mode: 'link' })
    await writeStarted
    const staleSave = storage.savePlan('Target', {
      ...stale, components: [...stale.components, note(otherId)]
    }, stale.updated_at)
    releaseWrite()

    const committed = await pendingReference
    await expect(staleSave).rejects.toMatchObject({ code: ERR.CONFLICT })
    expect((await storage.readPlan('Target')).plan_id).toBe(committed.plan_id)
    expect((await storage.readPlan('Target')).components).toEqual(stale.components)
  })

  it('rebases a component mutation after a stable-ID write on the same plan', async () => {
    await plan('Target')
    service.dispose()
    let releaseWrite: () => void = () => {}
    let signalWrite: () => void = () => {}
    const writeHeld = new Promise<void>((resolve) => { releaseWrite = resolve })
    const writeStarted = new Promise<void>((resolve) => { signalWrite = resolve })
    let holdNextTargetWrite = true
    repo = new PlanRepository({
      renameFn: async (from, to) => {
        if (holdNextTargetWrite && to === join(root as string, 'Target', 'plan.json')) {
          holdNextTargetWrite = false
          signalWrite()
          await writeHeld
        }
        await fs.rename(from, to)
      }
    })
    service = new PlanReferenceService(repo, () => root)
    service.activateRoot(root as string)
    const storage = new StorageService(repo)
    storage.setRoot(root as string)
    const pendingReference = service.commitTarget({ library_id: libraryId, path: 'Target', mode: 'link' })
    await writeStarted
    const append = storage.appendComponent('Target', note(otherId))
    releaseWrite()

    const committed = await pendingReference
    await append
    const result = await storage.readPlan('Target')
    expect(result.plan_id).toBe(committed.plan_id)
    expect(result.components.map((component) => component.id)).toEqual([NOTE_ID, otherId])
  })

  it('skips a queued child removed during the scan without hiding a healthy sibling', async () => {
    await plan('AQueued')
    await plan('ZHealthy', document([note(otherId)], fixedPlanId))
    const originalRead = repo.readPlan.bind(repo)
    vi.spyOn(repo, 'readPlan').mockImplementation(async (libraryRoot, path) => {
      if (path === 'ZHealthy') await fs.rm(join(root as string, 'AQueued'), { recursive: true })
      return originalRead(libraryRoot, path)
    })

    expect((await service.search({ library_id: libraryId, query: '' })).targets)
      .toContainEqual(expect.objectContaining({ path: 'ZHealthy', plan_id: fixedPlanId }))
  })
})
