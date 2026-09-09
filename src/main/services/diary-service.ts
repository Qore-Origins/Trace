// DiaryService：日记根/今日页幂等创建 + 月枚举聚合 + 日摘要
// 幂等守卫（ERROR 库 migration-script-not-idempotent 教训）：存在即跳过，只建不补，绝不覆盖用户内容
// 日计划=普通计划（契约零变更）：读写复用 PlanRepository——原子写/形状校验/错误语义一致
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
import type { DiaryDayComponent, DiaryDaySummary, DiaryMonthEntry } from '../../shared/ipc-contract'
import { ERR, TraceError } from '../../shared/errors'
import { todayDateStr, uuid32 } from '../../shared/validation'
import { PlanRepository } from './plan-repository'
import { resolveWithin } from './path-safety'

export const DIARY_DIR = 'Diary'

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const DATE_FORMAT_RE = /^\d{4}-\d{2}-\d{2}$/
const NOTE_PREVIEW_LEN = 60
const TEMPLATE_HEADING_SIZE = 18
const TEMPLATE_MOOD_SCORE = 50

const repo = new PlanRepository()

// 日记根绝对路径；幂等（recursive mkdir 已存在无副作用，不触碰已有内容）
export async function ensureDiaryRoot(planRoot: string): Promise<string> {
  const { abs } = resolveWithin(planRoot, DIARY_DIR)
  await fs.mkdir(abs, { recursive: true })
  return abs
}

// 今日页目录（Diary/<today>）；无 plan.json 才写模板三件套（heading/mood/note）——已存在绝不覆盖
export async function ensureTodayPage(planRoot: string): Promise<string> {
  const today = todayDateStr()
  const rel = `${DIARY_DIR}/${today}`
  const { abs } = resolveWithin(planRoot, rel)
  if (await repo.hasPlanFile(planRoot, rel)) return abs
  const now = new Date().toISOString()
  const template: PlanDocument = {
    format_version: '1',
    created_at: now,
    updated_at: now,
    components: [
      { id: uuid32(), type: 'heading', payload: { title: today, size: TEMPLATE_HEADING_SIZE } as HeadingPayload },
      {
        id: uuid32(),
        type: 'mood',
        payload: { score: TEMPLATE_MOOD_SCORE, text: '', mood_date: today, created_at: now } as MoodPayload
      },
      { id: uuid32(), type: 'note', payload: { content: '', created_at: now } as NotePayload }
    ]
  }
  await repo.writePlanAtomic(planRoot, rel, template)
  return abs
}

// 月枚举聚合：枚举 Diary/YYYY-MM-* 目录读 plan.json——无 plan.json 或坏 JSON 跳过该日
export async function listMonthEntries(planRoot: string, year: number, month: number): Promise<DiaryMonthEntry[]> {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new TraceError(ERR.VALIDATION, '月份需在 1-12 之间')
  }
  const { abs: diaryAbs } = resolveWithin(planRoot, DIARY_DIR)
  let dirents: Dirent[]
  try {
    dirents = await fs.readdir(diaryAbs, { withFileTypes: true })
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [] // 日记根尚不存在 → 空月
    throw e
  }
  const days = dirents
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => {
      const m = DATE_RE.exec(name)
      return m !== null && Number(m[1]) === year && Number(m[2]) === month
    })
    .sort() // YYYY-MM-DD 字典序=时间序（升序）

  const entries: DiaryMonthEntry[] = []
  for (const name of days) {
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

// 单日摘要：读 Diary/<date>/plan.json → 组件映射（缺失/坏 JSON 沿用既有 plan 读取错误语义）
export async function readDaySummary(planRoot: string, date: string): Promise<DiaryDaySummary> {
  if (typeof date !== 'string' || !DATE_FORMAT_RE.test(date)) {
    throw new TraceError(ERR.VALIDATION, '日期格式无效（需为 YYYY-MM-DD）')
  }
  const doc = await repo.readPlan(planRoot, `${DIARY_DIR}/${date}`)
  return { date, components: doc.components.map(toDayComponent) }
}

// 组件 → 摘要条目（label/excerpt 规则 = ipc-contract DiaryDayComponent 注释）
function toDayComponent(c: Component): DiaryDayComponent {
  return { kind: c.type, label: c.type === 'heading' ? '标题' : '', excerpt: excerptOf(c) }
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
      return String((c.payload as TaskListPayload).items.length)
    case 'task_detail':
      return (c.payload as TaskDetailPayload).title
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
