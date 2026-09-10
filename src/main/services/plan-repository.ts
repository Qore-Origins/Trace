// PlanRepository：计划库文件访问层（LLD §2.1.2）
// 铁律：一切落盘走原子写（tmp → fsync → rename）；跨盘 rename EXDEV → copy+rm fallback（SPIKE-3 实证）
import { promises as fs, type Dirent } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { PlanDocument, PlanLibraryMeta } from '../../shared/plan-types'
import { ERR, TraceError } from '../../shared/errors'
import { uuid32 } from '../../shared/validation'

const LIB_DIR = '.trace'
const LIB_FILE = 'plan-library.json'
const PLAN_FILE = 'plan.json'

type RenameFn = (from: string, to: string) => Promise<void>

// fs 底层错误 → 业务错误码（Windows 常见：EPERM/EACCES/EBUSY=占用；ENOENT=消失；EEXIST=重名）
function fsErrorToTrace(e: unknown): Error {
  const err = e as NodeJS.ErrnoException
  if (err?.code) {
    if (err.code === 'ENOENT') return new TraceError(ERR.PATH_NOT_FOUND, '目标位置不存在（可能已被移动或删除）')
    if (err.code === 'EPERM' || err.code === 'EACCES' || err.code === 'EBUSY') {
      return new TraceError(ERR.SAVE_FAILED, '文件被占用或无权限——请关闭正在使用该文件夹的程序（如资源管理器预览/编辑器）后重试')
    }
    if (err.code === 'EEXIST' || err.code === 'ENOTEMPTY') return new TraceError(ERR.NAME_CONFLICT, '同名文件夹已存在，请换一个名称')
  }
  return e instanceof Error ? e : new Error(String(e))
}

export interface RepoDeps {
  /** 外部写入通知（供 WatchService 抑制自身写入回声）；可选 */
  onInternalWrite?: (absPath: string) => void
  /** 可注入 rename（测试 EXDEV fallback 用） */
  renameFn?: RenameFn
}

export class PlanRepository {
  private deps: RepoDeps
  private rename: RenameFn
  // updated_at 单调性保障：CAS 锚点必须每次写都变化（同毫秒并发写时 +1ms）
  private lastWriteMs = 0

  constructor(deps: RepoDeps = {}) {
    // 注意顺序：类字段初始化器先于构造体执行，依赖必须在此显式赋值（不能用字段初始化器引用 this.deps）
    this.deps = deps
    this.rename = deps.renameFn ?? ((from, to) => fs.rename(from, to))
  }

  private notifyWrite(absPath: string): void {
    this.deps.onInternalWrite?.(absPath)
  }

  // 自身写入回声抑制入口：供外部服务（diary-service 等自建目录场景）在 mkdir/写入前登记路径，
  // 委托注入的 onInternalWrite（主装配处=watch.markInternalWrite，评审 F1 注入链）
  markInternalWrite(absPath: string): void {
    this.notifyWrite(absPath)
  }

  // ---------- 库结构 ----------

  // 首次配置/启动校验：可写探测 + .trace/plan-library.json 创建或加载
  async ensureLibraryRoot(rootAbs: string): Promise<PlanLibraryMeta> {
    await fs.mkdir(rootAbs, { recursive: true })
    const probe = join(rootAbs, `.trace-probe-${Date.now()}`)
    try {
      await fs.writeFile(probe, 'ok')
      await fs.rm(probe, { force: true })
    } catch {
      throw new TraceError(ERR.PATH_UNSAFE, '目录只读或无权限，请检查系统权限')
    }
    const libDir = join(rootAbs, LIB_DIR)
    await fs.mkdir(libDir, { recursive: true })
    const libFile = join(libDir, LIB_FILE)
    try {
      const raw = await fs.readFile(libFile, 'utf8')
      return JSON.parse(raw) as PlanLibraryMeta
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new TraceError(ERR.FORMAT_INVALID, '计划库元数据损坏')
      }
      const meta: PlanLibraryMeta = {
        format_version: '1',
        library_id: uuid32(),
        created_at: new Date().toISOString(),
        schema_info: ['min', 'v1']
      }
      await this.writeJsonAtomic(libFile, meta)
      return meta
    }
  }

  async readLibraryMeta(rootAbs: string): Promise<PlanLibraryMeta> {
    const raw = await fs.readFile(join(rootAbs, LIB_DIR, LIB_FILE), 'utf8')
    return JSON.parse(raw) as PlanLibraryMeta
  }

  async writeLibraryMeta(rootAbs: string, meta: PlanLibraryMeta): Promise<void> {
    const file = join(rootAbs, LIB_DIR, LIB_FILE)
    await this.writeJsonAtomic(file, meta)
  }

  // ---------- 计划读写 ----------

  planFileAbs(rootAbs: string, rel: string): string {
    return rel === '' ? join(rootAbs, LIB_DIR, LIB_FILE) : join(rootAbs, rel, PLAN_FILE)
  }

  async readPlan(rootAbs: string, rel: string): Promise<PlanDocument> {
    let raw: string
    try {
      raw = await fs.readFile(join(rootAbs, rel, PLAN_FILE), 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new TraceError(ERR.PATH_NOT_FOUND, '目标位置不存在（可能已被移动或删除）')
      }
      throw e
    }
    try {
      const doc = JSON.parse(raw) as PlanDocument
      if (doc.format_version !== '1' || !Array.isArray(doc.components)) {
        throw new Error('shape')
      }
      return doc
    } catch {
      throw new TraceError(ERR.FORMAT_INVALID, '内容格式异常，已降级显示')
    }
  }

  // 原子写（LLD §6.1）：同目录临时文件 → fsync → rename
  async writePlanAtomic(rootAbs: string, rel: string, doc: PlanDocument): Promise<void> {
    const target = join(rootAbs, rel, PLAN_FILE)
    doc.updated_at = this.nextTimestamp()
    await this.writeJsonAtomic(target, doc)
  }

  // 严格递增的 ISO 时间戳（CAS 锚点正确性的前提）
  private nextTimestamp(): string {
    let ms = Date.now()
    if (ms <= this.lastWriteMs) ms = this.lastWriteMs + 1
    this.lastWriteMs = ms
    return new Date(ms).toISOString()
  }

  private async writeJsonAtomic(target: string, data: unknown): Promise<void> {
    const dir = dirname(target)
    // mkdir 前登记目录：新建目录（如日记日页首次写入）的 addDir 事件同样被 watch 抑制（评审 Important-3）
    this.notifyWrite(dir)
    await fs.mkdir(dir, { recursive: true })
    const tmp = join(dir, `.${target.split(/[\\/]/).pop() ?? 'file'}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`)
    let handle: fs.FileHandle | undefined
    try {
      handle = await fs.open(tmp, 'w')
      await handle.writeFile(JSON.stringify(data, null, 2), 'utf8')
      await handle.sync()
      await handle.close()
      handle = undefined
      this.notifyWrite(tmp)
      await this.rename(tmp, target)
      this.notifyWrite(target)
    } catch (e) {
      await fs.rm(tmp, { force: true }).catch(() => {})
      if (e instanceof TraceError) throw e
      throw new TraceError(ERR.SAVE_FAILED, '保存失败，内容已保留（编辑态可重试）')
    } finally {
      await handle?.close().catch(() => {})
    }
  }

  // ---------- 应用数据 JSON（config.json 等，复用同一原子写引擎） ----------

  async writeAppJson(filePath: string, data: unknown): Promise<void> {
    await this.writeJsonAtomic(filePath, data)
  }

  // ---------- 目录操作 ----------

  // 列出子计划目录名（排除 .trace 与隐藏目录/文件）
  async listPlanDirs(rootAbs: string, rel: string): Promise<string[]> {
    const entries = await this.readDirEntries(rootAbs, rel)
    return entries.filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name).sort()
  }

  // 是否存在子计划目录（树展开箭头真值；数据驱动，不依赖渲染器猜）
  async hasChildDirs(rootAbs: string, rel: string): Promise<boolean> {
    const entries = await this.readDirEntries(rootAbs, rel)
    return entries.some((d) => d.isDirectory() && !d.name.startsWith('.'))
  }

  private async readDirEntries(rootAbs: string, rel: string): Promise<Dirent[]> {
    const abs = rel === '' ? rootAbs : join(rootAbs, rel)
    try {
      return await fs.readdir(abs, { withFileTypes: true })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new TraceError(ERR.PATH_NOT_FOUND, '目标位置不存在（可能已被移动或删除）')
      }
      throw e
    }
  }

  async mkdirPlan(rootAbs: string, parentRelPath: string, name: string): Promise<string> {
    const parentAbs = parentRelPath === '' ? rootAbs : join(rootAbs, parentRelPath)
    const dirAbs = join(parentAbs, name)
    // 内部写登记：新建目录的 addDir 事件须被 watch 抑制（否则回声触发整树重载——2026-09-10 用户反馈）
    this.notifyWrite(dirAbs)
    try {
      await fs.mkdir(dirAbs) // 已存在则抛 EEXIST → 转 NAME_CONFLICT
    } catch (e) {
      throw fsErrorToTrace(e)
    }
    return dirAbs
  }

  async existsDir(rootAbs: string, rel: string): Promise<boolean> {
    try {
      const stat = await fs.stat(rel === '' ? rootAbs : join(rootAbs, rel))
      return stat.isDirectory()
    } catch {
      return false
    }
  }

  // 目录是否为"计划"（含 plan.json）；无 → 纯容器文件夹
  async hasPlanFile(rootAbs: string, rel: string): Promise<boolean> {
    try {
      await fs.access(join(rootAbs, rel, PLAN_FILE))
      return true
    } catch {
      return false
    }
  }

  async renamePlanDir(rootAbs: string, rel: string, newName: string): Promise<void> {
    const from = join(rootAbs, rel)
    const to = join(dirname(from), newName)
    await this.moveDir(from, to)
  }

  async rmRecursive(rootAbs: string, rel: string): Promise<void> {
    const abs = join(rootAbs, rel)
    // 内部写登记：unlinkDir 及其内全部 unlink 事件须被 watch 抑制（2026-09-10 用户反馈——删除致整树重载）
    this.notifyWrite(abs)
    try {
      await fs.rm(abs, { recursive: true, force: false })
    } catch (e) {
      throw fsErrorToTrace(e)
    }
  }

  // 跨盘安全移动：同盘 rename；EXDEV → copy 目录 + rm 源（SPIKE-3 定案）
  async moveDir(fromAbs: string, toAbs: string): Promise<void> {
    // 内部写登记：源侧 unlinkDir 与目标侧 addDir 回声均抑制（含 EXDEV copy 产生的目标子树事件）
    this.notifyWrite(fromAbs)
    this.notifyWrite(toAbs)
    try {
      await this.rename(fromAbs, toAbs)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw fsErrorToTrace(e)
      try {
        await this.copyDirRecursive(fromAbs, toAbs)
        await fs.rm(fromAbs, { recursive: true, force: true }) // 源已在本方法开头登记抑制
      } catch (e2) {
        throw fsErrorToTrace(e2)
      }
    }
  }

  private async copyDirRecursive(from: string, to: string): Promise<void> {
    await fs.mkdir(dirname(to), { recursive: true })
    await fs.cp(from, to, { recursive: true, errorOnExist: true, force: false })
  }
}
