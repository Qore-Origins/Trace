import { ERR, TraceError } from '../../shared/errors'
import type { Component, PlanDocument } from '../../shared/plan-types'
import type {
  PlanReferenceCandidate, PlanReferenceInbound, PlanReferenceResolution
} from '../../shared/ipc-contract'
import type { PlanReferenceMode, PlanReferenceTarget } from '../../shared/plan-reference-types'
import { isPlanReferencePayload, isReferenceTargetType } from '../../shared/plan-reference-validation'
import { isUuid32, uuid32 } from '../../shared/validation'
import { bus } from './event-bus'
import { assertRealPathWithinRoot, resolveWithin } from './path-safety'
import { PlanRepository } from './plan-repository'

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

function componentName(component: Component): string {
  const payload = component.payload && typeof component.payload === 'object'
    ? component.payload as unknown as Record<string, unknown> : {}
  for (const key of ['title', 'content', 'text']) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim()) return value.split(/\r?\n/, 1)[0].slice(0, 200)
  }
  return component.type
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
    if (this.switchingRoot) throw new TraceError(ERR.CONFLICT, '计划库正在切换，请重试')
    const expectedGeneration = this.generation
    const operation = this.commitQueue.then(() => {
      if (this.generation !== expectedGeneration || this.switchingRoot) {
        throw new TraceError(ERR.CONFLICT, '计划库已切换，请重试')
      }
      return this.commitTargetNow(request)
    })
    this.commitQueue = operation.then(() => undefined, () => undefined)
    return operation
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
    const plans = await this.scanForSnapshot(snapshot)
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
}
