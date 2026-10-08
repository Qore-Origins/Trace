// @vitest-environment happy-dom
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TraceBridge, TraceResult } from '../src/shared/ipc-contract'
import { ERR } from '../src/shared/errors'

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>()
  return {
    handlers,
    ipcMain: { handle: (name: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => handlers.set(name, handler), removeHandler: (name: string) => handlers.delete(name) },
    ipcRenderer: { invoke: vi.fn((name: string, payload: unknown) => handlers.get(name)?.({}, payload)), on: vi.fn(), removeListener: vi.fn() },
    contextBridge: { exposeInMainWorld: (_key: string, value: unknown) => Reflect.set(window, 'trace', value) },
    dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
    safeStorage: { isAsyncEncryptionAvailable: vi.fn(async () => false) }
  }
})
vi.mock('electron', () => electron)

let directory: string
let root: string
let bridge: TraceBridge
let dispose: (() => void) | undefined
let disposeReferences: (() => void) | undefined
let repo: InstanceType<typeof import('../src/main/services/plan-repository').PlanRepository>
let storage: InstanceType<typeof import('../src/main/services/storage-service').StorageService>

type DynamicInvoke = (channel: string, payload?: unknown) => Promise<TraceResult<unknown>>
function invoke(channel: string, payload?: unknown): Promise<TraceResult<unknown>> {
  return (bridge as unknown as { invoke: DynamicInvoke }).invoke(channel, payload)
}

function committedUserMessage(id: string) {
  return {
    id, role: 'user' as const, content: 'committed message', status: 'complete' as const,
    createdAt: '2026-10-04T00:00:00.000Z', requestId: 'ffffffff-ffff-4fff-8fff-ffffffffffff'
  }
}

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  electron.handlers.clear()
  Reflect.deleteProperty(window, 'trace')
  directory = await fs.mkdtemp(join(tmpdir(), 'trace-agent-target-'))
  root = join(directory, 'library')
  await fs.mkdir(root)

  const [{ PlanRepository }, { StorageService }, { PlanReferenceService }, { registerIpc }] = await Promise.all([
    import('../src/main/services/plan-repository'),
    import('../src/main/services/storage-service'),
    import('../src/main/services/plan-reference-service'),
    import('../src/main/ipc/register')
  ])
  repo = new PlanRepository()
  await repo.ensureLibraryRoot(root)
  await fs.mkdir(join(root, 'Legacy'))
  await repo.writePlanAtomic(root, 'Legacy', {
    format_version: '1', created_at: '2026-10-04T00:00:00.000Z',
    updated_at: '2026-10-04T00:00:00.000Z', components: []
  })
  storage = new StorageService(repo)
  storage.setRoot(root)
  const planReferences = new PlanReferenceService(repo, () => storage.getRootAbs())
  planReferences.activateRoot(root)
  disposeReferences = () => planReferences.dispose()
  const startup = {
    waitForRootActivation: async () => undefined,
    waitForBootstrap: async () => undefined,
    getRootActivationStatus: () => 'active',
    runAfterRootActivation: (operation: () => unknown) => Promise.resolve().then(operation),
    markRootActivated: vi.fn(), onWindowShown: vi.fn()
  }
  dispose = registerIpc({
    app: {
      getAppInfo: vi.fn(), bootstrap: vi.fn(),
      setRootDir: vi.fn(async (nextRoot: string) => { storage.setRoot(nextRoot); return {} })
    },
    storage, config: {}, transfer: {}, export: {}, search: {}, startup, planReferences,
    agentUserDataDir: directory, getWindow: () => null, log: vi.fn()
  } as unknown as Parameters<typeof registerIpc>[0])
  await import('../src/preload/index')
  bridge = window.trace
})

afterEach(async () => {
  dispose?.()
  dispose = undefined
  disposeReferences?.()
  disposeReferences = undefined
  await fs.rm(directory, { recursive: true, force: true })
})

describe('agent target typed IPC', () => {
  it.each(['Diary', 'diary', 'dIaRy', 'Diary/2026-10-05', 'DIARY/Archive/Entry', 'diary/Archive']
    .flatMap((path) => (['plan', 'folder'] as const).map((kind) => ({ path, kind }))))
    ('rejects Diary $kind operation grants for $path before issuing any target refs', async ({ path, kind }) => {
      await fs.mkdir(join(root, path), { recursive: true })
      if (kind === 'plan') await repo.writePlanAtomic(root, path, {
        format_version: '1', created_at: '2026-10-04T00:00:00.000Z',
        updated_at: '2026-10-04T00:00:00.000Z', components: []
      })
      const issued = await bridge.invoke('agent:target:grant', { targets: [{ kind, path }] })
      expect(issued).toMatchObject({ ok: false, code: ERR.PATH_UNSAFE })
      expect(JSON.stringify(issued)).not.toContain(root)
    })

  it('keeps ordinary targets usable and explicit single-entry Diary context read-only', async () => {
    const diaryPath = 'Diary/2026-10-05'
    await fs.mkdir(join(root, diaryPath), { recursive: true })
    await repo.writePlanAtomic(root, diaryPath, {
      format_version: '1', created_at: '2026-10-04T00:00:00.000Z',
      updated_at: '2026-10-04T00:00:00.000Z', components: []
    })
    await fs.mkdir(join(root, 'DiaryNotes'))
    await fs.mkdir(join(root, 'Ordinary', 'Diary'), { recursive: true })
    const issued = await bridge.invoke('agent:target:grant', { targets: [
      { kind: 'plan', path: 'Legacy' }, { kind: 'folder', path: 'DiaryNotes' },
      { kind: 'folder', path: 'Ordinary/Diary' }
    ] })
    expect(issued.ok).toBe(true)
    if (!issued.ok) return
    for (const target of issued.data.targets) {
      expect(await bridge.invoke('agent:target:validate', { setId: issued.data.id, ref: target.ref }))
        .toMatchObject({ ok: true, data: { kind: target.kind, path: target.path } })
    }
    expect(await bridge.invoke('agent:context:read', { kind: 'diary', path: diaryPath }))
      .toMatchObject({ ok: true, data: { kind: 'diary', path: diaryPath } })
    expect(await bridge.invoke('agent:context:read', { kind: 'plan', path: diaryPath }))
      .toMatchObject({ ok: false, code: ERR.VALIDATION })
  })

  it.each(['plan', 'folder'] as const)('rejects case-varied Diary audited capture and relocation for %s', async (kind) => {
    const { AgentTargetService } = await import('../src/main/services/agent-target-service')
    const targets = new AgentTargetService(storage)
    const originalPath = kind === 'plan' ? 'Legacy' : 'Ordinary'
    if (kind === 'folder') await fs.mkdir(join(root, originalPath))
    const grant = await targets.grant({ targets: [{ kind, path: originalPath }] })
    const message = committedUserMessage('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    const ref = grant.targets[0].ref
    await targets.bindGrantSetToUserMessage(grant.id, message, [ref])
    const snapshot = await targets.captureActiveLibrarySnapshot()
    const resolved = await targets.resolveGrantForMessage({ setId: grant.id, ref }, message.id)
    if (resolved.kind === 'trash') throw new Error('Expected a filesystem target')
    const relocatedPath = 'dIaRy/Relocated'
    await fs.mkdir(join(root, 'dIaRy'), { recursive: true })
    await fs.rename(join(root, originalPath), join(root, relocatedPath))

    await expect(targets.captureAuditedTarget(snapshot, relocatedPath, kind))
      .rejects.toMatchObject({ code: ERR.PATH_UNSAFE })
    await expect(targets.resolveAuditedRelocationForMessage({
      kind, setId: grant.id, ref, path: relocatedPath, directoryIdentity: resolved.directoryIdentity,
      planId: resolved.kind === 'plan' ? resolved.planId : null
    }, message.id, snapshot)).rejects.toMatchObject({ code: ERR.PATH_UNSAFE })
    await expect(targets.validate({ setId: grant.id, ref })).rejects.toMatchObject({ code: ERR.CONFLICT })
  })

  it.each((['plan', 'folder'] as const).flatMap((kind) =>
    (['validate', 'resolve', 'refresh', 'binding', 'relocation'] as const).map((operation) => ({ kind, operation }))))
    ('rejects an existing Diary $kind grant during $operation', async ({ kind, operation }) => {
      const { AgentTargetService } = await import('../src/main/services/agent-target-service')
      const targets = new AgentTargetService(storage)
      const originalPath = kind === 'plan' ? 'Legacy' : 'Ordinary'
      if (kind === 'folder') await fs.mkdir(join(root, originalPath))
      const grant = await targets.grant({ targets: [{ kind, path: originalPath }] })
      const message = committedUserMessage('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
      const ref = grant.targets[0].ref
      const input = { setId: grant.id, ref }
      await targets.bindGrantSetToUserMessage(grant.id, message, [ref])
      const snapshot = await targets.captureActiveLibrarySnapshot()
      const resolved = await targets.resolveGrantForMessage(input, message.id)
      if (resolved.kind === 'trash') throw new Error('Expected a filesystem target')

      const diaryPath = 'dIaRy/Existing'
      await fs.mkdir(join(root, 'dIaRy'), { recursive: true })
      await fs.rename(join(root, originalPath), join(root, diaryPath))
      // Emulate a grant already held in main memory before the Diary policy;
      // new public grants are rejected, so this fixture only seeds legacy state.
      const records: unknown = Reflect.get(targets, 'grants')
      if (!(records instanceof Map)) throw new Error('Expected the main-owned grant map')
      const record: unknown = records.get(ref)
      if (typeof record !== 'object' || record === null) throw new Error('Expected an existing grant')
      Reflect.set(record, 'relativePath', diaryPath)

      const identity = {
        kind, directoryIdentity: resolved.directoryIdentity,
        planId: resolved.kind === 'plan' ? resolved.planId : null
      }
      const attempt = operation === 'validate' ? targets.validate(input)
        : operation === 'resolve' ? targets.resolveGrantForMessage(input, message.id)
          : operation === 'refresh' ? targets.refreshGrantForMessage(input, message.id, snapshot)
            : operation === 'binding' ? targets.assertGrantBindingForMessage(input, message.id, snapshot, identity)
              : targets.resolveAuditedRelocationForMessage({ ...input, ...identity, path: originalPath }, message.id, snapshot)
      await expect(attempt).rejects.toMatchObject({
        code: operation === 'validate' || operation === 'resolve' ? ERR.CONFLICT : ERR.PATH_UNSAFE
      })
    })

  it('issues a read-only grant for a legacy plan and invalidates it when its snapshot changes', async () => {
    const planFile = join(root, 'Legacy', 'plan.json')
    const originalBytes = await fs.readFile(planFile)

    const issued = await invoke('agent:target:grant', {
      targets: [{ kind: 'plan', path: 'Legacy' }]
    })
    expect(issued).toMatchObject({ ok: true, data: { targets: [{ kind: 'plan', path: 'Legacy' }] } })
    if (!issued.ok) return

    const data = issued.data as { id: string; targets: Array<{ ref: string }> }
    expect(data.id).toEqual(expect.any(String))
    expect(data.targets[0].ref).toEqual(expect.any(String))
    expect(JSON.stringify(issued)).not.toContain(root)
    expect(await fs.readFile(planFile)).toEqual(originalBytes)

    const resolved = await invoke('agent:target:validate', { setId: data.id, ref: data.targets[0].ref })
    expect(resolved).toMatchObject({ ok: true, data: { kind: 'plan', path: 'Legacy' } })

    const changed = JSON.parse(originalBytes.toString('utf8')) as Record<string, unknown>
    changed.updated_at = '2026-10-04T00:00:01.000Z'
    await fs.writeFile(planFile, JSON.stringify(changed))
    expect(await invoke('agent:target:validate', { setId: data.id, ref: data.targets[0].ref }))
      .toMatchObject({ ok: false })
  })

  it('rejects a plan file swapped to an outside symlink while its snapshot is being read', async () => {
    const planPath = 'ReadRace'
    const planFile = join(root, planPath, 'plan.json')
    const detachedPlanFile = join(directory, 'detached-plan.json')
    const outsidePlanFile = join(directory, 'outside-plan.json')
    await fs.mkdir(join(root, planPath))
    await repo.writePlanAtomic(root, planPath, {
      format_version: '1', created_at: '2026-10-04T00:00:00.000Z',
      updated_at: '2026-10-04T00:00:00.000Z', components: []
    })
    await fs.writeFile(outsidePlanFile, await fs.readFile(planFile))

    const originalReadPlan = storage.readPlan.bind(storage)
    const readSpy = vi.spyOn(storage, 'readPlan').mockImplementation(async (relativePath) => {
      if (relativePath === planPath) {
        await fs.rename(planFile, detachedPlanFile)
        await fs.symlink(outsidePlanFile, planFile, 'file')
      }
      return originalReadPlan(relativePath)
    })
    try {
      expect(await invoke('agent:target:grant', { targets: [{ kind: 'plan', path: planPath }] }))
        .toMatchObject({ ok: false })
    } finally {
      readSpy.mockRestore()
      await fs.rm(planFile, { force: true })
      await fs.rename(detachedPlanFile, planFile)
    }
  })

  it('rejects a plan file replaced by a same-content file while its snapshot is being read', async () => {
    const planPath = 'ReadReplacementRace'
    const planFile = join(root, planPath, 'plan.json')
    const replacementFile = join(root, planPath, 'replacement.json')
    const detachedPlanFile = join(directory, 'detached-replaced-plan.json')
    await fs.mkdir(join(root, planPath))
    await repo.writePlanAtomic(root, planPath, {
      format_version: '1', created_at: '2026-10-04T00:00:00.000Z',
      updated_at: '2026-10-04T00:00:00.000Z', components: []
    })
    await fs.copyFile(planFile, replacementFile)

    const originalReadPlan = storage.readPlan.bind(storage)
    const readSpy = vi.spyOn(storage, 'readPlan').mockImplementation(async (relativePath) => {
      if (relativePath === planPath) {
        await fs.rename(planFile, detachedPlanFile)
        await fs.rename(replacementFile, planFile)
      }
      return originalReadPlan(relativePath)
    })
    try {
      expect(await invoke('agent:target:grant', { targets: [{ kind: 'plan', path: planPath }] }))
        .toMatchObject({ ok: false })
    } finally {
      readSpy.mockRestore()
      await fs.rm(planFile, { force: true })
      await fs.rename(detachedPlanFile, planFile)
    }
  })

  it('keeps multiple same-name @ targets distinct by exact relative path', async () => {
    for (const path of ['AreaOne/Shared', 'AreaTwo/Shared']) {
      await fs.mkdir(join(root, path), { recursive: true })
      await repo.writePlanAtomic(root, path, {
        format_version: '1', created_at: '2026-10-04T00:00:00.000Z',
        updated_at: '2026-10-04T00:00:00.000Z', components: []
      })
    }

    const issued = await invoke('agent:target:grant', {
      targets: [
        { kind: 'plan', path: 'AreaOne/Shared' },
        { kind: 'plan', path: 'AreaTwo/Shared' }
      ]
    })
    expect(issued).toMatchObject({ ok: true, data: { targets: [
      { kind: 'plan', path: 'AreaOne/Shared', name: 'Shared' },
      { kind: 'plan', path: 'AreaTwo/Shared', name: 'Shared' }
    ] } })
    if (!issued.ok) return
    const targets = (issued.data as { targets: Array<{ ref: string }> }).targets
    expect(targets[0].ref).not.toBe(targets[1].ref)
  })

  it('issues a typed grant for more than twenty distinct @ targets', async () => {
    const paths = Array.from({ length: 21 }, (_, index) => `Many/Plan${String(index + 1).padStart(2, '0')}`)
    for (const path of paths) {
      await fs.mkdir(join(root, path), { recursive: true })
      await repo.writePlanAtomic(root, path, {
        format_version: '1', created_at: '2026-10-04T00:00:00.000Z',
        updated_at: '2026-10-04T00:00:00.000Z', components: []
      })
    }

    const issued = await invoke('agent:target:grant', {
      targets: paths.map((path) => ({ kind: 'plan', path }))
    })
    expect(issued).toMatchObject({ ok: true })
    if (!issued.ok) return
    expect((issued.data as { targets: Array<{ ref: string }> }).targets).toHaveLength(21)
  })

  it('revokes an existing target set when the active library changes', async () => {
    const issued = await invoke('agent:target:grant', { targets: [{ kind: 'plan', path: 'Legacy' }] })
    expect(issued.ok).toBe(true)
    if (!issued.ok) return
    const set = issued.data as { id: string; targets: Array<{ ref: string }> }
    const nextRoot = join(directory, 'second-library')
    await fs.mkdir(nextRoot)
    await repo.ensureLibraryRoot(nextRoot)

    expect(await invoke('app:setRootDir', { dirPath: nextRoot, confirmed: true })).toMatchObject({ ok: true })
    expect(await invoke('agent:target:validate', { setId: set.id, ref: set.targets[0].ref }))
      .toMatchObject({ ok: false })
  })

  it('rejects a plan reached through a symbolic-link directory', async () => {
    const outside = join(directory, 'outside')
    await fs.mkdir(outside)
    await repo.writePlanAtomic(directory, 'outside', {
      format_version: '1', created_at: '2026-10-04T00:00:00.000Z',
      updated_at: '2026-10-04T00:00:00.000Z', components: []
    })
    await fs.symlink(outside, join(root, 'Linked'), 'junction')

    expect(await invoke('agent:target:grant', { targets: [{ kind: 'plan', path: 'Linked' }] }))
      .toMatchObject({ ok: false })
  })

  it('keeps the canonical root hash separate from each library UUID', async () => {
    const { AgentTargetService } = await import('../src/main/services/agent-target-service')
    const targets = new AgentTargetService(storage)
    const firstGrant = await targets.grant({ targets: [{ kind: 'plan', path: 'Legacy' }] })
    const firstMessage = committedUserMessage('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    await targets.bindGrantSetToUserMessage(firstGrant.id, firstMessage, [firstGrant.targets[0].ref])
    const first = await targets.resolveGrantForMessage({ setId: firstGrant.id, ref: firstGrant.targets[0].ref }, firstMessage.id)
    const firstLibraryId = first.libraryId
    expect(first.rootHash).not.toBe(firstLibraryId)

    const secondRoot = join(directory, 'third-library')
    await fs.mkdir(secondRoot)
    await repo.ensureLibraryRoot(secondRoot)
    await fs.mkdir(join(secondRoot, 'Legacy'))
    await repo.writePlanAtomic(secondRoot, 'Legacy', {
      format_version: '1', created_at: '2026-10-04T00:00:00.000Z',
      updated_at: '2026-10-04T00:00:00.000Z', components: []
    })
    storage.setRoot(secondRoot)
    targets.invalidateRoot()
    const secondGrant = await targets.grant({ targets: [{ kind: 'plan', path: 'Legacy' }] })
    const secondMessage = committedUserMessage('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    await targets.bindGrantSetToUserMessage(secondGrant.id, secondMessage, [secondGrant.targets[0].ref])
    const second = await targets.resolveGrantForMessage({ setId: secondGrant.id, ref: secondGrant.targets[0].ref }, secondMessage.id)
    expect(second.libraryId).not.toBe(firstLibraryId)
    expect(second.rootHash).not.toBe(second.libraryId)
  })

  it('captures an internal active-library snapshot without exposing paths and rejects stale roots', async () => {
    const { AgentTargetService } = await import('../src/main/services/agent-target-service')
    const targets = new AgentTargetService(storage)
    const snapshot = await targets.captureActiveLibrarySnapshot()

    expect(snapshot).toMatchObject({
      libraryId: expect.any(String),
      rootHash: expect.any(String),
      rootGeneration: 0
    })
    expect(JSON.stringify(snapshot)).not.toContain(root)
    await expect(targets.assertActiveLibrarySnapshot(snapshot)).resolves.toBeUndefined()

    const nextRoot = join(directory, 'snapshot-next-library')
    await fs.mkdir(nextRoot)
    await repo.ensureLibraryRoot(nextRoot)
    storage.setRoot(nextRoot)
    targets.invalidateRoot()

    await expect(targets.assertActiveLibrarySnapshot(snapshot)).rejects.toMatchObject({ code: ERR.CONFLICT })
  })

  it('refreshes only the original message-bound plan ref when its stable identity and active library remain unchanged', async () => {
    const { AgentTargetService } = await import('../src/main/services/agent-target-service')
    const targets = new AgentTargetService(storage)
    const grant = await targets.grant({ targets: [{ kind: 'plan', path: 'Legacy' }] })
    const message = committedUserMessage('cccccccc-cccc-4ccc-8ccc-cccccccccccc')
    const ref = grant.targets[0].ref
    await targets.bindGrantSetToUserMessage(grant.id, message, [ref])
    const snapshot = await targets.captureActiveLibrarySnapshot()
    const initial = await targets.resolveGrantForMessage({ setId: grant.id, ref }, message.id)
    const planFile = join(root, 'Legacy', 'plan.json')
    const plan = JSON.parse(await fs.readFile(planFile, 'utf8')) as Record<string, unknown>
    plan.updated_at = '2026-10-04T00:00:01.000Z'
    await fs.writeFile(planFile, JSON.stringify(plan))

    const refreshed = await targets.refreshGrantForMessage({ setId: grant.id, ref }, message.id, snapshot)
    expect(refreshed).toMatchObject({ kind: 'plan', ref, path: 'Legacy', updatedAt: '2026-10-04T00:00:01.000Z' })
    expect(refreshed.planId).toBe(initial.planId)
    expect(refreshed.directoryIdentity).toBe(initial.directoryIdentity)
    expect(JSON.stringify(refreshed)).not.toContain(root)
  })

  it('freezes message-bound @ resolutions to read capability, including same-ref refresh', async () => {
    const { AgentTargetService } = await import('../src/main/services/agent-target-service')
    const targets = new AgentTargetService(storage)
    const grant = await targets.grant({ targets: [{ kind: 'plan', path: 'Legacy' }] })
    const message = committedUserMessage('dddddddd-dddd-4ddd-8ddd-dddddddddddd')
    const ref = grant.targets[0].ref
    await targets.bindGrantSetToUserMessage(grant.id, message, [ref])

    const resolved = await targets.resolveGrantForMessage({ setId: grant.id, ref }, message.id)
    const refreshed = await targets.refreshGrantForMessage({ setId: grant.id, ref }, message.id,
      await targets.captureActiveLibrarySnapshot())

    expect(resolved.capability).toBe('read')
    expect(refreshed.capability).toBe('read')
  })

  it('rejects an active-library snapshot after library metadata identity changes', async () => {
    const { AgentTargetService } = await import('../src/main/services/agent-target-service')
    const targets = new AgentTargetService(storage)
    const snapshot = await targets.captureActiveLibrarySnapshot()
    const metadataPath = join(root, '.trace', 'plan-library.json')
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8')) as Record<string, unknown>
    metadata.library_id = '11111111111111111111111111111111'
    await fs.writeFile(metadataPath, JSON.stringify(metadata))

    await expect(targets.assertActiveLibrarySnapshot(snapshot)).rejects.toMatchObject({ code: ERR.CONFLICT })
  })

  it('invalidates a stable plan grant if its plan ID changes without a timestamp change', async () => {
    const stablePath = 'StablePlan'
    const oldPlanId = '11111111111111111111111111111111'
    const newPlanId = '22222222222222222222222222222222'
    await fs.mkdir(join(root, stablePath))
    await repo.writePlanAtomic(root, stablePath, {
      format_version: '1', plan_id: oldPlanId,
      created_at: '2026-10-04T00:00:00.000Z', updated_at: '2026-10-04T00:00:00.000Z', components: []
    })
    const issued = await invoke('agent:target:grant', { targets: [{ kind: 'plan', path: stablePath }] })
    expect(issued.ok).toBe(true)
    if (!issued.ok) return
    const grantSet = issued.data as { id: string; targets: Array<{ ref: string }> }

    await repo.writePlanAtomic(root, stablePath, {
      format_version: '1', plan_id: newPlanId,
      created_at: '2026-10-04T00:00:00.000Z', updated_at: '2026-10-04T00:00:00.000Z', components: []
    })
    expect(await invoke('agent:target:validate', { setId: grantSet.id, ref: grantSet.targets[0].ref }))
      .toMatchObject({ ok: false })
  })

  it('lists only direct children for an explicitly granted folder', async () => {
    await fs.mkdir(join(root, 'Container', 'Nested', 'DeepPlan'), { recursive: true })
    await repo.writePlanAtomic(root, 'Container/Nested/DeepPlan', {
      format_version: '1', created_at: '2026-10-04T00:00:00.000Z',
      updated_at: '2026-10-04T00:00:00.000Z', components: []
    })
    await fs.mkdir(join(root, 'Container', 'DirectPlan'))
    await repo.writePlanAtomic(root, 'Container/DirectPlan', {
      format_version: '1', created_at: '2026-10-04T00:00:00.000Z',
      updated_at: '2026-10-04T00:00:00.000Z', components: []
    })

    const issued = await invoke('agent:target:grant', { targets: [{ kind: 'folder', path: 'Container' }] })
    expect(issued).toMatchObject({ ok: true })
    if (!issued.ok) return
    const set = issued.data as { id: string; targets: Array<{ ref: string }> }
    const children = await invoke('agent:target:children', { setId: set.id, ref: set.targets[0].ref })
    expect(children).toMatchObject({ ok: true, data: [
      { path: 'Container/DirectPlan', kind: 'plan' },
      { path: 'Container/Nested', kind: 'folder' }
    ] })
    expect(JSON.stringify(children)).not.toContain('DeepPlan')
  })

  it('does not let a plan grant enumerate children', async () => {
    const issued = await invoke('agent:target:grant', { targets: [{ kind: 'plan', path: 'Legacy' }] })
    expect(issued.ok).toBe(true)
    if (!issued.ok) return
    const grantSet = issued.data as { id: string; targets: Array<{ ref: string }> }
    expect(await invoke('agent:target:children', { setId: grantSet.id, ref: grantSet.targets[0].ref }))
      .toMatchObject({ ok: false })
  })

  it('grants only an explicitly selected trash entry and binds its current manifest revision', async () => {
    await storage.trashPlan('Legacy')
    const listed = await invoke('trash:list')
    expect(listed).toMatchObject({ ok: true, data: [{ kind: 'plan', status: 'trashed' }] })
    if (!listed.ok) return
    const entry = (listed.data as Array<{ id: string; manifest_revision: number }>)[0]

    const issued = await invoke('agent:target:grant', { targets: [{ kind: 'trash', entryId: entry.id }] })
    expect(issued).toMatchObject({ ok: true, data: { targets: [{ kind: 'trash', path: null, name: 'Legacy' }] } })
    expect(JSON.stringify(issued)).not.toContain('trashEntryToken')
    if (!issued.ok) return
    const grantSet = issued.data as { id: string; targets: Array<{ ref: string }> }
    expect(await invoke('agent:target:validate', { setId: grantSet.id, ref: grantSet.targets[0].ref }))
      .toMatchObject({ ok: true, data: { kind: 'trash', path: null } })

    const manifestPath = join(root, '.trace', 'trash', entry.id, 'manifest.json')
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>
    manifest.revision = entry.manifest_revision + 1
    await fs.writeFile(manifestPath, JSON.stringify(manifest))
    expect(await invoke('agent:target:validate', { setId: grantSet.id, ref: grantSet.targets[0].ref }))
      .toMatchObject({ ok: false })
  })

  it('rejects an expired opaque grant', async () => {
    const { AgentTargetService } = await import('../src/main/services/agent-target-service')
    let now = Date.now()
    const targets = new AgentTargetService(storage, () => now)
    const grantSet = await targets.grant({ targets: [{ kind: 'plan', path: 'Legacy' }] })
    now += 5 * 60 * 1000
    await expect(targets.validate({ setId: grantSet.id, ref: grantSet.targets[0].ref })).rejects.toMatchObject({ code: expect.any(Number) })
  })

  it('binds a grant set to one user message and resolves only the refs confirmed by each preview', async () => {
    const { AgentTargetService } = await import('../src/main/services/agent-target-service')
    const targets = new AgentTargetService(storage)
    await fs.mkdir(join(root, 'SecondPlan'))
    await repo.writePlanAtomic(root, 'SecondPlan', {
      format_version: '1', created_at: '2026-10-04T00:00:00.000Z',
      updated_at: '2026-10-04T00:00:00.000Z', components: []
    })
    const grantSet = await targets.grant({ targets: [{ kind: 'plan', path: 'Legacy' }, { kind: 'plan', path: 'SecondPlan' }] })
    const grantA = { setId: grantSet.id, ref: grantSet.targets[0].ref }
    const grantB = { setId: grantSet.id, ref: grantSet.targets[1].ref }
    const userMessage = committedUserMessage('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    const nextUserMessage = committedUserMessage('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    const errorMessage = {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', role: 'assistant', content: '', status: 'error-interrupted',
      createdAt: '2026-10-04T00:00:00.000Z', requestId: 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    } as const

    await expect(targets.resolveGrantForMessage(grantA, userMessage.id))
      .rejects.toMatchObject({ code: ERR.CONFLICT })
    await targets.bindGrantSetToUserMessage(grantSet.id, userMessage, [grantA.ref])
    await targets.bindGrantSetToUserMessage(grantSet.id, userMessage, [grantA.ref])
    await expect(targets.resolveGrantForMessage(grantA, userMessage.id)).resolves.toMatchObject({ kind: 'plan', path: 'Legacy' })
    await expect(targets.resolveGrantForMessage(grantB, userMessage.id))
      .rejects.toMatchObject({ code: ERR.CONFLICT })

    await expect(targets.bindGrantSetToUserMessage(grantSet.id, userMessage, [grantB.ref]))
      .rejects.toMatchObject({ code: ERR.CONFLICT })
    await expect(targets.resolveGrantForMessage(grantB, userMessage.id))
      .rejects.toMatchObject({ code: ERR.CONFLICT })
    await expect(targets.bindGrantSetToUserMessage(grantSet.id, nextUserMessage, [grantA.ref]))
      .rejects.toMatchObject({ code: ERR.CONFLICT })
    await expect(targets.resolveGrantForMessage(grantA, nextUserMessage.id))
      .rejects.toMatchObject({ code: ERR.CONFLICT })

    const newGrantSet = await targets.grant({ targets: [{ kind: 'plan', path: 'SecondPlan' }] })
    await targets.bindGrantSetToUserMessage(newGrantSet.id, nextUserMessage, [newGrantSet.targets[0].ref])
    await expect(targets.resolveGrantForMessage({ setId: newGrantSet.id, ref: newGrantSet.targets[0].ref }, nextUserMessage.id))
      .resolves.toMatchObject({ kind: 'plan', path: 'SecondPlan' })

    const unboundSet = await targets.grant({ targets: [{ kind: 'plan', path: 'Legacy' }] })
    await expect(targets.bindGrantSetToUserMessage(unboundSet.id, errorMessage, [unboundSet.targets[0].ref]))
      .rejects.toMatchObject({ code: ERR.VALIDATION })
  })

  it('rejects empty, duplicate, and cross-set preview refs without partially binding a grant set', async () => {
    const { AgentTargetService } = await import('../src/main/services/agent-target-service')
    const targets = new AgentTargetService(storage)
    await fs.mkdir(join(root, 'SecondPlan'))
    await repo.writePlanAtomic(root, 'SecondPlan', {
      format_version: '1', created_at: '2026-10-04T00:00:00.000Z',
      updated_at: '2026-10-04T00:00:00.000Z', components: []
    })
    const grantSet = await targets.grant({ targets: [{ kind: 'plan', path: 'Legacy' }, { kind: 'plan', path: 'SecondPlan' }] })
    const otherSet = await targets.grant({ targets: [{ kind: 'plan', path: 'Legacy' }] })
    const [refA, refB] = grantSet.targets.map((grant) => grant.ref)
    const firstMessage = committedUserMessage('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    const secondMessage = committedUserMessage('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')

    await expect(targets.bindGrantSetToUserMessage(grantSet.id, firstMessage, []))
      .rejects.toMatchObject({ code: ERR.VALIDATION })
    await expect(targets.bindGrantSetToUserMessage(grantSet.id, firstMessage, [refA, refA]))
      .rejects.toMatchObject({ code: ERR.VALIDATION })
    await expect(targets.bindGrantSetToUserMessage(grantSet.id, firstMessage, [refA, otherSet.targets[0].ref]))
      .rejects.toMatchObject({ code: ERR.VALIDATION })

    await targets.bindGrantSetToUserMessage(grantSet.id, secondMessage, [refA])
    await expect(targets.resolveGrantForMessage({ setId: grantSet.id, ref: refA }, secondMessage.id))
      .resolves.toMatchObject({ kind: 'plan', path: 'Legacy' })
    await expect(targets.resolveGrantForMessage({ setId: grantSet.id, ref: refB }, secondMessage.id))
      .rejects.toMatchObject({ code: ERR.CONFLICT })
  })

  it('allows an explicit trash target to create one exact preview, never a commit', async () => {
    const { AgentTargetService } = await import('../src/main/services/agent-target-service')
    await storage.trashPlan('Legacy')
    const entry = (await storage.listTrashEntries())[0]
    const targets = new AgentTargetService(storage)
    const grantSet = await targets.grant({ targets: [{ kind: 'trash', entryId: entry.id }] })
    const message = committedUserMessage('dddddddd-dddd-4ddd-8ddd-dddddddddddd')
    await targets.bindGrantSetToUserMessage(grantSet.id, message, [grantSet.targets[0].ref])
    const resolved = await targets.resolveGrantForMessage({ setId: grantSet.id, ref: grantSet.targets[0].ref }, message.id)
    expect(resolved.kind).toBe('trash')
    if (resolved.kind !== 'trash') return
    expect(resolved.trashEntryToken).toEqual(expect.any(String))

    const preview = await targets.previewTrashOperation({ setId: grantSet.id, ref: grantSet.targets[0].ref }, 'purge', message.id)
    expect(preview).toMatchObject({ operation: 'purge', entry_id: entry.id })
    expect((await storage.listTrashEntries()).some((candidate) => candidate.id === entry.id)).toBe(true)
    await expect(targets.previewTrashOperation({ setId: grantSet.id, ref: grantSet.targets[0].ref }, 'purge', message.id))
      .rejects.toMatchObject({ code: expect.any(Number) })
  })

  it('rejects a trash preview if the manifest digest changes without a revision bump', async () => {
    const { AgentTargetService } = await import('../src/main/services/agent-target-service')
    await storage.trashPlan('Legacy')
    const entry = (await storage.listTrashEntries())[0]
    const targets = new AgentTargetService(storage)
    const grantSet = await targets.grant({ targets: [{ kind: 'trash', entryId: entry.id }] })
    const message = committedUserMessage('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')
    await targets.bindGrantSetToUserMessage(grantSet.id, message, [grantSet.targets[0].ref])
    const manifestPath = join(root, '.trace', 'trash', entry.id, 'manifest.json')
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>
    manifest.deleted_at = '2026-10-04T00:00:01.000Z'
    await fs.writeFile(manifestPath, JSON.stringify(manifest))

    await expect(targets.previewTrashOperation({ setId: grantSet.id, ref: grantSet.targets[0].ref }, 'restore', message.id))
      .rejects.toMatchObject({ code: ERR.CONFIRMATION_REQUIRED })
    expect((await storage.listTrashEntries()).some((candidate) => candidate.id === entry.id)).toBe(true)
  })
})
