// DiaryService 测试：幂等 ensure / 模板三件套 / 月枚举聚合口径 / 日摘要映射（真实临时目录）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  ensureDiaryRoot,
  ensureTodayPage,
  ensureTodayPageWithResult,
  listMemories,
  listMonthEntries,
  reconcileDiaryPages,
  readDaySummary,
  setDiaryRepo
} from '../src/main/services/diary-service'
import { PlanRepository } from '../src/main/services/plan-repository'
import { todayDateStr } from '../src/shared/validation'
import { TraceError, ERR } from '../src/shared/errors'
import type { Component, MoodPayload, NotePayload, PlanDocument } from '../src/shared/plan-types'

let root: string

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 28, 14))
  setDiaryRepo(new PlanRepository())
  root = join(tmpdir(), `trace-diary-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
  await fs.mkdir(root, { recursive: true })
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  setDiaryRepo(new PlanRepository())
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
  it('reports exactly one lock-internal creator while preserving the string API', async () => {
    const date = '2026-09-28'
    const results = await Promise.all([
      ensureTodayPageWithResult(root, date),
      ensureTodayPageWithResult(root, date)
    ])
    expect(results).toEqual([
      { abs: dayDir(date), created: true },
      { abs: dayDir(date), created: false }
    ])
    expect(await ensureTodayPage(root, date)).toBe(dayDir(date))
    expect(await ensureTodayPageWithResult(root, date)).toEqual({ abs: dayDir(date), created: false })
  })
  it('生成模板三件套（heading/mood/note 顺序）且 heading title=今日', async () => {
    const dir = await ensureTodayPage(root)
    expect(dir).toBe(join(root, 'Diary', todayDateStr()))
    const json = JSON.parse(await fs.readFile(join(dir, 'plan.json'), 'utf8')) as PlanDocument
    expect(json.format_version).toBe('1')
    const types = json.components.map((c) => c.type)
    expect(types).toEqual(['heading', 'mood', 'note'])
    const heading = json.components[0].payload as { title: string; size: number }
    expect(heading).toEqual({ title: todayDateStr(), size: 18 })
    const mood = json.components[1].payload as MoodPayload
    expect(mood.score).toBeNull()
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

describe('reconcileDiaryPages', () => {
  const checkpointPath = (): string => join(root, '.trace', 'diary-automation.json')
  const checkpoint = async (): Promise<unknown> => JSON.parse(await fs.readFile(checkpointPath(), 'utf8'))

  it('空库仅创建 today，回报实际新建日期并持久化 checkpoint', async () => {
    expect(typeof reconcileDiaryPages).toBe('function')
    const result = await reconcileDiaryPages(root, '2026-09-28')
    expect(result).toEqual({ today: '2026-09-28', createdDates: ['2026-09-28'], lastReconciledDate: '2026-09-28' })
    expect(await fs.readdir(join(root, 'Diary'))).toEqual(['2026-09-28'])
    expect(await checkpoint()).toEqual({ format_version: '1', last_reconciled_date: '2026-09-28' })
    const entries = await listMonthEntries(root, 2026, 9)
    expect(entries).toEqual([{ date: '2026-09-28', score: null, notePreview: '', compCount: 3 }])
  })

  it('首跑从最早有效日期补到 today，保持已有 plan 字节与目录附件', async () => {
    expect(typeof reconcileDiaryPages).toBe('function')
    await writeDayPlan('2026-09-25', sampleDoc([{ id: FIXED_ID, type: 'note', payload: { content: '原文', created_at: '' } }]))
    const original = await fs.readFile(join(dayDir('2026-09-25'), 'plan.json'), 'utf8')
    await fs.mkdir(dayDir('2026-09-26'))
    await fs.writeFile(join(dayDir('2026-09-26'), '附件.txt'), '附件不动')
    await fs.mkdir(dayDir('2026-02-31'))
    await fs.mkdir(join(root, 'Diary', 'not-a-date'))
    await fs.writeFile(join(root, 'Diary', '2020-01-01'), '并非目录')
    const result = await reconcileDiaryPages(root, '2026-09-28')
    expect(result.createdDates).toEqual(['2026-09-26', '2026-09-27', '2026-09-28'])
    expect(await fs.readFile(join(dayDir('2026-09-25'), 'plan.json'), 'utf8')).toBe(original)
    expect(await fs.readFile(join(dayDir('2026-09-26'), '附件.txt'), 'utf8')).toBe('附件不动')
    expect(await fs.readdir(dayDir('2026-02-31'))).toEqual([])
  })

  it.each([
    ['2024-02-28', '2024-03-01', ['2024-02-28', '2024-02-29', '2024-03-01']],
    ['2025-02-28', '2025-03-01', ['2025-02-28', '2025-03-01']],
    ['2025-12-31', '2026-01-02', ['2025-12-31', '2026-01-01', '2026-01-02']]
  ])('本地日历边界 %s 到 %s', async (first, today, dates) => {
    expect(typeof reconcileDiaryPages).toBe('function')
    await fs.mkdir(dayDir(first), { recursive: true })
    expect((await reconcileDiaryPages(root, today)).createdDates).toEqual(dates)
  })

  it.each(['2026-02-29', '2026-02-31', '2026-13-01', '2026-00-01', '2026-09-00', '20260928', '../2026-09-28'])('拒绝不真实/非法 today %s，拒绝前不写文件', async (date) => {
    expect(typeof reconcileDiaryPages).toBe('function')
    await expect(reconcileDiaryPages(root, date)).rejects.toMatchObject({ code: ERR.VALIDATION })
    expect(await fs.readdir(root)).toEqual([])
  })

  it('同日重复 reconcile 不改已有内容、不回报已存在日期', async () => {
    expect(typeof reconcileDiaryPages).toBe('function')
    await reconcileDiaryPages(root, '2026-09-28')
    const file = join(dayDir('2026-09-28'), 'plan.json')
    const original = await fs.readFile(file, 'utf8')
    expect((await reconcileDiaryPages(root, '2026-09-28')).createdDates).toEqual([])
    expect(await fs.readFile(file, 'utf8')).toBe(original)
  })

  it('首跑仅有未来日期时只建 today，不修改未来日页', async () => {
    expect(typeof reconcileDiaryPages).toBe('function')
    await writeDayPlan('2026-10-02', sampleDoc([]))
    expect((await reconcileDiaryPages(root, '2026-09-28')).createdDates).toEqual(['2026-09-28'])
    expect((await fs.readdir(join(root, 'Diary'))).sort()).toEqual(['2026-09-28', '2026-10-02'])
  })

  it('checkpoint 后只补其后的日期，已完成但被用户删除的旧日不复活', async () => {
    expect(typeof reconcileDiaryPages).toBe('function')
    await fs.mkdir(dayDir('2026-09-25'), { recursive: true })
    await reconcileDiaryPages(root, '2026-09-27')
    await fs.rm(dayDir('2026-09-26'), { recursive: true })
    expect((await reconcileDiaryPages(root, '2026-09-29')).createdDates).toEqual(['2026-09-28', '2026-09-29'])
    await expect(fs.stat(dayDir('2026-09-26'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await checkpoint()).toEqual({ format_version: '1', last_reconciled_date: '2026-09-29' })
  })

  it('today 即使在 checkpoint 之前也保证存在，时钟回退不降低 checkpoint', async () => {
    expect(typeof reconcileDiaryPages).toBe('function')
    await reconcileDiaryPages(root, '2026-09-29')
    const result = await reconcileDiaryPages(root, '2026-09-28')
    expect(result.createdDates).toEqual(['2026-09-28'])
    expect(result.lastReconciledDate).toBe('2026-09-29')
    expect(await checkpoint()).toEqual({ format_version: '1', last_reconciled_date: '2026-09-29' })
  })

  it.each(['{ broken', '{"format_version":"2","last_reconciled_date":"2026-09-27"}', '{"format_version":"1","last_reconciled_date":"2026-02-31"}', 'null', '{"format_version":"1"}'])('损坏 checkpoint 不覆盖且不写日页：%s', async (raw) => {
    expect(typeof reconcileDiaryPages).toBe('function')
    await fs.mkdir(join(root, '.trace'))
    await fs.writeFile(checkpointPath(), raw)
    await expect(reconcileDiaryPages(root, '2026-09-28')).rejects.toMatchObject({ code: ERR.FORMAT_INVALID })
    expect(await fs.readFile(checkpointPath(), 'utf8')).toBe(raw)
    await expect(fs.stat(join(root, 'Diary'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('合法 null checkpoint 与尚未检查的首跑一致', async () => {
    expect(typeof reconcileDiaryPages).toBe('function')
    await fs.mkdir(join(root, '.trace'))
    await fs.writeFile(checkpointPath(), '{"format_version":"1","last_reconciled_date":null}')
    await fs.mkdir(dayDir('2026-09-27'), { recursive: true })
    expect((await reconcileDiaryPages(root, '2026-09-28')).createdDates).toEqual(['2026-09-27', '2026-09-28'])
  })

  it('局部日页写入失败不推进 checkpoint，重试保留已成功页', async () => {
    expect(typeof reconcileDiaryPages).toBe('function')
    await reconcileDiaryPages(root, '2026-09-25')
    class FailOneDateRepository extends PlanRepository {
      override async writePlanAtomic(planRoot: string, rel: string, doc: PlanDocument): Promise<void> {
        if (rel.startsWith('Diary/2026-09-27/')) throw new TraceError(ERR.SAVE_FAILED, '模拟日页不可写')
        await super.writePlanAtomic(planRoot, rel, doc)
      }
    }
    setDiaryRepo(new FailOneDateRepository())
    await expect(reconcileDiaryPages(root, '2026-09-28')).rejects.toMatchObject({ code: ERR.SAVE_FAILED })
    expect(await checkpoint()).toEqual({ format_version: '1', last_reconciled_date: '2026-09-25' })
    const todayBeforeRetry = await fs.readFile(join(dayDir('2026-09-28'), 'plan.json'), 'utf8')
    const earlierBeforeRetry = await fs.readFile(join(dayDir('2026-09-26'), 'plan.json'), 'utf8')
    setDiaryRepo(new PlanRepository())
    expect((await reconcileDiaryPages(root, '2026-09-28')).createdDates).toEqual(['2026-09-27'])
    expect(await fs.readFile(join(dayDir('2026-09-28'), 'plan.json'), 'utf8')).toBe(todayBeforeRetry)
    expect(await fs.readFile(join(dayDir('2026-09-26'), 'plan.json'), 'utf8')).toBe(earlierBeforeRetry)
    expect(await checkpoint()).toEqual({ format_version: '1', last_reconciled_date: '2026-09-28' })
  })

  it('checkpoint 原子写失败可重试，不重复创建日页', async () => {
    expect(typeof reconcileDiaryPages).toBe('function')
    class FailCheckpointRepository extends PlanRepository {
      override async writeAppJson(): Promise<void> {
        throw new TraceError(ERR.SAVE_FAILED, '模拟 checkpoint 不可写')
      }
    }
    setDiaryRepo(new FailCheckpointRepository())
    await expect(reconcileDiaryPages(root, '2026-09-28')).rejects.toMatchObject({ code: ERR.SAVE_FAILED })
    const original = await fs.readFile(join(dayDir('2026-09-28'), 'plan.json'), 'utf8')
    await expect(fs.stat(checkpointPath())).rejects.toMatchObject({ code: 'ENOENT' })
    setDiaryRepo(new PlanRepository())
    expect((await reconcileDiaryPages(root, '2026-09-28')).createdDates).toEqual([])
    expect(await fs.readFile(join(dayDir('2026-09-28'), 'plan.json'), 'utf8')).toBe(original)
  })

  it('前台 ensure 与后台 reconcile 并发，仅一次写入 today', async () => {
    expect(typeof reconcileDiaryPages).toBe('function')
    let writes = 0
    class CountRepository extends PlanRepository {
      override async writePlanAtomic(planRoot: string, rel: string, doc: PlanDocument): Promise<void> {
        writes += 1
        await new Promise<void>((resolve) => setTimeout(resolve, 10))
        await super.writePlanAtomic(planRoot, rel, doc)
      }
    }
    setDiaryRepo(new CountRepository())
    const today = '2026-09-28'
    await Promise.all([ensureTodayPage(root, today), reconcileDiaryPages(root, today), ensureTodayPage(root, today)])
    expect(writes).toBe(1)
    expect(await listMonthEntries(root, 2026, 9)).toHaveLength(1)
  })

  it('不同 today 的 reconcile 并发，checkpoint 保持较新日期且创建集合无重复', async () => {
    expect(typeof reconcileDiaryPages).toBe('function')
    await fs.mkdir(dayDir('2026-09-26'), { recursive: true })
    const results = await Promise.all([reconcileDiaryPages(root, '2026-09-28'), reconcileDiaryPages(root, '2026-09-29')])
    expect(results.flatMap((result) => result.createdDates)).toEqual(['2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29'])
    expect(await checkpoint()).toEqual({ format_version: '1', last_reconciled_date: '2026-09-29' })
  })

  it('损坏但存在的 plan.json 原文保留', async () => {
    expect(typeof reconcileDiaryPages).toBe('function')
    await fs.mkdir(dayDir('2026-09-27'), { recursive: true })
    await fs.writeFile(join(dayDir('2026-09-27'), 'plan.json'), 'broken user content')
    expect((await reconcileDiaryPages(root, '2026-09-28')).createdDates).toEqual(['2026-09-28'])
    expect(await fs.readFile(join(dayDir('2026-09-27'), 'plan.json'), 'utf8')).toBe('broken user content')
  })

  it('探测不存在之后出现外部 plan.json 时，排他发布保留外部原文', async () => {
    const today = '2026-09-28'
    const userFile = join(dayDir(today), 'plan.json')
    const original = '外部同步刚写入的用户原文'
    let inserted = false
    setDiaryRepo(new PlanRepository({
      renameFn: async (from, target) => {
        if (!inserted && target.endsWith('plan.json')) {
          await fs.writeFile(userFile, original)
          inserted = true
        }
        await fs.rename(from, target)
      }
    }))
    const result = await reconcileDiaryPages(root, today)
    expect(await fs.readFile(userFile, 'utf8')).toBe(original)
    expect(result.createdDates).toEqual([])
    expect(await fs.readdir(dayDir(today))).toEqual(['plan.json'])
    expect(await checkpoint()).toEqual({ format_version: '1', last_reconciled_date: today })
  })

  it('不支持硬链接时停止发布、清理 staging，不能回退到覆盖写', async () => {
    const unsupported = Object.assign(new Error('模拟文件系统不支持硬链接'), { code: 'ENOTSUP' })
    vi.spyOn(fs, 'link').mockRejectedValue(unsupported)
    await expect(reconcileDiaryPages(root, '2026-09-28')).rejects.toBe(unsupported)
    expect(await fs.readdir(dayDir('2026-09-28'))).toEqual([])
    await expect(fs.stat(checkpointPath())).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('回填目录与 checkpoint 写入经 repo 登记内部写', async () => {
    expect(typeof reconcileDiaryPages).toBe('function')
    const marks: string[] = []
    setDiaryRepo(new PlanRepository({ onInternalWrite: (abs) => marks.push(abs) }))
    await reconcileDiaryPages(root, '2026-09-28')
    expect(marks).toContain(join(root, 'Diary'))
    expect(marks).toContain(dayDir('2026-09-28'))
    expect(marks).toContain(checkpointPath())
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

  it('不真实日期目录即使含合法计划也不进入月历', async () => {
    await writeDayPlan('2026-02-31', sampleDoc([{ id: FIXED_ID, type: 'note', payload: { content: '无效日期原文', created_at: '' } }]))
    expect(await listMonthEntries(root, 2026, 2)).toEqual([])
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
      { kind: 'heading', label: '', excerpt: 'heading' },
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

  it('日历真伪校验：2026-02-31 / 2026-13-01 → VALIDATION(20)（清债：此前格式放行）', async () => {
    await expect(readDaySummary(root, '2026-02-31')).rejects.toMatchObject({ code: ERR.VALIDATION })
    await expect(readDaySummary(root, '2026-13-01')).rejects.toMatchObject({ code: ERR.VALIDATION })
  })

  it('坏 payload 守卫：task_list 无 items 时摘要有守卫不炸（清债：TypeError → 笼统 INTERNAL）', async () => {
    await writeDayPlan('2026-09-04', {
      ...sampleDoc([{ id: FIXED_ID, type: 'task_list', payload: { title: '坏列表' } } as unknown as Component])
    })
    const s = await readDaySummary(root, '2026-09-04')
    expect(s.components[0]).toEqual({ kind: 'task_list', label: '', excerpt: '0' })
  })
})

describe('listMemories（F2 回忆视图）', () => {
  // n 天前/后的 'YYYY-MM-DD'（里程碑与那年今日用例随日期漂移保持稳定）
  function shiftDays(n: number): string {
    const d = new Date()
    d.setDate(d.getDate() + n)
    const p = (x: number): string => String(x).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }
  function moodDoc(score: number, date: string): PlanDocument {
    return sampleDoc([{ id: FIXED_ID, type: 'mood', payload: { score, text: '', mood_date: date, created_at: '' } }])
  }

  it('日记根不存在 → 全空结构', async () => {
    expect(await listMemories(root)).toEqual({
      today: todayDateStr(),
      history: [],
      onthisday: [],
      milestones: [],
      random: null
    })
  })

  it('onthisday：往年同月同日按年份降序；今年今天排除', async () => {
    const y1 = shiftDays(-365)
    const y2 = shiftDays(-730)
    await writeDayPlan(y1, moodDoc(66, y1))
    await writeDayPlan(y2, moodDoc(42, y2))
    await writeDayPlan(todayDateStr(), moodDoc(50, todayDateStr()))
    const r = await listMemories(root)
    expect(r.onthisday.map((e) => e.date)).toEqual([y1, y2]) // 近年在前
    expect(r.onthisday[0].score).toBe(66)
  })

  it('milestones：100 天前有记录 → 收录且带 days=100；无记录里程碑不出现', async () => {
    const d100 = shiftDays(-100)
    await writeDayPlan(d100, moodDoc(55, d100))
    const r = await listMemories(root)
    const m = r.milestones.find((x) => x.days === 100)
    expect(m?.date).toBe(d100)
    expect(r.milestones.find((x) => x.days === 200)).toBeUndefined()
  })

  it('random：排除今天，从历史日随机；单条历史日必中该日', async () => {
    const d = shiftDays(-3)
    await writeDayPlan(d, moodDoc(48, d))
    const r = await listMemories(root)
    expect(r.random?.date).toBe(d)
  })

  it('history：保留普通历史日，供“抽一天”覆盖全部过去记录', async () => {
    const ordinaryDay = shiftDays(-3)
    await writeDayPlan(ordinaryDay, moodDoc(48, ordinaryDay))

    const result = await listMemories(root)
    expect('history' in result).toBe(true)
    const history = (result as unknown as { history?: Array<{ date: string }> }).history
    expect(history?.map((entry) => entry.date)).toContain(ordinaryDay)
  })

  it('自动空白日页在月历中可见但不进入任何回忆集合', async () => {
    expect(typeof reconcileDiaryPages).toBe('function')
    const date = shiftDays(-100)
    await reconcileDiaryPages(root, date)
    expect(await listMonthEntries(root, Number(date.slice(0, 4)), Number(date.slice(5, 7)))).toHaveLength(1)
    expect(await listMemories(root)).toEqual({ today: todayDateStr(), history: [], onthisday: [], milestones: [], random: null })
  })

  it.each(['score', 'moodText', 'note', 'extra'] as const)('空白日记添加 %s 后进入回忆', async (change) => {
    expect(typeof reconcileDiaryPages).toBe('function')
    const date = shiftDays(-100)
    await reconcileDiaryPages(root, date)
    const doc = JSON.parse(await fs.readFile(join(dayDir(date), 'plan.json'), 'utf8')) as PlanDocument
    if (change === 'score') (doc.components[1].payload as MoodPayload).score = 0
    if (change === 'moodText') (doc.components[1].payload as MoodPayload).text = '今天有感想'
    if (change === 'note') (doc.components[2].payload as NotePayload).content = '记录'
    if (change === 'extra') doc.components.push({ id: FIXED_ID, type: 'task_list', payload: { title: '', items: [] } })
    await writeDayPlan(date, doc)
    const result = await listMemories(root)
    expect(result.history.map((entry) => entry.date)).toEqual([date])
    expect(result.milestones[0]?.date).toBe(date)
    expect(result.random?.date).toBe(date)
  })

  it('空白和空白字符内容不进入回忆，额外 heading/note 卡算用户记录', async () => {
    await writeDayPlan(shiftDays(-2), sampleDoc([
      { id: FIXED_ID, type: 'heading', payload: { title: shiftDays(-2), size: 18 } },
      { id: FIXED_ID, type: 'mood', payload: { score: null, text: ' \n ', mood_date: shiftDays(-2), created_at: '' } },
      { id: FIXED_ID, type: 'note', payload: { content: ' \n ', created_at: '' } }
    ]))
    expect((await listMemories(root)).history).toEqual([])
    await writeDayPlan(shiftDays(-3), sampleDoc([
      { id: FIXED_ID, type: 'heading', payload: { title: shiftDays(-3), size: 18 } },
      { id: FIXED_ID, type: 'heading', payload: { title: '额外组件', size: 18 } }
    ]))
    expect((await listMemories(root)).history.map((entry) => entry.date)).toEqual([shiftDays(-3)])
  })
})

describe('watch 回声抑制登记（评审 Important-3）', () => {
  it('ensureDiaryRoot / ensureTodayPage 经注入 repo 在 mkdir/写前登记目录（addDir 抑制链路）', async () => {
    const marks: string[] = []
    setDiaryRepo(new PlanRepository({ onInternalWrite: (abs) => marks.push(abs) }))
    try {
      await ensureDiaryRoot(root)
      expect(marks).toContain(join(root, 'Diary'))
      await ensureTodayPage(root)
      expect(marks).toContain(join(root, 'Diary', todayDateStr()))
    } finally {
      setDiaryRepo(new PlanRepository()) // 复位模块级注入，避免污染其他用例
    }
  })

  it('已存在的 Diary 根检查不登记目录前缀，避免吞旧日记的外部编辑事件', async () => {
    await fs.mkdir(join(root, 'Diary'))
    const marks: string[] = []
    setDiaryRepo(new PlanRepository({ onInternalWrite: (abs) => marks.push(abs) }))
    await ensureDiaryRoot(root)
    expect(marks).toEqual([])
  })

  it('已有日期目录补文件只登记 staging/最终文件，不抑制同日附件', async () => {
    const today = '2026-09-28'
    await fs.mkdir(dayDir(today), { recursive: true })
    await fs.writeFile(join(dayDir(today), '附件.md'), '用户附件')
    const marks: string[] = []
    setDiaryRepo(new PlanRepository({ onInternalWrite: (abs) => marks.push(abs) }))
    await ensureTodayPage(root, today)
    expect(marks).not.toContain(dayDir(today))
    expect(marks).toContain(join(dayDir(today), 'plan.json'))
    expect(await fs.readFile(join(dayDir(today), '附件.md'), 'utf8')).toBe('用户附件')
  })

  it('重复成功 reconcile 的只读检查不登记任何内部写', async () => {
    await reconcileDiaryPages(root, '2026-09-28')
    const marks: string[] = []
    setDiaryRepo(new PlanRepository({ onInternalWrite: (abs) => marks.push(abs) }))
    expect((await reconcileDiaryPages(root, '2026-09-28')).createdDates).toEqual([])
    expect(marks).toEqual([])
  })
})
