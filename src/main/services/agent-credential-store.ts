import { safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { AgentKeyStatus } from '../../shared/agent-types'

// The persisted representation contains only OS-encrypted bytes.
export class AgentCredentialStore {
  private readonly sessionKeys = new Map<string, string>()

  constructor(private readonly userDataDir: string) {}

  private file(id: string): string {
    return join(this.userDataDir, 'agent-credentials', `${id}.bin`)
  }

  async status(id: string): Promise<AgentKeyStatus> {
    if (this.sessionKeys.has(id)) return 'session-only'
    try {
      await fs.access(this.file(id))
      return 'saved'
    } catch {
      return 'missing'
    }
  }

  async set(id: string, key: string): Promise<AgentKeyStatus> {
    if (!await safeStorage.isAsyncEncryptionAvailable()) {
      this.sessionKeys.set(id, key)
      await fs.rm(this.file(id), { force: true })
      return 'session-only'
    }
    const encrypted = await safeStorage.encryptStringAsync(key)
    const file = this.file(id)
    await fs.mkdir(join(this.userDataDir, 'agent-credentials'), { recursive: true })
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
    this.sessionKeys.delete(id)
    await fs.rm(this.file(id), { force: true })
  }

  // Main-process provider code is the only consumer; never expose through IPC.
  async getForProvider(id: string): Promise<string | null> {
    const sessionKey = this.sessionKeys.get(id)
    if (sessionKey) return sessionKey
    try {
      const encrypted = await fs.readFile(this.file(id))
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
