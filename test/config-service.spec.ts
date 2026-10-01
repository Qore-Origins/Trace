import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ConfigService } from '../src/main/services/config-service'
import { PlanRepository } from '../src/main/services/plan-repository'

describe('ConfigService root persistence', () => {
  const directories: string[] = []

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
  })

  it('keeps first-time root unconfigured after persistence fails and permits retry', async () => {
    const userData = await fs.mkdtemp(join(tmpdir(), 'trace-config-first-root-'))
    directories.push(userData)
    const repo = new PlanRepository()
    const config = new ConfigService(userData, repo)
    const first = join(userData, 'First')
    const retry = join(userData, 'Retry')
    vi.spyOn(repo, 'writeAppJson').mockRejectedValueOnce(new Error('config write failed'))

    await expect(config.setRootDir(first)).rejects.toThrow('config write failed')
    expect(config.getRootDir()).toBeNull()
    expect((await new ConfigService(userData, repo).load()).root_dir).toBeNull()

    await config.setRootDir(retry)
    expect(config.getRootDir()).toBe(retry)
    expect((await new ConfigService(userData, repo).load()).root_dir).toBe(retry)
  })

  it('restores the prior persisted root when a writer reports failure after replacing the file', async () => {
    const userData = await fs.mkdtemp(join(tmpdir(), 'trace-config-rollback-'))
    directories.push(userData)
    const repo = new PlanRepository()
    const config = new ConfigService(userData, repo)
    const first = join(userData, 'First')
    const second = join(userData, 'Second')
    await config.setRootDir(first)
    const originalWrite = repo.writeAppJson.bind(repo)
    vi.spyOn(repo, 'writeAppJson').mockImplementationOnce(async (filePath, data) => {
      await originalWrite(filePath, data)
      throw new Error('failure after replacement')
    })

    await expect(config.setRootDir(second)).rejects.toThrow('failure after replacement')
    expect(config.getRootDir()).toBe(first)
    expect((await new ConfigService(userData, repo).load()).root_dir).toBe(first)
  })

  it('restores an unconfigured persisted root when replacement succeeds but acknowledgement fails', async () => {
    const userData = await fs.mkdtemp(join(tmpdir(), 'trace-config-null-rollback-'))
    directories.push(userData)
    const repo = new PlanRepository()
    const config = new ConfigService(userData, repo)
    const originalWrite = repo.writeAppJson.bind(repo)
    vi.spyOn(repo, 'writeAppJson').mockImplementationOnce(async (filePath, data) => {
      await originalWrite(filePath, data)
      throw new Error('failure after replacement')
    })

    await expect(config.setRootDir(join(userData, 'Attempted'))).rejects.toThrow('failure after replacement')
    expect(config.getRootDir()).toBeNull()
    expect((await new ConfigService(userData, repo).load()).root_dir).toBeNull()
  })

  it('persists a new root and a concurrent window update without losing either field', async () => {
    const userData = await fs.mkdtemp(join(tmpdir(), 'trace-config-overlap-'))
    directories.push(userData)
    const repo = new PlanRepository()
    const config = new ConfigService(userData, repo)
    const oldRoot = join(userData, 'Old')
    const newRoot = join(userData, 'New')
    await config.setRootDir(oldRoot)
    let releaseRootWrite: () => void = () => {}
    let signalRootWrite: () => void = () => {}
    let signalRootWritten: () => void = () => {}
    const rootHeld = new Promise<void>((resolve) => { releaseRootWrite = resolve })
    const rootWriteStarted = new Promise<void>((resolve) => { signalRootWrite = resolve })
    const rootWritten = new Promise<void>((resolve) => { signalRootWritten = resolve })
    const originalWrite = repo.writeAppJson.bind(repo)
    vi.spyOn(repo, 'writeAppJson').mockImplementation(async (filePath, data) => {
      const candidate = data as { root_dir: string | null; window: { width: number } }
      if (candidate.root_dir === newRoot) {
        signalRootWrite()
        await rootHeld
        await originalWrite(filePath, data)
        signalRootWritten()
        return
      }
      if (candidate.root_dir === oldRoot && candidate.window.width === 1440) await rootWritten
      await originalWrite(filePath, data)
    })

    const changeRoot = config.setRootDir(newRoot)
    await rootWriteStarted
    const changeWindow = config.saveWindowState({ width: 1440, height: 900, maximized: true })
    await Promise.resolve()
    releaseRootWrite()
    await Promise.all([changeRoot, changeWindow])

    const reloaded = await new ConfigService(userData, repo).load()
    expect(reloaded.root_dir).toBe(newRoot)
    expect(reloaded.window).toEqual({ width: 1440, height: 900, maximized: true })
  })

  it('preserves the prior cache and original error if rollback persistence also fails', async () => {
    const userData = await fs.mkdtemp(join(tmpdir(), 'trace-config-double-failure-'))
    directories.push(userData)
    const repo = new PlanRepository()
    const config = new ConfigService(userData, repo)
    const oldRoot = join(userData, 'Old')
    const attemptedRoot = join(userData, 'Attempted')
    await config.setRootDir(oldRoot)
    const originalWrite = repo.writeAppJson.bind(repo)
    vi.spyOn(repo, 'writeAppJson')
      .mockImplementationOnce(async (filePath, data) => {
        await originalWrite(filePath, data)
        throw new Error('original write failed after replacement')
      })
      .mockRejectedValueOnce(new Error('rollback write failed'))

    await expect(config.setRootDir(attemptedRoot)).rejects.toThrow('original write failed after replacement')
    expect(config.getRootDir()).toBe(oldRoot)
    expect((await new ConfigService(userData, repo).load()).root_dir).toBe(attemptedRoot)
  })
})
