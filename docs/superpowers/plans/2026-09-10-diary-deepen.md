# 日记深化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把日记做成一等公民：自动日计划（Diary/<date>/ 幂等生成）+ 顶栏日视图（月历热力/时间线/统计/当日预览）。

**Architecture:** 零契约变更。main 新增 diary-service（根/今日页 ensure + 月枚举聚合摘要），经 IPC `diary` 域暴露；renderer 新增 DiaryView（纯逻辑抽 utils 单测）+ ui-store 视图态 + 顶栏导航。树内 Diary 根走现有 tree 懒加载。

**Tech Stack:** Electron 44 / React 19 / TS 5 / zustand 4 / vitest（Node 环境）/ 现有 tree/cache/plan-repository 服务复用。

## Global Constraints

- 契约零变更：PlanDocument format_version '1'、packages 类型均不动
- 目录名 `Diary`（ASCII）；显示名「日记」（i18n zh/en 双键）
- 幂等守卫：**存在即跳过，只建不补，绝不覆盖用户内容**（ERROR 库 migration-script-not-idempotent 教训）
- IPC 严格三步：shared/ipc-contract.ts 定类型 → main/ipc/register.ts 注册 → preload/index.ts 暴露（另更新 index.d.ts）
- renderer 禁止直触 fs；一切经 ipc-client
- 统计口径：均分/打卡/趋势仅计有 mood 的日（无记录天不按 0 计）；按目录名（日期）为聚合键
- 命名：服务 kebab-case（diary-service.ts）；视图 PascalCase（DiaryView.tsx）；纯逻辑工具 kebab（diary-view-utils.ts）
- typecheck 0 错 + test 全绿为每任务完成门槛；回复中中文、无 emoji
- demo 定稿参照：demo/diary-view-demo.html（周一起始、色块直显分数、无记录日可点、趋势仅连有记录日）

---

### Task 1: IPC 合约（diary 域）+ preload 暴露

**Files:**
- Modify: `src/shared/ipc-contract.ts`（新增 diary 域类型与通道常量）
- Modify: `src/main/ipc/register.ts`（注册 3 个 handler——先留桩实现：返回空数据，Task 2 填真）
- Modify: `src/preload/index.ts` + `src/preload/index.d.ts`（暴露 `diary` 桥）

**Interfaces:**
- Produces（后续任务消费）:
  - `DiaryMonthEntry` `{ date: string; score: number | null; notePreview: string; compCount: number }`（date='YYYY-MM-DD'）
  - `DiaryDaySummary` `{ date: string; components: Array<{ kind: string; label: string; excerpt: string }> }`
  - `IPC_DIARY_ENSURE = 'diary:ensure'`、`IPC_DIARY_MONTH = 'diary:month'`、`IPC_DIARY_DAY = 'diary:day'`
  - 渲染侧 API（preload bridge）：`api.diary.ensure(planRoot: string): Promise<void>` / `api.diary.month(planRoot: string, year: number, month: number): Promise<DiaryMonthEntry[]>`（month=1-12）/ `api.diary.day(planRoot: string, date: string): Promise<DiaryDaySummary>`
  - `diary:month` 请求载荷 `{ planRoot: string; year: number; month: number }`；响应 `{ entries: DiaryMonthEntry[] }`

- [ ] **Step 1: ipc-contract.ts 增类型与通道**

```ts
// 域：diary（日记深化 2026-09-10；契约零变更——日计划仍是普通计划）
export interface DiaryMonthEntry {
  date: string            // 'YYYY-MM-DD'（目录名=聚合键）
  score: number | null    // 当日 mood 卡分数；无 mood 卡为 null（不参与均分/打卡）
  notePreview: string     // 首个 note 组件文首 60 字符；无则 ''
  compCount: number
}
export interface DiaryDayComponent {
  kind: string            // 组件 kind（复用 ComponentType）
  label: string           // 渲染标签（heading=null 用 '标题'；由视图层 i18n 映射；此处可空）
  excerpt: string         // 摘要文本（mood=分数文本；note/custom=首行；task 类=任务数/标题；heading='heading'）
}
export interface DiaryDaySummary {
  date: string
  components: DiaryDayComponent[]
}
export const IPC_DIARY_ENSURE = 'diary:ensure'
export const IPC_DIARY_MONTH = 'diary:month'
export const IPC_DIARY_DAY = 'diary:day'
```

- [ ] **Step 2: 同步 index.d.ts（声明 window.api.diary 三个方法，类型引用 ipc-contract）**

- [ ] **Step 3: register.ts 注册三 handler（桩：esure 空实现、month 返回 { entries: [] }、day 返回组件空数组）——保证 typecheck 通过**

- [ ] **Step 4: preload/index.ts 暴露 `diary: { ensure, month, day }`（invoke 三通道）**

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc-contract.ts src/main/ipc/register.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "feat(contract): diary 域 IPC 合约（ensure/month/day 三通道 + DiaryMonthEntry/DiaryDaySummary）"
```

---

### Task 2: diary-service（核心：ensure/枚举/聚合）

**Files:**
- Create: `src/main/services/diary-service.ts`
- Test: `test/diary-service.spec.ts`

**Interfaces:**
- Consumes: `useStoragePlanRoot()`（现有 config/storage，参考 plan-repository.ts 的根解析）、`loadPlan`/`readPlanJson`（plan-repository 现有导出——以实到 API 为准，若签名不同按实际调整）、`path-safety.ensureInside`、`todayDateStr`（@shared/validation）、`uuid32`（@shared/validation）
- Produces:
  - `ensureDiaryRoot(planRoot: string): Promise<string>`（返回 Diary 路径；幂等）
  - `ensureTodayPage(planRoot: string): Promise<string>`（返回今日页目录；幂等；模板三件套）
  - `listMonthEntries(planRoot: string, year: number, month: number): Promise<DiaryMonthEntry[]>`（聚合：score=当日 mood 卡的 score（首张）；notePreview=首 note 组件内容截断；compCount=组件数）
  - `readDaySummary(planRoot: string, date: string): Promise<DiaryDaySummary>`

- [ ] **Step 1: 写失败测试 test/diary-service.spec.ts**

```ts
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureDiaryRoot, ensureTodayPage, listMonthEntries, readDaySummary } from '../src/main/services/diary-service'

const T = { format_version: '1', title: 'x', components: [] as unknown[], created_at: '', updated_at: '' }

describe('diary-service', () => {
  let root = ''
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'trace-diary-')) })
  afterEach(() => { import('node:fs').then((fs) => fs.rmSync(root, { recursive: true, force: true })) })

  it('ensureDiaryRoot 幂等：重复调用只建一次（secondary 不报错）', async () => {
    const p1 = await ensureDiaryRoot(root)
    const p2 = await ensureDiaryRoot(root)
    expect(p1).toBe(p2)
    expect(existsSync(p1)).toBe(true)
  })

  it('ensureTodayPage 生成模板三件套（heading/mood/note）且幂等不覆盖', async () => {
    const dir = await ensureTodayPage(root)
    const json = JSON.parse(await (await import('node:fs/promises')).readFile(join(dir, 'plan.json'), 'utf-8'))
    expect(json.title).toBe('2026-09-10')           // todayDateStr 实际值按系统；date 未知写 T(调用别 mock 动态日期)
    const kinds = json.components.map((c: { kind: string }) => c.kind)
    expect(kinds).toEqual(['heading', 'mood', 'note'])
    const mood = json.components.find((c: { kind: string }) => c.kind === 'mood')
    expect(mood.payload.score).toBe(50)
    expect(mood.payload.mood_date).toBe(json.title)
    // 幂等：改标题后重复 ensure 不覆盖
    json.title = '手动改过'
    await (await import('node:fs/promises')).writeFile(join(dir, 'plan.json'), JSON.stringify(json))
    await ensureTodayPage(root)
    const json2 = JSON.parse(await (await import('node:fs/promises')).readFile(join(dir, 'plan.json'), 'utf-8'))
    expect(json2.title).toBe('手动改过')
  })
})
```

（注：日期断言用真实 `todayDateStr()` 拼——写测试时导入 `todayDateStr` 而非硬编码 '2026-09-10'）

- [ ] **Step 2: 运行确认失败** `npx vitest run test/diary-service.spec.ts`（函数不存在 → FAIL）

- [ ] **Step 3: 实现 diary-service.ts**（要点：`ensureDiaryRoot`=`join(planRoot,'Diary')` 不存在则 `mkdir`（递归）；`ensureTodayPage`=`Diary/<today>`，无 plan.json 则写模板（title=today，components 三件套：heading 用 `{ title: today, size: 18 }`、mood 用 `{ score: 50, text: '', mood_date: today, created_at: now }`、note 用 `{ content: '', created_at: now }`——按现有 plan-types 实际 payload 字段核对；`created_at`/`updated_at` = ISO now；`uuid32()`）；`listMonthEntries`=枚举 `Diary/2026-09-*` 目录（读 plan.json——无 plan.json 或坏 JSON 跳过该目录），聚合规则见接口；`readDaySummary`=读单日 plan.json → 组件映射）

- [ ] **Step 4: 运行测试至全绿**（含补充：listMonthEntries 的聚合口径用例——有 mood 计分/无 mood 天 score null；notePreview 截断；坏 JSON 目录跳过；readDaySummary 空/满组件）

- [ ] **Step 5: 接入 register.ts——diary:ensure/month/day 三 handler 改为真实现（经 service；planRoot 取自 storage 服务的现根——以现有注册模式查当前 handler 取根方式）**

- [ ] **Step 6: typecheck + 全量 test 绿 + Commit**

```bash
git add src/main/services/diary-service.ts test/diary-service.spec.ts src/main/ipc/register.ts
git commit -m "feat(diary): diary-service 幂等 ensure + 月枚举聚合 + 日摘要（模板三件套/只建不补/坏目录跳过）"
```

---

### Task 3: 视图纯逻辑 utils（月网格 + 统计聚合）

**Files:**
- Create: `src/renderer/src/views/diary-view-utils.ts`
- Test: `test/diary-view-utils.spec.ts`

**Interfaces:**
- Produces:
  - `buildMonthGrid(year: number, month: number): Array<{ day: number | 0 }>`——0 表示占位；周一为一周首（对齐 demo）
  - `aggregateStats(entries: DiaryMonthEntry[]): { avg: number | null; daysCount: number; compCount: number; trend: Array<{ date: string; score: number }> }`
  - `startOfMonth(key: string, year: number, month: number): number`（日期比较辅助，按 'YYYY-MM-DD' ISO 字符串比较）

- [ ] **Step 1: 失败测试**（网格：2026-09 首日=周二 → 前导 1 格、日数 30；统计：7 条 entries 中 6 有分数 1 无 → avg=平均6条、daysCount=6、trend 6 点；空数组 avg null）

- [ ] **Step 2: 运行确认失败**

- [ ] **Step 3: 实现 utils（纯函数、无 React）**

- [ ] **Step 4: 全绿 + Commit**

```bash
git add src/renderer/src/views/diary-view-utils.ts test/diary-view-utils.spec.ts
git commit -m "feat(diary): 月网格/统计聚合纯函数（周一起始；无记录天不按 0 计）"
```

---

### Task 4: DiaryView 组件 + 样式

**Files:**
- Create: `src/renderer/src/views/DiaryView.tsx`
- Modify: `src/renderer/src/styles/workspace.css`（diary 样式节：stats/cal-grid/timeline/day-pre——格局抄 demo 颜色用 token）
- Modify: `src/renderer/src/stores/ui-store.ts`（`view: 'workspace' | 'diary'` + `setView`——检查现有 ui-store 结构后追加，保持默认 workspace）
- Modify: `src/renderer/src/App.tsx`（view==='diary' 时渲染 DiaryView，workspace 照旧——按现有 App 结构接入）

**Interfaces:**
- Consumes: `api.diary.month/day/ensure`（preload 桥）、`usePrefStore`（语言，用于 i18n）、PlanTree 定位动作（Task 5 接线，本任务先渲染）
- Produces: 无（UI 终端）

- [ ] **Step 1: ui-store 加 view 态（含持久化无关——纯 session 态）**

- [ ] **Step 2: DiaryView.tsx**——结构：统计条（均分/打卡/记录/趋势 SVG）→ 月历（`buildMonthGrid` 生成格；每日热力：score 色 `scoreColor` 复用 cards 导出、分数文本、组件数角标；今日高亮={todayDateStr()}；未来置灰（`date > today` 且是今天之后的日期）→ 右列时间线（listMonthEntries 倒序；点选=day 预览）→ 点「在树中打开」调 onOpenInTree(date)（先 console/占位回调 → Task 5 接线）；左/右切月（month 1-12 循环跨年）

- [ ] **Step 3: workspace.css 样式节**（复用 --t-ui 时序；热力格 hover 过渡、格内分数色、时间线项 hover——照 demo class 命名 .diary-*）

- [ ] **Step 4: 挂载即 `api.diary.ensure(root)` + `api.diary.month(root, y, m)`；空态（无记录月）友好提示**

- [ ] **Step 5: typecheck + test + Commit**

```bash
git add src/renderer/src/views/DiaryView.tsx src/renderer/src/stores/ui-store.ts src/renderer/src/App.tsx src/renderer/src/styles/workspace.css
git commit -m "feat(diary): DiaryView 月历/时间线/统计/预览（IPC 取数；demo 定稿布局；diary 视图路由）"
```

---

### Task 5: 顶栏「日记」导航 + 树特殊根标签 + 「在树中打开」接线

**Files:**
- Modify: `src/renderer/src/views/WorkspaceView.tsx`（SettingsModal 区域外：顶栏 nav 区块、「日记」钮 setView('diary')、view==='diary' 时隐藏 content 区切换）
- Modify: `src/renderer/src/components/PlanTreePanel.tsx`（Diary 根特殊标签：节点路径===`Diary` 或显示名映射——按现有 tree-node 渲染加判断，显示 `t('diary.name')` + 蓝标 dot）
- Modify: `src/renderer/src/i18n/locales/zh-CN.ts` + `en-US.ts`（`diary: { name: '日记'/Diary, nav: '日记', monthLabel, emptyMonth, emptyDay, openInTree, summaryLabel, moodLabel, componentLabel }`——对齐 demo 文案）
- Modify: `src/renderer/src/components/ContentArea.tsx` 或树 store（定位开卡——复用搜索回溯动作：查 plan-store 现有 select/openPlan 方法后接「在树中打开」）

**Interfaces:**
- Consumes: `DiaryView` 的 `onOpenInTree(date: string)`——实现为：树定位并打开该日计划（现有回溯树选择 action）

- [ ] **Step 1: i18n 双语文案**

- [ ] **Step 2: 顶栏 nav + view 切换（WorkspaceView）**

- [ ] **Step 3: 树 Diary 标签（PlanTreePanel 路径匹配）**

- [ ] **Step 4: 在树中打开接线（DiaryView → 现有树定位动作）：先 Grep `src/renderer/src/stores/plan-store.ts` 与 `search-store.ts` 的导出，确认“回溯脉冲定位”现有实现（上一批 Sprint 3 搜索定位动作）；DiaryView 的 `onOpenInTree` 复用同一动作（更新树选中态 + 内容区打开该计划），不得新建重复定位逻辑**

- [ ] **Step 5: 全量 typecheck/test + Commit**

```bash
git add src/renderer/src/views/WorkspaceView.tsx src/renderer/src/components/PlanTreePanel.tsx src/renderer/src/components/DiaryView.tsx src/renderer/src/i18n/locales/zh-CN.ts src/renderer/src/i18n/locales/en-US.ts src/renderer/src/components/ContentArea.tsx
git commit -m "feat(diary): 顶栏日记导航 + 树「日记」根标签 + 在树中打开（复用回溯定位）"
```

---

### Task 6: 收尾（BR-007 / 文档 / 全量回归）

**Files:**
- Modify: `CLAUDE.md`（BR-007 追加 + 目录结构 §2.1 补 diary-service）
- Modify: `docs/changelog/CHANGELOG.md`（挂 0.9.1/1.0.0 条目——发布时定；本任务只追加"未发布变更"小节预留）
- Modify: `docs/HANDOFF-*.md`（如需——不强制）

- [ ] **Step 1: CLAUDE.md BR-007 追加**

```yaml
| BR-007 | 日记根自动管理区 | Diary/<YYYY-MM-DD>/ 由 diary-service 幂等维护（只建不补）；显示名「日记」；契约零变更（日计划=普通计划） |
```

- [ ] **Step 2: changelog 未发布节**

- [ ] **Step 3: 全量回归：`npm run typecheck` 0 错 + `npm run test` 全绿 + `npm run dev` 真机冒烟清单（空库引导→日记根出现→今日页模板→顶栏切换→月历数据→点日期预览→在树中打开定位）**

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/changelog/CHANGELOG.md
git commit -m "docs(diary): BR-007 日记根自动管理区 + changelog 预留"
```
