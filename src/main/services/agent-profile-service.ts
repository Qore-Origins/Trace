import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { ERR, TraceError } from '../../shared/errors'
import { AGENT_PROVIDER_PRESETS } from '../../shared/agent-provider-catalog'
import type { AgentCapability, AgentProfile, AgentProfileInput, AgentProfileList, AgentProviderPreset } from '../../shared/agent-types'
import { AgentCredentialStore, assertAgentProfileId } from './agent-credential-store'
import { testAgentToolCapability } from './agent-capability-test'

type SavedProfile = Omit<AgentProfile, 'keyStatus'>
interface SavedProfiles { version: 1; defaultProfileId: string | null; profiles: SavedProfile[] }
const INITIAL: SavedProfiles = { version: 1, defaultProfileId: null, profiles: [] }
const UNTESTED: AgentCapability = { status: 'untested', testedAt: null, errorCategory: null }

function plainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function validEndpoint(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || value.trim() !== value) throw new TraceError(ERR.VALIDATION, '服务地址无效')
  let url: URL
  try { url = new URL(value) } catch { throw new TraceError(ERR.VALIDATION, '服务地址无效') }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash || !hostname) {
    throw new TraceError(ERR.VALIDATION, '远程服务地址须使用 HTTPS；HTTP 仅允许本机 loopback')
  }
  return url.toString().replace(/\/$/, '')
}

function parseInput(value: unknown): AgentProfileInput {
  if (!plainRecord(value)) throw new TraceError(ERR.VALIDATION, '服务配置无效')
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80 || typeof value.model !== 'string' || !value.model.trim() || value.model.length > 160) {
    throw new TraceError(ERR.VALIDATION, '服务名称或模型无效')
  }
  if (value.presetId !== undefined && value.presetId !== null && (typeof value.presetId !== 'string' || !AGENT_PROVIDER_PRESETS.some((preset) => preset.id === value.presetId))) {
    throw new TraceError(ERR.VALIDATION, '服务商预设无效')
  }
  return { name: value.name.trim(), model: value.model.trim(), endpoint: validEndpoint(value.endpoint), presetId: value.presetId as string | null | undefined }
}

export class AgentProfileService {
  readonly credentials: AgentCredentialStore
  private queue = Promise.resolve()
  // Main-only generation, unrelated to key bytes and never serialized into a DTO.
  private readonly credentialRevisions = new Map<string, number>()
  private readonly capabilityRevisions = new Map<string, number>()

  constructor(private readonly userDataDir: string) {
    this.credentials = new AgentCredentialStore(userDataDir)
  }

  providers(): readonly AgentProviderPreset[] { return AGENT_PROVIDER_PRESETS.map((preset) => ({ ...preset })) }

  private file(): string { return join(this.userDataDir, 'agent-profiles.json') }

  private async read(): Promise<SavedProfiles> {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.file(), 'utf8'))
      if (!plainRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.profiles) || (parsed.defaultProfileId !== null && typeof parsed.defaultProfileId !== 'string')) throw new Error('invalid')
      if (parsed.defaultProfileId !== null) assertAgentProfileId(parsed.defaultProfileId)
      const profiles: SavedProfile[] = parsed.profiles.map((value: unknown) => {
        if (!plainRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.endpoint !== 'string' || typeof value.model !== 'string' || value.protocol !== 'openai-chat-completions' || !plainRecord(value.capability)) throw new Error('invalid')
        assertAgentProfileId(value.id)
        const capability = value.capability
        if (!['untested', 'passed', 'failed', 'needs-retest'].includes(String(capability.status)) || (capability.testedAt !== null && typeof capability.testedAt !== 'string') || (capability.errorCategory !== null && typeof capability.errorCategory !== 'string')) throw new Error('invalid')
        return {
          id: value.id, name: value.name, endpoint: value.endpoint, model: value.model,
          presetId: typeof value.presetId === 'string' ? value.presetId : null,
          protocol: 'openai-chat-completions',
          capability: { status: capability.status as AgentCapability['status'], testedAt: capability.testedAt as string | null, errorCategory: capability.errorCategory as string | null }
        }
      })
      return { version: 1, defaultProfileId: parsed.defaultProfileId, profiles }
    } catch (error) {
      if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return { ...INITIAL, profiles: [] }
      throw new TraceError(ERR.INTERNAL, '服务配置无法读取')
    }
  }

  private async write(data: SavedProfiles): Promise<void> {
    await fs.mkdir(this.userDataDir, { recursive: true })
    const temporary = `${this.file()}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temporary, JSON.stringify(data), { flag: 'wx', mode: 0o600 })
      await fs.rename(temporary, this.file())
    } finally { await fs.rm(temporary, { force: true }) }
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  private async dto(profile: SavedProfile): Promise<AgentProfile> {
    return { ...profile, capability: { ...profile.capability }, keyStatus: await this.credentials.status(profile.id) }
  }

  list(): Promise<AgentProfileList> {
    return this.serial(async () => {
      const data = await this.read()
      return { profiles: await Promise.all(data.profiles.map((profile) => this.dto(profile))), defaultProfileId: data.defaultProfileId }
    })
  }

  create(payload: unknown): Promise<AgentProfile> {
    return this.serial(async () => {
      const input = parseInput(payload)
      const data = await this.read()
      const profile: SavedProfile = { id: randomUUID(), name: input.name, endpoint: input.endpoint, model: input.model, presetId: input.presetId ?? null, protocol: 'openai-chat-completions', capability: { ...UNTESTED } }
      data.profiles.push(profile)
      data.defaultProfileId ??= profile.id
      await this.write(data)
      return this.dto(profile)
    })
  }

  update(payload: unknown): Promise<AgentProfile> {
    return this.serial(async () => {
      if (!plainRecord(payload) || typeof payload.id !== 'string') throw new TraceError(ERR.VALIDATION, '服务配置无效')
      const input = parseInput(payload)
      const data = await this.read()
      const profile = data.profiles.find((item) => item.id === payload.id)
      if (!profile) throw new TraceError(ERR.PATH_NOT_FOUND, '服务配置不存在')
      const changed = profile.endpoint !== input.endpoint || profile.model !== input.model
      Object.assign(profile, { name: input.name, endpoint: input.endpoint, model: input.model, presetId: input.presetId ?? null })
      if (changed) {
        this.capabilityRevisions.set(profile.id, (this.capabilityRevisions.get(profile.id) ?? 0) + 1)
        profile.capability = { status: 'needs-retest', testedAt: null, errorCategory: null }
      }
      await this.write(data)
      return this.dto(profile)
    })
  }

  setDefault(id: unknown): Promise<AgentProfile> {
    return this.serial(async () => {
      const data = await this.read()
      const profile = data.profiles.find((item) => item.id === id)
      if (!profile) throw new TraceError(ERR.PATH_NOT_FOUND, '服务配置不存在')
      data.defaultProfileId = profile.id
      await this.write(data)
      return this.dto(profile)
    })
  }

  delete(id: unknown): Promise<AgentProfileList> {
    return this.serial(async () => {
      const data = await this.read()
      const index = data.profiles.findIndex((item) => item.id === id)
      if (index < 0) throw new TraceError(ERR.PATH_NOT_FOUND, '服务配置不存在')
      const removed = data.profiles[index]
      const keyStatus = await this.credentials.status(removed.id)
      const originalKey = keyStatus === 'missing' ? null : await this.credentials.getForProvider(removed.id)
      if (keyStatus !== 'missing' && originalKey === null) throw new TraceError(ERR.VALIDATION, '当前密钥无法读取，服务删除未完成')
      // Keep a durable fail-closed profile before touching credentials. A failed
      // final deletion can then restore the key without restoring a stale pass.
      removed.capability = { status: 'needs-retest', testedAt: null, errorCategory: null }
      await this.write(data)
      this.credentialRevisions.set(removed.id, (this.credentialRevisions.get(removed.id) ?? 0) + 1)
      try {
        await this.credentials.remove(removed.id)
        data.profiles.splice(index, 1)
        if (data.defaultProfileId === removed.id) data.defaultProfileId = data.profiles[0]?.id ?? null
        await this.write(data)
      } catch (error) {
        if (originalKey !== null) {
          try { await this.credentials.set(removed.id, originalKey) }
          catch { throw new TraceError(ERR.CREDENTIAL_RECOVERY_REQUIRED, '服务删除部分失败，密钥未能恢复；请重新配置密钥并重测能力') }
        }
        throw error
      }
      return { profiles: await Promise.all(data.profiles.map((profile) => this.dto(profile))), defaultProfileId: data.defaultProfileId }
    })
  }

  setKey(id: unknown, key: unknown): Promise<AgentProfile> {
    return this.serial(async () => {
      if (typeof key !== 'string' || !key.trim() || key.length > 4096) throw new TraceError(ERR.VALIDATION, 'API Key 无效')
      const data = await this.read()
      const profile = data.profiles.find((item) => item.id === id)
      if (!profile) throw new TraceError(ERR.PATH_NOT_FOUND, '服务配置不存在')
      profile.capability = { status: 'needs-retest', testedAt: null, errorCategory: null }
      await this.write(data)
      this.credentialRevisions.set(profile.id, (this.credentialRevisions.get(profile.id) ?? 0) + 1)
      await this.credentials.set(profile.id, key)
      return this.dto(profile)
    })
  }

  removeKey(id: unknown): Promise<AgentProfile> {
    return this.serial(async () => {
      const data = await this.read()
      const profile = data.profiles.find((item) => item.id === id)
      if (!profile) throw new TraceError(ERR.PATH_NOT_FOUND, '服务配置不存在')
      profile.capability = { status: 'needs-retest', testedAt: null, errorCategory: null }
      await this.write(data)
      this.credentialRevisions.set(profile.id, (this.credentialRevisions.get(profile.id) ?? 0) + 1)
      await this.credentials.remove(profile.id)
      return this.dto(profile)
    })
  }

  credentialRevision(id: string): Promise<number> {
    assertAgentProfileId(id)
    return this.serial(async () => this.credentialRevisions.get(id) ?? 0)
  }

  async testCapability(payload: unknown): Promise<AgentCapability> {
    if (!plainRecord(payload) || Reflect.ownKeys(payload).length !== 1 || typeof payload.id !== 'string') throw new TraceError(ERR.VALIDATION, '能力测试仅允许服务配置 ID')
    const id = payload.id
    assertAgentProfileId(id)
    const snapshot = await this.serial(async () => {
      const profile = (await this.read()).profiles.find((item) => item.id === id)
      if (!profile) throw new TraceError(ERR.PATH_NOT_FOUND, '服务配置不存在')
      const revision = (this.capabilityRevisions.get(id) ?? 0) + 1
      this.capabilityRevisions.set(id, revision)
      return { endpoint: profile.endpoint, model: profile.model, apiKey: await this.credentials.getForProvider(id), revision, keyRevision: this.credentialRevisions.get(id) ?? 0 }
    })
    // The provider promise must run outside the queue so edits invalidate in-flight tests.
    const capability: AgentCapability = snapshot.apiKey
      ? await testAgentToolCapability({ endpoint: snapshot.endpoint, model: snapshot.model, apiKey: snapshot.apiKey })
      : { status: 'failed', testedAt: new Date().toISOString(), errorCategory: 'missing-key' }
    return this.serial(async () => {
      const data = await this.read()
      const profile = data.profiles.find((item) => item.id === id)
      if (!profile) return { status: 'needs-retest', testedAt: null, errorCategory: null }
      if ((this.capabilityRevisions.get(id) ?? 0) !== snapshot.revision || (this.credentialRevisions.get(id) ?? 0) !== snapshot.keyRevision) return { ...profile.capability }
      profile.capability = capability
      await this.write(data)
      return { ...capability }
    })
  }

  // Hold profile/key mutations until the caller has revalidated context and synchronously
  // started fetch. The caller returns request identity, never the running provider promise.
  dispatchAuthorized<T>(id: string, revision: number, dispatch: (profile: AgentProfile, key: string) => Promise<T>): Promise<T> {
    return this.serial(async () => {
      assertAgentProfileId(id)
      const profile = (await this.read()).profiles.find((item) => item.id === id)
      if (!profile || (this.credentialRevisions.get(id) ?? 0) !== revision) throw new TraceError(ERR.CONFLICT, '模型服务配置已变化，请重新预览')
      const key = await this.credentials.getForProvider(id)
      if (!key) throw new TraceError(ERR.VALIDATION, '请先配置 API Key')
      if ((this.credentialRevisions.get(id) ?? 0) !== revision) throw new TraceError(ERR.CONFLICT, '模型服务配置已变化，请重新预览')
      const current = (await this.read()).profiles.find((item) => item.id === id)
      if (!current) throw new TraceError(ERR.CONFLICT, '模型服务配置已变化，请重新预览')
      return dispatch(await this.dto(current), key)
    })
  }

  // Capability tester (Task 2) updates only a redacted category, never request data.
  recordCapability(id: string, capability: AgentCapability): Promise<void> {
    return this.serial(async () => {
      const data = await this.read()
      const profile = data.profiles.find((item) => item.id === id)
      if (!profile) throw new TraceError(ERR.PATH_NOT_FOUND, '服务配置不存在')
      profile.capability = capability
      await this.write(data)
    })
  }
}
