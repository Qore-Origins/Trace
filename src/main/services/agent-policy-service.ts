import { randomBytes } from 'node:crypto'
import { promises as fs, type BigIntStats } from 'node:fs'
import type { AgentPermissionMode, AgentPermissionPolicy } from '../../shared/agent-types'
import { ERR, TraceError } from '../../shared/errors'
import { agentRecord } from './agent-session-repository'
import { assertRealPathWithinRoot, resolveWithin } from './path-safety'

const POLICY_FILE = 'agent-permission-policy.json'
const POLICY_VERSION = 1
const POLICY_MAX_BYTES = 4096
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

function sameFileSnapshot(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.birthtimeNs === right.birthtimeNs &&
    left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs
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
    return resolveWithin(this.userDataDir, POLICY_FILE).abs
  }

  private async assertFilePath(path: string, allowMissing: boolean): Promise<BigIntStats | undefined> {
    await assertRealPathWithinRoot(this.userDataDir, path, { allowMissing })
    try {
      const stat = await fs.lstat(path, { bigint: true })
      if (stat.isSymbolicLink() || !stat.isFile()) throw new TraceError(ERR.PATH_UNSAFE, '本地权限策略路径不安全')
      await assertRealPathWithinRoot(this.userDataDir, path)
      return stat
    } catch (error) {
      if (allowMissing && isMissing(error)) return undefined
      throw error
    }
  }

  private async read(): Promise<PersistedPolicy> {
    try {
      const directoryStat = await fs.stat(this.userDataDir)
      if (!directoryStat.isDirectory()) throw new TraceError(ERR.PATH_UNSAFE, '本地权限策略目录不安全')
    } catch (error) {
      if (isMissing(error)) return { version: POLICY_VERSION, mode: 'confirm' }
      throw error
    }

    const path = this.file()
    try {
      const before = await this.assertFilePath(path, true)
      if (!before) return { version: POLICY_VERSION, mode: 'confirm' }
      if (before.size > BigInt(POLICY_MAX_BYTES)) {
        throw new TraceError(ERR.FORMAT_INVALID, '本地权限策略文件无效，原文件已保留')
      }
      const contents = await fs.readFile(path)
      if (contents.byteLength > POLICY_MAX_BYTES) throw new TraceError(ERR.FORMAT_INVALID, '本地权限策略文件无效，原文件已保留')
      const after = await this.assertFilePath(path, false)
      if (!after || !sameFileSnapshot(before, after)) {
        throw new TraceError(ERR.CONFLICT, '本地权限策略在读取期间发生变化')
      }
      const parsed: unknown = JSON.parse(contents.toString('utf8'))
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
    await this.assertFilePath(path, true)

    const temporary = resolveWithin(this.userDataDir, `${POLICY_FILE}.${randomBytes(12).toString('hex')}.tmp`).abs
    await this.assertFilePath(temporary, true)
    try {
      await fs.writeFile(temporary, JSON.stringify(policy), { flag: 'wx', mode: 0o600 })
      await this.assertFilePath(temporary, false)
      await this.assertFilePath(path, true)
      await fs.rename(temporary, path)
      await this.assertFilePath(path, false)
    } catch (error) {
      if (error instanceof TraceError) throw error
      try {
        await this.assertFilePath(temporary, true)
      } catch (pathError) {
        if (pathError instanceof TraceError) throw pathError
      }
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
