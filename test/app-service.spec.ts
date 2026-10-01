import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AppService } from '../src/main/services/app-service'
import { ConfigService } from '../src/main/services/config-service'
import { PlanRepository } from '../src/main/services/plan-repository'
import { PlanReferenceService } from '../src/main/services/plan-reference-service'
import { StorageService } from '../src/main/services/storage-service'
import { ERR } from '../src/shared/errors'

vi.mock('electron', () => ({ app: { getVersion: () => '0.18.1' } }))

describe('AppService reference commit handoff', () => {
  const roots: string[] = []
  let referenceService: PlanReferenceService | undefined

  afterEach(async () => {
    referenceService?.dispose()
    referenceService = undefined
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
  })

  it('closes the commit gate before switching and drains an active target write', async () => {
    const first = await fs.mkdtemp(join(tmpdir(), 'trace-app-reference-first-'))
    const second = await fs.mkdtemp(join(tmpdir(), 'trace-app-reference-second-'))
    const userData = await fs.mkdtemp(join(tmpdir(), 'trace-app-reference-config-'))
    roots.push(first, second, userData)
    let releaseWrite: () => void = () => {}
    let signalWrite: () => void = () => {}
    const writeHeld = new Promise<void>((resolve) => { releaseWrite = resolve })
    const writeStarted = new Promise<void>((resolve) => { signalWrite = resolve })
    let holdTargetWrite = false
    const repo = new PlanRepository({
      renameFn: async (from, to) => {
        if (holdTargetWrite && to === join(first, 'Target', 'plan.json')) {
          holdTargetWrite = false
          signalWrite()
          await writeHeld
        }
        await fs.rename(from, to)
      }
    })
    const firstMeta = await repo.ensureLibraryRoot(first)
    await fs.mkdir(join(first, 'Target'))
    await repo.writePlanAtomic(first, 'Target', {
      format_version: '1', created_at: '2026-09-30T00:00:00.000Z',
      updated_at: '2026-09-30T00:00:00.000Z', components: []
    })
    const config = new ConfigService(userData, repo)
    await config.setRootDir(first)
    const storage = new StorageService(repo)
    storage.setRoot(first)
    referenceService = new PlanReferenceService(repo, () => storage.getRootAbs())
    referenceService.activateRoot(first)
    const appService = new AppService(config, repo, storage, (root) => referenceService?.activateRoot(root),
      () => 'ready', referenceService)
    const ensureLibrary = vi.spyOn(repo, 'ensureLibraryRoot')
    holdTargetWrite = true
    const activeCommit = referenceService.commitTarget({ library_id: firstMeta.library_id, path: 'Target', mode: 'link' })
    await writeStarted
    const switching = appService.setRootDir(second, true)
    try {
      expect(ensureLibrary).not.toHaveBeenCalledWith(second)
      expect(storage.getRootAbs()).toBe(first)
      await expect(referenceService.commitTarget({ library_id: firstMeta.library_id, path: 'Target', mode: 'link' }))
        .rejects.toMatchObject({ code: ERR.CONFLICT })
    } finally {
      releaseWrite()
      await Promise.allSettled([activeCommit, switching])
    }
    expect(storage.getRootAbs()).toBe(second)
    expect((await repo.readPlan(first, 'Target')).plan_id).toMatch(/^[0-9a-f]{32}$/)
  })

  it('reopens the active library if the proposed root cannot be initialized', async () => {
    const first = await fs.mkdtemp(join(tmpdir(), 'trace-app-reference-existing-'))
    const userData = await fs.mkdtemp(join(tmpdir(), 'trace-app-reference-config-'))
    roots.push(first, userData)
    const repo = new PlanRepository()
    const firstMeta = await repo.ensureLibraryRoot(first)
    await fs.mkdir(join(first, 'Target'))
    await repo.writePlanAtomic(first, 'Target', {
      format_version: '1', created_at: '2026-09-30T00:00:00.000Z',
      updated_at: '2026-09-30T00:00:00.000Z', components: []
    })
    const config = new ConfigService(userData, repo)
    await config.setRootDir(first)
    const storage = new StorageService(repo)
    storage.setRoot(first)
    referenceService = new PlanReferenceService(repo, () => storage.getRootAbs())
    referenceService.activateRoot(first)
    const appService = new AppService(config, repo, storage, (root) => referenceService?.activateRoot(root),
      () => 'ready', referenceService)
    const invalidRoot = join(first, 'not-a-directory')
    await fs.writeFile(invalidRoot, 'keep')

    await expect(appService.setRootDir(invalidRoot, true)).rejects.toThrow()
    expect(storage.getRootAbs()).toBe(first)
    expect(await referenceService.commitTarget({ library_id: firstMeta.library_id, path: 'Target', mode: 'link' }))
      .toMatchObject({ path: 'Target' })
  })

  it('restores the active configuration if saving the new root fails', async () => {
    const first = await fs.mkdtemp(join(tmpdir(), 'trace-app-reference-existing-'))
    const second = await fs.mkdtemp(join(tmpdir(), 'trace-app-reference-new-'))
    const userData = await fs.mkdtemp(join(tmpdir(), 'trace-app-reference-config-'))
    roots.push(first, second, userData)
    const repo = new PlanRepository()
    const firstMeta = await repo.ensureLibraryRoot(first)
    await fs.mkdir(join(first, 'Target'))
    await repo.writePlanAtomic(first, 'Target', {
      format_version: '1', created_at: '2026-09-30T00:00:00.000Z',
      updated_at: '2026-09-30T00:00:00.000Z', components: []
    })
    const config = new ConfigService(userData, repo)
    await config.setRootDir(first)
    const storage = new StorageService(repo)
    storage.setRoot(first)
    referenceService = new PlanReferenceService(repo, () => storage.getRootAbs())
    referenceService.activateRoot(first)
    const appService = new AppService(config, repo, storage, (root) => referenceService?.activateRoot(root),
      () => 'ready', referenceService)
    vi.spyOn(repo, 'writeAppJson').mockRejectedValueOnce(new Error('config write failed'))

    await expect(appService.setRootDir(second, true)).rejects.toThrow('config write failed')
    expect(config.getRootDir()).toBe(first)
    expect(storage.getRootAbs()).toBe(first)
    expect(await referenceService.commitTarget({ library_id: firstMeta.library_id, path: 'Target', mode: 'link' }))
      .toMatchObject({ path: 'Target' })
  })
})
