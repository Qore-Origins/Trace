import { createHash, randomBytes } from 'node:crypto'
import { promises as fs, type BigIntStats } from 'node:fs'
import { basename, isAbsolute, relative, sep } from 'node:path'
import type {
  AgentTargetChild, AgentTargetGrant, AgentTargetGrantInput, AgentTargetGrantSet,
  AgentTargetSelection, AgentTargetValidationInput
} from '../../shared/agent-types'
import type { AgentMessage } from '../../shared/agent-types'
import type { PlanLibraryMeta } from '../../shared/plan-types'
import type { TrashEntry, TrashOperation, TrashOperationPreview } from '../../shared/trash-types'
import { isUuid32 } from '../../shared/validation'
import { ERR, TraceError } from '../../shared/errors'
import { agentRecord, assertAgentSessionId } from './agent-session-repository'
import { assertRealPathWithinRoot, normalizeRelSafe, resolveWithin } from './path-safety'
import type { StorageService } from './storage-service'

const GRANT_TTL_MS = 5 * 60 * 1000
const LIBRARY_META_REL_PATH = '.trace/plan-library.json'

interface LibraryState {
  configuredRoot: string
  canonicalRoot: string
  rootHash: string
  libraryId: string
  rootGeneration: number
}

interface TargetIdentityBase extends LibraryState {
  kind: 'plan' | 'folder'
  relativePath: string
  name: string
  directoryIdentity: string
}

interface PlanIdentity extends TargetIdentityBase {
  kind: 'plan'
  planId: string | null
  updatedAt: string
}

interface FolderIdentity extends TargetIdentityBase {
  kind: 'folder'
}

interface TrashIdentity extends LibraryState {
  kind: 'trash'
  entryId: string
  name: string
  manifestRevision: number
  status: TrashEntry['status']
  canRestore: boolean
  canPurge: boolean
  trashEntryToken: string
  tokenExpiresAtMs: number
}

type CapturedTarget = PlanIdentity | FolderIdentity | TrashIdentity

type TargetGrantRecord = CapturedTarget & {
  setId: string
  ref: string
  revision: string
  expiresAtMs: number
  boundMessageId?: string
}

interface AgentTargetResolutionBase extends AgentTargetGrant {
  setId: string
  root: string
  rootHash: string
  libraryId: string
  rootGeneration: number
}

export type AgentTargetResolution =
  | (AgentTargetResolutionBase & {
    kind: 'plan'
    path: string
    directoryIdentity: string
    planId: string | null
    updatedAt: string
  })
  | (AgentTargetResolutionBase & {
    kind: 'folder'
    path: string
    directoryIdentity: string
  })
  | (AgentTargetResolutionBase & {
    kind: 'trash'
    path: null
    entryId: string
    manifestRevision: number
    status: TrashEntry['status']
    trashEntryToken: string
  })

interface DirectorySnapshot {
  absolutePath: string
  relativePath: string
  name: string
  identity: string
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

function opaqueId(): string {
  return randomBytes(32).toString('base64url')
}

function pathKey(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

function pathWithinRoot(root: string, target: string): string {
  const rel = relative(root, target)
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    if (rel === '') return ''
    throw new TraceError(ERR.PATH_UNSAFE, '目标路径不在当前计划库内')
  }
  return rel.split(sep).join('/')
}

function directoryIdentity(stat: BigIntStats): string {
  return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`
}

function fileSnapshot(stat: BigIntStats): string {
  return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`
}

function parseSelection(value: unknown): AgentTargetSelection {
  if (!agentRecord(value) || typeof value.kind !== 'string') {
    throw new TraceError(ERR.VALIDATION, '计划、文件夹或回收站目标无效')
  }
  if (value.kind === 'trash') {
    if (!exactRecord(value, ['kind', 'entryId']) || typeof value.entryId !== 'string' || !isUuid32(value.entryId)) {
      throw new TraceError(ERR.VALIDATION, '回收站目标无效')
    }
    return { kind: 'trash', entryId: value.entryId }
  }
  if ((value.kind !== 'plan' && value.kind !== 'folder') || typeof value.path !== 'string' ||
    !exactRecord(value, ['kind', 'path'])) throw new TraceError(ERR.VALIDATION, '计划或文件夹目标无效')
  const targetPath = value.path
  if (typeof targetPath !== 'string') throw new TraceError(ERR.VALIDATION, '计划或文件夹目标路径无效')
  const normalized = normalizeRelSafe(targetPath)
  if (!normalized || normalized !== value.path || normalized.split('/').some((part) => part === '' || part === '.' || part.startsWith('.'))) {
    throw new TraceError(ERR.VALIDATION, '计划或文件夹目标路径无效')
  }
  return value.kind === 'plan' ? { kind: 'plan', path: normalized } : { kind: 'folder', path: normalized }
}

function parseGrantInput(value: unknown): AgentTargetSelection[] {
  if (!exactRecord(value, ['targets']) || !Array.isArray(value.targets) || value.targets.length < 1) {
    throw new TraceError(ERR.VALIDATION, '目标授权请求无效')
  }
  const targets = value.targets.map(parseSelection)
  const unique = new Set(targets.map((target) => target.kind === 'trash'
    ? `${target.kind}\0${target.entryId}`
    : `${target.kind}\0${target.path}`))
  if (unique.size !== targets.length) throw new TraceError(ERR.VALIDATION, '目标授权请求包含重复条目')
  return targets
}

function parseValidationInput(value: unknown): AgentTargetValidationInput {
  if (!exactRecord(value, ['setId', 'ref']) || typeof value.setId !== 'string' || typeof value.ref !== 'string') {
    throw new TraceError(ERR.VALIDATION, '目标授权标识无效')
  }
  return { setId: value.setId, ref: value.ref }
}

function revisionFor(snapshot: CapturedTarget): string {
  const identity = snapshot.kind === 'plan'
    ? [snapshot.relativePath, snapshot.directoryIdentity, snapshot.planId, snapshot.updatedAt]
    : snapshot.kind === 'folder'
      ? [snapshot.relativePath, snapshot.directoryIdentity]
      : [snapshot.entryId, snapshot.manifestRevision, snapshot.status, snapshot.canRestore, snapshot.canPurge, snapshot.tokenExpiresAtMs]
  const fields = [snapshot.kind, ...identity, snapshot.libraryId, snapshot.rootHash, snapshot.rootGeneration]
  return `sha256:${createHash('sha256').update(JSON.stringify(fields)).digest('hex')}`
}

export class AgentTargetService {
  private rootGeneration = 0
  private readonly grants = new Map<string, TargetGrantRecord>()

  constructor(
    private readonly storage: StorageService,
    private readonly now: () => number = Date.now
  ) {}

  invalidateRoot(): void {
    this.rootGeneration += 1
    this.grants.clear()
  }

  async grant(input: unknown): Promise<AgentTargetGrantSet> {
    const selections = parseGrantInput(input)
    const library = await this.readLibraryState()
    const requestedExpiryMs = this.now() + GRANT_TTL_MS
    const prepared: TargetGrantRecord[] = []
    for (const selection of selections) {
      if (selection.kind === 'plan') prepared.push(await this.capturePlan(library, selection.path, requestedExpiryMs))
      else if (selection.kind === 'folder') prepared.push(await this.captureFolder(library, selection.path, requestedExpiryMs))
      else prepared.push(await this.captureTrash(library, selection.entryId, requestedExpiryMs))
    }
    this.assertLibraryUnchanged(library)

    const expiresAtMs = Math.min(requestedExpiryMs, ...prepared.map((record) =>
      record.kind === 'trash' ? record.tokenExpiresAtMs : requestedExpiryMs))
    const setId = opaqueId()
    const targets = prepared.map((record) => {
      record.setId = setId
      record.expiresAtMs = expiresAtMs
      record.ref = opaqueId()
      record.revision = revisionFor(record)
      this.grants.set(record.ref, record)
      return this.toDto(record)
    })
    return { id: setId, expiresAt: new Date(expiresAtMs).toISOString(), targets }
  }

  /**
   * Main-process seam. Call only after the session service has persisted this
   * complete user message; never pass renderer/provider-supplied identifiers.
   */
  async bindGrantSetToUserMessage(setId: string, message: AgentMessage): Promise<void> {
    if (typeof setId !== 'string' || !exactRecord(message, ['id', 'role', 'content', 'status', 'createdAt', 'requestId'])) {
      throw new TraceError(ERR.VALIDATION, '目标授权绑定无效')
    }
    if (message.role !== 'user' || message.status !== 'complete' || typeof message.content !== 'string' ||
      typeof message.createdAt !== 'string' || !Number.isFinite(Date.parse(message.createdAt))) {
      throw new TraceError(ERR.VALIDATION, '目标授权只能绑定到已提交的用户消息')
    }
    assertAgentSessionId(message.id)
    assertAgentSessionId(message.requestId)
    const messageId = message.id

    const records = [...this.grants.values()].filter((record) => record.setId === setId)
    if (records.length === 0) throw new TraceError(ERR.PATH_NOT_FOUND, '目标授权不存在或已失效')
    if (records.some((record) => this.now() >= record.expiresAtMs)) {
      this.deleteSet(setId)
      throw new TraceError(ERR.CONFLICT, '目标授权已过期，请重新选择')
    }
    if (records.some((record) => record.boundMessageId !== undefined && record.boundMessageId !== messageId)) {
      throw new TraceError(ERR.CONFLICT, '目标授权已绑定到另一条用户消息')
    }
    for (const record of records) record.boundMessageId = messageId
  }

  async validate(input: unknown): Promise<AgentTargetGrant> {
    const { setId, ref } = parseValidationInput(input)
    const record = this.grants.get(ref)
    if (!record || record.setId !== setId) throw new TraceError(ERR.PATH_NOT_FOUND, '目标授权不存在或已失效')
    if (this.now() >= record.expiresAtMs) {
      this.grants.delete(ref)
      throw new TraceError(ERR.CONFLICT, '目标授权已过期，请重新选择')
    }

    try {
      const currentLibrary = await this.readLibraryState()
      const currentTarget = record.kind === 'plan'
        ? await this.capturePlan(currentLibrary, record.relativePath, record.expiresAtMs)
        : record.kind === 'folder'
          ? await this.captureFolder(currentLibrary, record.relativePath, record.expiresAtMs)
          : await this.readTrashTarget(currentLibrary, record.entryId, record.trashEntryToken, record.tokenExpiresAtMs, record.expiresAtMs)
      if (!this.sameIdentity(record, currentLibrary, currentTarget)) throw new Error('stale')
      this.assertLibraryUnchanged(currentLibrary)
    } catch {
      this.grants.delete(ref)
      throw new TraceError(ERR.CONFLICT, '目标已变化或所在计划库已切换，请重新选择')
    }
    return this.toDto(record)
  }

  async resolveGrantForMessage(input: unknown, messageId: string): Promise<AgentTargetResolution> {
    assertAgentSessionId(messageId)
    const { setId, ref } = parseValidationInput(input)
    const record = this.grants.get(ref)
    if (!record || record.setId !== setId) throw new TraceError(ERR.PATH_NOT_FOUND, '目标授权不存在或已失效')
    if (record.boundMessageId !== messageId) throw new TraceError(ERR.CONFLICT, '目标授权未绑定到当前用户消息')
    await this.validate({ setId, ref })
    const currentRecord = this.grants.get(ref)
    if (!currentRecord || currentRecord.boundMessageId !== messageId) {
      throw new TraceError(ERR.CONFLICT, '目标授权未绑定到当前用户消息')
    }
    const resolvedRecord = currentRecord
    const resolution = {
      ...this.toDto(resolvedRecord), setId: resolvedRecord.setId, root: resolvedRecord.configuredRoot,
      rootHash: resolvedRecord.rootHash, libraryId: resolvedRecord.libraryId,
      rootGeneration: resolvedRecord.rootGeneration
    }
    return resolvedRecord.kind === 'plan'
      ? { ...resolution, kind: 'plan', path: resolvedRecord.relativePath, directoryIdentity: resolvedRecord.directoryIdentity, planId: resolvedRecord.planId, updatedAt: resolvedRecord.updatedAt }
      : resolvedRecord.kind === 'folder'
        ? { ...resolution, kind: 'folder', path: resolvedRecord.relativePath, directoryIdentity: resolvedRecord.directoryIdentity }
        : {
          ...resolution, kind: 'trash', path: null, entryId: resolvedRecord.entryId,
          manifestRevision: resolvedRecord.manifestRevision, status: resolvedRecord.status,
          trashEntryToken: resolvedRecord.trashEntryToken
        }
  }

  async previewTrashOperation(input: unknown, operation: TrashOperation, messageId: string): Promise<TrashOperationPreview> {
    if (operation !== 'restore' && operation !== 'purge') throw new TraceError(ERR.VALIDATION, '回收站操作无效')
    const resolution = await this.resolveGrantForMessage(input, messageId)
    if (resolution.kind !== 'trash') throw new TraceError(ERR.VALIDATION, '该授权不是回收站条目')
    const record = this.grants.get(resolution.ref)
    if (!record || record.kind !== 'trash') throw new TraceError(ERR.PATH_NOT_FOUND, '回收站授权不存在或已失效')
    if ((operation === 'restore' && !record.canRestore) || (operation === 'purge' && !record.canPurge)) {
      throw new TraceError(ERR.CONFLICT, '该回收站条目不支持此操作')
    }

    this.grants.delete(record.ref)
    return operation === 'restore'
      ? this.storage.previewTrashRestore(record.entryId, undefined, record.trashEntryToken)
      : this.storage.previewTrashPurge(record.entryId, record.trashEntryToken)
  }

  async children(input: unknown): Promise<AgentTargetChild[]> {
    const { setId, ref } = parseValidationInput(input)
    await this.validate({ setId, ref })
    const record = this.grants.get(ref)
    if (!record || record.setId !== setId || record.kind !== 'folder') {
      throw new TraceError(ERR.VALIDATION, '只有显式授权的文件夹可以列出直接子项')
    }

    const library: LibraryState = {
      configuredRoot: record.configuredRoot,
      canonicalRoot: record.canonicalRoot,
      rootHash: record.rootHash,
      libraryId: record.libraryId,
      rootGeneration: record.rootGeneration
    }
    const before = await this.captureFolder(library, record.relativePath, record.expiresAtMs)
    if (!this.sameIdentity(record, library, before)) throw new TraceError(ERR.CONFLICT, '文件夹授权已失效，请重新选择')

    const absoluteDirectory = resolveWithin(record.configuredRoot, record.relativePath).abs
    const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true })
    const children: AgentTargetChild[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.')) continue
      const childPath = `${record.relativePath}/${entry.name}`
      const childAbsolute = resolveWithin(record.configuredRoot, childPath).abs
      await assertRealPathWithinRoot(record.canonicalRoot, childAbsolute)
      const childStat = await fs.lstat(childAbsolute, { bigint: true })
      if (childStat.isSymbolicLink() || !childStat.isDirectory()) continue
      const canonicalChild = pathWithinRoot(record.canonicalRoot, await fs.realpath(childAbsolute))
      if (pathKey(canonicalChild) !== pathKey(childPath)) continue

      const planPath = resolveWithin(record.configuredRoot, `${childPath}/plan.json`).abs
      let kind: AgentTargetChild['kind'] = 'folder'
      try {
        const planStat = await fs.lstat(planPath)
        if (planStat.isSymbolicLink() || !planStat.isFile()) throw new TraceError(ERR.PATH_UNSAFE, '直接子项中的计划文件身份不安全')
        await assertRealPathWithinRoot(record.canonicalRoot, planPath)
        kind = 'plan'
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      children.push({ path: childPath, name: entry.name, kind })
    }

    const after = await this.captureFolder(library, record.relativePath, record.expiresAtMs)
    if (!this.sameIdentity(record, library, after)) {
      this.grants.delete(ref)
      throw new TraceError(ERR.CONFLICT, '文件夹内容已变化，请重新选择')
    }
    this.assertLibraryUnchanged(library)
    return children.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { ignorePunctuation: true }))
  }

  release(input: unknown): null {
    if (!exactRecord(input, ['setId']) || typeof input.setId !== 'string') throw new TraceError(ERR.VALIDATION, '目标授权组无效')
    for (const [ref, record] of this.grants) {
      if (record.setId === input.setId) this.grants.delete(ref)
    }
    return null
  }

  private deleteSet(setId: string): void {
    for (const [ref, record] of this.grants) {
      if (record.setId === setId) this.grants.delete(ref)
    }
  }

  private async readLibraryState(): Promise<LibraryState> {
    const configuredRoot = this.storage.getRootAbs()
    if (!configuredRoot) throw new TraceError(ERR.STATE_MACHINE, '请先打开计划库')
    const rootGeneration = this.rootGeneration
    const canonicalRoot = await fs.realpath(configuredRoot)
    const metaDirectory = resolveWithin(configuredRoot, '.trace').abs
    const metaPath = resolveWithin(configuredRoot, LIBRARY_META_REL_PATH).abs
    const directoryStat = await fs.lstat(metaDirectory)
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) throw new TraceError(ERR.PATH_UNSAFE, '计划库元数据目录不安全')
    const metaStat = await fs.lstat(metaPath)
    if (metaStat.isSymbolicLink() || !metaStat.isFile()) throw new TraceError(ERR.PATH_UNSAFE, '计划库身份文件不安全')
    await assertRealPathWithinRoot(canonicalRoot, metaDirectory)
    await assertRealPathWithinRoot(canonicalRoot, metaPath)
    const metadata: unknown = JSON.parse(await fs.readFile(metaPath, 'utf8'))
    if (!agentRecord(metadata) || metadata.format_version !== '1' || typeof metadata.library_id !== 'string' || !isUuid32(metadata.library_id)) {
      throw new TraceError(ERR.FORMAT_INVALID, '计划库身份无效')
    }
    const library = metadata as unknown as PlanLibraryMeta
    const canonicalKey = pathKey(canonicalRoot)
    const rootHash = createHash('sha256').update(canonicalKey).digest('hex')
    const result: LibraryState = {
      configuredRoot, canonicalRoot, rootHash, libraryId: library.library_id, rootGeneration
    }
    this.assertLibraryUnchanged(result)
    return result
  }

  private async captureDirectory(library: LibraryState, relativePath: string): Promise<DirectorySnapshot> {
    const resolved = resolveWithin(library.configuredRoot, relativePath)
    await assertRealPathWithinRoot(library.canonicalRoot, resolved.abs)
    const stat = await fs.lstat(resolved.abs, { bigint: true })
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new TraceError(ERR.PATH_UNSAFE, '目标目录身份不安全')
    const realDirectory = await fs.realpath(resolved.abs)
    const canonicalRelativePath = pathWithinRoot(library.canonicalRoot, realDirectory)
    if (pathKey(canonicalRelativePath) !== pathKey(relativePath)) throw new TraceError(ERR.PATH_UNSAFE, '目标路径不是规范相对路径')
    const idStat = await fs.lstat(resolved.abs, { bigint: true })
    const identity = directoryIdentity(stat)
    if (directoryIdentity(idStat) !== identity) throw new TraceError(ERR.CONFLICT, '目标目录身份已变化，请重新选择')
    return {
      absolutePath: resolved.abs,
      relativePath: canonicalRelativePath,
      name: basename(canonicalRelativePath),
      identity
    }
  }

  private async capturePlan(library: LibraryState, relativePath: string, expiresAtMs: number): Promise<TargetGrantRecord> {
    const directory = await this.captureDirectory(library, relativePath)

    const planFile = resolveWithin(library.configuredRoot, `${directory.relativePath}/plan.json`).abs
    const fileStat = await fs.lstat(planFile, { bigint: true })
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) throw new TraceError(ERR.PATH_UNSAFE, '计划文件身份不安全')
    await assertRealPathWithinRoot(library.canonicalRoot, planFile)
    const realPlanFile = await fs.realpath(planFile)
    const verifiedFileStat = await fs.lstat(planFile, { bigint: true })
    if (verifiedFileStat.isSymbolicLink() || !verifiedFileStat.isFile() ||
      fileSnapshot(fileStat) !== fileSnapshot(verifiedFileStat)) {
      throw new TraceError(ERR.CONFLICT, '计划文件在读取前发生变化，请重新选择')
    }

    const document = await this.storage.readPlan(directory.relativePath)
    await assertRealPathWithinRoot(library.canonicalRoot, planFile)
    const afterStat = await fs.lstat(planFile, { bigint: true })
    if (afterStat.isSymbolicLink() || !afterStat.isFile()) throw new TraceError(ERR.PATH_UNSAFE, '计划文件身份不安全')
    const afterRealPlanFile = await fs.realpath(planFile)
    await assertRealPathWithinRoot(library.canonicalRoot, afterRealPlanFile)
    if (fileSnapshot(verifiedFileStat) !== fileSnapshot(afterStat) || pathKey(realPlanFile) !== pathKey(afterRealPlanFile)) {
      throw new TraceError(ERR.CONFLICT, '计划文件在读取期间发生变化，请重新选择')
    }
    if (typeof document.updated_at !== 'string' || !Number.isFinite(Date.parse(document.updated_at))) {
      throw new TraceError(ERR.FORMAT_INVALID, '计划版本无效')
    }

    return {
      ...library, kind: 'plan', relativePath: directory.relativePath, name: directory.name,
      planId: document.plan_id ?? null, directoryIdentity: directory.identity,
      updatedAt: document.updated_at, setId: '', ref: '', revision: '', expiresAtMs
    }
  }

  private async captureFolder(library: LibraryState, relativePath: string, expiresAtMs: number): Promise<TargetGrantRecord> {
    const directory = await this.captureDirectory(library, relativePath)
    const planFile = resolveWithin(library.configuredRoot, `${directory.relativePath}/plan.json`).abs
    try {
      const planStat = await fs.lstat(planFile)
      if (planStat.isSymbolicLink() || !planStat.isFile()) throw new TraceError(ERR.PATH_UNSAFE, '文件夹计划标记身份不安全')
      throw new TraceError(ERR.VALIDATION, '计划节点不能作为文件夹授权目标')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return {
      ...library, kind: 'folder', relativePath: directory.relativePath,
      name: directory.name, directoryIdentity: directory.identity,
      setId: '', ref: '', revision: '', expiresAtMs
    }
  }

  private async captureTrash(library: LibraryState, entryId: string, expiresAtMs: number): Promise<TargetGrantRecord> {
    const entry = await this.readTrashEntry(entryId)
    if (entry.status !== 'trashed' && entry.status !== 'purge_interrupted') {
      throw new TraceError(ERR.CONFLICT, '回收站条目当前不可操作')
    }
    if (!entry.can_purge) throw new TraceError(ERR.CONFLICT, '回收站条目当前不可操作')
    const grant = await this.storage.issueTrashEntryTarget(entryId)
    const tokenExpiresAtMs = Date.parse(grant.expires_at)
    if (!Number.isFinite(tokenExpiresAtMs) || tokenExpiresAtMs <= this.now()) {
      throw new TraceError(ERR.CONFLICT, '回收站授权已过期，请重新选择')
    }
    return {
      ...library, kind: 'trash', entryId: entry.id, name: entry.name,
      manifestRevision: entry.manifest_revision, status: entry.status,
      canRestore: entry.can_restore, canPurge: entry.can_purge,
      trashEntryToken: grant.token, tokenExpiresAtMs,
      setId: '', ref: '', revision: '', expiresAtMs: Math.min(expiresAtMs, tokenExpiresAtMs)
    }
  }

  private async readTrashEntry(entryId: string): Promise<TrashEntry> {
    const entries = await this.storage.listTrashEntries()
    const entry = entries.find((candidate) => candidate.id === entryId)
    if (!entry) throw new TraceError(ERR.PATH_NOT_FOUND, '回收站条目不存在或已失效')
    return entry
  }

  private async readTrashTarget(
    library: LibraryState,
    entryId: string,
    trashEntryToken: string,
    tokenExpiresAtMs: number,
    expiresAtMs: number
  ): Promise<TargetGrantRecord> {
    this.assertLibraryUnchanged(library)
    if (this.now() >= tokenExpiresAtMs) throw new TraceError(ERR.CONFLICT, '回收站授权已过期，请重新选择')
    const entry = await this.readTrashEntry(entryId)
    if ((entry.status !== 'trashed' && entry.status !== 'purge_interrupted') || !entry.can_purge) {
      throw new TraceError(ERR.CONFLICT, '回收站条目已变化或不可操作，请重新选择')
    }
    return {
      ...library, kind: 'trash', entryId: entry.id, name: entry.name,
      manifestRevision: entry.manifest_revision, status: entry.status,
      canRestore: entry.can_restore, canPurge: entry.can_purge,
      trashEntryToken, tokenExpiresAtMs, expiresAtMs,
      setId: '', ref: '', revision: ''
    }
  }

  private sameIdentity(record: TargetGrantRecord, library: LibraryState, current: TargetGrantRecord): boolean {
    const sameLibrary = record.configuredRoot === library.configuredRoot && record.canonicalRoot === library.canonicalRoot &&
      record.rootHash === library.rootHash && record.libraryId === library.libraryId &&
      record.rootGeneration === library.rootGeneration && record.kind === current.kind
    if (!sameLibrary) return false
    if (record.kind === 'plan' && current.kind === 'plan') {
      return record.relativePath === current.relativePath && record.directoryIdentity === current.directoryIdentity &&
        record.planId === current.planId && record.updatedAt === current.updatedAt
    }
    if (record.kind === 'folder' && current.kind === 'folder') {
      return record.relativePath === current.relativePath && record.directoryIdentity === current.directoryIdentity
    }
    if (record.kind === 'trash' && current.kind === 'trash') {
      return record.entryId === current.entryId && record.manifestRevision === current.manifestRevision &&
        record.status === current.status && record.canRestore === current.canRestore && record.canPurge === current.canPurge
    }
    return false
  }

  private assertLibraryUnchanged(library: LibraryState): void {
    if (this.storage.getRootAbs() !== library.configuredRoot || this.rootGeneration !== library.rootGeneration) {
      throw new TraceError(ERR.CONFLICT, '计划库已切换，请重新选择')
    }
  }

  private toDto(record: TargetGrantRecord): AgentTargetGrant {
    return {
      ref: record.ref, kind: record.kind, path: record.kind === 'trash' ? null : record.relativePath,
      name: record.name, revision: record.revision,
      expiresAt: new Date(record.expiresAtMs).toISOString()
    }
  }
}
