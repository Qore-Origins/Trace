import { ERR, TraceError } from '../../shared/errors'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import type { Component, PlanDocument } from '../../shared/plan-types'
import type { TrashOperationCommitResult } from '../../shared/trash-types'
import type {
  PlanReferenceCandidate, PlanReferenceInbound, PlanReferenceResolution
} from '../../shared/ipc-contract'
import type {
  PlanReferenceMode, PlanReferenceTarget, ReferenceImpactItem, ReferenceImpactPreview,
  ReferenceImpactRequest, ReferenceImpactCommit, PlanMoveSnapshot, PlanMoveTargetSnapshot
} from '../../shared/plan-reference-types'
import { referenceComponentDisplayName, referenceComponentTypeFallback } from '../../shared/plan-reference-types'
import { isPlanReferencePayload, isReferenceTargetType } from '../../shared/plan-reference-validation'
import { isUuid32, uuid32, validatePlanName } from '../../shared/validation'
import { bus } from './event-bus'
import { assertRealPathWithinRoot, isSelfOrDescendant, parentRel, resolveWithin } from './path-safety'
import { PlanRepository } from './plan-repository'
import type { StorageService } from './storage-service'

interface LibrarySnapshot {
  root: string
  libraryId: string
  generation: number
  changeRevision: number
}

interface ScannedPlan {
  path: string
  document: PlanDocument
}

const MAX_QUERY_LENGTH = 200

function impactKey(reference: Pick<ReferenceImpactItem, 'source_path' | 'source_component_id'>): string {
  return `${reference.source_path}\0${reference.source_component_id}`
}

function componentName(component: Component): string {
  return referenceComponentDisplayName(component)
}

function targetOf(plan: ScannedPlan, component?: Component): PlanReferenceTarget {
  const planName = plan.path.split('/').at(-1) ?? plan.path
  const target: PlanReferenceTarget = {
    plan_id: plan.document.plan_id as string,
    path: plan.path,
    plan_name: planName
  }
  if (component && isReferenceTargetType(component.type)) {
    target.component_id = component.id
    target.component_type = component.type
    target.component_name = componentName(component)
  }
  return target
}

/** All paths stay relative to the selected library; no snapshot is used as a lookup key. */
export class PlanReferenceService {
  private generation = 0
  private activeRoot: string | null = null
  private reverseCache: { generation: number; changeRevision: number; items: PlanReferenceInbound[] } | null = null
  private scanCache: { root: string; generation: number; changeRevision: number; plans: ScannedPlan[] } | null = null
  private scanInFlight: {
    root: string; generation: number; changeRevision: number; promise: Promise<ScannedPlan[]>
  } | null = null
  private changeRevision = 0
  private commitQueue: Promise<void> = Promise.resolve()
  private switchingRoot = false
  private readonly unsubscribe: Array<() => void>

  constructor(private repo: PlanRepository, private getRoot: () => string | null) {
    this.unsubscribe = [
      bus.on('trace:plan-changed', () => this.invalidateScans()),
      bus.on('trace:fs-external-change', () => this.invalidateScans())
    ]
  }

  private invalidateScans(): void {
    this.changeRevision += 1
    this.reverseCache = null
    this.scanCache = null
  }

  activateRoot(root: string): void {
    this.activeRoot = root
    this.generation += 1
    this.changeRevision += 1
    this.reverseCache = null
    this.scanCache = null
    this.switchingRoot = false
  }

  beginRootSwitch(): Promise<() => void> {
    if (this.switchingRoot) throw new TraceError(ERR.CONFLICT, '计划库正在切换，请重试')
    this.switchingRoot = true
    const generation = this.generation
    return this.commitQueue.then(() => {
      if (this.generation !== generation) throw new TraceError(ERR.CONFLICT, '计划库已切换，请重试')
      return () => {
        if (this.generation === generation) this.switchingRoot = false
      }
    }, (error) => {
      this.switchingRoot = false
      throw error
    })
  }

  dispose(): void {
    this.unsubscribe.forEach((unsubscribe) => unsubscribe())
    this.unsubscribe.length = 0
  }

  private current(snapshot: LibrarySnapshot): void {
    if (this.generation !== snapshot.generation || this.activeRoot !== snapshot.root || this.getRoot() !== snapshot.root) {
      throw new TraceError(ERR.CONFLICT, '计划库已切换，请重试')
    }
  }

  private currentRevision(snapshot: LibrarySnapshot): void {
    this.current(snapshot)
    if (this.changeRevision !== snapshot.changeRevision) {
      throw new TraceError(ERR.CONFLICT, '计划内容已变化，请重试')
    }
  }

  private enqueueCommit<T>(operation: () => Promise<T>): Promise<T> {
    if (this.switchingRoot) throw new TraceError(ERR.CONFLICT, '计划库正在切换，请重试')
    const expectedGeneration = this.generation
    const queued = this.commitQueue.then(() => {
      if (this.generation !== expectedGeneration || this.switchingRoot) {
        throw new TraceError(ERR.CONFLICT, '计划库已切换，请重试')
      }
      return operation()
    })
    this.commitQueue = queued.then(() => undefined, () => undefined)
    return queued
  }

  runRendererMutation<T>(operation: () => Promise<T>): Promise<T> {
    return this.enqueueCommit(operation)
  }

  private async snapshot(libraryId: unknown): Promise<LibrarySnapshot> {
    if (typeof libraryId !== 'string' || !isUuid32(libraryId)) {
      throw new TraceError(ERR.VALIDATION, '计划库标识无效')
    }
    const root = this.getRoot()
    if (!root || root !== this.activeRoot) throw new TraceError(ERR.CONFLICT, '计划库已切换，请重试')
    const snapshot = { root, libraryId, generation: this.generation, changeRevision: this.changeRevision }
    const metaFile = resolveWithin(root, '.trace/plan-library.json').abs
    await assertRealPathWithinRoot(root, metaFile)
    this.currentRevision(snapshot)
    const meta = await this.repo.readLibraryMeta(root)
    this.currentRevision(snapshot)
    if (meta.library_id !== libraryId) throw new TraceError(ERR.CONFLICT, '计划库已切换，请重试')
    return snapshot
  }

  private async activeSnapshot(): Promise<LibrarySnapshot> {
    const root = this.getRoot()
    if (!root || root !== this.activeRoot) throw new TraceError(ERR.CONFLICT, '计划库已切换，请重试')
    const metaFile = resolveWithin(root, '.trace/plan-library.json').abs
    await assertRealPathWithinRoot(root, metaFile)
    const initial: LibrarySnapshot = {
      root, libraryId: '', generation: this.generation, changeRevision: this.changeRevision
    }
    this.currentRevision(initial)
    const meta = await this.repo.readLibraryMeta(root)
    this.currentRevision(initial)
    return this.snapshot(meta.library_id)
  }

  private async securePlan(snapshot: LibrarySnapshot, path: string): Promise<PlanDocument> {
    this.current(snapshot)
    const directory = resolveWithin(snapshot.root, path)
    if (!directory.rel) throw new TraceError(ERR.PATH_UNSAFE, '计划路径无效')
    await assertRealPathWithinRoot(snapshot.root, directory.abs)
    this.current(snapshot)
    const file = resolveWithin(snapshot.root, `${directory.rel}/plan.json`).abs
    await assertRealPathWithinRoot(snapshot.root, file)
    this.current(snapshot)
    const doc = await this.repo.readPlan(snapshot.root, directory.rel)
    this.current(snapshot)
    return doc
  }

  private async scan(snapshot: LibrarySnapshot): Promise<ScannedPlan[]> {
    const found: ScannedPlan[] = []
    const pending = ['']
    while (pending.length > 0) {
      const parent = pending.pop() as string
      this.currentRevision(snapshot)
      const directory = resolveWithin(snapshot.root, parent).abs
      let names: string[]
      try {
        await assertRealPathWithinRoot(snapshot.root, directory)
        this.currentRevision(snapshot)
        names = await this.repo.listPlanDirs(snapshot.root, parent)
      } catch (error) {
        this.currentRevision(snapshot)
        if (parent) continue
        throw error
      }
      this.currentRevision(snapshot)
      for (const name of names) {
        const path = parent ? `${parent}/${name}` : name
        const child = resolveWithin(snapshot.root, path).abs
        try {
          await assertRealPathWithinRoot(snapshot.root, child)
          this.currentRevision(snapshot)
          // A safe folder is traversed even if its own plan file is absent or malformed.
          pending.push(path)
          const planFile = resolveWithin(snapshot.root, `${path}/plan.json`).abs
          await assertRealPathWithinRoot(snapshot.root, planFile)
          this.currentRevision(snapshot)
          const document = await this.repo.readPlan(snapshot.root, path)
          this.currentRevision(snapshot)
          found.push({ path, document })
        } catch (error) {
          this.currentRevision(snapshot)
          // An unreadable or damaged child does not make its healthy siblings disappear.
          if (error instanceof TraceError && error.code === ERR.CONFLICT) throw error
        }
      }
    }
    return found
  }

  private async scanForSnapshot(snapshot: LibrarySnapshot): Promise<ScannedPlan[]> {
    this.currentRevision(snapshot)
    const matches = (entry: { root: string; generation: number; changeRevision: number }): boolean =>
      entry.root === snapshot.root && entry.generation === snapshot.generation &&
      entry.changeRevision === snapshot.changeRevision
    if (this.scanCache && matches(this.scanCache)) return this.scanCache.plans

    let flight = this.scanInFlight
    if (!flight || !matches(flight)) {
      flight = {
        root: snapshot.root,
        generation: snapshot.generation,
        changeRevision: snapshot.changeRevision,
        promise: this.scan(snapshot)
      }
      this.scanInFlight = flight
    }

    try {
      const plans = await flight.promise
      this.currentRevision(snapshot)
      this.scanCache = {
        root: snapshot.root,
        generation: snapshot.generation,
        changeRevision: snapshot.changeRevision,
        plans
      }
      return plans
    } finally {
      if (this.scanInFlight === flight) this.scanInFlight = null
    }
  }

  private findById(plans: ScannedPlan[], planId: string): ScannedPlan | null | 'conflict' {
    const matches = plans.filter((plan) => plan.document.plan_id === planId)
    if (matches.length > 1) return 'conflict'
    return matches[0] ?? null
  }

  private async planSubtreeSnapshot(
    snapshot: LibrarySnapshot,
    path: string
  ): Promise<{ plans: ScannedPlan[]; directoryIdentity: string; digest: string }> {
    const absolutePath = resolveWithin(snapshot.root, path).abs
    await assertRealPathWithinRoot(snapshot.root, absolutePath)
    this.currentRevision(snapshot)
    const directoryIdentity = await readDirectoryIdentityKey(absolutePath)
    const allPlans = await this.scan(snapshot)
    this.currentRevision(snapshot)
    const plans = allPlans.filter((plan) => isSelfOrDescendant(path, plan.path))
      .sort((left, right) => left.path.localeCompare(right.path))
    const snapshots = plans.map((plan) => ({
      path: plan.path,
      plan_id: typeof plan.document.plan_id === 'string' ? plan.document.plan_id : null,
      updated_at: plan.document.updated_at
    }))
    const digest = createHash('sha256').update(JSON.stringify({ directoryIdentity, plans: snapshots })).digest('hex')
    return { plans, directoryIdentity, digest }
  }

  private async freezeMoveSnapshot(
    request: { path: string; target_parent_path: string },
    storage: StorageService
  ): Promise<PlanMoveSnapshot> {
    if (!request || typeof request.path !== 'string' || typeof request.target_parent_path !== 'string') {
      throw new TraceError(ERR.VALIDATION, '移动请求无效')
    }
    const snapshot = await this.activeSnapshot()
    const sourcePath = resolveWithin(snapshot.root, request.path).rel
    const targetParentPath = resolveWithin(snapshot.root, request.target_parent_path).rel
    if (!sourcePath || isReferenceReservedPath(sourcePath) || isReferenceReservedPath(targetParentPath)) {
      throw new TraceError(ERR.PATH_UNSAFE, '该路径不可移动')
    }
    if (isSelfOrDescendant(sourcePath, targetParentPath)) {
      throw new TraceError(ERR.CIRCULAR_NESTING, '不能移动到自身或子计划中')
    }
    const storageSnapshot = await storage.captureMoveDirectorySnapshot(sourcePath, targetParentPath)
    this.currentRevision(snapshot)
    const allPlans = await this.scan(snapshot)
    this.currentRevision(snapshot)
    const sourcePlans = allPlans.filter((plan) => isSelfOrDescendant(sourcePath, plan.path))
      .sort((left, right) => left.path.localeCompare(right.path))
    const ids = new Map<string, number>()
    for (const plan of allPlans) {
      const id = plan.document.plan_id
      if (typeof id === 'string') ids.set(id, (ids.get(id) ?? 0) + 1)
    }
    const sourceIds = sourcePlans.map((plan) => plan.document.plan_id).filter((id): id is string => typeof id === 'string')
    if (sourceIds.some((id) => ids.get(id) !== 1)) {
      throw new TraceError(ERR.CONFLICT, '移动子树存在重复计划标识，请先处理重复项')
    }
    const sourceSnapshots: PlanMoveTargetSnapshot[] = sourcePlans.map((plan) => ({
      path: plan.path,
      plan_id: typeof plan.document.plan_id === 'string' ? plan.document.plan_id : null,
      updated_at: plan.document.updated_at
    }))
    return {
      library_id: snapshot.libraryId,
      root_generation: snapshot.generation,
      change_revision: snapshot.changeRevision,
      storage_root_generation: storageSnapshot.root_generation,
      source_path: sourcePath,
      target_parent_path: targetParentPath,
      source_directory_identity: storageSnapshot.source_directory_identity,
      target_directory_identity: storageSnapshot.target_directory_identity,
      source_plans: sourceSnapshots
    }
  }

  async commitMove(request: { path: string; target_parent_path: string }, storage: StorageService): Promise<{ path: string }> {
    const frozen = await this.freezeMoveSnapshot(request, storage)
    return this.enqueueCommit(async () => {
      const snapshot = await this.snapshot(frozen.library_id)
      if (snapshot.generation !== frozen.root_generation || snapshot.changeRevision !== frozen.change_revision) {
        throw new TraceError(ERR.CONFLICT, '计划内容已变化，请重新预览确认')
      }
      const currentDirectories = await storage.captureMoveDirectorySnapshot(frozen.source_path, frozen.target_parent_path)
      if (currentDirectories.root_generation !== frozen.storage_root_generation ||
        currentDirectories.source_directory_identity !== frozen.source_directory_identity ||
        currentDirectories.target_directory_identity !== frozen.target_directory_identity) {
        throw new TraceError(ERR.CONFLICT, '移动目录身份已变化，请重新预览确认')
      }
      const allPlans = await this.scan(snapshot)
      this.currentRevision(snapshot)
      const currentIdCounts = new Map<string, number>()
      for (const plan of allPlans) {
        if (typeof plan.document.plan_id === 'string') {
          currentIdCounts.set(plan.document.plan_id, (currentIdCounts.get(plan.document.plan_id) ?? 0) + 1)
        }
      }
      if (frozen.source_plans.some((plan) => plan.plan_id !== null && currentIdCounts.get(plan.plan_id) !== 1)) {
        throw new TraceError(ERR.CONFLICT, '移动子树存在重复计划标识，请先处理重复项')
      }
      const currentSourcePlans = allPlans.filter((plan) => isSelfOrDescendant(frozen.source_path, plan.path))
        .sort((left, right) => left.path.localeCompare(right.path))
        .map((plan) => ({
          path: plan.path,
          plan_id: typeof plan.document.plan_id === 'string' ? plan.document.plan_id : null,
          updated_at: plan.document.updated_at
        }))
      if (JSON.stringify(currentSourcePlans) !== JSON.stringify(frozen.source_plans)) {
        throw new TraceError(ERR.CONFLICT, '移动子树已变化，请重新预览确认')
      }
      const sourceIds = frozen.source_plans.map((plan) => plan.plan_id).filter((id): id is string => id !== null)
      const targetPath = `${frozen.target_parent_path ? `${frozen.target_parent_path}/` : ''}${basenameRel(frozen.source_path)}`
      const oldParentPath = parentRel(frozen.source_path)
      if (frozen.target_parent_path === oldParentPath) return { path: frozen.source_path }
      const siblings = await this.repo.listPlanDirs(snapshot.root, frozen.target_parent_path)
      this.currentRevision(snapshot)
      if (siblings.includes(basenameRel(frozen.source_path))) {
        throw new TraceError(ERR.NAME_CONFLICT, '目标位置已存在同名计划或文件夹')
      }
      await storage.movePlanRaw(frozen, frozen.storage_root_generation)
      storage.treeCache.invalidatePrefix(frozen.source_path)
      storage.treeCache.invalidatePrefix(frozen.target_parent_path)
      bus.emit('trace:plan-changed', { path: targetPath })
      if (sourceIds.length > 0) bus.emit('trace:reference-target-changed', { plan_ids: sourceIds.sort() })
      return { path: targetPath }
    })
  }

  async search(request: { library_id: string; query: string }): Promise<{ targets: PlanReferenceCandidate[] }> {
    const snapshot = await this.snapshot(request?.library_id)
    if (typeof request.query !== 'string' || request.query.length > MAX_QUERY_LENGTH) {
      throw new TraceError(ERR.VALIDATION, '搜索词无效')
    }
    const query = request.query.trim().toLocaleLowerCase()
    const targets: PlanReferenceCandidate[] = []
    for (const plan of await this.scanForSnapshot(snapshot)) {
      const planName = plan.path.split('/').at(-1) ?? plan.path
      const idCounts = new Map<string, number>()
      for (const component of plan.document.components) {
        if (typeof component.id === 'string') idCounts.set(component.id, (idCounts.get(component.id) ?? 0) + 1)
      }
      if (planName.toLocaleLowerCase().includes(query)) {
        targets.push({ path: plan.path, plan_name: planName, plan_id: plan.document.plan_id })
      }
      for (const component of plan.document.components) {
        if (!isReferenceTargetType(component.type) || !isUuid32(component.id) || idCounts.get(component.id) !== 1) continue
        const name = componentName(component)
        if (!planName.toLocaleLowerCase().includes(query) && !name.toLocaleLowerCase().includes(query)) continue
        targets.push({
          path: plan.path, plan_name: planName, plan_id: plan.document.plan_id,
          component_id: component.id, component_type: component.type, component_name: name
        })
      }
    }
    this.currentRevision(snapshot)
    return { targets }
  }

  async resolve(request: { library_id: string; plan_id: string; component_id?: string }): Promise<PlanReferenceResolution> {
    const snapshot = await this.snapshot(request?.library_id)
    if (!isUuid32(request.plan_id) || (request.component_id !== undefined && !isUuid32(request.component_id))) {
      throw new TraceError(ERR.VALIDATION, '引用目标标识无效')
    }
    const plans = await this.scanForSnapshot(snapshot)
    this.currentRevision(snapshot)
    const plan = this.findById(plans, request.plan_id)
    if (plan === 'conflict') return { status: 'conflict' }
    if (!plan) return { status: 'missing' }
    const component = request.component_id
      ? plan.document.components.find((entry) => entry.id === request.component_id)
      : undefined
    if (request.component_id && (!component || !isReferenceTargetType(component.type) ||
      plan.document.components.filter((entry) => entry.id === request.component_id).length !== 1)) {
      return { status: 'missing' }
    }
    this.current(snapshot)
    return { status: 'found', target: targetOf(plan, component), ...(component ? { component } : {}) }
  }

  async commitTarget(request: {
    library_id: string; path: string; component_id?: string; mode: PlanReferenceMode
  }): Promise<PlanReferenceTarget> {
    return this.enqueueCommit(() => this.commitTargetNow(request))
  }

  private async commitTargetNow(request: {
    library_id: string; path: string; component_id?: string; mode: PlanReferenceMode
  }): Promise<PlanReferenceTarget> {
    const snapshot = await this.snapshot(request?.library_id)
    if ((request.mode !== 'link' && request.mode !== 'embed') ||
      (request.mode === 'embed' && !request.component_id) ||
      (request.component_id !== undefined && !isUuid32(request.component_id)) ||
      typeof request.path !== 'string') {
      throw new TraceError(ERR.VALIDATION, '引用目标请求无效')
    }
    const path = resolveWithin(snapshot.root, request.path).rel
    const document = await this.securePlan(snapshot, path)
    const component = request.component_id
      ? document.components.find((entry) => entry.id === request.component_id)
      : undefined
    if (request.component_id && (!component || !isReferenceTargetType(component.type) ||
      document.components.filter((entry) => entry.id === request.component_id).length !== 1)) {
      throw new TraceError(ERR.VALIDATION, '引用组件无效')
    }
    const plans = await this.scan(snapshot)
    this.currentRevision(snapshot)
    if (document.plan_id && this.findById(plans, document.plan_id) === 'conflict') {
      throw new TraceError(ERR.CONFLICT, '计划标识冲突，请先处理重复项')
    }
    // Re-read immediately before writing so unrelated edits are preserved.
    let assigned = false
    let assignedPlanId: string | undefined
    const latest = await this.repo.mutatePlanAtomic(snapshot.root, path, (current) => {
      this.currentRevision(snapshot)
      if (this.switchingRoot) throw new TraceError(ERR.CONFLICT, '计划库正在切换，请重试')
      if (current.updated_at !== document.updated_at || current.plan_id !== document.plan_id) {
        throw new TraceError(ERR.CONFLICT, '目标计划已变化，请重试')
      }
      if (request.component_id && current.components.filter((entry) =>
        entry.id === request.component_id && isReferenceTargetType(entry.type)).length !== 1) {
        throw new TraceError(ERR.CONFLICT, '目标组件已变化，请重试')
      }
      if (current.plan_id) return null
      const used = new Set(plans.map((plan) => plan.document.plan_id).filter((id): id is string => !!id))
      let id = uuid32()
      while (used.has(id)) id = uuid32()
      current.plan_id = id
      assigned = true
      assignedPlanId = id
      return current
    })
    this.current(snapshot)
    if (assigned) {
      bus.emit('trace:plan-changed', { path })
      if (assignedPlanId) bus.emit('trace:reference-target-changed', { plan_ids: [assignedPlanId] })
    }
    const latestComponent = request.component_id
      ? latest.components.find((entry) => entry.id === request.component_id)
      : undefined
    return targetOf({ path, document: latest }, latestComponent)
  }

  async inbound(request: { library_id: string; plan_id: string; component_id?: string }): Promise<{ references: PlanReferenceInbound[] }> {
    const snapshot = await this.snapshot(request?.library_id)
    if (!isUuid32(request.plan_id) || (request.component_id !== undefined && !isUuid32(request.component_id))) {
      throw new TraceError(ERR.VALIDATION, '引用目标标识无效')
    }
    if (!this.reverseCache || this.reverseCache.generation !== snapshot.generation ||
      this.reverseCache.changeRevision !== snapshot.changeRevision) {
      const items: PlanReferenceInbound[] = []
      for (const plan of await this.scanForSnapshot(snapshot)) {
        for (const component of plan.document.components) {
          if (component.type !== 'plan_reference' || !isPlanReferencePayload(component.payload)) continue
          items.push({
            source_path: plan.path,
            source_component_id: component.id,
            target_plan_id: component.payload.target_plan_id,
            ...(component.payload.target_component_id ? { target_component_id: component.payload.target_component_id } : {})
          })
        }
      }
      this.currentRevision(snapshot)
      this.reverseCache = { generation: snapshot.generation, changeRevision: snapshot.changeRevision, items }
    }
    return { references: this.reverseCache.items.filter((reference) =>
      reference.target_plan_id === request.plan_id &&
      (request.component_id === undefined || reference.target_component_id === request.component_id)) }
  }

  async saveRendererPlan(
    storage: StorageService,
    path: string,
    document: PlanDocument,
    expectedUpdatedAt: string
  ): Promise<{ updated_at: string }> {
    return this.enqueueCommit(async () => {
      await this.assertRendererSaveDoesNotChangeReferencedTargets(path, document, expectedUpdatedAt)
      return storage.savePlan(path, document, expectedUpdatedAt)
    })
  }

  async appendRendererComponent(storage: StorageService, path: string, component: Component): Promise<void> {
    return this.enqueueCommit(async () => {
      if (component.type === 'plan_reference') {
        const snapshot = await this.activeSnapshot()
        await this.assertReferenceTargetsExist(snapshot, [component])
      }
      return storage.appendComponent(path, component)
    })
  }

  private async assertRendererSaveDoesNotChangeReferencedTargets(
    path: string,
    nextDocument: PlanDocument,
    expectedUpdatedAt: string
  ): Promise<void> {
    const snapshot = await this.activeSnapshot()
    const rel = resolveWithin(snapshot.root, path).rel
    if (!rel) throw new TraceError(ERR.VALIDATION, '根目录无内容可保存')
    const current = await this.securePlan(snapshot, rel)
    if (current.updated_at !== expectedUpdatedAt) {
      throw new TraceError(ERR.CONFLICT, '数据已被修改（外部或并发），请刷新后重试')
    }
    if (!nextDocument || !Array.isArray(nextDocument.components)) {
      throw new TraceError(ERR.VALIDATION, '计划内容无效')
    }

    const targetSignature = (document: PlanDocument): Map<string, string> => {
      const values = new Map<string, string[]>()
      for (const component of document.components) {
        if (!isReferenceTargetType(component.type) || typeof component.id !== 'string') continue
        const entries = values.get(component.id) ?? []
        entries.push(JSON.stringify({ type: component.type, name: referenceComponentDisplayName(component) }))
        values.set(component.id, entries)
      }
      return new Map([...values].map(([id, entries]) => [id, JSON.stringify(entries.sort())]))
    }
    const previousTargets = targetSignature(current)
    const nextTargets = targetSignature(nextDocument)
    const changedComponentIds = new Set([...previousTargets.keys(), ...nextTargets.keys()]
      .filter((id) => previousTargets.get(id) !== nextTargets.get(id)))
    const previousReferenceCounts = new Map<string, number>()
    const previousComponentsById = new Map<string, Component[]>()
    const referenceIdentity = (component: Component): string | null => {
      const payload = component.payload
      if (component.type !== 'plan_reference' || !isPlanReferencePayload(payload)) return null
      return JSON.stringify({ id: component.id, plan_id: payload.target_plan_id,
        component_id: payload.target_component_id })
    }
    for (const component of current.components) {
      const identity = referenceIdentity(component)
      if (identity) previousReferenceCounts.set(identity, (previousReferenceCounts.get(identity) ?? 0) + 1)
      if (component.type === 'plan_reference') {
        const entries = previousComponentsById.get(component.id) ?? []
        entries.push(component)
        previousComponentsById.set(component.id, entries)
      }
    }
    const newReferences: Component[] = []
    for (const component of nextDocument.components) {
      if (component.type !== 'plan_reference') continue
      const identity = referenceIdentity(component)
      if (!identity) {
        const unchangedInvalidReference = previousComponentsById.get(component.id)?.some((previous) =>
          JSON.stringify(previous) === JSON.stringify(component))
        if (unchangedInvalidReference) continue
        throw new TraceError(ERR.VALIDATION, '计划引用内容无效')
      }
      const count = previousReferenceCounts.get(identity) ?? 0
      if (count > 0) previousReferenceCounts.set(identity, count - 1)
      else newReferences.push(component)
    }
    const changedPlanId = current.plan_id !== nextDocument.plan_id
    if (!changedPlanId && changedComponentIds.size === 0 && newReferences.length === 0) return

    const plans = await this.scanForSnapshot(snapshot)
    this.currentRevision(snapshot)
    const planIds = new Set([current.plan_id, nextDocument.plan_id]
      .filter((id): id is string => typeof id === 'string'))
    const hasAffectedReference = plans.some((plan) => plan.document.components.some((component) => {
      if (component.type !== 'plan_reference' || !isPlanReferencePayload(component.payload)) return false
      const payload = component.payload
      if (!planIds.has(payload.target_plan_id)) return false
      if (changedPlanId) return true
      return typeof payload.target_component_id === 'string' && changedComponentIds.has(payload.target_component_id)
    }))
    this.currentRevision(snapshot)
    if (hasAffectedReference) {
      throw new TraceError(ERR.CONFIRMATION_REQUIRED, '请通过关联影响确认流程修改被引用的计划或组件')
    }
    await this.assertReferenceTargetsExistInPlans(plans, newReferences)
    this.currentRevision(snapshot)
  }

  private async assertReferenceTargetsExist(snapshot: LibrarySnapshot, components: Component[]): Promise<void> {
    const plans = await this.scanForSnapshot(snapshot)
    this.currentRevision(snapshot)
    await this.assertReferenceTargetsExistInPlans(plans, components)
    this.currentRevision(snapshot)
  }

  private async assertReferenceTargetsExistInPlans(plans: ScannedPlan[], components: Component[]): Promise<void> {
    for (const component of components) {
      const payload = component.payload
      if (component.type !== 'plan_reference' || !isPlanReferencePayload(payload)) {
        throw new TraceError(ERR.VALIDATION, '计划引用内容无效')
      }
      const target = this.findById(plans, payload.target_plan_id)
      if (target === 'conflict') throw new TraceError(ERR.CONFLICT, '引用目标计划标识冲突')
      if (!target) throw new TraceError(ERR.PATH_NOT_FOUND, '引用目标已不存在，请重新选择')
      if (payload.target_component_id !== undefined) {
        const matches = target.document.components.filter((entry) => entry.id === payload.target_component_id)
        if (matches.length !== 1 || !isReferenceTargetType(matches[0].type)) {
          throw new TraceError(ERR.PATH_NOT_FOUND, '引用目标组件已不存在，请重新选择')
        }
      }
    }
  }

  async previewImpact(request: ReferenceImpactRequest): Promise<ReferenceImpactPreview> {
    const snapshot = await this.snapshot(request?.library_id)
    if (!request || typeof request.path !== 'string' ||
      !['rename-plan', 'delete-plan', 'rename-component', 'delete-component'].includes(request.operation)) {
      throw new TraceError(ERR.VALIDATION, '引用影响请求无效')
    }
    if (request.locale !== undefined && request.locale !== 'zh-CN' && request.locale !== 'en-US') {
      throw new TraceError(ERR.VALIDATION, '引用显示语言无效')
    }
    const path = resolveWithin(snapshot.root, request.path).rel
    if (!path) throw new TraceError(ERR.VALIDATION, '根目录不可修改')
    const isPlanOperation = request.operation.endsWith('-plan')
    const isRename = request.operation.startsWith('rename-')
    if (request.operation === 'rename-plan') {
      if (typeof request.new_name !== 'string' || /[\u0000-\u001f\u007f-\u009f]/.test(request.new_name)) {
        throw new TraceError(ERR.VALIDATION, '计划名称无效')
      }
      validatePlanName(request.new_name)
    }
    if (request.operation === 'rename-component' &&
      (typeof request.new_title !== 'string' || request.new_title.length > 200 ||
        /[\u0000-\u001f\u007f-\u009f]/.test(request.new_title))) {
      throw new TraceError(ERR.VALIDATION, '组件标题无效')
    }
    if (!isPlanOperation && (typeof request.component_id !== 'string' ||
      request.component_id.length === 0 || request.component_id.length > 256)) {
      throw new TraceError(ERR.VALIDATION, '组件标识无效')
    }
    await assertRealPathWithinRoot(snapshot.root, resolveWithin(snapshot.root, path).abs)
    this.currentRevision(snapshot)
    const plans = await this.scan(snapshot)
    this.currentRevision(snapshot)
    const targetPlan = plans.find((plan) => plan.path === path)
    if (!isPlanOperation && !targetPlan) throw new TraceError(ERR.PATH_NOT_FOUND, '目标计划不存在')
    if (!isPlanOperation && targetPlan?.document.plan_id &&
      this.findById(plans, targetPlan.document.plan_id) === 'conflict') {
      throw new TraceError(ERR.CONFLICT, '目标计划标识冲突，请先处理重复项')
    }
    let targetComponent: Component | undefined
    if (!isPlanOperation) {
      const matches = targetPlan!.document.components.filter((component) => component.id === request.component_id)
      if (matches.length !== 1 ||
        (request.operation === 'rename-component' && !isReferenceTargetType(matches[0].type))) {
        throw new TraceError(ERR.PATH_NOT_FOUND, '目标组件不存在')
      }
      targetComponent = matches[0]
      if (request.operation === 'rename-component' &&
        !['single_plan', 'multi_plan', 'task_list', 'task_detail', 'heading'].includes(targetComponent.type)) {
        throw new TraceError(ERR.VALIDATION, '此组件类型不可重命名')
      }
      if (request.operation === 'rename-component' &&
        request.expected_updated_at !== targetPlan!.document.updated_at) {
        throw new TraceError(ERR.CONFLICT, '目标组件已变化，请刷新后重试')
      }
    }
    const affectedPlanRecords = plans.filter((plan) => isPlanOperation && isSelfOrDescendant(path, plan.path))
    const affectedIds = affectedPlanRecords.map((plan) => plan.document.plan_id)
      .filter((id): id is string => typeof id === 'string')
    const planIdCounts = new Map<string, number>()
    for (const plan of plans) {
      const id = plan.document.plan_id
      if (typeof id === 'string') planIdCounts.set(id, (planIdCounts.get(id) ?? 0) + 1)
    }
    if (affectedIds.some((id) => planIdCounts.get(id) !== 1)) {
      throw new TraceError(ERR.CONFLICT, '受影响计划存在重复标识，请先处理重复项')
    }
    const targetSnapshot = isPlanOperation ? await this.planSubtreeSnapshot(snapshot, path) : null
    this.currentRevision(snapshot)
    const affectedPlans = new Set(affectedIds)
    const references: ReferenceImpactItem[] = []
    for (const source of plans) {
      if (request.operation === 'delete-plan' && isSelfOrDescendant(path, source.path)) continue
      for (const component of source.document.components) {
        if (component.type !== 'plan_reference' || !isPlanReferencePayload(component.payload)) continue
        const payload = component.payload
        const hit = isPlanOperation
          ? affectedPlans.has(payload.target_plan_id)
          : payload.target_plan_id === targetPlan!.document.plan_id &&
            payload.target_component_id === request.component_id
        if (!hit) continue
        if (source.document.components.filter((entry) => entry.id === component.id).length !== 1) {
          throw new TraceError(ERR.CONFLICT, '来源计划存在重复组件标识')
        }
        references.push({
          source_path: source.path, source_component_id: component.id,
          source_updated_at: source.document.updated_at,
          target_plan_id: payload.target_plan_id,
          ...(payload.target_component_id ? { target_component_id: payload.target_component_id } : {}),
          mode: payload.mode, target_path_snapshot: payload.target_path_snapshot,
          target_name_snapshot: payload.target_name_snapshot
        })
      }
    }
    this.currentRevision(snapshot)
    references.sort((left, right) =>
      `${left.source_path}\0${left.source_component_id}`.localeCompare(`${right.source_path}\0${right.source_component_id}`))
    return {
      operation: request.operation, path,
      ...(request.component_id ? { component_id: request.component_id } : {}),
      ...(isRename && request.new_name !== undefined ? { new_name: request.new_name } : {}),
      ...(isRename && request.new_title !== undefined ? { new_title: request.new_title } : {}),
      ...(request.expected_updated_at ? { expected_updated_at: request.expected_updated_at } : {}),
      ...(request.locale ? { locale: request.locale } : {}),
      ...(targetPlan ? { target_updated_at: targetPlan.document.updated_at } : {}),
      target_plan_ids: [...affectedPlans].filter((id): id is string => typeof id === 'string').sort(),
      ...(targetSnapshot ? { target_snapshot_digest: targetSnapshot.digest } : {}),
      references
    }
  }

  async commitImpact(request: ReferenceImpactCommit, storage: StorageService): Promise<{ path?: string }> {
    return this.enqueueCommit(() => this.commitImpactNow(request, storage))
  }

  commitTrashRestore(storage: StorageService, confirmationToken: string): Promise<TrashOperationCommitResult> {
    return this.enqueueCommit(() => storage.commitTrashRestore(confirmationToken))
  }

  commitTrashPurge(storage: StorageService, confirmationToken: string): Promise<TrashOperationCommitResult> {
    return this.enqueueCommit(() => storage.commitTrashPurge(confirmationToken))
  }

  private async commitImpactNow(request: ReferenceImpactCommit, storage: StorageService): Promise<{ path?: string }> {
    if (!request || !request.preview || !Array.isArray(request.preview.references)) {
      throw new TraceError(ERR.VALIDATION, '引用影响确认无效')
    }
    const { preview } = request
    const snapshot = await this.snapshot(request.library_id)
    const fresh = await this.previewImpact({
      library_id: request.library_id, operation: preview.operation, path: preview.path,
      component_id: preview.component_id, new_name: preview.new_name, new_title: preview.new_title,
      expected_updated_at: preview.expected_updated_at, locale: preview.locale
    })
    const signature = (value: ReferenceImpactPreview): string => JSON.stringify({
      operation: value.operation, path: value.path, component_id: value.component_id,
      new_name: value.new_name, new_title: value.new_title,
      locale: value.locale,
      target_updated_at: value.target_updated_at,
      target_plan_ids: value.target_plan_ids,
      target_snapshot_digest: value.target_snapshot_digest,
      references: value.references.map((reference) => ({
        key: impactKey(reference), source_updated_at: reference.source_updated_at,
        target_plan_id: reference.target_plan_id,
        target_component_id: reference.target_component_id,
        mode: reference.mode
      })).sort((left, right) => left.key.localeCompare(right.key))
    })
    if (signature(fresh) !== signature(preview)) {
      throw new TraceError(ERR.CONFLICT, '关联影响已变化，请重新预览确认')
    }
    const isRename = preview.operation.startsWith('rename-')
    if (isRename && fresh.references.length > 0 &&
      request.rename_action !== 'update' && request.rename_action !== 'keep') {
      throw new TraceError(ERR.CONFIRMATION_REQUIRED, '请选择是否更新关联显示')
    }
    const decisionMap = new Map<string, NonNullable<ReferenceImpactCommit['decisions']>[number]>()
    if (!isRename) {
      if (!Array.isArray(request.decisions) || request.decisions.length !== fresh.references.length) {
        throw new TraceError(ERR.CONFIRMATION_REQUIRED, '请逐条确认受影响的关联')
      }
      for (const decision of request.decisions) {
        const key = impactKey(decision)
        if (decisionMap.has(key) || !fresh.references.some((reference) => impactKey(reference) === key) ||
          (decision.action !== 'keep' && decision.action !== 'replace')) {
          throw new TraceError(ERR.VALIDATION, '关联替换选择无效')
        }
        decisionMap.set(key, decision)
      }
    }

    // Validate every source and replacement before the first write. The same source plan is edited once.
    const sourceDocs = new Map<string, PlanDocument>()
    for (const reference of fresh.references) {
      if (!sourceDocs.has(reference.source_path)) {
        const doc = await this.securePlan(snapshot, reference.source_path)
        if (doc.updated_at !== reference.source_updated_at) {
          throw new TraceError(ERR.CONFLICT, '关联来源已变化，请重新预览确认')
        }
        sourceDocs.set(reference.source_path, doc)
      }
    }
    if (preview.operation.endsWith('-component') && !sourceDocs.has(preview.path)) {
      sourceDocs.set(preview.path, await this.securePlan(snapshot, preview.path))
    }
    const replacements = new Map<string, { path: string; component_id?: string; document: PlanDocument; component?: Component }>()
    const plansBefore = await this.scanForSnapshot(snapshot)
    if (preview.operation === 'rename-plan') {
      const siblings = await this.repo.listPlanDirs(snapshot.root, parentRel(preview.path))
      const oldName = preview.path.split('/').at(-1)
      if (siblings.includes(preview.new_name as string) && preview.new_name !== oldName) {
        throw new TraceError(ERR.NAME_CONFLICT, '同名计划或文件夹已存在，请换一个名称')
      }
    }
    for (const reference of fresh.references) {
      const decision = decisionMap.get(impactKey(reference))
      if (decision?.action !== 'replace') continue
      if (!decision.replacement || typeof decision.replacement.path !== 'string') {
        throw new TraceError(ERR.VALIDATION, '替代目标无效')
      }
      const path = resolveWithin(snapshot.root, decision.replacement.path).rel
      if (!path || (preview.operation === 'delete-plan' && isSelfOrDescendant(preview.path, path)) ||
        (preview.operation === 'delete-component' && path === preview.path &&
          decision.replacement.component_id === preview.component_id)) {
        throw new TraceError(ERR.VALIDATION, '不能以待删除目标作为替代')
      }
      const document = await this.securePlan(snapshot, path)
      if (document.plan_id && this.findById(plansBefore, document.plan_id) === 'conflict') {
        throw new TraceError(ERR.CONFLICT, '替代计划标识冲突')
      }
      const componentId = decision.replacement.component_id
      if (reference.mode === 'embed' && !componentId) {
        throw new TraceError(ERR.VALIDATION, '软链接只能替换为原生组件')
      }
      const matches = componentId ? document.components.filter((component) => component.id === componentId) : []
      if (componentId && (matches.length !== 1 || !isReferenceTargetType(matches[0].type))) {
        throw new TraceError(ERR.VALIDATION, '替代组件无效')
      }
      replacements.set(impactKey(reference), { path, ...(componentId ? { component_id: componentId } : {}),
        document, ...(matches[0] ? { component: matches[0] } : {}) })
    }
    this.currentRevision(snapshot)
    if (this.switchingRoot) throw new TraceError(ERR.CONFLICT, '计划库正在切换，请重试')

    // Legacy replacement plans receive an ID only after every choice has been validated.
    const usedIds = new Set(plansBefore.map((plan) => plan.document.plan_id).filter((id): id is string => !!id))
    const assignedDocs = new Map<string, PlanDocument>()
    const assignedPaths = [...new Set([...replacements.values()].filter((item) => !item.document.plan_id).map((item) => item.path))]
    const writtenRevisions = new Map<string, string>()
    let writes = 0
    try {
      for (const path of assignedPaths) {
        const expected = [...replacements.values()].find((item) => item.path === path)!.document.updated_at
        let id = uuid32()
        while (usedIds.has(id)) id = uuid32()
        usedIds.add(id)
        const assigned = await this.repo.mutatePlanAtomic(snapshot.root, path, (current) => {
          if (current.updated_at !== expected || current.plan_id) {
            throw new TraceError(ERR.CONFLICT, '替代计划已变化，请重新预览确认')
          }
          current.plan_id = id
          return current
        })
        writes += 1
        assignedDocs.set(path, assigned)
        writtenRevisions.set(path, assigned.updated_at)
        if (sourceDocs.has(path)) sourceDocs.set(path, assigned)
        bus.emit('trace:plan-changed', { path })
        bus.emit('trace:reference-target-changed', { plan_ids: [id] })
      }

      const targetPlans = new Map(plansBefore.map((plan) => [plan.document.plan_id, plan]))
      for (const reference of fresh.references) {
        const source = sourceDocs.get(reference.source_path)!
        const component = source.components.find((entry) => entry.id === reference.source_component_id)
        if (!component || component.type !== 'plan_reference' || !isPlanReferencePayload(component.payload) ||
          component.payload.target_plan_id !== reference.target_plan_id ||
          component.payload.target_component_id !== reference.target_component_id) {
          throw new TraceError(ERR.CONFLICT, '关联来源已变化，请重新预览确认')
        }
        const payload = component.payload
        if (isRename) {
          if (request.rename_action !== 'update') continue
          if (preview.operation === 'rename-plan') {
            const target = targetPlans.get(reference.target_plan_id)
            if (!target) throw new TraceError(ERR.CONFLICT, '目标计划已变化，请重试')
            const prefix = preview.path.includes('/') ? preview.path.slice(0, preview.path.lastIndexOf('/') + 1) : ''
            const renamedPath = `${prefix}${preview.new_name}${target.path.slice(preview.path.length)}`
            payload.target_path_snapshot = renamedPath.slice(-1024)
            if (!reference.target_component_id) payload.target_name_snapshot =
              (renamedPath.split('/').at(-1) ?? renamedPath).slice(0, 200)
          } else {
            const renamedComponent = targetPlans.get(reference.target_plan_id)?.document.components.find(
              (entry) => entry.id === preview.component_id)
            if (!renamedComponent || !isReferenceTargetType(renamedComponent.type)) {
              throw new TraceError(ERR.CONFLICT, '目标组件已变化，请重试')
            }
            payload.target_name_snapshot = preview.new_title?.trim() ||
              referenceComponentTypeFallback(renamedComponent.type, preview.locale)
          }
        } else {
          const decision = decisionMap.get(impactKey(reference))!
          if (decision.action === 'keep') continue
          const replacement = replacements.get(impactKey(reference))!
          payload.target_plan_id = (assignedDocs.get(replacement.path) ?? replacement.document).plan_id as string
          if (replacement.component_id) payload.target_component_id = replacement.component_id
          else delete payload.target_component_id
          payload.target_path_snapshot = replacement.path
          payload.target_name_snapshot = replacement.component
            ? referenceComponentDisplayName(replacement.component, preview.locale) :
            replacement.path.split('/').at(-1) ?? replacement.path
        }
      }
      if (preview.operation.endsWith('-component')) {
        const target = sourceDocs.get(preview.path)!
        const matches = target.components.filter((entry) => entry.id === preview.component_id)
        if (target.updated_at !== (assignedDocs.get(preview.path)?.updated_at ?? fresh.target_updated_at) ||
          matches.length !== 1) throw new TraceError(ERR.CONFLICT, '目标组件已变化，请重试')
        if (preview.operation === 'rename-component') {
          const payload = matches[0].payload as unknown as Record<string, unknown>
          payload.title = preview.new_title ?? ''
        } else {
          target.components = target.components.filter((entry) => entry.id !== preview.component_id)
        }
      }
      const documentWrites = [...sourceDocs].sort(([left], [right]) =>
        Number(left === preview.path) - Number(right === preview.path))
      for (const [path, draft] of documentWrites) {
        if (preview.operation.endsWith('-component') && path === preview.path) continue
        if (path !== preview.path && !fresh.references.some((reference) =>
          reference.source_path === path && (isRename ? request.rename_action === 'update' :
            decisionMap.get(impactKey(reference))?.action === 'replace'))) continue
        if (path === preview.path && !preview.operation.endsWith('-component') &&
          !fresh.references.some((reference) => reference.source_path === path &&
            (isRename ? request.rename_action === 'update' : decisionMap.get(impactKey(reference))?.action === 'replace'))) continue
        const saved = await storage.savePlan(path, draft, draft.updated_at)
        writtenRevisions.set(path, saved.updated_at)
        writes += 1
      }
      // Keep a component target unwritten until this check passes. Other plans may have added
      // inbound refs while their atomic source writes were awaited above.
      const remaining = await this.previewImpact({
        library_id: request.library_id, operation: preview.operation, path: preview.path,
        component_id: preview.component_id, new_name: preview.new_name, new_title: preview.new_title,
        expected_updated_at: preview.expected_updated_at, locale: preview.locale
      })
      const expectedReferences = fresh.references.filter((reference) => isRename ||
        reference.source_path === preview.path || decisionMap.get(impactKey(reference))?.action === 'keep')
        .map((reference) => ({
          ...reference,
          source_updated_at: writtenRevisions.get(reference.source_path) ??
            sourceDocs.get(reference.source_path)?.updated_at ?? reference.source_updated_at
        }))
      const referenceSignature = (references: ReferenceImpactItem[]): string => JSON.stringify(references.map((reference) => ({
        key: impactKey(reference), target_plan_id: reference.target_plan_id,
        target_component_id: reference.target_component_id, mode: reference.mode,
        source_updated_at: reference.source_updated_at
      })).sort((left, right) => left.key.localeCompare(right.key)))
      const observedSignature = JSON.stringify(remaining.references.map((reference) => ({
        key: impactKey(reference), target_plan_id: reference.target_plan_id,
        target_component_id: reference.target_component_id, mode: reference.mode,
        source_updated_at: reference.source_updated_at
      })).sort((left, right) => left.key.localeCompare(right.key)))
      if (remaining.target_updated_at !== (writtenRevisions.get(preview.path) ??
        sourceDocs.get(preview.path)?.updated_at ?? fresh.target_updated_at) ||
        JSON.stringify(remaining.target_plan_ids) !== JSON.stringify(fresh.target_plan_ids) ||
        remaining.target_snapshot_digest !== fresh.target_snapshot_digest ||
        observedSignature !== referenceSignature(expectedReferences)) {
        throw new TraceError(ERR.CONFLICT, '关联影响已变化，请重新预览确认')
      }
      if (preview.operation === 'rename-plan') return await storage.renamePlan(
        preview.path, preview.new_name as string,
        writtenRevisions.get(preview.path) ?? sourceDocs.get(preview.path)?.updated_at ?? fresh.target_updated_at
      )
      if (preview.operation.endsWith('-component')) {
        const target = sourceDocs.get(preview.path)!
        const saved = await storage.savePlan(preview.path, target, target.updated_at)
        writtenRevisions.set(preview.path, saved.updated_at)
        writes += 1
      }
      if (preview.operation === 'delete-plan') {
        // A newly created inbound reference must not be silently orphaned during the write sequence.
        const remaining = await this.previewImpact({
          library_id: request.library_id, operation: 'delete-plan', path: preview.path
        })
        const targetUpdatedAt = writtenRevisions.get(preview.path) ?? fresh.target_updated_at
        if (remaining.target_updated_at !== targetUpdatedAt ||
          JSON.stringify(remaining.target_plan_ids) !== JSON.stringify(fresh.target_plan_ids) ||
          remaining.target_snapshot_digest !== fresh.target_snapshot_digest) {
          throw new TraceError(ERR.CONFLICT, '待删除计划已变化，请重新预览确认')
        }
        const allowed = new Set(fresh.references.filter((reference) =>
          decisionMap.get(impactKey(reference))?.action === 'keep').map(impactKey))
        if (remaining.references.some((reference) => !allowed.has(impactKey(reference)))) {
          throw new TraceError(ERR.CONFLICT, '关联影响已变化，请重新预览确认')
        }
        const directory = await storage.captureMoveDirectorySnapshot(preview.path, parentRel(preview.path))
        await storage.trashPlan(preview.path, targetUpdatedAt, directory.source_directory_identity)
      }
      return {}
    } catch (error) {
      if (writes > 0) throw new TraceError(ERR.SAVE_FAILED, '部分关联更新已完成，目标仍保留；请刷新后重试')
      throw error
    }
  }
}

function basenameRel(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function isReferenceReservedPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  return normalized === '.trace' || normalized.startsWith('.trace/') ||
    normalized === 'Diary' || normalized.startsWith('Diary/')
}

async function readDirectoryIdentityKey(path: string): Promise<string> {
  const stat = await fs.lstat(path, { bigint: true })
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new TraceError(ERR.PATH_UNSAFE, '计划目录身份无效')
  }
  return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`
}
