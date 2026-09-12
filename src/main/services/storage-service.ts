// StorageService：计划树业务逻辑（LLD §2.1）
// 职责：校验（名称/路径/confirm/CAS）→ 编排 Repository + TreeCache → 事件通知
import { join } from 'node:path'
import type { PlanDocument, Component, TaskItem } from '../../shared/plan-types'
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
      throw new TraceError(ERR.NAME_CONFLICT, '同名计划或文件夹已存在，请换一个名称')
    }

    await this.repo.renamePlanDir(root, rel, newName)

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
    this.treeCache.invalidatePrefix(rel)
    // 与其余结构变更一致：通知树刷新与搜索索引重建（否则索引残留已删计划的幽灵条目）
    bus.emit('trace:plan-changed', { path: rel })
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

    const fromAbs = targetJoin(root, rel)
    const toAbs = targetJoin(root, targetParent === '' ? name : `${targetParent}/${name}`)
    await this.repo.moveDir(fromAbs, toAbs)

    this.treeCache.invalidatePrefix(rel)
    this.treeCache.invalidatePrefix(targetParent)
    bus.emit('trace:plan-changed', { path: targetParent === '' ? name : `${targetParent}/${name}` })
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
