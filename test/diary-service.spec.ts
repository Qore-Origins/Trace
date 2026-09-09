// DiaryService 测试：幂等 ensure / 模板三件套 / 月枚举聚合口径 / 日摘要映射（真实临时目录）
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  ensureDiaryRoot,
  ensureTodayPage,
  listMonthEntries,
  readDaySummary
} from '../src/main/services/diary-service'
import { todayDateStr } from '../src/shared/validation'
import { TraceError, ERR } from '../src/shared/errors'
import type { PlanDocument } from '../src/shared/plan-types'

let root: string

beforeEach(async () => {
  root = join(tmpdir(), `trace-diary-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
  await fs.mkdir(root, { recursive: true })
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

const UUID32_RE = /^[0-9a-f]{32}$/
const FIXED_ID = '00000000000000000000000000000001'

function dayDir(date: string): string {
  return join(root, 'Diary', date)
}

function sampleDoc(components: PlanDocument['components']): PlanDocument {
  const now = new Date().toISOString()
  return { format_version: '1', created_at: now, updated_at: now, components }
}

// 直接落一个日计划 plan.json（模拟已有日计划目录）
async function writeDayPlan(date: string, doc: PlanDocument): Promise<void> {
  await fs.mkdir(dayDir(date), { recursive: true })
  await fs.writeFile(join(dayDir(date), 'plan.json'), JSON.stringify(doc, null, 2), 'utf8')
}

describe('ensureDiaryRoot', () => {
  it('幂等：重复调用只建一次（返回同一路径）', async () => {
    const p1 = await ensureDiaryRoot(root)
    const p2 = await ensureDiaryRoot(root)
    expect(p1).toBe(p2)
    expect(p1).toBe(join(root, 'Diary'))
    expect((await fs.stat(p1)).isDirectory()).toBe(true)
  })

  it('已存在的 Diary 目录内容不被触碰', async () => {
    await fs.mkdir(join(root, 'Diary'))
    await fs.writeFile(join(root, 'Diary', '用户文件.txt'), '保留我')
    await ensureDiaryRoot(root)
    expect(await fs.readFile(join(root, 'Diary', '用户文件.txt'), 'utf8')).toBe('保留我')
  })
})

describe('ensureTodayPage', () => {
  it('生成模板三件套（heading/mood/note 顺序）且 heading title=今日', async () => {
    const dir = await ensureTodayPage(root)
    expect(dir).toBe(join(root, 'Diary', todayDateStr()))
    const json = JSON.parse(await fs.readFile(join(dir, 'plan.json'), 'utf8')) as PlanDocument
    expect(json.format_version).toBe('1')
    const types = json.components.map((c) => c.type)
    expect(types).toEqual(['heading', 'mood', 'note'])
    const heading = json.components[0].payload as { title: string; size: number }
    expect(heading).toEqual({ title: todayDateStr(), size: 18 })
    const mood = json.components[1].payload as { score: number; text: string; mood_date: string; created_at: string }
    expect(mood.score).toBe(50)
    expect(mood.text).toBe('')
    expect(mood.mood_date).toBe(todayDateStr())
    expect(mood.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const note = json.components[2].payload as { content: string; created_at: string }
    expect(note.content).toBe('')
    expect(note.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    for (const c of json.components) expect(c.id).toMatch(UUID32_RE)
    expect(new Set(json.components.map((c) => c.id)).size).toBe(3)
  })

  it('幂等不覆盖：手改后重复 ensure 内容原样保留', async () => {
    const dir = await ensureTodayPage(root)
    const json = JSON.parse(await fs.readFile(join(dir, 'plan.json'), 'utf8')) as PlanDocument
    // 模拟用户手改：改 heading 标题 + 追加组件 + 改 mood 分数
    const heading = json.components[0]
    ;(heading.payload as { title: string }).title = '手动改过'
    ;(json.components[1].payload as { score: number }).score = 88
    json.components.push({
      id: FIXED_ID,
      type: 'note',
      payload: { content: '用户自己写的', created_at: new Date().toISOString() }
    })
    await fs.writeFile(join(dir, 'plan.json'), JSON.stringify(json, null, 2), 'utf8')

    const again = await ensureTodayPage(root)
    expect(again).toBe(dir)
    const json2 = JSON.parse(await fs.readFile(join(dir, 'plan.json'), 'utf8')) as PlanDocument
    expect((json2.components[0].payload as { title: string }).title).toBe('手动改过')
    expect((json2.components[1].payload as { score: number }).score).toBe(88)
    expect(json2.components.length).toBe(4)
  })
})

describe('listMonthEntries', () => {
  it('空库（无 Diary 目录）返回空数组', async () => {
    expect(await listMonthEntries(root, 2026, 9)).toEqual([])
  })

  it('聚合口径：首张 mood 计分 / 首 note 截断 60 / compCount=组件数', async () => {
    await writeDayPlan(
      '2026-09-01',
      sampleDoc([
        { id: FIXED_ID, type: 'mood', payload: { score: 72, text: '不错', mood_date: '2026-09-01', created_at: '' } },
        {
          id: FIXED_ID,
          type: 'note',
          payload: { content: 'a'.repeat(100), created_at: '' }
        },
        { id: FIXED_ID, type: 'heading', payload: { title: '2026-09-01', size: 18 } }
      ])
    )
    const entries = await listMonthEntries(root, 2026, 9)
    expect(entries).toEqual([
      { date: '2026-09-01', score: 72, notePreview: 'a'.repeat(60), compCount: 3 }
    ])
  })

  it('多 mood 取首张；无 mood 天 score null', async () => {
    await writeDayPlan(
      '2026-09-01',
      sampleDoc([
        { id: FIXED_ID, type: 'mood', payload: { score: 30, text: '', mood_date: '2026-09-01', created_at: '' } },
        { id: FIXED_ID, type: 'mood', payload: { score: 90, text: '', mood_date: '2026-09-01', created_at: '' } }
      ])
    )
    await writeDayPlan(
      '2026-09-02',
      sampleDoc([{ id: FIXED_ID, type: 'note', payload: { content: '只有笔记', created_at: '' } }])
    )
    const entries = await listMonthEntries(root, 2026, 9)
    expect(entries.map((e) => e.date)).toEqual(['2026-09-01', '2026-09-02'])
    expect(entries[0].score).toBe(30)
    expect(entries[1].score).toBeNull()
    expect(entries[1].notePreview).toBe('只有笔记')
  })

  it('坏 JSON 目录跳过；无 plan.json 目录跳过；邻月目录不混入', async () => {
    await writeDayPlan(
      '2026-09-05',
      sampleDoc([{ id: FIXED_ID, type: 'note', payload: { content: '正常', created_at: '' } }])
    )
    // 坏 JSON
    await fs.mkdir(dayDir('2026-09-06'), { recursive: true })
    await fs.writeFile(join(dayDir('2026-09-06'), 'plan.json'), '{"format_version":"1","trunc', 'utf8')
    // 纯文件夹（无 plan.json）
    await fs.mkdir(dayDir('2026-09-07'), { recursive: true })
    // 邻月与非法名目录
    await writeDayPlan(
      '2026-08-31',
      sampleDoc([{ id: FIXED_ID, type: 'note', payload: { content: '上月的', created_at: '' } }])
    )
    await writeDayPlan(
      '2026-10-01',
      sampleDoc([{ id: FIXED_ID, type: 'note', payload: { content: '下月的', created_at: '' } }])
    )
    await fs.mkdir(join(root, 'Diary', 'not-a-date'), { recursive: true })

    const entries = await listMonthEntries(root, 2026, 9)
    expect(entries.map((e) => e.date)).toEqual(['2026-09-05'])
    expect(entries[0].compCount).toBe(1)
  })

  it('月份校验：month 越界或非整数 → VALIDATION(20)', async () => {
    await expect(listMonthEntries(root, 2026, 0)).rejects.toMatchObject({ code: ERR.VALIDATION })
    await expect(listMonthEntries(root, 2026, 13)).rejects.toMatchObject({ code: ERR.VALIDATION })
    await expect(listMonthEntries(root, 2026, 1.5)).rejects.toMatchObject({ code: ERR.VALIDATION })
  })
})

describe('readDaySummary', () => {
  it('满组件映射（label/excerpt 规则）', async () => {
    await writeDayPlan(
      '2026-09-01',
      sampleDoc([
        { id: FIXED_ID, type: 'heading', payload: { title: '2026-09-01', size: 18 } },
        { id: FIXED_ID, type: 'mood', payload: { score: 72.5, text: '不错', mood_date: '2026-09-01', created_at: '' } },
        { id: FIXED_ID, type: 'note', payload: { content: '第一行\n第二行', created_at: '' } },
        { id: FIXED_ID, type: 'custom', payload: { content: '自定义首行\n二', source: 'import' } },
        {
          id: FIXED_ID,
          type: 'task_list',
          payload: { title: '列表', items: [{ id: FIXED_ID, title: 'a', status: 'not_started' }, { id: FIXED_ID, title: 'b', status: 'done' }] }
        },
        {
          id: FIXED_ID,
          type: 'task_detail',
          payload: { title: '单任务', status: 'in_progress', created_at: '' }
        },
        { id: FIXED_ID, type: 'single_plan', payload: { title: '子计划', done: false, created_at: '' } }
      ])
    )
    const summary = await readDaySummary(root, '2026-09-01')
    expect(summary.date).toBe('2026-09-01')
    expect(summary.components).toEqual([
      { kind: 'heading', label: '标题', excerpt: 'heading' },
      { kind: 'mood', label: '', excerpt: '72.5' },
      { kind: 'note', label: '', excerpt: '第一行' },
      { kind: 'custom', label: '', excerpt: '自定义首行' },
      { kind: 'task_list', label: '', excerpt: '2' },
      { kind: 'task_detail', label: '', excerpt: '单任务' },
      { kind: 'single_plan', label: '', excerpt: '' }
    ])
  })

  it('空组件日返回空 components', async () => {
    await writeDayPlan('2026-09-03', sampleDoc([]))
    expect(await readDaySummary(root, '2026-09-03')).toEqual({ date: '2026-09-03', components: [] })
  })

  it('不存在 → PATH_NOT_FOUND(10)；坏 JSON → FORMAT_INVALID(14)', async () => {
    await expect(readDaySummary(root, '2026-09-01')).rejects.toMatchObject({ code: ERR.PATH_NOT_FOUND })
    await fs.mkdir(dayDir('2026-09-02'), { recursive: true })
    await fs.writeFile(join(dayDir('2026-09-02'), 'plan.json'), '{"format_version":"1","trunc', 'utf8')
    await expect(readDaySummary(root, '2026-09-02')).rejects.toBeInstanceOf(TraceError)
    await expect(readDaySummary(root, '2026-09-02')).rejects.toMatchObject({ code: ERR.FORMAT_INVALID })
  })

  it('日期格式校验：非 YYYY-MM-DD → VALIDATION(20)', async () => {
    await expect(readDaySummary(root, '2026/09/01')).rejects.toMatchObject({ code: ERR.VALIDATION })
    await expect(readDaySummary(root, '20260901')).rejects.toMatchObject({ code: ERR.VALIDATION })
    await expect(readDaySummary(root, '2026-9-1')).rejects.toMatchObject({ code: ERR.VALIDATION })
  })
})
