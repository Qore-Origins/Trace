import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { AgentPermissionMode, AgentPermissionPolicy } from '../../shared/agent-types'
import { ERR, TraceError } from '../../shared/errors'
import { agentRecord } from './agent-session-repository'

const POLICY_FILE = 'agent-permission-policy.json'
const POLICY_VERSION = 1
const ALLOWED_MODES = new Set<AgentPermissionMode>(['confirm', 'restricted', 'unrestricted'])

interface PersistedPolicy {
  version: typeof POLICY_VERSION
  mode: AgentPermissionMode
}

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!agentRecord(value)) return false
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) return false
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor !== undefined && 'value' in descriptor
  })
}

function parsePolicyInput(value: unknown): AgentPermissionPolicy {
  if (!exactRecord(value, ['mode']) || typeof value.mode !== 'string' || !ALLOWED_MODES.has(value.mode as AgentPermissionMode)) {
    throw new TraceError(ERR.VALIDATION, '权限策略无效')
  }
  return { mode: value.mode as AgentPermissionMode }
}

function isMissing(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
}

export class AgentPolicyService {
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly userDataDir: string) {}

  get(): Promise<AgentPermissionPolicy> {
    return this.serial(async () => {
      const stored = await this.read()
      return { mode: stored.mode }
    })
  }

  set(input: unknown): Promise<AgentPermissionPolicy> {
    return this.serial(async () => {
      const policy = parsePolicyInput(input)
      await this.write({ version: POLICY_VERSION, mode: policy.mode })
      return policy
    })
  }

  private file(): string {
    return join(this.userDataDir, POLICY_FILE)
  }

  private async read(): Promise<PersistedPolicy> {
    const path = this.file()
    try {
      const stat = await fs.lstat(path)
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 4096) {
        throw new TraceError(ERR.FORMAT_INVALID, '本地权限策略文件无效，原文件已保留')
      }
      const parsed: unknown = JSON.parse(await fs.readFile(path, 'utf8'))
      if (!exactRecord(parsed, ['version', 'mode']) || parsed.version !== POLICY_VERSION ||
        typeof parsed.mode !== 'string' || !ALLOWED_MODES.has(parsed.mode as AgentPermissionMode)) {
        throw new TraceError(ERR.FORMAT_INVALID, '本地权限策略格式无效，原文件已保留')
      }
      return { version: POLICY_VERSION, mode: parsed.mode as AgentPermissionMode }
    } catch (error) {
      if (isMissing(error)) return { version: POLICY_VERSION, mode: 'confirm' }
      if (error instanceof TraceError) throw error
      throw new TraceError(ERR.INTERNAL, '本地权限策略无法读取')
    }
  }

  private async write(policy: PersistedPolicy): Promise<void> {
    await fs.mkdir(this.userDataDir, { recursive: true })
    const path = this.file()
    try {
      const stat = await fs.lstat(path)
      if (stat.isSymbolicLink() || !stat.isFile()) throw new TraceError(ERR.PATH_UNSAFE, '本地权限策略路径不安全')
    } catch (error) {
      if (!isMissing(error)) throw error
    }

    const temporary = `${path}.${randomBytes(12).toString('hex')}.tmp`
    try {
      await fs.writeFile(temporary, JSON.stringify(policy), { flag: 'wx', mode: 0o600 })
      await fs.rename(temporary, path)
    } catch (error) {
      if (error instanceof TraceError) throw error
      throw new TraceError(ERR.INTERNAL, '本地权限策略无法保存')
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined)
    }
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.queue.then(operation)
    this.queue = current.then(() => undefined, () => undefined)
    return current
  }
}
