// TransferService：.plan 导入/导出（zip 容器复用存储契约）+ Markdown 旧计划迁入
// .plan 结构：manifest.json + <计划名>/plan.json + <计划名>/<子计划>/plan.json...（与磁盘计划库同构，零转换）
import { promises as fs } from 'node:fs'
import { join, dirname } from 'node:path'
import { zipSync, unzipSync, type Zippable } from 'fflate'
import type { PlanDocument, Component, PlanLibraryMeta, TaskItem } from '../../shared/plan-types'
import { ERR, TraceError } from '../../shared/errors'
import { validatePlanName, validateTitle, validateNoteText, uuid32 } from '../../shared/validation'
import { normalizeRel } from '../../shared/path-utils'
import type { PlanRepository } from './plan-repository'
import type { TreeCache } from './tree-cache'
import { bus } from './event-bus'

const MANIFEST = 'manifest.json'
const BUNDLE_TYPE = 'trace-plan-bundle'

export interface ExportReport {
  savedTo: string
  plans: number
  components: number
  tasks: number
}

export interface ImportReport {
  imported: Array<{ path: string; renamedFrom?: string }>
  plans: number
  components: number
  tasks: number
  notes: number
  skipped: string[]
}

export class TransferService {
  constructor(
    private repo: PlanRepository,
    private treeCache: TreeCache,
    private getRoot: () => string
  ) {}

  // ---------- 导出：子树 → .plan ----------

  async exportPlan(rel: string, saveToAbs: string): Promise<ExportReport> {
    const root = this.getRoot()
    const safe = normalizeRel(rel)
    if (safe === '') throw new TraceError(ERR.VALIDATION, '不能导出根目录（整库请直接拷贝文件夹）')
    const planName = safe.slice(safe.lastIndexOf('/') + 1)

    // 收集子树：自身 + 全部后代计划
    const files: Zippable = {}
    let plans = 0
    let components = 0
    let tasks = 0
    const enc = new TextEncoder()

    const walk = async (relPath: string, zipPrefix: string): Promise<void> => {
      const doc = await this.repo.readPlan(root, relPath)
      files[joinZip(zipPrefix, 'plan.json')] = enc.encode(JSON.stringify(doc, null, 2))
      plans++
      components += doc.components.length
      for (const c of doc.components) {
        if (c.type === 'task_list') tasks += (c.payload as { items: unknown[] }).items.length
        if (c.type === 'task_detail') tasks += 1
      }
      const children = await this.repo.listPlanDirs(root, relPath)
      for (const child of children) {
        await walk(relPath === '' ? child : `${relPath}/${child}`, joinZip(zipPrefix, child))
      }
    }
    await walk(safe, planName)

    files[MANIFEST] = enc.encode(
      JSON.stringify(
        {
          type: BUNDLE_TYPE,
          format_version: '1',
          name: planName,
          exported_at: new Date().toISOString(),
          counts: { plans, components, tasks }
        },
        null,
        2
      )
    )

    const zipped = zipSync(files, { level: 6 })
    // 保存目标原子写（用户经保存对话框选定路径）
    const tmp = `${saveToAbs}.tmp`
    await fs.writeFile(tmp, zipped)
    await fs.rename(tmp, saveToAbs)
    return { savedTo: saveToAbs, plans, components, tasks }
  }

  // ---------- 导入：.plan → 目标父级 ----------

  async importPlan(targetParentRel: string, planFileAbs: string): Promise<ImportReport> {
    const root = this.getRoot()
    const targetParent = normalizeRel(targetParentRel)

    const raw = new Uint8Array(await fs.readFile(planFileAbs))
    let entries: Record<string, Uint8Array>
    try {
      entries = unzipSync(raw)
    } catch {
      throw new TraceError(ERR.FORMAT_INVALID, '无法读取该文件（不是有效的 .plan 包）')
    }

    // manifest 校验
    const manifestRaw = entries[MANIFEST]
    if (!manifestRaw) throw new TraceError(ERR.FORMAT_INVALID, '缺少 manifest.json（不是溯源计划包）')
    let manifest: { type?: string; format_version?: string; name?: string }
    try {
      manifest = JSON.parse(new TextDecoder().decode(manifestRaw))
    } catch {
      throw new TraceError(ERR.FORMAT_INVALID, 'manifest.json 损坏')
    }
    if (manifest.type !== BUNDLE_TYPE || manifest.format_version !== '1') {
      throw new TraceError(ERR.FORMAT_INVALID, '该包不是溯源计划包（或版本不兼容）')
    }

    // 安全校验：entry 路径不得穿越（../、盘符、绝对路径）；且必须位于包内顶层计划目录下
    const bundleRootName = sanitizeSeg(manifest.name ?? '')
    const planEntries = Object.keys(entries).filter((k) => k !== MANIFEST && !k.endsWith('/'))
    for (const key of planEntries) {
      const norm = normalizeZipPath(key)
      if (norm === null || !norm.startsWith(bundleRootName + '/')) {
        throw new TraceError(ERR.PATH_UNSAFE, `包内存在非法路径条目：${key.slice(0, 60)}`)
      }
      if (!norm.endsWith('plan.json')) {
        throw new TraceError(ERR.PATH_UNSAFE, `包内存在未知文件：${key.slice(0, 60)}`)
      }
    }

    // 冲突处理：目标父级同名 → 自动改名 " (2)"
    const finalName = await this.uniqueName(targetParent, bundleRootName)

    // 落盘：解出子树到目标父级（plan.json 内容原样；目录自建）
    const report: ImportReport = { imported: [], plans: 0, components: 0, tasks: 0, notes: 0, skipped: [] }
    for (const key of planEntries) {
      const relUnderBundle = normalizeZipPath(key) as string // 已校验非 null
      // <bundleRoot>/rest → <finalName>/rest
      const rest = relUnderBundle.slice(bundleRootName.length + 1)
      const targetRel = targetParent === '' ? `${finalName}/${rest}` : `${targetParent}/${finalName}/${rest}`
      const abs = join(root, targetRel)
      await fs.mkdir(dirname(abs), { recursive: true })
      const content = entries[key]
      // plan.json 内容校验（契约形状），通过后原样写入
      const doc = JSON.parse(new TextDecoder().decode(content)) as PlanDocument
      if (doc.format_version !== '1' || !Array.isArray(doc.components)) {
        report.skipped.push(relUnderBundle)
        continue
      }
      await fs.writeFile(abs, content)
      report.plans++
      report.components += doc.components.length
      for (const c of doc.components) {
        if (c.type === 'task_list') report.tasks += (c.payload as { items: unknown[] }).items.length
        if (c.type === 'task_detail') report.tasks += 1
        if (c.type === 'note') report.notes += 1
      }
    }

    const importedPath = targetParent === '' ? finalName : `${targetParent}/${finalName}`
    report.imported.push({ path: importedPath, renamedFrom: finalName !== bundleRootName ? bundleRootName : undefined })
    this.treeCache.invalidatePrefix(targetParent)
    bus.emit('trace:plan-changed', { path: importedPath })
    return report
  }

  private async uniqueName(parentRelPath: string, name: string): Promise<string> {
    const root = this.getRoot()
    const siblings = await this.repo.listPlanDirs(root, parentRelPath)
    if (!siblings.includes(name)) return name
    for (let i = 2; ; i++) {
      const candidate = `${name} (${i})`
      if (!siblings.includes(candidate)) return candidate
      // 兜底：已存在 (2) 时下一次探测 (3)...，listPlanDirs 每次同一快照，循环安全
    }
  }

  // ---------- Markdown 迁入（D:\Desktop\Plan 格式） ----------

  // 文件名：`<类型>-<YYYYMMDD>-<标题>.md`；类型映射为层级文件夹（原样保留，如 Daily_Plan）
  async importMarkdown(targetParentRel: string, files: Array<{ name: string; content: string }>): Promise<ImportReport> {
    const report: ImportReport = { imported: [], plans: 0, components: 0, tasks: 0, notes: 0, skipped: [] }
    // 按层级分组：同一层级一次刷新缓存
    const byLevel = new Map<string, Array<{ planName: string; doc: PlanDocument; original: string }>>()

    for (const f of files) {
      if (!f.name.toLowerCase().endsWith('.md')) {
        report.skipped.push(f.name)
        continue
      }
      const base = f.name.slice(0, -3)
      const parsed = parseMdFileName(base)
      if (!parsed) {
        report.skipped.push(f.name)
        continue
      }
      const { level, ymd, title } = parsed
      const doc = markdownToPlanDocument(title, ymd, f.content, report)
      const list = byLevel.get(level) ?? []
      list.push({ planName: `${ymd}-${title}`, doc, original: f.name })
      byLevel.set(level, list)
    }

    for (const [level, plans] of byLevel) {
      // 层级文件夹（顶层在 targetParent 下；无则创建）
      const levelPath = await this.ensureLevelFolder(targetParentRel, level)
      for (const p of plans) {
        const finalName = await this.uniqueName(levelPath, p.planName)
        const rel = `${levelPath}/${finalName}`
        const root = this.getRoot()
        await fs.mkdir(join(root, rel), { recursive: true })
        await this.repo.writePlanAtomic(root, rel, p.doc)
        report.plans++
        report.components += p.doc.components.length
        report.imported.push({ path: rel, renamedFrom: finalName !== p.planName ? p.planName : undefined })
      }
      this.treeCache.invalidatePrefix(levelPath)
      bus.emit('trace:plan-changed', { path: levelPath })
    }
    return report
  }

  private async ensureLevelFolder(targetParentRel: string, level: string): Promise<string> {
    const root = this.getRoot()
    const parent = normalizeRel(targetParentRel)
    const levelPath = parent === '' ? level : `${parent}/${level}`
    try {
      await this.repo.mkdirPlan(root, parent, level)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    }
    this.treeCache.invalidatePrefix(parent)
    return levelPath
  }
}

// ---------- 模块级辅助 ----------

function joinZip(prefix: string, name: string): string {
  return prefix === '' ? name : `${prefix}/${name}`
}

// zip 内路径规范化：拒绝绝对路径/盘符/..；返回 'a/b/c' 形态或 null
function normalizeZipPath(p: string): string | null {
  const replaced = p.replace(/\\/g, '/')
  if (/^[a-zA-Z]:/.test(replaced) || replaced.startsWith('/')) return null
  const segs = replaced.split('/').filter((s) => s !== '' && s !== '.')
  if (segs.some((s) => s === '..')) return null
  return segs.join('/')
}

function sanitizeSeg(name: string): string {
  const norm = normalizeZipPath(name)
  if (!norm || norm.includes('/')) throw new TraceError(ERR.FORMAT_INVALID, 'manifest 计划名非法')
  return norm
}

// 文件名解析：`<类型>-<YYYYMMDD>-<标题>`；类型段可含连字符（如 Long-Term_Plan）
export function parseMdFileName(base: string): { level: string; ymd: string; title: string } | null {
  const m = base.match(/^([A-Za-z][A-Za-z0-9_\-]*?)-(\d{8})-(.+)$/)
  if (!m) return null
  const level = m[1]
  const ymd = m[2]
  const title = m[3].trim()
  if (!title) return null
  return { level, ymd, title }
}

// Markdown → PlanDocument（清单+保底策略，2026-09-06 定案）：
//   checkbox 行 → 任务列表组件（粗体/### 行 = 分组，每组一个 task_list，title=分组名）
//   其余非空文本 → 单个 note 组件保底（不丢内容）
export function markdownToPlanDocument(
  title: string,
  ymd: string,
  content: string,
  report: { tasks: number; notes: number }
): PlanDocument {
  const now = new Date().toISOString()
  const doc: PlanDocument = { format_version: '1', created_at: now, updated_at: now, components: [] }
  const lines = content.split(/\r?\n/)

  // 1. 任务清单解析
  const groups: Array<{ name: string; items: TaskItem[] }> = []
  let currentGroup: { name: string; items: TaskItem[] } | null = null
  const proseLines: string[] = []

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    const cb = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/)
    if (cb) {
      if (!currentGroup) {
        currentGroup = { name: '任务', items: [] }
        groups.push(currentGroup)
      }
      const done = cb[1].toLowerCase() === 'x'
      currentGroup.items.push({
        id: uuid32(),
        title: cleanInline(cb[2]),
        status: done ? 'done' : 'not_started',
        planned_at: formatDate(ymd),
        completed_at: done ? now : undefined
      })
      continue
    }
    // 分组标题：**粗体** 或 ### 小节（排除一级标题与元信息行）
    const bold = line.match(/^\*\*(.+?)\*\*:?\s*$/)
    const heading = line.match(/^#{2,4}\s+(.+)$/)
    if (bold || (heading && !/^#{1,4}\s*(一|二|三|四|五|六|七|八|九|十)?[、.]?\s*$/.test(line) && !line.includes('时间') && !line.includes('组织'))) {
      const name = cleanInline((bold ? bold[1] : heading?.[1]) ?? '')
      if (name) {
        currentGroup = { name, items: [] }
        groups.push(currentGroup)
        continue
      }
    }
    // 一级标题 = 文件名重复，跳过；##### 元信息行跳过；分隔线跳过
    if (/^#\s+/.test(line) || /^#{5}\s*/.test(line) || /^---+\s*$/.test(line)) continue
    if (line.trim() !== '') proseLines.push(line)
  }

  for (const g of groups) {
    if (g.items.length === 0) {
      // 空分组名文本并入保底
      proseLines.push(g.name)
      continue
    }
    const comp: Component = { id: uuid32(), type: 'task_list', payload: { title: g.name, items: g.items } }
    doc.components.push(comp)
    report.tasks += g.items.length
  }

  if (proseLines.length > 0) {
    const text = proseLines.join('\n').slice(0, 20000)
    if (text.trim()) {
      doc.components.push({ id: uuid32(), type: 'note', payload: { content: text, created_at: now } })
      report.notes++
    }
  }

  // 标题组件：单选计划承载"这份计划本身"
  validateTitle(title || `计划 ${ymd}`)
  doc.components.unshift({
    id: uuid32(),
    type: 'single_plan',
    payload: { title: title || `计划 ${ymd}`, done: false, summary: `迁入自 Markdown（${ymd}）`, created_at: now }
  })
  void validateNoteText
  return doc
}

function cleanInline(s: string): string {
  return s.replace(/`/g, '').replace(/\s+$/, '').trim().slice(0, 200)
}

function formatDate(ymd: string): string | undefined {
  if (!/^\d{8}$/.test(ymd)) return undefined
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
}

// 库元数据类型引用保留（导出顶层顺序远期可用）
export type { PlanLibraryMeta }
