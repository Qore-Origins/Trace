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
})
