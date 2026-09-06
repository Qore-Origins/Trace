// StorageService：计划树业务逻辑（LLD §2.1）
// 职责：校验（名称/路径/confirm/CAS）→ 编排 Repository + TreeCache → 事件通知
import { join } from 'node:path'
import type { PlanDocument, PlanLibraryMeta, Component, TaskItem } from '../../shared/plan-types'
import { ERR, TraceError } from '../../shared/errors'
import { validatePlanName, validateTitle, validateNoteText, uuid32 } from '../../shared/validation'
import { applyStatusChange } from '../../shared/task-state'
import type { PlanTreeNode } from '../../shared/ipc-contract'
import { PlanRepository } from './plan-repository'
import { TreeCache } from './tree-cache'
import { resolveWithin, isSelfOrDescendant, parentRel } from './path-safety'
import { bus } from './event-bus'

export class StorageService {
  private rootAbs: string | null = null
  readonly treeCache = new TreeCache()

  constructor(private repo: PlanRepository) {}

  // 根目录生效后由 AppService 调用
  setRoot(rootAbs: string): void {
    this.rootAbs = rootAbs
    this.treeCache.clear()
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

  // ---------- 树 ----------

  async treeGetChildren(parentPathRel: string): Promise<PlanTreeNode[]> {
    const parent = this.safe(parentPathRel)
    const root = this.root()

    // 顶层顺序存库元数据；计划层存父 plan.json children_order；容器文件夹无载体 → 按名排序
    let ordered: string[] | undefined
    if (parent === '') {
      ordered = (await this.repo.readLibraryMeta(root)).children_order
    } else if (await this.repo.hasPlanFile(root, parent)) {
      ordered = (await this.repo.readPlan(root, parent)).children_order
    }

    let names = this.treeCache.get(parent)
    if (!names) {
      names = await this.repo.listPlanDirs(root, parent)
      this.treeCache.set(parent, names)
    }

    const rank = (name: string): number => {
      const idx = ordered?.indexOf(name) ?? -1
      return idx === -1 ? Number.MAX_SAFE_INTEGER : idx
    }
    const sorted = [...names].sort((a, b) => {
      const ra = rank(a)
      const rb = rank(b)
      if (ra !== rb) return ra - rb
      return a.localeCompare(b, 'zh-CN')
    })

    const nodes: Awaited<ReturnType<StorageService['treeGetChildren']>> = []
    for (const name of sorted) {
      const path = parent === '' ? name : `${parent}/${name}`
      // kind：含 plan.json=计划；否则纯容器文件夹；has_children=子目录真值（箭头数据驱动）
      const kind = (await this.repo.hasPlanFile(root, path)) ? ('plan' as const) : ('folder' as const)
      nodes.push({
        path,
        name,
        has_children: await this.repo.hasChildDirs(root, path),
        order: rank(name) === Number.MAX_SAFE_INTEGER ? nodes.length : rank(name),
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
    if (siblings.includes(name)) throw new TraceError(ERR.NAME_CONFLICT, '同名文件夹已存在，请换一个名称')
    try {
      await this.repo.mkdirPlan(root, parent, name)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new TraceError(ERR.NAME_CONFLICT, '同名文件夹已存在，请换一个名称')
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
    if (siblings.includes(name)) throw new TraceError(ERR.NAME_CONFLICT, '同名文件夹已存在，请换一个名称')

    let dirAbs: string
    try {
      dirAbs = await this.repo.mkdirPlan(root, parent, name)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new TraceError(ERR.NAME_CONFLICT, '同名文件夹已存在，请换一个名称')
      }
      throw e
    }

    const now = new Date().toISOString()
    const doc: PlanDocument = { format_version: '1', created_at: now, updated_at: now, components: [] }
    await this.repo.writePlanAtomic(root, parent === '' ? name : `${parent}/${name}`, doc)

    this.treeCache.invalidatePrefix(parent)
    const path = parent === '' ? name : `${parent}/${name}`
    bus.emit('trace:plan-changed', { path })
    return { path, name, has_children: false, order: Number.MAX_SAFE_INTEGER, kind: 'plan' }
  }

  async renamePlan(pathRel: string, newName: string): Promise<{ path: string }> {
    validatePlanName(newName)
    const rel = this.safe(pathRel)
    if (rel === '') throw new TraceError(ERR.VALIDATION, '根目录不可重命名')
    const root = this.root()
    const parent = parentRel(rel)
    const oldName = rel.slice(rel.lastIndexOf('/') + 1)

    const siblings = await this.repo.listPlanDirs(root, parent)
    if (siblings.includes(newName) && newName !== oldName) {
      throw new TraceError(ERR.NAME_CONFLICT, '同名文件夹已存在，请换一个名称')
    }

    await this.repo.renamePlanDir(root, rel, newName)
    await this.updateOrderAfterRename(parent, oldName, newName)

    this.treeCache.invalidatePrefix(rel)
    const newPath = parent === '' ? newName : `${parent}/${newName}`
    bus.emit('trace:plan-changed', { path: newPath })
    return { path: newPath }
  }

  async deletePlan(pathRel: string, confirmed: boolean): Promise<void> {
    if (confirmed !== true) throw new TraceError(ERR.CONFIRMATION_REQUIRED, '危险操作需确认后执行')
    const rel = this.safe(pathRel)
    if (rel === '') throw new TraceError(ERR.VALIDATION, '根目录不可删除')
    const root = this.root()
    if (!(await this.repo.existsDir(root, rel))) {
      throw new TraceError(ERR.PATH_NOT_FOUND, '目标位置不存在（可能已被移动或删除）')
    }
    await this.repo.rmRecursive(root, rel)
    await this.removeOrderEntry(parentRel(rel), rel.slice(rel.lastIndexOf('/') + 1))
    this.treeCache.invalidatePrefix(rel)
  }

  async movePlan(pathRel: string, targetParentRel: string, orderIndex: number): Promise<void> {
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
      if (siblings.includes(name)) throw new TraceError(ERR.NAME_CONFLICT, '同名文件夹已存在，请换一个名称')
    }

    const fromAbs = targetJoin(root, rel)
    const toAbs = targetJoin(root, targetParent === '' ? name : `${targetParent}/${name}`)
    await this.repo.moveDir(fromAbs, toAbs)

    await this.removeOrderEntry(oldParent, name)
    await this.insertOrderEntry(targetParent, name, orderIndex)

    this.treeCache.invalidatePrefix(rel)
    this.treeCache.invalidatePrefix(targetParent)
    bus.emit('trace:plan-changed', { path: targetParent === '' ? name : `${targetParent}/${name}` })
  }

  async resortChildren(parentPathRel: string, orderedNames: string[]): Promise<void> {
    const parent = this.safe(parentPathRel)
    const root = this.root()
    if (parent === '') {
      const meta = await this.repo.readLibraryMeta(root)
      meta.children_order = orderedNames
      await this.repo.writeLibraryMeta(root, meta)
    } else {
      const doc = await this.repo.readPlan(root, parent)
      doc.children_order = orderedNames
      await this.repo.writePlanAtomic(root, parent, doc)
    }
    this.treeCache.invalidatePrefix(parent)
  }

  // ---------- 计划读写（CAS） ----------

  async readPlan(pathRel: string): Promise<PlanDocument> {
    return this.repo.readPlan(this.root(), this.safe(pathRel))
  }

  async savePlan(pathRel: string, document: PlanDocument, expectedUpdatedAt: string): Promise<{ updated_at: string }> {
    const rel = this.safe(pathRel)
    if (rel === '') throw new TraceError(ERR.VALIDATION, '根目录无内容可保存')
    const root = this.root()
    const current = await this.repo.readPlan(root, rel)
    if (current.updated_at !== expectedUpdatedAt) {
      throw new TraceError(ERR.CONFLICT, '数据已被修改（外部或并发），请刷新后重试')
    }
    await this.repo.writePlanAtomic(root, rel, document)
    bus.emit('trace:plan-changed', { path: rel })
    bus.emit('trace:save-status', { path: rel, saved: true, at: new Date().toISOString() })
    const fresh = await this.repo.readPlan(root, rel)
    return { updated_at: fresh.updated_at }
  }

  // ---------- 组件与任务 ----------

  async appendComponent(pathRel: string, component: Component): Promise<void> {
    if (!component.id) component.id = uuid32()
    const doc = await this.mutatePlan(pathRel)
    doc.components.push(component)
    await this.commitMutation(pathRel, doc)
  }

  async removeComponent(pathRel: string, componentId: string): Promise<void> {
    const doc = await this.mutatePlan(pathRel)
    const idx = doc.components.findIndex((c) => c.id === componentId)
    if (idx === -1) throw new TraceError(ERR.PATH_NOT_FOUND, '组件不存在')
    doc.components.splice(idx, 1)
    await this.commitMutation(pathRel, doc)
  }

  async moveComponent(pathRel: string, componentId: string, targetIndex: number): Promise<void> {
    const doc = await this.mutatePlan(pathRel)
    const idx = doc.components.findIndex((c) => c.id === componentId)
    if (idx === -1) throw new TraceError(ERR.PATH_NOT_FOUND, '组件不存在')
    const [moved] = doc.components.splice(idx, 1)
    const clamped = Math.max(0, Math.min(targetIndex, doc.components.length))
    doc.components.splice(clamped, 0, moved)
    await this.commitMutation(pathRel, doc)
  }

  async updateTask(
    pathRel: string,
    componentId: string,
    taskId: string,
    patch: { status?: TaskItem['status']; title?: string; planned_at?: string; note?: string }
  ): Promise<void> {
    if (patch.title !== undefined) validateTitle(patch.title, '任务标题')
    if (patch.note !== undefined) validateNoteText(patch.note, '任务备注')
    const doc = await this.mutatePlan(pathRel)
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
    await this.commitMutation(pathRel, doc)
  }

  // ---------- 内部：读-改-写三明治 ----------

  // 读出文档供修改（mutate 后必须 commitMutation）
  private async mutatePlan(pathRel: string): Promise<PlanDocument> {
    return this.repo.readPlan(this.root(), this.safe(pathRel))
  }

  private async commitMutation(pathRel: string, doc: PlanDocument): Promise<void> {
    const rel = this.safe(pathRel)
    await this.repo.writePlanAtomic(this.root(), rel, doc)
    bus.emit('trace:plan-changed', { path: rel })
  }

  // ---------- 内部：children_order 维护 ----------
  // 注意：父级为纯容器文件夹（无 plan.json）时无 order 载体 → 子项按名称排序，维护操作跳过

  private async parentIsFolder(parent: string): Promise<boolean> {
    if (parent === '') return false
    return !(await this.repo.hasPlanFile(this.root(), parent))
  }

  private async orderHolder(parent: string): Promise<PlanDocument | PlanLibraryMeta> {
    const root = this.root()
    return parent === '' ? await this.repo.readLibraryMeta(root) : await this.repo.readPlan(root, parent)
  }

  private async saveOrderHolder(parent: string, holder: PlanDocument | PlanLibraryMeta): Promise<void> {
    const root = this.root()
    if (parent === '') await this.repo.writeLibraryMeta(root, holder as PlanLibraryMeta)
    else await this.repo.writePlanAtomic(root, parent, holder as PlanDocument)
  }

  private async updateOrderAfterRename(parent: string, oldName: string, newName: string): Promise<void> {
    if (await this.parentIsFolder(parent)) return
    const holder = await this.orderHolder(parent)
    const list = holder.children_order
    if (list) {
      const idx = list.indexOf(oldName)
      if (idx !== -1) list[idx] = newName
      await this.saveOrderHolder(parent, holder)
    }
  }

  private async removeOrderEntry(parent: string, name: string): Promise<void> {
    if (await this.parentIsFolder(parent)) return
    const holder = await this.orderHolder(parent)
    const list = holder.children_order
    if (list) {
      const idx = list.indexOf(name)
      if (idx !== -1) {
        list.splice(idx, 1)
        await this.saveOrderHolder(parent, holder)
      }
    }
  }

  private async insertOrderEntry(parent: string, name: string, orderIndex: number): Promise<void> {
    if (await this.parentIsFolder(parent)) return
    const holder = await this.orderHolder(parent)
    if (!holder.children_order) holder.children_order = []
    const list = holder.children_order
    const clamped = Math.max(0, Math.min(orderIndex, list.length))
    list.splice(clamped, 0, name)
    await this.saveOrderHolder(parent, holder)
  }
}

// ---------- 模块级辅助 ----------

function targetJoin(rootAbs: string, rel: string): string {
  return rel === '' ? rootAbs : join(rootAbs, rel)
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
