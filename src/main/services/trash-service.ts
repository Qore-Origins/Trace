import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { DIARY_DIR, type PlanDocument } from '../../shared/plan-types'
import { ERR, TraceError } from '../../shared/errors'
import { isUuid32, uuid32, validatePlanName } from '../../shared/validation'
import type {
  TrashDirectoryIdentity, TrashEntry, TrashEntryKind, TrashEntryTargetGrant,
  TrashManifest, TrashManifestPhase, TrashOperation, TrashOperationCommitResult,
  TrashOperationPreview, TrashPlanSnapshot, TrashReferenceImpactSummary, TrashRestoreDestination
} from '../../shared/trash-types'
import { PlanRepository } from './plan-repository'
import { assertRealPathWithinRoot, resolveWithin } from './path-safety'

const TRASH_RELATIVE_ROOT = '.trace/trash'
const MANIFEST_NAME = 'manifest.json'
const PAYLOAD_NAME = 'payload'
const CONFIRMATION_TTL_MS = 120_000
const ENTRY_ID_PATTERN = /^[a-f0-9]{32}$/

export interface TrashLibraryContext {
  root: string
  library_id: string
  root_generation: number
}

export interface TrashReferenceImpactReader {
  (libraryId: string, planIds: string[]): Promise<TrashReferenceImpactSummary>
}

export interface TrashChange {
  path: string
  plan_ids: string[]
}

export interface TrashListResult {
  entries: TrashEntry[]
  changes: TrashChange[]
}

export interface TrashMutationResult {
  entry: TrashEntry
  changed: boolean
  changed_plan_ids: string[]
}

export interface TrashServiceOptions {
  now?: () => number
}

interface ConfirmationRecord {
  operation: TrashOperation
  root: string
  library_id: string
  root_generation: number
  entry_id: string
  manifest_revision: number
  manifest_digest: string
  preview_digest: string
  payload_state_digest?: string
  reference_impact_signature: string
  issued_at_ms: number
  restore_relative_path?: string
  restore_parent_identity?: TrashDirectoryIdentity
  expires_at_ms: number
}

interface EntryTargetRecord {
  root: string
  library_id: string
  root_generation: number
  entry_id: string
  manifest_revision: number
  manifest_digest: string
  issued_at_ms: number
  expires_at_ms: number
}

interface RecoveryResult {
  entry: TrashEntry | null
  changes: TrashChange[]
}

interface DirectorySnapshot {
  kind: TrashEntryKind
  directory_identity: TrashDirectoryIdentity
  plans: TrashPlanSnapshot[]
}

interface PayloadFileSnapshot {
  relative_path: string
  kind: 'file'
  device: string
  inode: string
  birthtime_ns: string
  size: string
  content_digest: string
}

interface PayloadDirectorySnapshot {
  relative_path: string
  kind: 'directory'
  identity: TrashDirectoryIdentity
}

type PayloadSnapshot = PayloadFileSnapshot | PayloadDirectorySnapshot

/** Per-library, manifest-backed trash. Only explicit confirmation tokens can restore or purge. */
export class TrashService {
  private readonly now: () => number
  private readonly confirmations = new Map<string, ConfirmationRecord>()
  private readonly entryTargets = new Map<string, EntryTargetRecord>()
  private referenceImpactReader: TrashReferenceImpactReader = async () => ({
    signature: digestJson([]), reference_count: 0
  })

  constructor(private readonly repo: PlanRepository, options: TrashServiceOptions = {}) {
    this.now = options.now ?? Date.now
  }

  setReferenceImpactReader(reader: TrashReferenceImpactReader): void {
    this.referenceImpactReader = reader
  }

  invalidateGrants(): void {
    this.confirmations.clear()
    this.entryTargets.clear()
  }

  async list(context: TrashLibraryContext): Promise<TrashListResult> {
    await this.assertLibraryContext(context)
    const trashRoot = await this.trashRoot(context, false)
    if (!trashRoot) return { entries: [], changes: [] }

    const rows: TrashEntry[] = []
    const changes: TrashChange[] = []
    const directories = await fs.readdir(trashRoot, { withFileTypes: true })
    for (const directory of directories) {
      const id = safeListedId(directory.name)
      if (!directory.isDirectory() || directory.isSymbolicLink() || !ENTRY_ID_PATTERN.test(directory.name)) {
        rows.push(attentionEntry(id, 'entry_incomplete'))
        continue
      }

      try {
        await this.assertEntryContents(context, directory.name)
      } catch (error) {
        const issue = error instanceof TraceError && error.code === ERR.FORMAT_INVALID
          ? 'manifest_invalid'
          : error instanceof TraceError && error.code === ERR.PATH_UNSAFE
            ? 'identity_mismatch'
            : 'entry_incomplete'
        rows.push(attentionEntry(id, issue))
        continue
      }

      let manifest: TrashManifest
      try {
        manifest = await this.readManifest(context, directory.name)
      } catch {
        rows.push(attentionEntry(id, 'manifest_invalid'))
        continue
      }
      if (manifest.entry_id !== directory.name || manifest.library_id !== context.library_id) {
        rows.push(attentionEntry(id, 'identity_mismatch'))
        continue
      }

      const recovered = await this.recoverEntry(context, manifest)
      if (recovered.entry) rows.push(recovered.entry)
      changes.push(...recovered.changes)
    }
    rows.sort((left, right) => left.deleted_at.localeCompare(right.deleted_at) || left.id.localeCompare(right.id))
    return { entries: rows, changes }
  }

  async trashPlan(
    context: TrashLibraryContext,
    relativePath: string,
    expectedUpdatedAt?: string,
    expectedDirectoryIdentity?: string
  ): Promise<TrashMutationResult> {
    await this.assertLibraryContext(context)
    const relative = this.assertActivePlanPath(context.root, relativePath)
    await this.assertNoSymlinkPath(context.root, relative)
    const sourceAbs = resolveWithin(context.root, relative).abs
    const snapshot = await this.captureDirectorySnapshot(context.root, relative)
    if (expectedUpdatedAt !== undefined) {
      const rootPlan = snapshot.plans.find((plan) => plan.relative_path === '')
      if (snapshot.kind !== 'plan' || !rootPlan || rootPlan.updated_at !== expectedUpdatedAt) {
        throw new TraceError(ERR.CONFLICT, '目标计划已变化，请重新预览确认')
      }
    }
    if (expectedDirectoryIdentity !== undefined &&
      directoryIdentityKey(snapshot.directory_identity) !== expectedDirectoryIdentity) {
      throw new TraceError(ERR.CONFLICT, '目标文件夹已变化，请重新预览确认')
    }

    const parentRelative = dirname(relative).replace(/\\/g, '/') === '.'
      ? ''
      : dirname(relative).replace(/\\/g, '/')
    await this.assertNoSymlinkPath(context.root, parentRelative)
    const parentIdentity = await this.readDirectoryIdentity(resolveWithin(context.root, parentRelative).abs)
    const entryId = uuid32()
    const entryRelative = `${TRASH_RELATIVE_ROOT}/${entryId}`
    const entryDirectory = resolveWithin(context.root, entryRelative).abs
    const payload = join(entryDirectory, PAYLOAD_NAME)
    await this.trashRoot(context, true)
    this.repo.markInternalWrite(entryDirectory)
    await fs.mkdir(entryDirectory)
    const manifest: TrashManifest = {
      schema_version: 1,
      revision: 1,
      entry_id: entryId,
      library_id: context.library_id,
      root_generation: context.root_generation,
      kind: snapshot.kind,
      name: basename(relative),
      original_relative_path: relative,
      deleted_at: new Date(this.now()).toISOString(),
      directory_identity: snapshot.directory_identity,
      original_parent_identity: parentIdentity,
      plans: snapshot.plans,
      phase: 'staging'
    }

    try {
      await this.writeManifest(entryDirectory, manifest)
    } catch (error) {
      this.repo.markInternalWrite(entryDirectory)
      await fs.rmdir(entryDirectory).catch(() => undefined)
      throw error
    }

    try {
      await this.repo.moveDirAtomic(sourceAbs, payload)
    } catch (error) {
      const recovered = await this.recoverEntry(context, manifest).catch(() => null)
      if (recovered?.changes.length || recovered?.entry?.status === 'needs_attention') {
        return {
          entry: recovered.entry ?? entryFromManifest(manifest, 'needs_attention', 'entry_incomplete'),
          changed: true,
          changed_plan_ids: collectPlanIds(manifest)
        }
      }
      throw error
    }

    const entrySnapshot = await this.captureDirectorySnapshot(context.root, `${entryRelative}/${PAYLOAD_NAME}`)
      .catch(() => null)
    if (!entrySnapshot || !sameSnapshot(snapshot, entrySnapshot)) {
      const attention = entryFromManifest(manifest, 'needs_attention', 'identity_mismatch')
      return { entry: attention, changed: true, changed_plan_ids: collectPlanIds(manifest) }
    }

    let trashedManifest: TrashManifest
    try {
      trashedManifest = await this.writeNextManifest(entryDirectory, manifest, { phase: 'trashed' })
    } catch {
      // The staging manifest plus verified payload is an explicitly recoverable crash state.
      // Report the completed disk move so caches/indexes do not keep the removed source visible.
      return {
        entry: entryFromManifest(manifest, 'needs_attention', 'entry_incomplete'),
        changed: true,
        changed_plan_ids: collectPlanIds(manifest)
      }
    }
    return {
      entry: entryFromManifest(trashedManifest, 'trashed'),
      changed: true,
      changed_plan_ids: collectPlanIds(manifest)
    }
  }

  async issueEntryTarget(context: TrashLibraryContext, entryId: string): Promise<TrashEntryTargetGrant> {
    await this.assertLibraryContext(context)
    const manifest = await this.readActionableManifest(context, entryId, ['trashed', 'purging'])
    const token = uuid32()
    const issuedAtMs = this.now()
    const expiresAtMs = issuedAtMs + CONFIRMATION_TTL_MS
    this.entryTargets.set(token, {
      root: context.root,
      library_id: context.library_id,
      root_generation: context.root_generation,
      entry_id: entryId,
      manifest_revision: manifest.revision,
      manifest_digest: digestJson(manifest),
      issued_at_ms: issuedAtMs,
      expires_at_ms: expiresAtMs
    })
    return { entry_id: entryId, token, expires_at: new Date(expiresAtMs).toISOString() }
  }

  async previewRestore(
    context: TrashLibraryContext,
    entryId: string,
    destination?: TrashRestoreDestination,
    entryTargetToken?: string
  ): Promise<TrashOperationPreview> {
    await this.assertLibraryContext(context)
    const manifest = await this.readActionableManifest(context, entryId, ['trashed'])
    if (entryTargetToken) this.consumeEntryTarget(context, entryId, manifest, entryTargetToken)
    const target = await this.resolveRestoreTarget(context.root, manifest, destination)
    const referenceImpact = await this.referenceImpactReader(context.library_id, collectPlanIds(manifest))
    const previewDigest = digestJson({
      operation: 'restore', entry_id: entryId, manifest_revision: manifest.revision,
      manifest_digest: digestJson(manifest), library_id: context.library_id,
      root_generation: context.root_generation, restore_relative_path: target.relative_path,
      restore_parent_identity: target.parent_identity, reference_impact_signature: referenceImpact.signature
    })
    return this.issueConfirmation(context, manifest, 'restore', previewDigest, referenceImpact, target)
  }

  async commitRestore(
    context: TrashLibraryContext,
    confirmationToken: string
  ): Promise<TrashOperationCommitResult> {
    await this.assertLibraryContext(context)
    const confirmation = this.consumeConfirmation(context, confirmationToken, 'restore')
    const manifest = await this.readActionableManifest(context, confirmation.entry_id, ['trashed'])
    if (manifest.revision !== confirmation.manifest_revision || digestJson(manifest) !== confirmation.manifest_digest) {
      throw new TraceError(ERR.CONFLICT, '回收站条目已变化，请重新预览确认')
    }
    if (!confirmation.restore_relative_path || !confirmation.restore_parent_identity) {
      throw new TraceError(ERR.CONFIRMATION_REQUIRED, '恢复确认已失效，请重新预览')
    }
    const target = await this.resolveRestoreTarget(context.root, manifest, {
      parent_path: dirname(confirmation.restore_relative_path).replace(/\\/g, '/') === '.'
        ? ''
        : dirname(confirmation.restore_relative_path).replace(/\\/g, '/'),
      name: basename(confirmation.restore_relative_path)
    })
    if (target.relative_path !== confirmation.restore_relative_path ||
      directoryIdentityKey(target.parent_identity) !== directoryIdentityKey(confirmation.restore_parent_identity)) {
      throw new TraceError(ERR.CONFLICT, '恢复位置已变化，请重新预览确认')
    }
    const referenceImpact = await this.referenceImpactReader(context.library_id, collectPlanIds(manifest))
    if (referenceImpact.signature !== confirmation.reference_impact_signature) {
      throw new TraceError(ERR.CONFLICT, '计划关联影响已变化，请重新预览确认')
    }
    const expectedPreviewDigest = digestJson({
      operation: 'restore', entry_id: confirmation.entry_id,
      manifest_revision: manifest.revision, manifest_digest: digestJson(manifest),
      library_id: context.library_id, root_generation: context.root_generation,
      restore_relative_path: target.relative_path,
      restore_parent_identity: target.parent_identity,
      reference_impact_signature: referenceImpact.signature
    })
    if (expectedPreviewDigest !== confirmation.preview_digest) {
      throw new TraceError(ERR.CONFLICT, '恢复预览已变化，请重新预览确认')
    }

    const entryDirectory = this.entryDirectory(context.root, confirmation.entry_id)
    const payload = join(entryDirectory, PAYLOAD_NAME)
    const restoring = await this.writeNextManifest(entryDirectory, manifest, {
      phase: 'restoring',
      restore_relative_path: target.relative_path,
      restore_parent_identity: target.parent_identity
    })
    try {
      await this.repo.moveDirAtomic(payload, target.absolute_path)
    } catch (error) {
      const recovered = await this.recoverEntry(context, restoring).catch(() => null)
      if (recovered?.changes.some((change) => change.path === target.relative_path)) {
        return { path: target.relative_path, changed_plan_ids: collectPlanIds(manifest) }
      }
      if (await pathExists(target.absolute_path).catch(() => false) &&
        !(await pathExists(payload).catch(() => true))) {
        return { path: target.relative_path, changed_plan_ids: collectPlanIds(manifest) }
      }
      throw error
    }

    const restoredSnapshot = await this.captureDirectorySnapshot(context.root, target.relative_path).catch(() => null)
    if (!restoredSnapshot || !sameSnapshotFromManifest(restoring, restoredSnapshot)) {
      return { path: target.relative_path, changed_plan_ids: collectPlanIds(manifest) }
    }
    await this.removeEntryMetadata(context.root, entryDirectory).catch(() => undefined)
    return { path: target.relative_path, changed_plan_ids: collectPlanIds(manifest) }
  }

  async previewPurge(
    context: TrashLibraryContext,
    entryId: string,
    entryTargetToken?: string
  ): Promise<TrashOperationPreview> {
    await this.assertLibraryContext(context)
    const manifest = await this.readActionableManifest(context, entryId, ['trashed', 'purging'])
    if (entryTargetToken) this.consumeEntryTarget(context, entryId, manifest, entryTargetToken)
    const entryStatus = await this.statusForManifest(context, manifest)
    if (entryStatus !== 'trashed' && entryStatus !== 'purge_interrupted') {
      throw new TraceError(ERR.CONFLICT, '此回收站条目不可清除')
    }
    const payloadStateDigest = await this.payloadStateDigest(context.root, manifest)
    const referenceImpact = await this.referenceImpactReader(context.library_id, collectPlanIds(manifest))
    const previewDigest = digestJson({
      operation: 'purge', entry_id: entryId, manifest_revision: manifest.revision,
      manifest_digest: digestJson(manifest), library_id: context.library_id,
      root_generation: context.root_generation, reference_impact_signature: referenceImpact.signature,
      reference_count: referenceImpact.reference_count, status: entryStatus,
      payload_state_digest: payloadStateDigest
    })
    return this.issueConfirmation(context, manifest, 'purge', previewDigest, referenceImpact, undefined, payloadStateDigest)
  }

  async commitPurge(
    context: TrashLibraryContext,
    confirmationToken: string
  ): Promise<TrashOperationCommitResult> {
    await this.assertLibraryContext(context)
    const confirmation = this.consumeConfirmation(context, confirmationToken, 'purge')
    const manifest = await this.readActionableManifest(context, confirmation.entry_id, ['trashed', 'purging'])
    if (manifest.revision !== confirmation.manifest_revision || digestJson(manifest) !== confirmation.manifest_digest) {
      throw new TraceError(ERR.CONFLICT, '回收站条目已变化，请重新预览确认')
    }
    const status = await this.statusForManifest(context, manifest)
    if (status !== 'trashed' && status !== 'purge_interrupted') {
      throw new TraceError(ERR.CONFLICT, '此回收站条目不可清除')
    }
    const payloadStateDigest = await this.payloadStateDigest(context.root, manifest)
    if (!confirmation.payload_state_digest || payloadStateDigest !== confirmation.payload_state_digest) {
      throw new TraceError(ERR.CONFLICT, '待清除内容已变化，请重新预览确认')
    }
    const referenceImpact = await this.referenceImpactReader(context.library_id, collectPlanIds(manifest))
    if (referenceImpact.signature !== confirmation.reference_impact_signature) {
      throw new TraceError(ERR.CONFLICT, '计划关联影响已变化，请重新预览确认')
    }
    const expectedPreviewDigest = digestJson({
      operation: 'purge', entry_id: confirmation.entry_id,
      manifest_revision: manifest.revision, manifest_digest: digestJson(manifest),
      library_id: context.library_id, root_generation: context.root_generation,
      reference_impact_signature: referenceImpact.signature,
      reference_count: referenceImpact.reference_count, status,
      payload_state_digest: payloadStateDigest
    })
    if (expectedPreviewDigest !== confirmation.preview_digest) {
      throw new TraceError(ERR.CONFLICT, '清除预览已变化，请重新预览确认')
    }

    const entryDirectory = this.entryDirectory(context.root, confirmation.entry_id)
    await this.writeNextManifest(entryDirectory, manifest, {
      phase: 'purging', restore_relative_path: undefined, restore_parent_identity: undefined
    })
    const payloadRel = `${TRASH_RELATIVE_ROOT}/${confirmation.entry_id}/${PAYLOAD_NAME}`
    await this.assertNoSymlinkPath(context.root, payloadRel)
    const payloadStat = await fs.lstat(resolveWithin(context.root, payloadRel).abs)
    if (!payloadStat.isDirectory() || payloadStat.isSymbolicLink()) {
      throw new TraceError(ERR.PATH_UNSAFE, '回收站内容路径不安全')
    }
    await this.repo.rmRecursive(context.root, payloadRel)
    await this.removeEntryMetadata(context.root, entryDirectory).catch(() => undefined)
    return { changed_plan_ids: collectPlanIds(manifest) }
  }

  private async issueConfirmation(
    context: TrashLibraryContext,
    manifest: TrashManifest,
    operation: TrashOperation,
    previewDigest: string,
    referenceImpact: TrashReferenceImpactSummary,
    restoreTarget?: { relative_path: string; parent_identity: TrashDirectoryIdentity },
    payloadStateDigest?: string
  ): Promise<TrashOperationPreview> {
    const token = uuid32()
    const issuedAtMs = this.now()
    const expiresAtMs = issuedAtMs + CONFIRMATION_TTL_MS
    const manifestDigest = digestJson(manifest)
    this.confirmations.set(token, {
      operation,
      root: context.root,
      library_id: context.library_id,
      root_generation: context.root_generation,
      entry_id: manifest.entry_id,
      manifest_revision: manifest.revision,
      manifest_digest: manifestDigest,
      preview_digest: previewDigest,
      ...(payloadStateDigest ? { payload_state_digest: payloadStateDigest } : {}),
      reference_impact_signature: referenceImpact.signature,
      issued_at_ms: issuedAtMs,
      ...(restoreTarget ? {
        restore_relative_path: restoreTarget.relative_path,
        restore_parent_identity: restoreTarget.parent_identity
      } : {}),
      expires_at_ms: expiresAtMs
    })
    return {
      operation,
      entry_id: manifest.entry_id,
      name: manifest.name,
      original_relative_path: manifest.original_relative_path,
      ...(restoreTarget ? { restore_relative_path: restoreTarget.relative_path } : {}),
      plan_count: manifest.plans.length,
      reference_count: referenceImpact.reference_count,
      reference_impact_signature: referenceImpact.signature,
      preview_digest: previewDigest,
      confirmation_token: token,
      expires_at: new Date(expiresAtMs).toISOString()
    }
  }

  private consumeConfirmation(context: TrashLibraryContext, token: string, operation: TrashOperation): ConfirmationRecord {
    const record = this.confirmations.get(token)
    this.confirmations.delete(token)
    if (!record || record.operation !== operation || record.issued_at_ms > this.now() || record.expires_at_ms <= this.now() ||
      record.root !== context.root || record.library_id !== context.library_id ||
      record.root_generation !== context.root_generation) {
      throw new TraceError(ERR.CONFIRMATION_REQUIRED, '确认已失效，请重新预览')
    }
    return record
  }

  private consumeEntryTarget(
    context: TrashLibraryContext,
    entryId: string,
    manifest: TrashManifest,
    token: string
  ): void {
    const record = this.entryTargets.get(token)
    this.entryTargets.delete(token)
    if (!record || record.issued_at_ms > this.now() || record.expires_at_ms <= this.now() || record.root !== context.root ||
      record.library_id !== context.library_id || record.root_generation !== context.root_generation ||
      record.entry_id !== entryId || record.manifest_revision !== manifest.revision ||
      record.manifest_digest !== digestJson(manifest)) {
      throw new TraceError(ERR.CONFIRMATION_REQUIRED, '回收站目标授权已失效，请重新选择')
    }
  }

  private async assertLibraryContext(context: TrashLibraryContext): Promise<void> {
    if (!context || !context.root || !isUuid32(context.library_id) ||
      !Number.isSafeInteger(context.root_generation) || context.root_generation < 1) {
      throw new TraceError(ERR.CONFLICT, '计划库已切换，请重试')
    }
    await this.assertNoSymlinkPath(context.root, '.trace')
    await this.assertNoSymlinkPath(context.root, '.trace/plan-library.json')
    const library = await this.repo.readLibraryMeta(context.root)
    if (library.library_id !== context.library_id) throw new TraceError(ERR.CONFLICT, '计划库已切换，请重试')
  }

  private async trashRoot(context: TrashLibraryContext, create: boolean): Promise<string | null> {
    const traceDirectory = resolveWithin(context.root, '.trace').abs
    await this.assertNoSymlinkPath(context.root, '.trace')
    if (create) {
      const root = resolveWithin(context.root, TRASH_RELATIVE_ROOT).abs
      this.repo.markInternalWrite(root)
      await fs.mkdir(root).catch(async (error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const existing = await fs.lstat(root)
        if (existing.isSymbolicLink() || !existing.isDirectory()) throw new TraceError(ERR.PATH_UNSAFE, '回收站目录不安全')
      })
    }
    const trashRoot = join(traceDirectory, 'trash')
    try {
      const stat = await fs.lstat(trashRoot)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new TraceError(ERR.PATH_UNSAFE, '回收站目录不安全')
      await assertRealPathWithinRoot(context.root, trashRoot)
      return trashRoot
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private entryDirectory(root: string, entryId: string): string {
    if (!ENTRY_ID_PATTERN.test(entryId)) throw new TraceError(ERR.VALIDATION, '回收站条目标识无效')
    return resolveWithin(root, `${TRASH_RELATIVE_ROOT}/${entryId}`).abs
  }

  private async readManifest(context: TrashLibraryContext, entryId: string): Promise<TrashManifest> {
    const manifestRelative = `${TRASH_RELATIVE_ROOT}/${entryId}/${MANIFEST_NAME}`
    await this.assertNoSymlinkPath(context.root, manifestRelative)
    const raw = await fs.readFile(resolveWithin(context.root, manifestRelative).abs, 'utf8')
    let value: unknown
    try {
      value = JSON.parse(raw) as unknown
    } catch {
      throw new TraceError(ERR.FORMAT_INVALID, '回收站记录损坏')
    }
    if (!isTrashManifest(value) || value.entry_id !== entryId || value.library_id !== context.library_id ||
      !this.isAllowedOriginalPath(context.root, value.original_relative_path) ||
      value.name !== basename(value.original_relative_path) ||
      !this.isValidPlanSnapshots(context.root, value)) {
      throw new TraceError(ERR.FORMAT_INVALID, '回收站记录损坏')
    }
    if (value.phase === 'restoring' && (!value.restore_relative_path || !isIdentity(value.restore_parent_identity) ||
      !this.isAllowedOriginalPath(context.root, value.restore_relative_path))) {
      throw new TraceError(ERR.FORMAT_INVALID, '回收站恢复记录损坏')
    }
    return value
  }

  private async writeManifest(entryDirectory: string, manifest: TrashManifest): Promise<void> {
    await this.repo.writeJsonAtomic(join(entryDirectory, MANIFEST_NAME), manifest)
  }

  private async writeNextManifest(
    entryDirectory: string,
    current: TrashManifest,
    patch: Partial<Pick<TrashManifest, 'phase' | 'restore_relative_path' | 'restore_parent_identity'>>
  ): Promise<TrashManifest> {
    const next: TrashManifest = {
      ...current,
      revision: current.revision + 1,
      ...patch
    }
    await this.writeManifest(entryDirectory, next)
    return next
  }

  private async readActionableManifest(
    context: TrashLibraryContext,
    entryId: string,
    phases: TrashManifestPhase[]
  ): Promise<TrashManifest> {
    await this.assertEntryContents(context, entryId)
    const manifest = await this.readManifest(context, entryId)
    if (!phases.includes(manifest.phase)) throw new TraceError(ERR.CONFLICT, '回收站条目当前不可操作')
    if (manifest.phase === 'trashed' && !(await this.payloadMatches(context.root, manifest))) {
      throw new TraceError(ERR.CONFLICT, '回收站内容状态异常，已保留数据')
    }
    return manifest
  }

  private async assertEntryContents(context: TrashLibraryContext, entryId: string): Promise<void> {
    const relative = `${TRASH_RELATIVE_ROOT}/${entryId}`
    await this.assertNoSymlinkPath(context.root, relative)
    const entryDirectory = this.entryDirectory(context.root, entryId)
    const directoryStat = await fs.lstat(entryDirectory)
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      throw new TraceError(ERR.PATH_UNSAFE, '回收站条目目录不安全')
    }
    const entries = await fs.readdir(entryDirectory, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === MANIFEST_NAME) {
        if (!entry.isFile() || entry.isSymbolicLink()) {
          throw new TraceError(ERR.FORMAT_INVALID, '回收站条目记录状态异常，已保留数据')
        }
        continue
      }
      if (entry.name === PAYLOAD_NAME) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) {
          throw new TraceError(ERR.PATH_UNSAFE, '回收站内容状态异常，已保留数据')
        }
        continue
      }
      throw new TraceError(ERR.CONFLICT, '回收站条目包含未识别文件，已保留数据')
    }
  }

  private async recoverEntry(context: TrashLibraryContext, manifest: TrashManifest): Promise<RecoveryResult> {
    const entryDirectory = this.entryDirectory(context.root, manifest.entry_id)
    const payload = join(entryDirectory, PAYLOAD_NAME)
    const payloadExists = await pathExists(payload)
    const sourceExists = await pathExists(resolveWithin(context.root, manifest.original_relative_path).abs)

    if (manifest.phase === 'staging') {
      if (sourceExists && !payloadExists && await this.snapshotMatches(context.root, manifest.original_relative_path, manifest)) {
        const removed = await this.removeEntryMetadata(context.root, entryDirectory).catch(() => false)
        return { entry: removed ? null : entryFromManifest(manifest, 'needs_attention', 'entry_incomplete'), changes: [] }
      }
      if (!sourceExists && payloadExists && await this.payloadMatches(context.root, manifest)) {
        try {
          const trashed = await this.writeNextManifest(entryDirectory, manifest, { phase: 'trashed' })
          return {
            entry: entryFromManifest(trashed, 'trashed'),
            changes: [{ path: manifest.original_relative_path, plan_ids: collectPlanIds(manifest) }]
          }
        } catch {
          return { entry: entryFromManifest(manifest, 'needs_attention', 'entry_incomplete'), changes: [] }
        }
      }
      return { entry: entryFromManifest(manifest, 'needs_attention', 'identity_mismatch'), changes: [] }
    }

    if (manifest.phase === 'trashed') {
      if (!payloadExists || !(await this.payloadMatches(context.root, manifest))) {
        return { entry: entryFromManifest(manifest, 'needs_attention', 'identity_mismatch'), changes: [] }
      }
      return { entry: entryFromManifest(manifest, 'trashed'), changes: [] }
    }

    if (manifest.phase === 'restoring') {
      const target = manifest.restore_relative_path as string
      const targetAbs = resolveWithin(context.root, target).abs
      const targetExists = await pathExists(targetAbs)
      if (!targetExists && payloadExists && await this.payloadMatches(context.root, manifest) &&
        await this.restoreParentMatches(context.root, target, manifest.restore_parent_identity as TrashDirectoryIdentity)) {
        try {
          const trashed = await this.writeNextManifest(entryDirectory, manifest, {
            phase: 'trashed', restore_relative_path: undefined, restore_parent_identity: undefined
          })
          return { entry: entryFromManifest(trashed, 'trashed'), changes: [] }
        } catch {
          return { entry: entryFromManifest(manifest, 'needs_attention', 'entry_incomplete'), changes: [] }
        }
      }
      if (targetExists && !payloadExists && await this.snapshotMatches(context.root, target, manifest) &&
        await this.restoreParentMatches(context.root, target, manifest.restore_parent_identity as TrashDirectoryIdentity)) {
        const removed = await this.removeEntryMetadata(context.root, entryDirectory).catch(() => false)
        return {
          entry: removed ? null : entryFromManifest(manifest, 'needs_attention', 'entry_incomplete'),
          changes: [{ path: target, plan_ids: collectPlanIds(manifest) }]
        }
      }
      return { entry: entryFromManifest(manifest, 'needs_attention', 'identity_mismatch'), changes: [] }
    }

    if (manifest.phase === 'purging') {
      if (!payloadExists) {
        const removed = await this.removeEntryMetadata(context.root, entryDirectory).catch(() => false)
        return { entry: removed ? null : entryFromManifest(manifest, 'needs_attention', 'entry_incomplete'), changes: [] }
      }
      return { entry: entryFromManifest(manifest, 'purge_interrupted', 'purge_interrupted'), changes: [] }
    }

    return { entry: entryFromManifest(manifest, 'needs_attention', 'manifest_invalid'), changes: [] }
  }

  private async statusForManifest(context: TrashLibraryContext, manifest: TrashManifest): Promise<TrashEntry['status']> {
    if (manifest.phase === 'purging') return 'purge_interrupted'
    if (manifest.phase !== 'trashed' || !(await this.payloadMatches(context.root, manifest))) return 'needs_attention'
    return 'trashed'
  }

  private async resolveRestoreTarget(
    root: string,
    manifest: TrashManifest,
    destination?: TrashRestoreDestination
  ): Promise<{ relative_path: string; absolute_path: string; parent_identity: TrashDirectoryIdentity }> {
    const fallbackParent = dirname(manifest.original_relative_path).replace(/\\/g, '/') === '.'
      ? ''
      : dirname(manifest.original_relative_path).replace(/\\/g, '/')
    const parentRelative = destination?.parent_path ?? fallbackParent
    const name = destination?.name ?? manifest.name
    validatePlanName(name)
    if (typeof parentRelative !== 'string') throw new TraceError(ERR.VALIDATION, '恢复位置无效')
    const safeParent = resolveWithin(root, parentRelative).rel
    this.assertNotReserved(safeParent)
    await this.assertNoSymlinkPath(root, safeParent)
    const parentAbs = resolveWithin(root, safeParent).abs
    const parentStat = await fs.lstat(parentAbs).catch(() => null)
    if (!parentStat?.isDirectory() || parentStat.isSymbolicLink()) {
      throw new TraceError(ERR.PATH_NOT_FOUND, '恢复目标文件夹不存在或不可用')
    }
    await assertRealPathWithinRoot(root, parentAbs)
    const parentIdentity = await this.readDirectoryIdentity(parentAbs)
    const relativePath = safeParent ? `${safeParent}/${name}` : name
    const absolutePath = resolveWithin(root, relativePath).abs
    this.assertNotReserved(relativePath)
    await this.assertNoSymlinkPath(root, relativePath, true)
    if (await pathExists(absolutePath)) throw new TraceError(ERR.NAME_CONFLICT, '恢复位置已有同名内容，请选择新名称或文件夹')
    return { relative_path: relativePath, absolute_path: absolutePath, parent_identity: parentIdentity }
  }

  private async restoreParentMatches(root: string, target: string, identity: TrashDirectoryIdentity): Promise<boolean> {
    const parentRelative = dirname(target).replace(/\\/g, '/') === '.' ? '' : dirname(target).replace(/\\/g, '/')
    try {
      await this.assertNoSymlinkPath(root, parentRelative)
      const current = await this.readDirectoryIdentity(resolveWithin(root, parentRelative).abs)
      return directoryIdentityKey(current) === directoryIdentityKey(identity)
    } catch {
      return false
    }
  }

  private async captureDirectorySnapshot(root: string, relative: string): Promise<DirectorySnapshot> {
    await this.assertNoSymlinkPath(root, relative)
    const directoryIdentity = await this.readDirectoryIdentity(resolveWithin(root, relative).abs)
    const plans: TrashPlanSnapshot[] = []
    const pending = [relative]
    while (pending.length > 0) {
      const current = pending.pop() as string
      const currentAbs = resolveWithin(root, current).abs
      await this.assertNoSymlinkPath(root, current)
      const entries = await fs.readdir(currentAbs, { withFileTypes: true })
      for (const entry of entries) {
        const childRelative = current ? `${current}/${entry.name}` : entry.name
        if (entry.isSymbolicLink()) throw new TraceError(ERR.PATH_UNSAFE, '计划子树包含链接路径，已拒绝操作')
        if (entry.isDirectory()) {
          pending.push(childRelative)
          continue
        }
        if (!entry.isFile() || entry.name !== 'plan.json') continue
        await this.assertNoSymlinkPath(root, childRelative)
        const content = await fs.readFile(resolveWithin(root, childRelative).abs)
        let planId: string | null = null
        let updatedAt: string | null = null
        try {
          const document = JSON.parse(content.toString('utf8')) as Partial<PlanDocument>
          planId = typeof document.plan_id === 'string' && isUuid32(document.plan_id) ? document.plan_id : null
          updatedAt = typeof document.updated_at === 'string' ? document.updated_at : null
        } catch {
          // Keep malformed plans movable, but bind their exact bytes into the manifest snapshot.
        }
        plans.push({
          relative_path: childRelative === `${relative}/plan.json` ? '' : childRelative.slice(relative.length + 1, -'/plan.json'.length),
          plan_id: planId,
          updated_at: updatedAt,
          content_digest: createHash('sha256').update(content).digest('hex')
        })
      }
    }
    plans.sort((left, right) => left.relative_path.localeCompare(right.relative_path))
    const kind: TrashEntryKind = plans.some((plan) => plan.relative_path === '') ? 'plan' : 'folder'
    return { kind, directory_identity: directoryIdentity, plans }
  }

  private async snapshotMatches(root: string, relative: string, manifest: TrashManifest): Promise<boolean> {
    try {
      const snapshot = await this.captureDirectorySnapshot(root, relative)
      return sameSnapshotFromManifest(manifest, snapshot)
    } catch {
      return false
    }
  }

  private async payloadMatches(root: string, manifest: TrashManifest): Promise<boolean> {
    const payloadRelative = `${TRASH_RELATIVE_ROOT}/${manifest.entry_id}/${PAYLOAD_NAME}`
    return this.snapshotMatches(root, payloadRelative, manifest)
  }

  private async payloadStateDigest(root: string, manifest: TrashManifest): Promise<string> {
    const payloadRelative = `${TRASH_RELATIVE_ROOT}/${manifest.entry_id}/${PAYLOAD_NAME}`
    await this.assertNoSymlinkPath(root, payloadRelative)
    const payloadAbs = resolveWithin(root, payloadRelative).abs
    const snapshots: PayloadSnapshot[] = []
    const pending: Array<{ relative_path: string; absolute_path: string }> = [
      { relative_path: '', absolute_path: payloadAbs }
    ]

    while (pending.length > 0) {
      const current = pending.pop() as { relative_path: string; absolute_path: string }
      const directoryIdentity = await this.readDirectoryIdentity(current.absolute_path)
      snapshots.push({ relative_path: current.relative_path, kind: 'directory', identity: directoryIdentity })
      const entries = await fs.readdir(current.absolute_path, { withFileTypes: true })
      entries.sort((left, right) => left.name.localeCompare(right.name))
      for (const entry of entries) {
        const relativePath = current.relative_path
          ? `${current.relative_path}/${entry.name}`
          : entry.name
        const fullRelativePath = `${payloadRelative}/${relativePath}`
        const absolutePath = join(current.absolute_path, entry.name)
        if (entry.isSymbolicLink()) throw new TraceError(ERR.PATH_UNSAFE, '回收站内容包含链接路径，已保留数据')
        if (entry.isDirectory()) {
          await this.assertNoSymlinkPath(root, fullRelativePath)
          pending.push({ relative_path: relativePath, absolute_path: absolutePath })
          continue
        }
        if (!entry.isFile()) throw new TraceError(ERR.PATH_UNSAFE, '回收站内容包含不支持的文件类型，已保留数据')
        await this.assertNoSymlinkPath(root, fullRelativePath)
        snapshots.push(await this.snapshotPayloadFile(absolutePath, relativePath))
      }
    }

    snapshots.sort((left, right) => left.relative_path.localeCompare(right.relative_path) || left.kind.localeCompare(right.kind))
    return digestJson(snapshots)
  }

  private async snapshotPayloadFile(absolutePath: string, relativePath: string): Promise<PayloadFileSnapshot> {
    const pathStat = await fs.lstat(absolutePath, { bigint: true })
    if (!pathStat.isFile() || pathStat.isSymbolicLink()) {
      throw new TraceError(ERR.PATH_UNSAFE, '回收站文件路径不安全，已保留数据')
    }
    const handle = await fs.open(absolutePath, 'r')
    try {
      const before = await handle.stat({ bigint: true })
      if (!before.isFile() || pathStat.dev !== before.dev || pathStat.ino !== before.ino ||
        pathStat.birthtimeNs !== before.birthtimeNs || pathStat.size !== before.size ||
        pathStat.mtimeNs !== before.mtimeNs || pathStat.ctimeNs !== before.ctimeNs) {
        throw new TraceError(ERR.CONFLICT, '回收站内容在读取时发生变化，请重新预览')
      }
      const hash = createHash('sha256')
      const stream = handle.createReadStream({ autoClose: false })
      for await (const chunk of stream) hash.update(chunk)
      const after = await handle.stat({ bigint: true })
      if (before.dev !== after.dev || before.ino !== after.ino || before.birthtimeNs !== after.birthtimeNs ||
        before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
        throw new TraceError(ERR.CONFLICT, '回收站内容在读取时发生变化，请重新预览')
      }
      return {
        relative_path: relativePath,
        kind: 'file',
        device: String(before.dev),
        inode: String(before.ino),
        birthtime_ns: String(before.birthtimeNs),
        size: String(before.size),
        content_digest: hash.digest('hex')
      }
    } finally {
      await handle.close().catch(() => undefined)
    }
  }

  private async readDirectoryIdentity(path: string): Promise<TrashDirectoryIdentity> {
    const stat = await fs.lstat(path, { bigint: true })
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new TraceError(ERR.PATH_UNSAFE, '目录身份无效')
    return { device: String(stat.dev), inode: String(stat.ino), birthtime_ns: String(stat.birthtimeNs) }
  }

  private async assertNoSymlinkPath(root: string, relative: string, allowMissingTarget = false): Promise<void> {
    const safe = resolveWithin(root, relative).rel
    if (!safe) {
      await assertRealPathWithinRoot(root, root)
      return
    }
    const segments = safe.split('/')
    let current = root
    for (const [index, segment] of segments.entries()) {
      current = join(current, segment)
      try {
        const stat = await fs.lstat(current)
        if (stat.isSymbolicLink()) throw new TraceError(ERR.PATH_UNSAFE, '不允许通过链接路径访问计划库')
        if (index < segments.length - 1 && !stat.isDirectory()) {
          throw new TraceError(ERR.PATH_UNSAFE, '计划路径层级无效')
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' && allowMissingTarget && index === segments.length - 1) break
        throw error
      }
    }
    await assertRealPathWithinRoot(root, resolveWithin(root, safe).abs, { allowMissing: allowMissingTarget })
  }

  private assertActivePlanPath(root: string, relativePath: string): string {
    const relative = resolveWithin(root, relativePath).rel
    if (!relative) throw new TraceError(ERR.VALIDATION, '计划库根目录不可移入回收站')
    this.assertNotReserved(relative)
    return relative
  }

  private isAllowedOriginalPath(root: string, relativePath: string): boolean {
    try {
      const relative = resolveWithin(root, relativePath).rel
      return relative !== '' && !this.isReserved(relative)
    } catch {
      return false
    }
  }

  private isValidPlanSnapshots(root: string, manifest: TrashManifest): boolean {
    const seen = new Set<string>()
    let hasRootPlan = false
    for (const plan of manifest.plans) {
      try {
        const planDirectory = plan.relative_path
          ? `${manifest.original_relative_path}/${plan.relative_path}`
          : manifest.original_relative_path
        const normalizedPlanDirectory = resolveWithin(root, planDirectory).rel
        if (normalizedPlanDirectory !== planDirectory || this.isReserved(normalizedPlanDirectory) ||
          seen.has(plan.relative_path)) return false
        seen.add(plan.relative_path)
        if (plan.relative_path === '') hasRootPlan = true
      } catch {
        return false
      }
    }
    return manifest.kind === 'plan' ? hasRootPlan : !hasRootPlan
  }

  private assertNotReserved(relative: string): void {
    if (this.isReserved(relative)) throw new TraceError(ERR.PATH_UNSAFE, '此系统目录不属于计划回收站范围')
  }

  private isReserved(relative: string): boolean {
    const first = relative.split('/')[0]?.toLocaleLowerCase('en-US')
    return first === '.trace' || first === DIARY_DIR.toLocaleLowerCase('en-US')
  }

  private async removeEntryMetadata(root: string, entryDirectory: string): Promise<boolean> {
    const entryId = basename(entryDirectory)
    await this.assertNoSymlinkPath(root, `${TRASH_RELATIVE_ROOT}/${entryId}`)
    const directoryStat = await fs.lstat(entryDirectory)
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) return false
    const entries = await fs.readdir(entryDirectory, { withFileTypes: true })
    if (entries.length !== 1 || entries[0].name !== MANIFEST_NAME || !entries[0].isFile() || entries[0].isSymbolicLink()) {
      return false
    }
    this.repo.markInternalWrite(entryDirectory)
    await fs.unlink(join(entryDirectory, MANIFEST_NAME))
    await fs.rmdir(entryDirectory)
    return true
  }
}

function isTrashManifest(value: unknown): value is TrashManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Partial<TrashManifest>
  if (item.schema_version !== 1 || !Number.isSafeInteger(item.revision) || (item.revision ?? 0) < 1 ||
    !ENTRY_ID_PATTERN.test(item.entry_id ?? '') || !isUuid32(item.library_id ?? '') ||
    !Number.isSafeInteger(item.root_generation) || (item.root_generation ?? 0) < 1 ||
    (item.kind !== 'plan' && item.kind !== 'folder') || typeof item.name !== 'string' ||
    typeof item.original_relative_path !== 'string' || typeof item.deleted_at !== 'string' ||
    !isIdentity(item.directory_identity) || !isIdentity(item.original_parent_identity) || !Array.isArray(item.plans) ||
    !(['staging', 'trashed', 'restoring', 'purging'] as unknown[]).includes(item.phase)) return false
  if (item.plans.some((plan) => !plan || typeof plan.relative_path !== 'string' ||
    (plan.plan_id !== null && !isUuid32(plan.plan_id)) ||
    (plan.updated_at !== null && typeof plan.updated_at !== 'string') ||
    !/^[a-f0-9]{64}$/.test(plan.content_digest))) return false
  return true
}

function isIdentity(value: unknown): value is TrashDirectoryIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Partial<TrashDirectoryIdentity>
  return [item.device, item.inode, item.birthtime_ns].every((part) =>
    typeof part === 'string' && /^\d+$/.test(part))
}

function entryFromManifest(
  manifest: TrashManifest,
  status: TrashEntry['status'],
  issue?: TrashEntry['issue']
): TrashEntry {
  return {
    id: manifest.entry_id,
    kind: manifest.kind,
    name: manifest.name,
    original_relative_path: manifest.original_relative_path,
    deleted_at: manifest.deleted_at,
    manifest_revision: manifest.revision,
    status,
    can_restore: status === 'trashed',
    can_purge: status === 'trashed' || status === 'purge_interrupted',
    ...(issue ? { issue } : {})
  }
}

function attentionEntry(id: string, issue: NonNullable<TrashEntry['issue']>): TrashEntry {
  return {
    id,
    kind: 'folder',
    name: '无法识别的回收站条目',
    original_relative_path: '',
    deleted_at: '',
    manifest_revision: 0,
    status: 'needs_attention',
    can_restore: false,
    can_purge: false,
    issue
  }
}

function safeListedId(name: string): string {
  if (ENTRY_ID_PATTERN.test(name)) return name
  return `invalid-${createHash('sha256').update(name).digest('hex').slice(0, 16)}`
}

function collectPlanIds(manifest: TrashManifest): string[] {
  return [...new Set(manifest.plans.map((plan) => plan.plan_id).filter((id): id is string => id !== null))].sort()
}

function sameSnapshot(expected: DirectorySnapshot, actual: DirectorySnapshot): boolean {
  return directoryIdentityKey(expected.directory_identity) === directoryIdentityKey(actual.directory_identity) &&
    JSON.stringify(expected.plans) === JSON.stringify(actual.plans)
}

function sameSnapshotFromManifest(manifest: TrashManifest, actual: DirectorySnapshot): boolean {
  return directoryIdentityKey(manifest.directory_identity) === directoryIdentityKey(actual.directory_identity) &&
    JSON.stringify(manifest.plans) === JSON.stringify(actual.plans)
}

function directoryIdentityKey(identity: TrashDirectoryIdentity): string {
  return `${identity.device}\0${identity.inode}\0${identity.birthtime_ns}`
}

function digestJson(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (!value || typeof value !== 'object') return JSON.stringify(value)
  const item = value as Record<string, unknown>
  return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(item[key])}`).join(',')}}`
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
