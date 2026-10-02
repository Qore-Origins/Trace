import { safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, resolve } from 'node:path'
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

  async status(id: string): Promise<AgentKeyStatus> {
    const file = this.file(id)
    if (this.sessionKeys.has(id)) return 'session-only'
    try {
      await fs.access(file)
      return 'saved'
    } catch {
      return 'missing'
    }
  }

  async set(id: string, key: string): Promise<AgentKeyStatus> {
    const file = this.file(id)
    if (!await safeStorage.isAsyncEncryptionAvailable()) {
      this.sessionKeys.set(id, key)
      await fs.rm(file, { force: true })
      return 'session-only'
    }
    const encrypted = await safeStorage.encryptStringAsync(key)
    await fs.mkdir(dirname(file), { recursive: true })
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temporary, encrypted, { flag: 'wx', mode: 0o600 })
      await fs.rename(temporary, file)
    } finally {
      await fs.rm(temporary, { force: true })
    }
    this.sessionKeys.delete(id)
    return 'saved'
  }

  async remove(id: string): Promise<void> {
    const file = this.file(id)
    this.sessionKeys.delete(id)
    await fs.rm(file, { force: true })
  }

  // Main-process provider code is the only consumer; never expose through IPC.
  async getForProvider(id: string): Promise<string | null> {
    const file = this.file(id)
    const sessionKey = this.sessionKeys.get(id)
    if (sessionKey) return sessionKey
    try {
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
