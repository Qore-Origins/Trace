import { promises as fs, type Dirent } from 'node:fs'
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
  private reverseCache: { generation: number; items: PlanReferenceInbound[] } | null = null
  private changeRevision = 0
  private commitQueue: Promise<void> = Promise.resolve()
  private readonly unsubscribe: Array<() => void>

  constructor(private repo: PlanRepository, private getRoot: () => string | null) {
    this.unsubscribe = [
      bus.on('trace:plan-changed', () => { this.changeRevision += 1; this.reverseCache = null }),
      bus.on('trace:fs-external-change', () => { this.changeRevision += 1; this.reverseCache = null })
    ]
  }

  activateRoot(root: string): void {
    this.activeRoot = root
    this.generation += 1
    this.changeRevision += 1
    this.reverseCache = null
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

  private async snapshot(libraryId: unknown): Promise<LibrarySnapshot> {
    if (typeof libraryId !== 'string' || !isUuid32(libraryId)) {
      throw new TraceError(ERR.VALIDATION, '计划库标识无效')
    }
    const root = this.getRoot()
    if (!root || root !== this.activeRoot) throw new TraceError(ERR.CONFLICT, '计划库已切换，请重试')
    const snapshot = { root, libraryId, generation: this.generation }
    const metaFile = resolveWithin(root, '.trace/plan-library.json').abs
    await assertRealPathWithinRoot(root, metaFile)
    this.current(snapshot)
    const meta = await this.repo.readLibraryMeta(root)
    this.current(snapshot)
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
      this.current(snapshot)
      const directory = resolveWithin(snapshot.root, parent).abs
      await assertRealPathWithinRoot(snapshot.root, directory)
      this.current(snapshot)
      let entries: Dirent[]
      try {
        entries = await fs.readdir(directory, { withFileTypes: true })
      } catch (error) {
        if (parent) continue
        throw error
      }
      this.current(snapshot)
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.')) continue
        const path = parent ? `${parent}/${entry.name}` : entry.name
        const child = resolveWithin(snapshot.root, path).abs
        try {
          await assertRealPathWithinRoot(snapshot.root, child)
          this.current(snapshot)
          // A safe folder is traversed even if its own plan file is absent or malformed.
          pending.push(path)
          const planFile = resolveWithin(snapshot.root, `${path}/plan.json`).abs
          await assertRealPathWithinRoot(snapshot.root, planFile)
          this.current(snapshot)
          const document = await this.repo.readPlan(snapshot.root, path)
          this.current(snapshot)
          found.push({ path, document })
        } catch (error) {
          this.current(snapshot)
          // An unreadable or damaged child does not make its healthy siblings disappear.
          if (error instanceof TraceError && error.code === ERR.CONFLICT) throw error
        }
      }
    }
    return found
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
    for (const plan of await this.scan(snapshot)) {
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
    this.current(snapshot)
    return { targets }
  }

  async resolve(request: { library_id: string; plan_id: string; component_id?: string }): Promise<PlanReferenceResolution> {
    const snapshot = await this.snapshot(request?.library_id)
    if (!isUuid32(request.plan_id) || (request.component_id !== undefined && !isUuid32(request.component_id))) {
      throw new TraceError(ERR.VALIDATION, '引用目标标识无效')
    }
    const plan = this.findById(await this.scan(snapshot), request.plan_id)
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
    const expectedGeneration = this.generation
    const operation = this.commitQueue.then(() => {
      if (this.generation !== expectedGeneration) throw new TraceError(ERR.CONFLICT, '计划库已切换，请重试')
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
    const plans = await this.scan(snapshot)
    if (document.plan_id && this.findById(plans, document.plan_id) === 'conflict') {
      throw new TraceError(ERR.CONFLICT, '计划标识冲突，请先处理重复项')
    }
    // Re-read immediately before writing so unrelated edits are preserved.
    const latest = await this.securePlan(snapshot, path)
    if (latest.updated_at !== document.updated_at || latest.plan_id !== document.plan_id) {
      throw new TraceError(ERR.CONFLICT, '目标计划已变化，请重试')
    }
    const latestComponents = request.component_id
      ? latest.components.filter((entry) => entry.id === request.component_id && isReferenceTargetType(entry.type))
      : []
    if (request.component_id && latestComponents.length !== 1) {
      throw new TraceError(ERR.CONFLICT, '目标组件已变化，请重试')
    }
    if (!latest.plan_id) {
      const used = new Set(plans.map((plan) => plan.document.plan_id).filter((id): id is string => !!id))
      let id = uuid32()
      while (used.has(id)) id = uuid32()
      latest.plan_id = id
      this.current(snapshot)
      await this.repo.writePlanAtomic(snapshot.root, path, latest)
      this.current(snapshot)
      bus.emit('trace:plan-changed', { path })
    }
    return targetOf({ path, document: latest }, latestComponents[0])
  }

  async inbound(request: { library_id: string; plan_id: string; component_id?: string }): Promise<{ references: PlanReferenceInbound[] }> {
    const snapshot = await this.snapshot(request?.library_id)
    if (!isUuid32(request.plan_id) || (request.component_id !== undefined && !isUuid32(request.component_id))) {
      throw new TraceError(ERR.VALIDATION, '引用目标标识无效')
    }
    if (!this.reverseCache || this.reverseCache.generation !== snapshot.generation) {
      const revision = this.changeRevision
      const items: PlanReferenceInbound[] = []
      for (const plan of await this.scan(snapshot)) {
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
      this.current(snapshot)
      if (revision !== this.changeRevision) throw new TraceError(ERR.CONFLICT, '计划内容已变化，请重试')
      this.reverseCache = { generation: snapshot.generation, items }
    }
    return { references: this.reverseCache.items.filter((reference) =>
      reference.target_plan_id === request.plan_id &&
      (request.component_id === undefined || reference.target_component_id === request.component_id)) }
  }
}
