import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ERR, TraceError } from '../src/shared/errors'
import type { PlanDocument } from '../src/shared/plan-types'
import type { TrashLibraryContext, TrashService } from '../src/main/services/trash-service'
import { PlanRepository, type AgentLibraryMutationGuard } from '../src/main/services/plan-repository'

let root: string
let outside: string
let repo: PlanRepository
let trash: TrashService
let context: TrashLibraryContext
let libraryId: string

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'trace-trash-'))
  outside = await fs.mkdtemp(join(tmpdir(), 'trace-trash-outside-'))
  repo = new PlanRepository()
  libraryId = (await repo.ensureLibraryRoot(root)).library_id
  trash = new (await import('../src/main/services/trash-service')).TrashService(repo)
  context = { root, library_id: libraryId, root_generation: 1 }
})

afterEach(async () => {
  await Promise.all([
    fs.rm(root, { recursive: true, force: true }),
    fs.rm(outside, { recursive: true, force: true })
  ])
  vi.restoreAllMocks()
})

async function createPlan(path: string, planId?: string): Promise<PlanDocument> {
  await fs.mkdir(join(root, path), { recursive: true })
  const now = new Date('2026-10-03T00:00:00.000Z').toISOString()
  const document: PlanDocument = {
    format_version: '1',
    ...(planId ? { plan_id: planId } : {}),
    created_at: now,
    updated_at: now,
    components: [{ id: '11111111111111111111111111111111', type: 'note', payload: { content: `content:${path}` } }]
  }
  await repo.writePlanAtomic(root, path, document)
  return repo.readPlan(root, path)
}

async function manifestPath(entryId: string): Promise<string> {
  return join(root, '.trace', 'trash', entryId, 'manifest.json')
}

async function readManifest(entryId: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(await manifestPath(entryId), 'utf8')) as Record<string, unknown>
}

async function patchManifest(entryId: string, patch: Record<string, unknown>): Promise<void> {
  const file = await manifestPath(entryId)
  const manifest = await readManifest(entryId)
  await fs.writeFile(file, JSON.stringify({ ...manifest, ...patch }), 'utf8')
}

async function moveIntoTrash(path: string): Promise<string> {
  return (await trash.trashPlan(context, path)).entry.id
}

async function replaceRootAtSamePath(displacedRoot: string): Promise<void> {
  await fs.rename(root, displacedRoot)
  await fs.mkdir(root)
  for (const entry of await fs.readdir(displacedRoot)) {
    await fs.rename(join(displacedRoot, entry), join(root, entry))
  }
}

function rootDirectoryIdentity(stat: Awaited<ReturnType<typeof fs.lstat>>): string {
  return `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`
}

describe('readEntryById', () => {
  it('reads only the requested entry without invoking full trash enumeration', async () => {
    const first = await createPlan('First')
    const second = await createPlan('Second')
    const firstEntry = (await trash.trashPlan(context, 'First', first.updated_at)).entry
    await trash.trashPlan(context, 'Second', second.updated_at)
    vi.spyOn(trash, 'list').mockRejectedValue(new Error('full trash enumeration must not run'))

    await expect(trash.readEntryById(context, firstEntry.id)).resolves.toMatchObject({
      id: firstEntry.id, name: 'First', original_relative_path: 'First', status: 'trashed', can_purge: true
    })
  })
})

describe('trashPlan and restore/purge confirmations', () => {
  it.each(['restore', 'purge'] as const)(
    'revalidates the frozen Agent root between %s manifest and payload mutations', async (operation) => {
      const displacedRoot = `${root}-displaced`
      const frozenRootStat = await fs.lstat(root)
      const frozenRootIdentity = rootDirectoryIdentity(frozenRootStat)
      const guard: AgentLibraryMutationGuard = {
        rootDirectoryIdentity: frozenRootIdentity,
        rootGeneration: 17,
        async assertCurrent() {
          const current = await fs.lstat(root)
          if (rootDirectoryIdentity(current) !== frozenRootIdentity) {
            throw new TraceError(ERR.CONFLICT, 'frozen library identity changed')
          }
        }
      }
      let swapAfterManifestWrite = false
      let swapped = false
      let expectedManifest = ''
      const injectedRepository = new PlanRepository({
        renameFn: async (from, to) => {
          await fs.rename(from, to)
          if (swapAfterManifestWrite && to === expectedManifest && !swapped) {
            swapped = true
            await replaceRootAtSamePath(displacedRoot)
          }
        }
      })
      await injectedRepository.ensureLibraryRoot(root)
      repo = injectedRepository
      libraryId = (await repo.readLibraryMeta(root)).library_id
      trash = new (await import('../src/main/services/trash-service')).TrashService(repo)
      context = { root, library_id: libraryId, root_generation: 1 }
      await createPlan('Target')
      const entry = await trash.trashPlan(context, 'Target')
      const entryId = entry.entry.id
      expectedManifest = await manifestPath(entryId)
      const preview = operation === 'restore'
        ? await trash.previewRestore(context, entryId)
        : await trash.previewPurge(context, entryId)
      swapAfterManifestWrite = true

      try {
        const commit = operation === 'restore'
          ? trash.commitRestore(context, preview.confirmation_token, guard)
          : trash.commitPurge(context, preview.confirmation_token, guard)
        await expect(commit).rejects.toMatchObject({ code: ERR.CONFLICT })
        expect(swapped).toBe(true)
        if (operation === 'restore') {
          await expect(fs.access(join(root, '.trace', 'trash', entryId, 'payload'))).resolves.toBeUndefined()
          await expect(fs.access(join(root, 'Target'))).rejects.toMatchObject({ code: 'ENOENT' })
        } else {
          await expect(fs.access(join(root, '.trace', 'trash', entryId, 'payload'))).resolves.toBeUndefined()
        }
      } finally {
        await fs.rm(displacedRoot, { recursive: true, force: true })
      }
    }
  )

  it('rechecks the frozen restore parent identity at the final move seam and keeps payload safely restorable', async () => {
    await createPlan('Parent/Source')
    const entryId = await moveIntoTrash('Parent/Source')
    const preview = await trash.previewRestore(context, entryId)
    const parent = join(root, 'Parent')
    const displacedParent = join(outside, 'displaced-parent')
    await fs.writeFile(join(outside, 'outside-marker.txt'), 'must remain outside')
    const moveDirAtomic = repo.moveDirAtomic.bind(repo)
    let barrierHit = false
    vi.spyOn(repo, 'moveDirAtomic').mockImplementationOnce(async (from, to, mutationGuard) => {
      barrierHit = true
      await fs.rename(parent, displacedParent)
      await fs.symlink(outside, parent, 'junction')
      return moveDirAtomic(from, to, mutationGuard)
    })

    await expect(trash.commitRestore(context, preview.confirmation_token)).rejects.toMatchObject({ code: ERR.CONFLICT })

    expect(barrierHit).toBe(true)
    await expect(fs.access(join(root, '.trace', 'trash', entryId, 'payload', 'plan.json'))).resolves.toBeUndefined()
    await expect(fs.access(join(outside, 'Source'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.readFile(join(outside, 'outside-marker.txt'), 'utf8')).resolves.toBe('must remain outside')
    await expect(readManifest(entryId)).resolves.toMatchObject({ phase: 'trashed' })
    await fs.unlink(parent)
  })

  it('rechecks frozen restore payload identity and digest immediately before moving it', async () => {
    await createPlan('Source')
    const entryId = await moveIntoTrash('Source')
    const preview = await trash.previewRestore(context, entryId)
    const payload = join(root, '.trace', 'trash', entryId, 'payload')
    const displacedPayload = join(outside, 'displaced-restore-payload')
    const moveDirAtomic = repo.moveDirAtomic.bind(repo)
    let barrierHit = false
    vi.spyOn(repo, 'moveDirAtomic').mockImplementationOnce(async (from, to, mutationGuard) => {
      barrierHit = true
      await fs.rename(payload, displacedPayload)
      await fs.mkdir(payload)
      await fs.writeFile(join(payload, 'replacement.txt'), 'not reviewed')
      return moveDirAtomic(from, to, mutationGuard)
    })

    await expect(trash.commitRestore(context, preview.confirmation_token)).rejects.toMatchObject({ code: ERR.CONFLICT })

    expect(barrierHit).toBe(true)
    await expect(fs.readFile(join(payload, 'replacement.txt'), 'utf8')).resolves.toBe('not reviewed')
    await expect(fs.readFile(join(displacedPayload, 'plan.json'), 'utf8')).resolves.toContain('content:Source')
    await expect(fs.access(join(root, 'Source'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readManifest(entryId)).resolves.toMatchObject({ phase: 'restoring' })
  })

  it('exposes a validated purge summary without consuming the confirmation token', async () => {
    const plan = await createPlan('Trusted purge summary')
    const entry = await trash.trashPlan(context, 'Trusted purge summary', plan.updated_at)
    const preview = await trash.previewPurge(context, entry.entry.id)

    await expect(trash.getPurgeConfirmationSnapshot(context, preview.confirmation_token)).resolves.toEqual({
      entry_id: entry.entry.id,
      kind: 'plan',
      name: 'Trusted purge summary',
      original_relative_path: 'Trusted purge summary',
      plan_count: 1,
      reference_count: 0,
      status: 'trashed',
      expires_at: preview.expires_at
    })
    await expect(trash.commitPurge(context, preview.confirmation_token)).resolves.toHaveProperty('changed_plan_ids')
  })

  it('soft-deletes a complete plan subtree and restores stable IDs and exact plan documents', async () => {
    const parent = await createPlan('Parent', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    const child = await createPlan('Parent/Child', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
    await fs.writeFile(join(root, 'Parent', 'attachment.bin'), Buffer.from([0, 1, 2, 255]))

    const removed = await trash.trashPlan(context, 'Parent', parent.updated_at)
    expect(removed.entry).toMatchObject({ kind: 'plan', name: 'Parent', status: 'trashed', can_restore: true })
    await expect(fs.access(join(root, 'Parent'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.readFile(join(root, '.trace', 'trash', removed.entry.id, 'payload', 'Child', 'plan.json'), 'utf8'))
      .resolves.toContain(child.plan_id)

    const preview = await trash.previewRestore(context, removed.entry.id)
    await trash.commitRestore(context, preview.confirmation_token)
    await expect(repo.readPlan(root, 'Parent')).resolves.toMatchObject({ plan_id: parent.plan_id, components: parent.components })
    await expect(repo.readPlan(root, 'Parent/Child')).resolves.toMatchObject({ plan_id: child.plan_id, components: child.components })
    await expect(fs.readFile(join(root, 'Parent', 'attachment.bin'))).resolves.toEqual(Buffer.from([0, 1, 2, 255]))
    await expect(fs.access(await manifestPath(removed.entry.id))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('soft-deletes and restores an empty folder without turning it into a plan', async () => {
    await fs.mkdir(join(root, 'Archive'))
    const removed = await trash.trashPlan(context, 'Archive')

    expect(removed.entry).toMatchObject({ kind: 'folder', name: 'Archive', status: 'trashed' })
    await trash.commitRestore(context, (await trash.previewRestore(context, removed.entry.id)).confirmation_token)

    await expect(fs.readdir(join(root, 'Archive'))).resolves.toEqual([])
    await expect(fs.access(join(root, 'Archive', 'plan.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects stale plan revision and leaves the source untouched', async () => {
    await createPlan('Plan')
    await expect(trash.trashPlan(context, 'Plan', 'stale-revision')).rejects.toMatchObject({ code: ERR.CONFLICT })
    await expect(repo.readPlan(root, 'Plan')).resolves.toMatchObject({
      components: [expect.objectContaining({ payload: { content: 'content:Plan' } })]
    })
  })

  it('rejects a plan revision when plan.json disappeared before trashing', async () => {
    const plan = await createPlan('Plan')
    await fs.writeFile(join(root, 'Plan', 'attachment.bin'), 'keep')
    await fs.unlink(join(root, 'Plan', 'plan.json'))

    await expect(trash.trashPlan(context, 'Plan', plan.updated_at)).rejects.toMatchObject({ code: ERR.CONFLICT })
    await expect(fs.readFile(join(root, 'Plan', 'attachment.bin'), 'utf8')).resolves.toBe('keep')
    await expect(fs.access(join(root, 'Plan', 'plan.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await trash.list(context)).entries).toEqual([])
  })

  it('purges only after a fresh one-shot preview and a matching confirmation token', async () => {
    await createPlan('Permanent')
    const id = await moveIntoTrash('Permanent')
    const restorePreview = await trash.previewRestore(context, id)
    await expect(trash.commitPurge(context, restorePreview.confirmation_token))
      .rejects.toMatchObject({ code: ERR.CONFIRMATION_REQUIRED })
    await expect(fs.access(join(root, '.trace', 'trash', id, 'payload'))).resolves.toBeUndefined()

    const preview = await trash.previewPurge(context, id)
    await trash.commitPurge(context, preview.confirmation_token)
    await expect(fs.access(join(root, '.trace', 'trash', id))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(trash.commitPurge(context, preview.confirmation_token))
      .rejects.toMatchObject({ code: ERR.CONFIRMATION_REQUIRED })
  })

  it('refuses restore over a newly created same-name directory', async () => {
    await createPlan('Plan')
    const id = await moveIntoTrash('Plan')
    await createPlan('Plan')
    await expect(trash.previewRestore(context, id)).rejects.toMatchObject({ code: ERR.NAME_CONFLICT })
    await expect(repo.readPlan(root, 'Plan')).resolves.toMatchObject({ components: [expect.objectContaining({ payload: { content: 'content:Plan' } })] })
    await expect(fs.access(join(root, '.trace', 'trash', id, 'payload', 'plan.json'))).resolves.toBeUndefined()
  })
})

describe('manifest recovery matrix', () => {
  it('discards staging metadata only when the complete source is still present', async () => {
    await createPlan('Source')
    const id = await moveIntoTrash('Source')
    await fs.rename(join(root, '.trace', 'trash', id, 'payload'), join(root, 'Source'))
    await patchManifest(id, { phase: 'staging' })

    const listed = await trash.list(context)
    expect(listed.entries).toEqual([])
    await expect(repo.readPlan(root, 'Source')).resolves.toMatchObject({ components: [expect.objectContaining({ payload: { content: 'content:Source' } })] })
    await expect(fs.access(join(root, '.trace', 'trash', id))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('promotes staging to trashed only when the verified payload is present and source is absent', async () => {
    await createPlan('Source', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    const id = await moveIntoTrash('Source')
    await patchManifest(id, { phase: 'staging' })

    const listed = await trash.list(context)
    expect(listed.entries).toMatchObject([{ id, status: 'trashed' }])
    expect(listed.changes).toEqual([{ path: 'Source', plan_ids: ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] }])
    await expect(readManifest(id)).resolves.toMatchObject({ phase: 'trashed', revision: 3 })
  })

  it('preserves both copies and marks staging ambiguous when source and payload coexist', async () => {
    await createPlan('Source')
    const id = await moveIntoTrash('Source')
    await fs.cp(join(root, '.trace', 'trash', id, 'payload'), join(root, 'Source'), { recursive: true })
    await patchManifest(id, { phase: 'staging' })

    const listed = await trash.list(context)
    expect(listed.entries).toMatchObject([{ id, status: 'needs_attention', can_restore: false, can_purge: false }])
    await expect(fs.access(join(root, 'Source', 'plan.json'))).resolves.toBeUndefined()
    await expect(fs.access(join(root, '.trace', 'trash', id, 'payload', 'plan.json'))).resolves.toBeUndefined()
  })

  it('keeps an incomplete staging entry when both source and payload are missing', async () => {
    await createPlan('Source')
    const id = await moveIntoTrash('Source')
    await fs.rm(join(root, '.trace', 'trash', id, 'payload'), { recursive: true })
    await patchManifest(id, { phase: 'staging' })

    const listed = await trash.list(context)
    expect(listed.entries).toMatchObject([{ id, status: 'needs_attention', issue: 'identity_mismatch' }])
    await expect(fs.access(await manifestPath(id))).resolves.toBeUndefined()
    await expect(fs.access(join(root, 'Source'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rolls an interrupted restore back to trashed when target is absent and payload is intact', async () => {
    await createPlan('Source')
    const id = await moveIntoTrash('Source')
    const manifest = await readManifest(id)
    await patchManifest(id, {
      phase: 'restoring', restore_relative_path: 'Source',
      restore_parent_identity: manifest.original_parent_identity
    })

    const listed = await trash.list(context)
    expect(listed.entries).toMatchObject([{ id, status: 'trashed', can_restore: true }])
    await expect(readManifest(id)).resolves.toMatchObject({ phase: 'trashed' })
    await expect(fs.access(join(root, '.trace', 'trash', id, 'payload', 'plan.json'))).resolves.toBeUndefined()
  })

  it('completes an interrupted restore only when target identity and plan snapshot match', async () => {
    await createPlan('Source', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    const id = await moveIntoTrash('Source')
    const manifest = await readManifest(id)
    await patchManifest(id, {
      phase: 'restoring', restore_relative_path: 'Source',
      restore_parent_identity: manifest.original_parent_identity
    })
    await fs.rename(join(root, '.trace', 'trash', id, 'payload'), join(root, 'Source'))

    const listed = await trash.list(context)
    expect(listed.entries).toEqual([])
    expect(listed.changes).toEqual([{ path: 'Source', plan_ids: ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] }])
    await expect(fs.access(join(root, 'Source', 'plan.json'))).resolves.toBeUndefined()
  })

  it('does not delete either side when restoring state conflicts', async () => {
    await createPlan('Source')
    const id = await moveIntoTrash('Source')
    const manifest = await readManifest(id)
    await patchManifest(id, {
      phase: 'restoring', restore_relative_path: 'Source',
      restore_parent_identity: manifest.original_parent_identity
    })
    await createPlan('Source')

    const listed = await trash.list(context)
    expect(listed.entries).toMatchObject([{ id, status: 'needs_attention' }])
    await expect(fs.access(join(root, 'Source', 'plan.json'))).resolves.toBeUndefined()
    await expect(fs.access(join(root, '.trace', 'trash', id, 'payload', 'plan.json'))).resolves.toBeUndefined()
  })

  it('keeps a restoring entry for attention when neither target nor payload exists', async () => {
    await createPlan('Source')
    const id = await moveIntoTrash('Source')
    const manifest = await readManifest(id)
    await fs.rm(join(root, '.trace', 'trash', id, 'payload'), { recursive: true })
    await patchManifest(id, {
      phase: 'restoring', restore_relative_path: 'Source',
      restore_parent_identity: manifest.original_parent_identity
    })

    const listed = await trash.list(context)
    expect(listed.entries).toMatchObject([{ id, status: 'needs_attention', issue: 'identity_mismatch' }])
    await expect(fs.access(await manifestPath(id))).resolves.toBeUndefined()
    await expect(fs.access(join(root, 'Source'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps restoring metadata invalid when its recorded destination identity is malformed', async () => {
    await createPlan('Source')
    const id = await moveIntoTrash('Source')
    await patchManifest(id, {
      phase: 'restoring', restore_relative_path: 'Source',
      restore_parent_identity: { device: 'invalid', inode: '1', birthtime_ns: '2' }
    })

    const listed = await trash.list(context)
    expect(listed.entries).toMatchObject([{ id, status: 'needs_attention', issue: 'manifest_invalid' }])
    await expect(fs.access(join(root, '.trace', 'trash', id, 'payload', 'plan.json'))).resolves.toBeUndefined()
  })

  it('marks a still-present purging payload interrupted and requires another preview', async () => {
    await createPlan('Source')
    const id = await moveIntoTrash('Source')
    await patchManifest(id, { phase: 'purging' })

    const listed = await trash.list(context)
    expect(listed.entries).toMatchObject([{ id, status: 'purge_interrupted', can_restore: false, can_purge: true }])
    const preview = await trash.previewPurge(context, id)
    await trash.commitPurge(context, preview.confirmation_token)
    expect((await trash.list(context)).entries).toEqual([])
  })

  it('rejects an interrupted purge token when the residual payload is replaced after preview', async () => {
    await createPlan('Source')
    const id = await moveIntoTrash('Source')
    const payload = join(root, '.trace', 'trash', id, 'payload')
    await patchManifest(id, { phase: 'purging' })
    const preview = await trash.previewPurge(context, id)
    const displacedPayload = join(outside, 'displaced-payload')
    await fs.rename(payload, displacedPayload)
    await fs.mkdir(payload)
    await fs.writeFile(join(payload, 'replacement.txt'), 'not reviewed')

    await expect(trash.commitPurge(context, preview.confirmation_token)).rejects.toMatchObject({ code: ERR.CONFLICT })
    await expect(fs.readFile(join(payload, 'replacement.txt'), 'utf8')).resolves.toBe('not reviewed')
    await expect(fs.readFile(join(displacedPayload, 'plan.json'), 'utf8')).resolves.toContain('content:Source')
  })

  it('rechecks the frozen payload digest at the final recursive purge seam and never deletes a replacement', async () => {
    await createPlan('Source')
    const entryId = await moveIntoTrash('Source')
    const preview = await trash.previewPurge(context, entryId)
    const payload = join(root, '.trace', 'trash', entryId, 'payload')
    const displacedPayload = join(outside, 'displaced-purge-payload')
    const rmRecursive = repo.rmRecursive.bind(repo)
    let recursiveDeleteBarrierHit = false
    vi.spyOn(repo, 'rmRecursive').mockImplementationOnce(async (rootAbs, relativePath, mutationGuard) => {
      recursiveDeleteBarrierHit = true
      await fs.rename(payload, displacedPayload)
      await fs.mkdir(payload)
      await fs.writeFile(join(payload, 'replacement.txt'), 'not approved for deletion')
      return rmRecursive(rootAbs, relativePath, mutationGuard)
    })

    await expect(trash.commitPurge(context, preview.confirmation_token)).rejects.toMatchObject({ code: ERR.CONFLICT })

    expect(recursiveDeleteBarrierHit).toBe(true)
    await expect(fs.readFile(join(payload, 'replacement.txt'), 'utf8')).resolves.toBe('not approved for deletion')
    await expect(fs.readFile(join(displacedPayload, 'plan.json'), 'utf8')).resolves.toContain('content:Source')
    await expect(readManifest(entryId)).resolves.toMatchObject({ phase: 'purging' })
    await expect(trash.list(context)).resolves.toMatchObject({ entries: [{ id: entryId, status: 'needs_attention' }] })
  })

  it('allows a fresh interrupted-purge preview to clear a partially removed payload', async () => {
    await createPlan('Source')
    const id = await moveIntoTrash('Source')
    const payload = join(root, '.trace', 'trash', id, 'payload')
    await patchManifest(id, { phase: 'purging' })
    await fs.unlink(join(payload, 'plan.json'))

    const preview = await trash.previewPurge(context, id)
    await expect(trash.commitPurge(context, preview.confirmation_token)).resolves.toHaveProperty('changed_plan_ids')
    expect((await trash.list(context)).entries).toEqual([])
  })

  it('cleans a completed purge only when the payload is already absent', async () => {
    await createPlan('Source')
    const id = await moveIntoTrash('Source')
    await patchManifest(id, { phase: 'purging' })
    await fs.rm(join(root, '.trace', 'trash', id, 'payload'), { recursive: true })

    expect((await trash.list(context)).entries).toEqual([])
    await expect(fs.access(join(root, '.trace', 'trash', id))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps malformed and payload-mismatched entries for explicit attention', async () => {
    await createPlan('Malformed')
    const malformedId = await moveIntoTrash('Malformed')
    await fs.writeFile(await manifestPath(malformedId), '{', 'utf8')
    await createPlan('Mismatch')
    const mismatchId = await moveIntoTrash('Mismatch')
    await fs.writeFile(join(root, '.trace', 'trash', mismatchId, 'payload', 'plan.json'), '{"format_version":"1"}', 'utf8')

    const listed = await trash.list(context)
    expect(listed.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: malformedId, status: 'needs_attention', issue: 'manifest_invalid' }),
      expect.objectContaining({ id: mismatchId, status: 'needs_attention', issue: 'identity_mismatch' })
    ]))
    await expect(fs.access(join(root, '.trace', 'trash', malformedId, 'payload', 'plan.json'))).resolves.toBeUndefined()
    await expect(fs.access(join(root, '.trace', 'trash', mismatchId, 'payload', 'plan.json'))).resolves.toBeUndefined()
  })

  it('rejects a manifest symlink instead of reading outside the library', async () => {
    await createPlan('LinkedManifest')
    const id = await moveIntoTrash('LinkedManifest')
    const manifestFile = await manifestPath(id)
    const outsideManifest = join(outside, 'manifest.json')
    const manifestContents = await fs.readFile(manifestFile)
    await fs.writeFile(outsideManifest, manifestContents)
    await fs.unlink(manifestFile)
    await fs.symlink(outsideManifest, manifestFile, 'file')

    const listed = await trash.list(context)

    expect(listed.entries).toMatchObject([{ id, status: 'needs_attention', issue: 'manifest_invalid' }])
    await expect(fs.readFile(outsideManifest)).resolves.toEqual(manifestContents)
    await expect(fs.access(join(root, '.trace', 'trash', id, 'payload', 'plan.json'))).resolves.toBeUndefined()
  })
})

describe('confirmation binding and library/path safety', () => {
  it.each([
    ['unknown file', 'unexpected.bin'],
    ['stale manifest temp file', '.manifest.json.123.deadbeef.tmp']
  ])('blocks entry actions when an entry contains a %s before preview', async (_label, filename) => {
    await createPlan('Source')
    const id = await moveIntoTrash('Source')
    await fs.writeFile(join(root, '.trace', 'trash', id, filename), 'unexpected')

    expect((await trash.list(context)).entries).toMatchObject([
      { id, status: 'needs_attention', can_purge: false }
    ])
    await expect(trash.issueEntryTarget(context, id)).rejects.toMatchObject({ code: ERR.CONFLICT })
    await expect(trash.previewRestore(context, id)).rejects.toMatchObject({ code: ERR.CONFLICT })
    await expect(trash.previewPurge(context, id)).rejects.toMatchObject({ code: ERR.CONFLICT })
    await expect(fs.access(join(root, '.trace', 'trash', id, 'payload', 'plan.json'))).resolves.toBeUndefined()
  })

  it.each([
    ['unknown file', 'unexpected.bin'],
    ['stale manifest temp file', '.manifest.json.123.deadbeef.tmp']
  ])('rechecks a %s added after purge preview and preserves payload', async (_label, filename) => {
    await createPlan('Source')
    const id = await moveIntoTrash('Source')
    const preview = await trash.previewPurge(context, id)
    await fs.writeFile(join(root, '.trace', 'trash', id, filename), 'unexpected')

    await expect(trash.commitPurge(context, preview.confirmation_token)).rejects.toMatchObject({ code: ERR.CONFLICT })
    await expect(fs.access(join(root, '.trace', 'trash', id, 'payload', 'plan.json'))).resolves.toBeUndefined()
    await expect(fs.readFile(join(root, '.trace', 'trash', id, filename), 'utf8')).resolves.toBe('unexpected')
  })

  it('binds confirmations to manifest revision and digest, library, and root generation', async () => {
    await createPlan('Source')
    const id = await moveIntoTrash('Source')
    const preview = await trash.previewRestore(context, id)
    await patchManifest(id, { revision: 3 })
    await expect(trash.commitRestore(context, preview.confirmation_token)).rejects.toMatchObject({ code: ERR.CONFLICT })

    const nextPreview = await trash.previewRestore(context, id)
    await expect(trash.commitRestore({ ...context, root_generation: 2 }, nextPreview.confirmation_token))
      .rejects.toMatchObject({ code: ERR.CONFIRMATION_REQUIRED })
    const currentPreview = await trash.previewRestore(context, id)
    await expect(trash.commitRestore(context, currentPreview.confirmation_token)).resolves.toMatchObject({ path: 'Source' })
  })

  it('rejects a changed canonical manifest digest even when its revision is unchanged', async () => {
    await createPlan('Source')
    const id = await moveIntoTrash('Source')
    const preview = await trash.previewRestore(context, id)
    const manifest = await readManifest(id)
    await patchManifest(id, { deleted_at: '2026-10-02T23:59:59.000Z' })

    await expect(trash.commitRestore(context, preview.confirmation_token)).rejects.toMatchObject({ code: ERR.CONFLICT })
    await expect(fs.access(join(root, '.trace', 'trash', id, 'payload', 'plan.json'))).resolves.toBeUndefined()
    expect(await readManifest(id)).toMatchObject({ revision: manifest.revision })
  })

  it('rejects expired tokens and a changed inbound-reference signature', async () => {
    let now = 10_000
    trash = new (await import('../src/main/services/trash-service')).TrashService(repo, { now: () => now })
    await createPlan('Source')
    const id = await moveIntoTrash('Source')
    let signature = 'reference-set-1'
    trash.setReferenceImpactReader(async () => ({ signature, reference_count: 0 }))
    const preview = await trash.previewRestore(context, id)
    signature = 'reference-set-2'
    await expect(trash.commitRestore(context, preview.confirmation_token)).rejects.toMatchObject({ code: ERR.CONFLICT })

    const expiringPreview = await trash.previewRestore(context, id)
    now += 120_001
    await expect(trash.commitRestore(context, expiringPreview.confirmation_token))
      .rejects.toMatchObject({ code: ERR.CONFIRMATION_REQUIRED })
  })

  it('binds purge preview to inbound-reference count in addition to the opaque signature', async () => {
    await createPlan('Source')
    const id = await moveIntoTrash('Source')
    let referenceCount = 0
    trash.setReferenceImpactReader(async () => ({ signature: 'opaque-stable-signature', reference_count: referenceCount }))
    const preview = await trash.previewPurge(context, id)
    referenceCount = 1

    await expect(trash.commitPurge(context, preview.confirmation_token)).rejects.toMatchObject({ code: ERR.CONFLICT })
    await expect(fs.access(join(root, '.trace', 'trash', id, 'payload', 'plan.json'))).resolves.toBeUndefined()
  })

  it('rejects purge when the inbound-reference signature changes after preview', async () => {
    await createPlan('Source')
    const id = await moveIntoTrash('Source')
    let signature = 'references-before-preview'
    trash.setReferenceImpactReader(async () => ({ signature, reference_count: 0 }))
    const preview = await trash.previewPurge(context, id)
    signature = 'references-after-preview'

    await expect(trash.commitPurge(context, preview.confirmation_token)).rejects.toMatchObject({ code: ERR.CONFLICT })
    await expect(fs.access(join(root, '.trace', 'trash', id, 'payload', 'plan.json'))).resolves.toBeUndefined()
  })

  it('issues a single-use read-only entry target grant bound to the entry revision', async () => {
    await createPlan('Source')
    const id = await moveIntoTrash('Source')
    const grant = await trash.issueEntryTarget(context, id)
    await expect(trash.previewRestore(context, id, undefined, grant.token)).resolves.toMatchObject({ entry_id: id })
    await expect(trash.previewRestore(context, id, undefined, grant.token)).rejects.toMatchObject({ code: ERR.CONFIRMATION_REQUIRED })
    await expect(trash.commitRestore(context, grant.token)).rejects.toMatchObject({ code: ERR.CONFIRMATION_REQUIRED })
  })

  it('rolls back a failed restore move while keeping payload available for a new preview', async () => {
    await createPlan('Source')
    const id = await moveIntoTrash('Source')
    const preview = await trash.previewRestore(context, id)
    vi.spyOn(repo, 'moveDirAtomic').mockRejectedValueOnce(new Error('restore rename failed'))

    await expect(trash.commitRestore(context, preview.confirmation_token)).rejects.toThrow('restore rename failed')
    expect((await trash.list(context)).entries).toMatchObject([{ id, status: 'trashed', can_restore: true }])
    await expect(fs.access(join(root, '.trace', 'trash', id, 'payload', 'plan.json'))).resolves.toBeUndefined()
  })

  it('reports success if an atomic restore rename completed before its caller failed', async () => {
    await createPlan('Source', 'dddddddddddddddddddddddddddddddd')
    const id = await moveIntoTrash('Source')
    const preview = await trash.previewRestore(context, id)
    vi.spyOn(repo, 'moveDirAtomic').mockImplementationOnce(async (from, to) => {
      await fs.rename(from, to)
      throw new Error('reported after atomic restore rename')
    })

    await expect(trash.commitRestore(context, preview.confirmation_token)).resolves.toMatchObject({ path: 'Source' })
    await expect(repo.readPlan(root, 'Source')).resolves.toMatchObject({ plan_id: 'dddddddddddddddddddddddddddddddd' })
    expect((await trash.list(context)).entries).toEqual([])
  })

  it('rejects changed restore-directory identity without losing the trash payload', async () => {
    await createPlan('Source')
    await fs.mkdir(join(root, 'RestoreHere'))
    const id = await moveIntoTrash('Source')
    const preview = await trash.previewRestore(context, id, { parent_path: 'RestoreHere', name: 'Source' })
    await fs.rmdir(join(root, 'RestoreHere'))
    await fs.mkdir(join(root, 'RestoreHere'))

    await expect(trash.commitRestore(context, preview.confirmation_token)).rejects.toMatchObject({ code: ERR.CONFLICT })
    await expect(fs.access(join(root, '.trace', 'trash', id, 'payload', 'plan.json'))).resolves.toBeUndefined()
  })

  it('isolates libraries and rejects path traversal, reserved roots, Diary, and external junctions', async () => {
    await createPlan('Source')
    const id = await moveIntoTrash('Source')
    const otherRoot = await fs.mkdtemp(join(tmpdir(), 'trace-trash-other-'))
    try {
      const otherLibraryId = (await repo.ensureLibraryRoot(otherRoot)).library_id
      const otherContext = { root: otherRoot, library_id: otherLibraryId, root_generation: 1 }
      expect((await trash.list(otherContext)).entries).toEqual([])
      await expect(trash.commitRestore(otherContext, (await trash.previewRestore(context, id)).confirmation_token))
        .rejects.toMatchObject({ code: ERR.CONFIRMATION_REQUIRED })

      await expect(trash.trashPlan(context, '../Source')).rejects.toMatchObject({ code: ERR.PATH_UNSAFE })
      await expect(trash.trashPlan(context, '.trace')).rejects.toMatchObject({ code: ERR.PATH_UNSAFE })
      await fs.mkdir(join(root, 'Diary'))
      await createPlan('Diary/2026-10-03')
      await expect(trash.trashPlan(context, 'Diary')).rejects.toMatchObject({ code: ERR.PATH_UNSAFE })

      await fs.mkdir(join(outside, 'Secret'))
      await createPlanOutside('Secret')
      await fs.symlink(join(outside, 'Secret'), join(root, 'Linked'), process.platform === 'win32' ? 'junction' : 'dir')
      await expect(trash.trashPlan(context, 'Linked')).rejects.toMatchObject({ code: ERR.PATH_UNSAFE })
      await expect(fs.access(join(outside, 'Secret', 'plan.json'))).resolves.toBeUndefined()
    } finally {
      await fs.rm(otherRoot, { recursive: true, force: true })
    }
  })

  it('fails safely when a move fails before commit and returns recovered state when rename moved then threw', async () => {
    await createPlan('BeforeFailure')
    vi.spyOn(repo, 'moveDirAtomic').mockRejectedValueOnce(new Error('rename failed'))
    await expect(trash.trashPlan(context, 'BeforeFailure')).rejects.toThrow('rename failed')
    await expect(repo.readPlan(root, 'BeforeFailure')).resolves.toBeTruthy()
    expect((await trash.list(context)).entries).toEqual([])

    await createPlan('AfterFailure', 'cccccccccccccccccccccccccccccccc')
    vi.spyOn(repo, 'moveDirAtomic').mockImplementationOnce(async (from, to) => {
      await fs.rename(from, to)
      throw new Error('reported after atomic rename')
    })
    const recovered = await trash.trashPlan(context, 'AfterFailure')
    expect(recovered.entry).toMatchObject({ status: 'trashed', original_relative_path: 'AfterFailure' })
    await expect(fs.access(join(root, 'AfterFailure'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves the source when the initial staging manifest write fails', async () => {
    await createPlan('ManifestFailure')
    vi.spyOn(repo, 'writeJsonAtomic').mockRejectedValueOnce(new Error('staging manifest write failed'))

    await expect(trash.trashPlan(context, 'ManifestFailure')).rejects.toThrow('staging manifest write failed')
    await expect(repo.readPlan(root, 'ManifestFailure')).resolves.toBeTruthy()
    expect((await trash.list(context)).entries).toEqual([])
  })

  it('recovers a completed move when the final trashed-manifest write fails', async () => {
    await createPlan('FinalManifestFailure', 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')
    const writeManifest = repo.writeJsonAtomic.bind(repo)
    const writeJsonAtomic = vi.spyOn(repo, 'writeJsonAtomic')
    writeJsonAtomic.mockImplementationOnce(writeManifest)
    writeJsonAtomic.mockRejectedValueOnce(new Error('trashed manifest write failed'))

    const removed = await trash.trashPlan(context, 'FinalManifestFailure')
    expect(removed.entry).toMatchObject({ status: 'needs_attention', can_restore: false })
    expect(removed.changed).toBe(true)

    const recovered = await trash.list(context)
    expect(recovered.entries).toMatchObject([{ id: removed.entry.id, status: 'trashed', can_restore: true }])
    await expect(fs.access(join(root, 'FinalManifestFailure'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.access(join(root, '.trace', 'trash', removed.entry.id, 'payload', 'plan.json'))).resolves.toBeUndefined()
  })

  it('does not resume a failed purge until a new preview and confirmation', async () => {
    await createPlan('PurgeFailure')
    const id = await moveIntoTrash('PurgeFailure')
    const preview = await trash.previewPurge(context, id)
    vi.spyOn(repo, 'rmRecursive').mockRejectedValueOnce(new Error('payload removal failed'))

    await expect(trash.commitPurge(context, preview.confirmation_token)).rejects.toThrow('payload removal failed')
    expect((await trash.list(context)).entries).toMatchObject([{ id, status: 'purge_interrupted', can_restore: false }])
    await expect(trash.previewRestore(context, id)).rejects.toMatchObject({ code: ERR.CONFLICT })

    const freshPreview = await trash.previewPurge(context, id)
    await trash.commitPurge(context, freshPreview.confirmation_token)
    expect((await trash.list(context)).entries).toEqual([])
  })

  it('does not leak an initialized root path through entry DTOs', async () => {
    await createPlan('PrivatePath')
    const id = await moveIntoTrash('PrivatePath')
    const entry = (await trash.list(context)).entries[0]
    expect(JSON.stringify(entry)).not.toContain(root)
    expect(entry.id).toBe(id)
  })
})

async function createPlanOutside(path: string): Promise<void> {
  const dir = join(outside, path)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(join(dir, 'plan.json'), JSON.stringify({
    format_version: '1', created_at: '2026-10-03T00:00:00.000Z',
    updated_at: '2026-10-03T00:00:00.000Z', components: []
  }), 'utf8')
}
