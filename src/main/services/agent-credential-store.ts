import { safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { AgentKeyStatus } from '../../shared/agent-types'
import { ERR, TraceError } from '../../shared/errors'

const PROFILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function assertAgentProfileId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !PROFILE_ID.test(id)) throw new TraceError(ERR.VALIDATION, '服务配置 ID 无效')
}

// The persisted representation contains only OS-encrypted bytes.
export class AgentCredentialStore {
  private readonly sessionKeys = new Map<string, string>()

  constructor(private readonly userDataDir: string) {}

  private file(id: string): string {
    assertAgentProfileId(id)
    const directory = resolve(this.userDataDir, 'agent-credentials')
    const file = resolve(directory, `${id}.bin`)
    if (dirname(file) !== directory) throw new TraceError(ERR.VALIDATION, '服务配置 ID 无效')
    return file
  }

  private async checkedFile(id: string): Promise<string> {
    const file = this.file(id)
    const directory = dirname(file)
    try {
      const directoryStat = await fs.lstat(directory)
      if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) throw new Error('unsafe directory')
      const expectedDirectory = join(await fs.realpath(this.userDataDir), 'agent-credentials')
      if (await fs.realpath(directory) !== expectedDirectory) throw new Error('escaped directory')
      try {
        const fileStat = await fs.lstat(file)
        if (fileStat.isSymbolicLink() || !fileStat.isFile() || await fs.realpath(file) !== join(expectedDirectory, `${id}.bin`)) {
          throw new Error('unsafe file')
        }
      } catch (error) {
        if (!isMissing(error)) throw error
      }
    } catch (error) {
      if (!isMissing(error)) throw new TraceError(ERR.PATH_UNSAFE, '凭据路径不安全')
    }
    return file
  }

  async status(id: string): Promise<AgentKeyStatus> {
    const file = await this.checkedFile(id)
    if (this.sessionKeys.has(id)) return 'session-only'
    try {
      await fs.lstat(file)
      return 'saved'
    } catch (error) {
      if (isMissing(error)) return 'missing'
      throw new TraceError(ERR.PATH_UNSAFE, '凭据路径不安全')
    }
  }

  async set(id: string, key: string): Promise<AgentKeyStatus> {
    const file = await this.checkedFile(id)
    if (!await safeStorage.isAsyncEncryptionAvailable()) {
      await this.checkedFile(id)
      this.sessionKeys.set(id, key)
      await fs.rm(file, { force: true })
      return 'session-only'
    }
    const encrypted = await safeStorage.encryptStringAsync(key)
    await fs.mkdir(dirname(file), { recursive: true })
    await this.checkedFile(id)
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temporary, encrypted, { flag: 'wx', mode: 0o600 })
      await this.checkedFile(id)
      await fs.rename(temporary, file)
    } finally {
      await fs.rm(temporary, { force: true })
    }
    this.sessionKeys.delete(id)
    return 'saved'
  }

  async remove(id: string): Promise<void> {
    const file = await this.checkedFile(id)
    this.sessionKeys.delete(id)
    await fs.rm(file, { force: true })
  }

  // Main-process provider code is the only consumer; never expose through IPC.
  async getForProvider(id: string): Promise<string | null> {
    try {
      const file = await this.checkedFile(id)
      const sessionKey = this.sessionKeys.get(id)
      if (sessionKey) return sessionKey
      const encrypted = await fs.readFile(file)
      let decrypted = await safeStorage.decryptStringAsync(encrypted)
      if (decrypted.shouldReEncrypt) {
        // Electron returns the new key's plaintext on the second decrypt call.
        decrypted = await safeStorage.decryptStringAsync(encrypted)
        if (await safeStorage.isAsyncEncryptionAvailable()) await this.set(id, decrypted.result)
      }
      return decrypted.result
    } catch {
      return null
    }
  }
}

function isMissing(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
}
