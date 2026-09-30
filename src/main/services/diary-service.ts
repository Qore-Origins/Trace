// DiaryService：日记页幂等创建/缺日补建 + 月枚举聚合 + 日摘要
// 幂等守卫：存在 plan.json 即跳过，补入缺页但绝不覆盖用户内容
// 日计划=普通计划：读写复用 PlanRepository——原子写/形状校验/错误语义一致
import { promises as fs, type Dirent } from 'node:fs'
import type {
  Component,
  CustomPayload,
  HeadingPayload,
  MoodPayload,
  NotePayload,
  PlanDocument,
  TaskDetailPayload,
  TaskListPayload
} from '../../shared/plan-types'
import type { DiaryDayComponent, DiaryDaySummary, DiaryMemoryEntry, DiaryMemoryMilestone, DiaryMonthEntry } from '../../shared/ipc-contract'
import { DIARY_DIR } from '../../shared/plan-types'
import { ERR, TraceError } from '../../shared/errors'
import { todayDateStr, uuid32 } from '../../shared/validation'
import { PlanRepository } from './plan-repository'
import { assertRealPathWithinRoot, resolveWithin } from './path-safety'

export { DIARY_DIR }

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const NOTE_PREVIEW_LEN = 60
const TEMPLATE_HEADING_SIZE = 18
const AUTOMATION_REL = '.trace/diary-automation.json'
const CALENDAR_NOON = 12
const DAY_WRITES = new Map<string, Promise<void>>()
const RECONCILE_WRITES = new Map<string, Promise<void>>()

interface DiaryAutomationCheckpoint {
  format_version: '1'
  last_reconciled_date: string | null
}

export interface DiaryReconcileResult {
  today: string
  /** 仅本次实际创建 plan.json 的日期，按日期升序；已有页不会出现在这里。 */
  createdDates: string[]
  /** 成功完成后的 checkpoint；时钟回退时保持已完成的较新日期。 */
  lastReconciledDate: string
}

// 默认自建（测试/未注入环境）；主装配处经 setDiaryRepo 注入共享实例——diary 自写事件才能被
// watch.markInternalWrite 抑制，否则 chokidar 回声 → trace:fs-external-change 外部变更误报（评审 F1）
let repo: PlanRepository = new PlanRepository()

export function setDiaryRepo(r: PlanRepository): void {
  repo = r
}

// 日记根绝对路径；幂等（recursive mkdir 已存在无副作用，不触碰已有内容）
export async function ensureDiaryRoot(planRoot: string): Promise<string> {
  const { abs: rootAbs } = resolveWithin(planRoot, '')
  const { abs } = resolveWithin(rootAbs, DIARY_DIR)
  await assertRealPathWithinRoot(rootAbs, abs, { allowMissing: true })
  try {
    if (!(await fs.stat(abs)).isDirectory()) throw new TraceError(ERR.PATH_UNSAFE, '日记根路径不是目录')
    return abs
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  // mkdir 前经注入实例登记：首次进日记视图建 Diary/ 目录的 addDir 事件被 watch 抑制（评审 Important-3）
  repo.markInternalWrite(abs)
  await fs.mkdir(abs, { recursive: true })
  await assertRealPathWithinRoot(rootAbs, abs)
  return abs
}

// 日期串以本地日历验真；setFullYear 避开构造器将 00-99 年隐式映射到 1900 年的问题。
function calendarDate(date: string): Date | null {
  if (typeof date !== 'string') return null
  const match = DATE_RE.exec(date)
  if (!match) return null
  const [year, month, day] = match.slice(1).map(Number)
  if (year < 1 || month < 1 || month > 12 || day < 1) return null
  const value = new Date(0)
  value.setHours(CALENDAR_NOON, 0, 0, 0)
  value.setFullYear(year, month - 1, day)
  return value.getFullYear() === year && value.getMonth() === month - 1 && value.getDate() === day ? value : null
}

function validateDiaryDate(date: string): void {
  if (!calendarDate(date)) throw new TraceError(ERR.VALIDATION, '日期无效（需为真实的 YYYY-MM-DD 日期）')
}

function nextDiaryDate(date: string): string {
  const value = calendarDate(date)
  if (!value) throw new TraceError(ERR.VALIDATION, '日期无效')
  value.setDate(value.getDate() + 1)
  const pad = (part: number, width = 2): string => String(part).padStart(width, '0')
  return `${pad(value.getFullYear(), 4)}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

async function safeDiaryDateDirectoryNames(
  rootAbs: string,
  dirents: Dirent[],
  includeDate: (date: string) => boolean
): Promise<string[]> {
  const names: string[] = []
  for (const entry of dirents) {
    const { name } = entry
    if (!calendarDate(name) || !includeDate(name)) continue

    const { abs } = resolveWithin(rootAbs, `${DIARY_DIR}/${name}`)
    try {
      await assertRealPathWithinRoot(rootAbs, abs)
    } catch (error) {
      if (error instanceof TraceError && error.code === ERR.PATH_NOT_FOUND) continue
      throw error
    }
    if (entry.isSymbolicLink() || !entry.isDirectory()) continue
    names.push(name)
  }
  return names.sort()
}

function pathLockKey(abs: string): string {
  return process.platform === 'win32' ? abs.toLowerCase() : abs
}

// 失败不会堵住后续请求，完成后释放 map 项；不同根/日期互不占用。
function serialized<T>(pending: Map<string, Promise<void>>, key: string, operation: () => Promise<T>): Promise<T> {
  const result = (pending.get(key) ?? Promise.resolve()).then(operation)
  const settled = result.then(() => {}, () => {})
  pending.set(key, settled)
  void settled.then(() => { if (pending.get(key) === settled) pending.delete(key) })
  return result
}

async function ensureDatePage(planRoot: string, date: string): Promise<{ abs: string; created: boolean }> {
  validateDiaryDate(date)
  const rel = `${DIARY_DIR}/${date}`
  const { abs } = resolveWithin(planRoot, rel)
  await assertRealPathWithinRoot(planRoot, abs, { allowMissing: true })
  return serialized(DAY_WRITES, pathLockKey(abs), async () => {
    const { abs: planFile } = resolveWithin(planRoot, `${rel}/plan.json`)
    await assertRealPathWithinRoot(planRoot, abs, { allowMissing: true })
    await assertRealPathWithinRoot(planRoot, planFile, { allowMissing: true })
    try {
      await fs.lstat(planFile)
      return { abs, created: false }
    } catch (error) {
      // 无法确认文件不存在时必须停止；权限/IO 异常不能解释为缺页。
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    try {
      if (!(await fs.stat(abs)).isDirectory()) throw new TraceError(ERR.PATH_UNSAFE, '日记日期路径不是目录')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      repo.markInternalWrite(abs)
    }
    const now = new Date().toISOString()
    const template: PlanDocument = {
      format_version: '1',
      created_at: now,
      updated_at: now,
      components: [
        { id: uuid32(), type: 'heading', payload: { title: date, size: TEMPLATE_HEADING_SIZE } as HeadingPayload },
        { id: uuid32(), type: 'mood', payload: { score: null, text: '', mood_date: date, created_at: now } as MoodPayload },
        { id: uuid32(), type: 'note', payload: { content: '', created_at: now } as NotePayload }
      ]
    }
    // 先在目标日目录内用仓库原子写完成 staging，再用硬链接原子发布。
    // link 是排他创建：探测后出现的外部文件也不会被 rename 覆盖。
    const stagingRel = `${rel}/.trace-diary-${uuid32()}`
    const { abs: stagingAbs } = resolveWithin(planRoot, stagingRel)
    const { abs: stagedPlanFile } = resolveWithin(planRoot, `${stagingRel}/plan.json`)
    let operationFailed = false
    let operationError: unknown
    try {
      await repo.writePlanAtomic(planRoot, stagingRel, template)
      repo.markInternalWrite(planFile)
      try {
        await fs.link(stagedPlanFile, planFile)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return { abs, created: false }
        throw error // 不支持硬链接/权限/IO 错误均停止，绝不降级成可能覆盖的写入。
      }
      repo.markInternalWrite(planFile)
      return { abs, created: true }
    } catch (error) {
      operationFailed = true
      operationError = error
      throw error
    } finally {
      repo.markInternalWrite(stagingAbs)
      try {
        await fs.rm(stagingAbs, { recursive: true, force: true })
      } catch (cleanupError) {
        if (operationFailed) {
          throw new AggregateError([operationError, cleanupError], '创建日记失败且 staging 清理失败', { cause: operationError })
        }
        throw cleanupError
      }
    }
  })
}

// 前台今日页与后台回填共用日页锁；显式日期用于确定性调用，省略仍取本地今天。
export async function ensureTodayPage(planRoot: string, today = todayDateStr()): Promise<string> {
  return (await ensureTodayPageWithResult(planRoot, today)).abs
}

// created 来自持有日页锁时的排他发布结果，供前台仅刷新自身实际创建的页面。
export async function ensureTodayPageWithResult(planRoot: string, today = todayDateStr()): Promise<{ abs: string; created: boolean }> {
  return ensureDatePage(planRoot, today)
}

async function readCheckpoint(planRoot: string): Promise<DiaryAutomationCheckpoint | null> {
  const { abs: traceDirectory } = resolveWithin(planRoot, '.trace')
  const { abs } = resolveWithin(planRoot, AUTOMATION_REL)
  await assertRealPathWithinRoot(planRoot, traceDirectory, { allowMissing: true })
  await assertRealPathWithinRoot(planRoot, abs, { allowMissing: true })
  let raw: string
  try {
    raw = await fs.readFile(abs, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('shape')
    const checkpoint = value as Partial<DiaryAutomationCheckpoint>
    if (checkpoint.format_version !== '1' ||
      !(checkpoint.last_reconciled_date === null ||
        (typeof checkpoint.last_reconciled_date === 'string' && calendarDate(checkpoint.last_reconciled_date)))) {
      throw new Error('shape')
    }
    return checkpoint as DiaryAutomationCheckpoint
  } catch {
    throw new TraceError(ERR.FORMAT_INVALID, '日记补建进度文件损坏，已保留原文件')
  }
}

/** 补建缺日但保留既有页；请求区间全部成功后才原子推进 checkpoint。 */
export async function reconcileDiaryPages(planRoot: string, today: string): Promise<DiaryReconcileResult> {
  validateDiaryDate(today)
  const { abs: rootAbs } = resolveWithin(planRoot, '')
  return serialized(RECONCILE_WRITES, pathLockKey(rootAbs), async () => {
    const checkpoint = await readCheckpoint(rootAbs)
    const lastDate = checkpoint?.last_reconciled_date ?? null
    const diaryAbs = await ensureDiaryRoot(rootAbs)
    const createdDates = new Set<string>()

    const dirents = lastDate === null ? await fs.readdir(diaryAbs, { withFileTypes: true }) : []
    const earliestDate = dirents
      .filter((entry) => entry.isDirectory() && calendarDate(entry.name) && entry.name <= today)
      .map((entry) => entry.name)
      .sort()[0] ?? today
    const startDate = lastDate === null ? earliestDate : lastDate < today ? nextDiaryDate(lastDate) : today
    for (let date = startDate; ; date = nextDiaryDate(date)) {
      if ((await ensureDatePage(rootAbs, date)).created) createdDates.add(date)
      if (date === today) break
    }
    const lastReconciledDate = lastDate !== null && lastDate > today ? lastDate : today
    if (checkpoint === null || lastDate !== lastReconciledDate) {
      const { abs: checkpointAbs } = resolveWithin(rootAbs, AUTOMATION_REL)
      const { abs: traceDirectory } = resolveWithin(rootAbs, '.trace')
      await assertRealPathWithinRoot(rootAbs, traceDirectory, { allowMissing: true })
      await assertRealPathWithinRoot(rootAbs, checkpointAbs, { allowMissing: true })
      await repo.writeAppJson(checkpointAbs, { format_version: '1', last_reconciled_date: lastReconciledDate } satisfies DiaryAutomationCheckpoint)
    }
    return { today, createdDates: [...createdDates].sort(), lastReconciledDate }
  })
}

// 月枚举聚合：枚举 Diary/YYYY-MM-* 目录读 plan.json——无 plan.json 或坏 JSON 跳过该日
export async function listMonthEntries(planRoot: string, year: number, month: number): Promise<DiaryMonthEntry[]> {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new TraceError(ERR.VALIDATION, '月份需在 1-12 之间')
  }
  const { abs: rootAbs } = resolveWithin(planRoot, '')
  const { abs: diaryAbs } = resolveWithin(rootAbs, DIARY_DIR)
  try {
    await assertRealPathWithinRoot(rootAbs, diaryAbs, { allowMissing: true })
  } catch (error) {
    if (error instanceof TraceError && error.code === ERR.PATH_NOT_FOUND) return []
    throw error
  }
  let dirents: Dirent[]
  try {
    dirents = await fs.readdir(diaryAbs, { withFileTypes: true })
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [] // 日记根尚不存在 → 空月
    throw e
  }
  const days = await safeDiaryDateDirectoryNames(rootAbs, dirents, (name) => {
    const match = DATE_RE.exec(name)
    return match !== null && Number(match[1]) === year && Number(match[2]) === month
  }) // YYYY-MM-DD 字典序=时间序（升序）

  const entries: DiaryMonthEntry[] = []
  for (const name of days) {
    const { abs: planAbs } = resolveWithin(rootAbs, `${DIARY_DIR}/${name}/plan.json`)
    await assertRealPathWithinRoot(rootAbs, planAbs, { allowMissing: true })
    let doc: PlanDocument
    try {
      doc = await repo.readPlan(planRoot, `${DIARY_DIR}/${name}`)
    } catch (e) {
      // 无 plan.json（纯文件夹）或坏 JSON：该日跳过，不污染月历
      if (e instanceof TraceError && (e.code === ERR.PATH_NOT_FOUND || e.code === ERR.FORMAT_INVALID)) continue
      throw e
    }
    entries.push(aggregateDay(name, doc))
  }
  return entries
}

// 单日聚合：score=首张 mood 卡分数（非数字视为无记录）；notePreview=首个 note 文首 60 字符；compCount=组件总数
function aggregateDay(date: string, doc: PlanDocument): DiaryMonthEntry {
  const mood = doc.components.find((c) => c.type === 'mood')
  const note = doc.components.find((c) => c.type === 'note')
  const moodRaw = mood ? (mood.payload as MoodPayload).score : null
  const noteRaw = note ? (note.payload as NotePayload).content : ''
  return {
    date,
    score: typeof moodRaw === 'number' ? moodRaw : null,
    notePreview: typeof noteRaw === 'string' ? noteRaw.slice(0, NOTE_PREVIEW_LEN) : '',
    compCount: doc.components.length
  }
}

// 回忆聚合（F2 回忆视图）：一次枚举 Diary/ 全目录 → 那年今日 / 里程碑 / 随机
// 里程碑通式：n%100===0（百天）∪ n%365===0（周年），n ∈ [100, 3650]；今天由 main 侧取（与 diary:ensure 一致）
export async function listMemories(planRoot: string): Promise<{
  today: string
  history: DiaryMemoryEntry[]
  onthisday: DiaryMemoryEntry[]
  milestones: DiaryMemoryMilestone[]
  random: DiaryMemoryEntry | null
}> {
  const today = todayDateStr()
  const md = today.slice(5) // MM-DD
  const { abs: rootAbs } = resolveWithin(planRoot, '')
  const { abs: diaryAbs } = resolveWithin(rootAbs, DIARY_DIR)
  try {
    await assertRealPathWithinRoot(rootAbs, diaryAbs, { allowMissing: true })
  } catch (error) {
    if (error instanceof TraceError && error.code === ERR.PATH_NOT_FOUND) {
      return { today, history: [], onthisday: [], milestones: [], random: null }
    }
    throw error
  }
  let dirents: Dirent[]
  try {
    dirents = await fs.readdir(diaryAbs, { withFileTypes: true })
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return { today, history: [], onthisday: [], milestones: [], random: null } // 日记根尚不存在 → 全空
    }
    throw e
  }

  const msMap = new Map<string, number>()
  for (let n = 100; n <= 3650; n++) {
    if (n % 100 === 0 || n % 365 === 0) {
      const d = new Date()
      d.setDate(d.getDate() - n)
      const p = (x: number): string => String(x).padStart(2, '0')
      msMap.set(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, n)
    }
  }

  const names = await safeDiaryDateDirectoryNames(rootAbs, dirents, (name) => name !== today) // 今天不算回忆

  const onthisday: DiaryMemoryEntry[] = []
  const milestones: DiaryMemoryMilestone[] = []
  const all: DiaryMemoryEntry[] = []
  for (const name of names) {
    const { abs: planAbs } = resolveWithin(rootAbs, `${DIARY_DIR}/${name}/plan.json`)
    await assertRealPathWithinRoot(rootAbs, planAbs, { allowMissing: true })
    let doc: PlanDocument
    try {
      doc = await repo.readPlan(planRoot, `${DIARY_DIR}/${name}`)
    } catch {
      continue // 无 plan.json / 坏 JSON 跳过（与 listMonthEntries 同语义）
    }
    if (!hasDiaryContent(name, doc)) continue
    const entry = aggregateDay(name, doc)
    all.push(entry)
    if (name.slice(5) === md) onthisday.push(entry)
    const days = msMap.get(name)
    if (days !== undefined) milestones.push({ ...entry, days })
  }

  onthisday.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)) // 近年在前
  milestones.sort((a, b) => a.days - b.days)
  const random = all.length > 0 ? all[Math.floor(Math.random() * all.length)] : null
  return { today, history: all, onthisday, milestones, random }
}

// 日期标题、一个未填写 mood 和一个空 note 都是模板占位；额外组件或真实文字/分数才是记录。
function hasDiaryContent(date: string, doc: PlanDocument): boolean {
  const seen = new Set<Component['type']>()
  return doc.components.some((component) => {
    if (seen.has(component.type)) return true
    seen.add(component.type)
    if (component.type === 'mood') {
      const mood = component.payload as MoodPayload
      return typeof mood.score === 'number' || hasText(mood.text)
    }
    if (component.type === 'note') return hasText((component.payload as NotePayload).content)
    if (component.type === 'heading') {
      const title = (component.payload as HeadingPayload).title
      return hasText(title) && title !== date
    }
    return true
  })
}

function hasText(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

// 单日摘要：读 Diary/<date>/plan.json → 组件映射（缺失/坏 JSON 沿用既有 plan 读取错误语义）
export async function readDaySummary(planRoot: string, date: string): Promise<DiaryDaySummary> {
  validateDiaryDate(date)
  const { abs: rootAbs } = resolveWithin(planRoot, '')
  const { abs: diaryAbs } = resolveWithin(rootAbs, DIARY_DIR)
  const { abs: dayAbs } = resolveWithin(rootAbs, `${DIARY_DIR}/${date}`)
  const { abs: planAbs } = resolveWithin(rootAbs, `${DIARY_DIR}/${date}/plan.json`)
  await assertRealPathWithinRoot(rootAbs, diaryAbs, { allowMissing: true })
  await assertRealPathWithinRoot(rootAbs, dayAbs, { allowMissing: true })
  await assertRealPathWithinRoot(rootAbs, planAbs, { allowMissing: true })
  const doc = await repo.readPlan(planRoot, `${DIARY_DIR}/${date}`)
  return { date, components: doc.components.map(toDayComponent) }
}

// 组件 → 摘要条目（label 恒 ''——视图层按 kind 走 i18n；excerpt 规则 = ipc-contract 注释）
function toDayComponent(c: Component): DiaryDayComponent {
  return { kind: c.type, label: '', excerpt: excerptOf(c) }
}

// payload 按 type 收窄读取（plan-types 的 Component 非判别联合，显式断言——与 storage-service.findTask 同法）
function excerptOf(c: Component): string {
  switch (c.type) {
    case 'mood': {
      const score = (c.payload as MoodPayload).score
      return typeof score === 'number' ? String(score) : ''
    }
    case 'note':
    case 'custom':
      return firstLine((c.payload as NotePayload | CustomPayload).content)
    case 'task_list':
      return String((c.payload as TaskListPayload).items?.length ?? 0) // 手改坏 payload 防 TypeError
    case 'task_detail':
      return (c.payload as TaskDetailPayload).title ?? ''
    case 'heading':
      return 'heading'
    default:
      return ''
  }
}

function firstLine(text: string): string {
  if (typeof text !== 'string') return ''
  const idx = text.indexOf('\n')
  return idx === -1 ? text : text.slice(0, idx)
}
