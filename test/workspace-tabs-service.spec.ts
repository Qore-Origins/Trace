import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PlanRepository } from '../src/main/services/plan-repository'
import { WorkspaceTabsService } from '../src/main/services/workspace-tabs-service'
import { ERR } from '../src/shared/errors'

describe('WorkspaceTabsService', () => {
  const roots: string[] = []
  let root: string | null
  let repo: PlanRepository
  let service: WorkspaceTabsService

  beforeEach(() => {
    root = null
    repo = new PlanRepository()
    service = new WorkspaceTabsService(repo, () => root)
  })

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((path) => fs.rm(path, { recursive: true, force: true })))
  })

  async function library(name: string): Promise<{ path: string; id: string }> {
    const path = await fs.mkdtemp(join(tmpdir(), `trace-tabs-${name}-`))
    roots.push(path)
    const meta = await repo.ensureLibraryRoot(path)
    return { path, id: meta.library_id }
  }

  async function plan(path: string, relativePath: string): Promise<void> {
    const directory = join(path, relativePath)
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(join(directory, 'plan.json'), '{}')
  }

  it('restores ordered tabs and existing plan identity only in their library', async () => {
    const first = await library('first')
    const second = await library('second')
    await plan(first.path, 'A')
    await plan(first.path, 'B')
    root = first.path

    const saved = {
      library_id: first.id,
      open_paths: [{ path: 'A', plan_id: 'existing-id' }, { path: 'B' }],
      active_path: 'B'
    }
    await service.save(saved)
    await expect(service.load()).resolves.toEqual(saved)

    root = second.path
    await expect(service.load()).resolves.toEqual({ library_id: second.id, open_paths: [], active_path: null })
    await expect(fs.access(join(second.path, '.trace', 'workspace-tabs.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects an old library save after the active root changes', async () => {
    const first = await library('first')
    const second = await library('second')
    await plan(first.path, 'A')
    root = first.path
    const stale = { library_id: first.id, open_paths: [{ path: 'A' }], active_path: 'A' }
    root = second.path

    await expect(service.save(stale)).rejects.toMatchObject({ code: ERR.CONFLICT })
    await expect(service.load()).resolves.toEqual({ library_id: second.id, open_paths: [], active_path: null })
  })

  it('rejects duplicate paths and an active path outside the open list', async () => {
    const first = await library('validation')
    await plan(first.path, 'A')
    await plan(first.path, 'B')
    root = first.path
    const initial = await service.load()

    await expect(service.save({ ...initial, open_paths: [{ path: 'A' }, { path: 'A' }], active_path: 'A' }))
      .rejects.toMatchObject({ code: ERR.VALIDATION })
    await expect(service.save({ ...initial, open_paths: [{ path: 'A' }], active_path: 'B' }))
      .rejects.toMatchObject({ code: ERR.VALIDATION })
  })

  it('normalizes relative paths, rejects escapes, and filters deleted plans on restore', async () => {
    const first = await library('paths')
    await plan(first.path, 'Folder/A')
    await plan(first.path, 'B')
    root = first.path
    const initial = await service.load()
    await service.save({
      ...initial,
      open_paths: [{ path: 'Folder\\A' }, { path: 'B' }],
      active_path: 'Folder\\A'
    })
    await expect(service.load()).resolves.toEqual({
      library_id: first.id,
      open_paths: [{ path: 'Folder/A' }, { path: 'B' }],
      active_path: 'Folder/A'
    })

    await expect(service.save({ ...initial, open_paths: [{ path: '../outside' }], active_path: null }))
      .rejects.toMatchObject({ code: ERR.PATH_UNSAFE })
    await expect(service.save({ ...initial, open_paths: [{ path: '/Folder/A' }], active_path: null }))
      .rejects.toMatchObject({ code: ERR.PATH_UNSAFE })
    await fs.rm(join(first.path, 'Folder', 'A', 'plan.json'))
    await expect(service.load()).resolves.toEqual({
      library_id: first.id,
      open_paths: [{ path: 'B' }],
      active_path: null
    })
  })

  it('does not restore tabs from an old or different library identity', async () => {
    const first = await library('identity')
    await plan(first.path, 'A')
    root = first.path
    const config = join(first.path, '.trace', 'workspace-tabs.json')
    const oldShape = { open_paths: [{ path: 'A' }], active_path: 'A' }
    await fs.writeFile(config, JSON.stringify(oldShape))
    await expect(service.load()).resolves.toEqual({ library_id: first.id, open_paths: [], active_path: null })

    await fs.writeFile(config, JSON.stringify({ ...oldShape, library_id: 'another-library' }))
    await expect(service.load()).resolves.toEqual({ library_id: first.id, open_paths: [], active_path: null })
  })

  it('does not overwrite malformed JSON on load or save', async () => {
    const first = await library('damaged')
    root = first.path
    const config = join(first.path, '.trace', 'workspace-tabs.json')
    const malformed = Buffer.from('{"library_id":', 'utf8')
    await fs.writeFile(config, malformed)

    await expect(service.load()).rejects.toMatchObject({ code: ERR.FORMAT_INVALID })
    await expect(service.save({ library_id: first.id, open_paths: [], active_path: null }))
      .rejects.toMatchObject({ code: ERR.FORMAT_INVALID })
    await expect(fs.readFile(config)).resolves.toEqual(malformed)
  })
})
