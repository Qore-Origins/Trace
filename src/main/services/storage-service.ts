// StorageService：计划树业务逻辑（LLD §2.1）
// 职责：校验（名称/路径/confirm/CAS）→ 编排 Repository + TreeCache → 事件通知
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { PlanDocument, Component, TaskItem } from '../../shared/plan-types'
import { ERR, TraceError } from '../../shared/errors'
import { isUuid32, validatePlanName, validateTitle, validateNoteText, uuid32 } from '../../shared/validation'
import { applyStatusChange } from '../../shared/task-state'
import type { PlanTreeNode } from '../../shared/ipc-contract'
import type {
  TrashEntry, TrashEntryTargetGrant, TrashOperationCommitResult, TrashOperationPreview,
  TrashReferenceImpactSummary, TrashRestoreDestination
} from '../../shared/trash-types'
import { PlanRepository } from './plan-repository'
import { TreeCache } from './tree-cache'
import { assertRealPathWithinRoot, resolveWithin, isSelfOrDescendant, parentRel } from './path-safety'
import { bus } from './event-bus'
import { TrashService, type TrashChange, type TrashLibraryContext } from './trash-service'

export class StorageService {
  private rootAbs: string | null = null
  private rootGeneration = 0
  readonly treeCache = new TreeCache()
  private readonly trash: TrashService

  constructor(private repo: PlanRepository) {
    this.trash = new TrashService(repo)
  }

  // 根目录生效后由 AppService 调用
  setRoot(rootAbs: string): void {
    this.rootAbs = rootAbs
    this.rootGeneration += 1
    this.trash.invalidateGrants()
    this.treeCache.clear()
  }

  setTrashReferenceImpactReader(reader: (libraryId: string, planIds: string[]) => Promise<TrashReferenceImpactSummary>): void {
    this.trash.setReferenceImpactReader(reader)
  }

  private root(): string {
    if (!this.rootAbs) throw new TraceError(ERR.INTERNAL, '计划库根目录未初始化')
    return this.rootAbs
  }

  // 根目录读取（未初始化返回 null；供 TransferService 等旁路服务使用）
  getRootAbs(): string | null {
    return this.rootAbs
  }

  private safe(rel: string): string {
    return resolveWithin(this.root(), rel).rel
  }

  private emitReferenceTargetChanges(ids: unknown[]): void {
    const plan_ids = [...new Set(ids.filter((id): id is string =>
      typeof id === 'string' && isUuid32(id)))].sort()
    if (plan_ids.length > 0) bus.emit('trace:reference-target-changed', { plan_ids })
  }

  private async collectSubtreePlanIds(root: string, rel: string): Promise<string[]> {
    const ids = new Set<string>()
    const pending = [rel]
    while (pending.length > 0) {
      const current = pending.pop() as string
      const directory = resolveWithin(root, current).abs
      try {
        await assertRealPathWithinRoot(root, directory)
      } catch (error) {
        if (current === rel) throw error
        continue
      }

      if (current) {
        const planFile = resolveWithin(root, `${current}/plan.json`).abs
        try {
          await assertRealPathWithinRoot(root, planFile)
          const document = await this.repo.readPlan(root, current)
          if (document.plan_id && isUuid32(document.plan_id)) ids.add(document.plan_id)
        } catch {
          // A malformed or unreadable plan does not hide valid descendants or siblings.
        }
      }

      let children: string[]
      try {
        children = await this.repo.listPlanDirs(root, current)
      } catch (error) {
        if (current === rel) throw error
        continue
      }
      for (const name of children) {
        const childRel = current ? `${current}/${name}` : name
        try {
          await assertRealPathWithinRoot(root, resolveWithin(root, childRel).abs)
          pending.push(childRel)
        } catch {
          // Skip links or children that are no longer safely inside this library.
        }
      }
    }
    return [...ids].sort()
  }

  // ---------- 树 ----------

  async treeGetChildren(parentPathRel: string): Promise<PlanTreeNode[]> {
    const parent = this.safe(parentPathRel)
    const root = this.root()

    let names = this.treeCache.get(parent)
    if (!names) {
      names = await this.repo.listPlanDirs(root, parent)
      this.treeCache.set(parent, names)
    }

    // 2026-09-08 排序定稿：全部按文件名排序（zh-CN），children_order 载体退役（历史字段读取时忽略）
    // ignorePunctuation：忽略 -/_ 等标点差异后按字母数字比较——zh-CN collation 会把 _ 组排到 - 组前，
    // 混用分隔符的日期命名（Daily_Plan_20260910 / Daily_Plan-20260825）不再按日期直觉序（2026-09-12 用户反馈）
    const sorted = [...names].sort((a, b) => a.localeCompare(b, 'zh-CN', { ignorePunctuation: true }))

    const nodes: Awaited<ReturnType<StorageService['treeGetChildren']>> = []
    for (const [i, name] of sorted.entries()) {
      const path = parent === '' ? name : `${parent}/${name}`
      // kind：含 plan.json=计划；否则纯容器文件夹；has_children=子目录真值（箭头数据驱动）
      const kind = (await this.repo.hasPlanFile(root, path)) ? ('plan' as const) : ('folder' as const)
      nodes.push({
        path,
        name,
        has_children: await this.repo.hasChildDirs(root, path),
        order: i,
        kind
      })
    }
    return nodes
  }

  // 新建纯容器文件夹（无 plan.json）：仅 mkdir，计划可拖入
  async createFolder(parentPathRel: string, name: string): Promise<PlanTreeNode> {
    validatePlanName(name)
    const parent = this.safe(parentPathRel)
    const root = this.root()
    const siblings = await this.repo.listPlanDirs(root, parent)
    if (siblings.includes(name)) throw new TraceError(ERR.NAME_CONFLICT, '同名计划或文件夹已存在，请换一个名称')
    try {
      await this.repo.mkdirPlan(root, parent, name)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new TraceError(ERR.NAME_CONFLICT, '同名计划或文件夹已存在，请换一个名称')
      }
      throw e
    }
    this.treeCache.invalidatePrefix(parent)
    const path = parent === '' ? name : `${parent}/${name}`
    bus.emit('trace:plan-changed', { path })
    return { path, name, has_children: false, order: Number.MAX_SAFE_INTEGER, kind: 'folder' }
  }

  // ---------- 计划 CRUD ----------

  async createPlan(parentPathRel: string, name: string): Promise<PlanTreeNode> {
    validatePlanName(name)
    const parent = this.safe(parentPathRel)
    const root = this.root()

    const siblings = await this.repo.listPlanDirs(root, parent)
    if (siblings.includes(name)) throw new TraceError(ERR.NAME_CONFLICT, '同名计划或文件夹已存在，请换一个名称')

    let dirAbs: string
    try {
      dirAbs = await this.repo.mkdirPlan(root, parent, name)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new TraceError(ERR.NAME_CONFLICT, '同名计划或文件夹已存在，请换一个名称')
      }
      throw e
    }
    const createdDirIdentity = await getDirectoryIdentity(dirAbs)

    const now = new Date().toISOString()
    const doc: PlanDocument = { format_version: '1', created_at: now, updated_at: now, components: [] }
    try {
      await this.repo.writePlanAtomic(root, parent === '' ? name : `${parent}/${name}`, doc)
    } catch (writeError) {
      try {
        const currentDirIdentity = await getDirectoryIdentity(dirAbs)
        if (createdDirIdentity && sameDirectoryIdentity(createdDirIdentity, currentDirIdentity)) {
          this.repo.markInternalWrite(dirAbs)
          await fs.rmdir(dirAbs)
        }
      } catch {
        // Leave changed/non-empty directories alone; cleanup must not replace the write error.
      }
      throw writeError
    }

    this.treeCache.invalidatePrefix(parent)
    const path = parent === '' ? name : `${parent}/${name}`
    bus.emit('trace:plan-changed', { path })
    return { path, name, has_children: false, order: Number.MAX_SAFE_INTEGER, kind: 'plan' }
  }

  async renamePlan(pathRel: string, newName: string, expectedUpdatedAt?: string): Promise<{ path: string }> {
    validatePlanName(newName)
    const rel = this.safe(pathRel)
    if (rel === '') throw new TraceError(ERR.VALIDATION, '根目录不可重命名')
    const root = this.root()
    const parent = parentRel(rel)
    const oldName = rel.slice(rel.lastIndexOf('/') + 1)
    if (expectedUpdatedAt !== undefined) await this.assertPlanRevision(root, rel, expectedUpdatedAt)

    const siblings = await this.repo.listPlanDirs(root, parent)
    if (siblings.includes(newName) && newName !== oldName) {
      throw new TraceError(ERR.NAME_CONFLICT, '同名计划或文件夹已存在，请换一个名称')
    }

    const affectedPlanIds = await this.collectSubtreePlanIds(root, rel)
    await this.repo.renamePlanDir(root, rel, newName)

    this.treeCache.invalidatePrefix(rel)
    const newPath = parent === '' ? newName : `${parent}/${newName}`
    bus.emit('trace:plan-changed', { path: newPath })
    this.emitReferenceTargetChanges(affectedPlanIds)
    return { path: newPath }
  }

  async deletePlan(pathRel: string, confirmed: boolean, expectedUpdatedAt?: string): Promise<void> {
    if (confirmed !== true) throw new TraceError(ERR.CONFIRMATION_REQUIRED, '危险操作需确认后执行')
    await this.trashPlan(pathRel, expectedUpdatedAt)
  }

  async listTrashEntries(): Promise<TrashEntry[]> {
    const context = await this.trashContext()
    const result = await this.trash.list(context)
    this.applyTrashChanges(result.changes)
    return result.entries
  }

  async trashPlan(pathRel: string, expectedUpdatedAt?: string, expectedDirectoryIdentity?: string): Promise<TrashEntry> {
    const context = await this.trashContext()
    const result = await this.trash.trashPlan(context, pathRel, expectedUpdatedAt, expectedDirectoryIdentity)
    if (result.changed) this.applyTrashChanges([{
      path: result.entry.original_relative_path,
      plan_ids: result.changed_plan_ids
    }])
    return result.entry
  }

  async issueTrashEntryTarget(entryId: string): Promise<TrashEntryTargetGrant> {
    return this.trash.issueEntryTarget(await this.trashContext(), entryId)
  }

  async previewTrashRestore(
    entryId: string,
    destination?: TrashRestoreDestination,
    entryTargetToken?: string
  ): Promise<TrashOperationPreview> {
    return this.trash.previewRestore(await this.trashContext(), entryId, destination, entryTargetToken)
  }

  async commitTrashRestore(confirmationToken: string): Promise<TrashOperationCommitResult> {
    const result = await this.trash.commitRestore(await this.trashContext(), confirmationToken)
    if (result.path) this.applyTrashChanges([{ path: result.path, plan_ids: result.changed_plan_ids }])
    return result
  }

  async previewTrashPurge(entryId: string, entryTargetToken?: string): Promise<TrashOperationPreview> {
    return this.trash.previewPurge(await this.trashContext(), entryId, entryTargetToken)
  }

  async commitTrashPurge(confirmationToken: string): Promise<TrashOperationCommitResult> {
    return this.trash.commitPurge(await this.trashContext(), confirmationToken)
  }

  async movePlan(pathRel: string, targetParentRel: string): Promise<void> {
    const rel = this.safe(pathRel)
    const targetParent = this.safe(targetParentRel)
    if (rel === '') throw new TraceError(ERR.VALIDATION, '根目录不可移动')
    if (isSelfOrDescendant(rel, targetParent)) {
      throw new TraceError(ERR.CIRCULAR_NESTING, '不能移动到自身或子计划中')
    }
    const root = this.root()
    const name = rel.slice(rel.lastIndexOf('/') + 1)
    const oldParent = parentRel(rel)

    if (targetParent !== oldParent) {
      const siblings = await this.repo.listPlanDirs(root, targetParent)
      if (siblings.includes(name)) throw new TraceError(ERR.NAME_CONFLICT, '同名计划或文件夹已存在，请换一个名称')
    }

    const affectedPlanIds = await this.collectSubtreePlanIds(root, rel)
    const fromAbs = targetJoin(root, rel)
    const toAbs = targetJoin(root, targetParent === '' ? name : `${targetParent}/${name}`)
    await this.repo.moveDir(fromAbs, toAbs)

    this.treeCache.invalidatePrefix(rel)
    this.treeCache.invalidatePrefix(targetParent)
    bus.emit('trace:plan-changed', { path: targetParent === '' ? name : `${targetParent}/${name}` })
    this.emitReferenceTargetChanges(affectedPlanIds)
  }

  // ---------- 计划读写（CAS） ----------

  async readPlan(pathRel: string): Promise<PlanDocument> {
    return this.repo.readPlan(this.root(), this.safe(pathRel))
  }

  private async assertPlanRevision(root: string, rel: string, expectedUpdatedAt: string): Promise<void> {
    const file = resolveWithin(root, `${rel}/plan.json`).abs
    await assertRealPathWithinRoot(root, file)
    const current = await this.repo.readPlan(root, rel)
    if (current.updated_at !== expectedUpdatedAt) {
      throw new TraceError(ERR.CONFLICT, '目标计划已变化，请重新预览确认')
    }
  }

  private async trashContext(): Promise<TrashLibraryContext> {
    const root = this.root()
    const rootGeneration = this.rootGeneration
    for (const relativePath of ['.trace', '.trace/plan-library.json']) {
      const absolutePath = resolveWithin(root, relativePath).abs
      const stat = await fs.lstat(absolutePath)
      if (stat.isSymbolicLink()) throw new TraceError(ERR.PATH_UNSAFE, '计划库元数据路径不安全')
      await assertRealPathWithinRoot(root, absolutePath)
    }
    const library = await this.repo.readLibraryMeta(root)
    if (this.rootAbs !== root || this.rootGeneration !== rootGeneration) {
      throw new TraceError(ERR.CONFLICT, '计划库已切换，请重试')
    }
    return { root, library_id: library.library_id, root_generation: rootGeneration }
  }

  private applyTrashChanges(changes: TrashChange[]): void {
    for (const change of changes) {
      this.treeCache.invalidatePrefix(change.path)
      bus.emit('trace:plan-changed', { path: change.path })
      this.emitReferenceTargetChanges(change.plan_ids)
    }
  }

  async savePlan(pathRel: string, document: PlanDocument, expectedUpdatedAt: string): Promise<{ updated_at: string }> {
    const rel = this.safe(pathRel)
    if (rel === '') throw new TraceError(ERR.VALIDATION, '根目录无内容可保存')
    const root = this.root()
    let previousPlanId: unknown
    const saved = await this.repo.mutatePlanAtomic(root, rel, (current) => {
      if (current.updated_at !== expectedUpdatedAt) {
        throw new TraceError(ERR.CONFLICT, '数据已被修改（外部或并发），请刷新后重试')
      }
      previousPlanId = current.plan_id
      return document
    })
    bus.emit('trace:plan-changed', { path: rel })
    this.emitReferenceTargetChanges([previousPlanId, saved.plan_id])
    bus.emit('trace:save-status', { path: rel, saved: true, at: new Date().toISOString() })
    return { updated_at: saved.updated_at }
  }

  // ---------- 组件与任务 ----------

  async appendComponent(pathRel: string, component: Component): Promise<void> {
    if (!component.id) component.id = uuid32()
    await this.commitMutation(pathRel, (doc) => { doc.components.push(component) })
  }

  async removeComponent(pathRel: string, componentId: string): Promise<void> {
    await this.commitMutation(pathRel, (doc) => {
      const idx = doc.components.findIndex((c) => c.id === componentId)
      if (idx === -1) throw new TraceError(ERR.PATH_NOT_FOUND, '组件不存在')
      doc.components.splice(idx, 1)
    })
  }

  async moveComponent(pathRel: string, componentId: string, targetIndex: number): Promise<void> {
    await this.commitMutation(pathRel, (doc) => {
      const idx = doc.components.findIndex((c) => c.id === componentId)
      if (idx === -1) throw new TraceError(ERR.PATH_NOT_FOUND, '组件不存在')
      const [moved] = doc.components.splice(idx, 1)
      const clamped = Math.max(0, Math.min(targetIndex, doc.components.length))
      doc.components.splice(clamped, 0, moved)
    })
  }

  async updateTask(
    pathRel: string,
    componentId: string,
    taskId: string,
    patch: { status?: TaskItem['status']; title?: string; planned_at?: string; note?: string }
  ): Promise<void> {
    if (patch.title !== undefined) validateTitle(patch.title, '任务标题')
    if (patch.note !== undefined) validateNoteText(patch.note, '任务备注')
    await this.commitMutation(pathRel, (doc) => {
      const comp = doc.components.find((c) => c.id === componentId)
      if (!comp) throw new TraceError(ERR.PATH_NOT_FOUND, '组件不存在')

      const task = findTask(comp, taskId)
      if (!task) throw new TraceError(ERR.PATH_NOT_FOUND, '任务不存在')

      if (patch.status !== undefined && patch.status !== task.status) {
        applyStatusChange(task, patch.status) // 状态机内含 completed_at 维护
      }
      if (patch.title !== undefined) task.title = patch.title
      if (patch.planned_at !== undefined) task.planned_at = patch.planned_at
      if (patch.note !== undefined) task.note = patch.note
    })
  }

  // ---------- 内部：读-改-写三明治 ----------

  private async commitMutation(pathRel: string, mutate: (doc: PlanDocument) => void): Promise<void> {
    const rel = this.safe(pathRel)
    let previousPlanId: unknown
    let resultingPlanId: unknown
    await this.repo.mutatePlanAtomic(this.root(), rel, (doc) => {
      previousPlanId = doc.plan_id
      mutate(doc)
      resultingPlanId = doc.plan_id
      return doc
    })
    bus.emit('trace:plan-changed', { path: rel })
    this.emitReferenceTargetChanges([previousPlanId, resultingPlanId])
  }
}

// ---------- 模块级辅助 ----------

function targetJoin(rootAbs: string, rel: string): string {
  return rel === '' ? rootAbs : join(rootAbs, rel)
}

interface DirectoryIdentity {
  dev: bigint
  ino: bigint
  birthtimeNs: bigint
}

async function getDirectoryIdentity(path: string): Promise<DirectoryIdentity | null> {
  try {
    const stat = await fs.lstat(path, { bigint: true })
    if (!stat.isDirectory()) return null
    return { dev: stat.dev, ino: stat.ino, birthtimeNs: stat.birthtimeNs }
  } catch {
    return null
  }
}

function sameDirectoryIdentity(left: DirectoryIdentity, right: DirectoryIdentity | null): boolean {
  return right !== null && left.dev === right.dev && left.ino === right.ino && left.birthtimeNs === right.birthtimeNs
}

// 任务定位：task_list 内按 TaskItem.id；task_detail 组件本身即单任务，taskId=组件 id
// （payload 与 type 的判别关联未在类型层建模，此处显式收窄）
function findTask(component: Component, taskId: string): TaskItem | null {
  if (component.type === 'task_list') {
    return (component.payload as { items: TaskItem[] }).items.find((t) => t.id === taskId) ?? null
  }
  if (component.type === 'task_detail' && taskId === component.id) {
    return component.payload as unknown as TaskItem
  }
  return null
}
