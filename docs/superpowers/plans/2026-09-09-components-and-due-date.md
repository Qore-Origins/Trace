# 组件扩展 + 计划截止日期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 mood（今日心情 1-100 可小数）、heading（标题字号滑杆）、custom（Markdown 自定义组件+可保存快照预设）三组件，并为每个计划文档增加可选/可清空截止日期。

**Architecture:** 纯数据契约扩展（ComponentType 联合 + PlanDocument 可选字段，向后兼容 format_version '1'），组件渲染走 cards.tsx 现有卡模式，Markdown 复用自研 NoteMarkdown，预设存 pref-store（zustand persist，零新 IPC）；索引按类型加 switch case。

**Tech Stack:** TypeScript 5 / React 19 / zustand 4 / antd 5 / vitest 5；验证：`npm run typecheck` + `npm run test` + `npm run dev`（CDP 9222 冒烟）。

## Global Constraints

- 零新增 npm 依赖（用户明确定向：不装 react-markdown 等；Markdown 渲染只用自研 `note-md.tsx`）
- 契约向后兼容：`format_version: '1'` 不变；旧文档缺 `due_date` 键 = 未设置；未知组件类型降级卡已存在（FallbackBlock）
- 用户决策（spec 2026-09-09）：心情评分=1-100 数字可小数（≤2 位收敛）；标题=字号滑杆 14-32（默认 18）；预设=插入即快照；心情日期默认今天可改；预设第一版无重命名
- 命名/风格：emotion 禁用、PascalCase 组件文件、kebab-case 服务文件、i18n 中英同批、commit 约定式
- 测试基线：typecheck 0 错、100 测试全绿（8 spec 文件）——每任务须保持全绿
- UI 改动必须自测遮挡/越界（用户在真机截图级验收）

---

### Task 1: due_date 契约 + 共享校验（TDD）

**Files:**
- Modify: `src/shared/plan-types.ts`（PlanDocument 加 `due_date?: string`）
- Modify: `src/shared/validation.ts`（新增 `validateDueDate`）
- Test: `test/validation.spec.ts`（新建）

**Interfaces:**
- Produces: `validateDueDate(s: unknown): void`（废弃/非法抛 `TraceError(ERR.VALIDATION, '截止日期格式无效')`；空/undefined 视为"清除"，通过，不抛）
- Produces: `PlanDocument.due_date?: string`（'YYYY-MM-DD'）

- [ ] **Step 1: 写失败测试**

```ts
// test/validation.spec.ts
import { describe, expect, it } from 'vitest'
import { validateDueDate } from '../src/shared/validation'
import { ERR, TraceError } from '../src/shared/errors'

describe('validateDueDate', () => {
  it('合法 YYYY-MM-DD 通过', () => {
    expect(() => validateDueDate('2026-09-10')).not.toThrow()
  })
  it('清除（undefined/空串）通过', () => {
    expect(() => validateDueDate(undefined)).not.toThrow()
    expect(() => validateDueDate('')).not.toThrow()
  })
  it('非法：格式错/不存在日期/非字符串', () => {
    expect(() => validateDueDate('20260910')).toThrow(TraceError)
    expect(() => validateDueDate('2026-13-01')).toThrow(TraceError)
    expect(() => validateDueDate('2026-02-30')).toThrow(TraceError)
    expect(() => validateDueDate(20260910)).toThrow(TraceError)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/validation.spec.ts`
Expected: FAIL（validateDueDate 未定义）

- [ ] **Step 3: 实现**

```ts
// src/shared/validation.ts 追加
// 截止日期：'YYYY-MM-DD'；undefined/'' 表示清除；CLAMP 外一律抛 ERR.VALIDATION
export function validateDueDate(s: unknown): void {
  if (s === undefined || s === '') return // 清除，视为通过
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new TraceError(ERR.VALIDATION, '截止日期格式无效')
  }
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
    throw new TraceError(ERR.VALIDATION, '截止日期无效（该日期不存在）')
  }
}
```

```ts
// src/shared/plan-types.ts PlanDocument 接口内加（位于 components 后）
  due_date?: string // 'YYYY-MM-DD'；undefined=未设置（旧文档缺键即未设置）
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run test/validation.spec.ts` → PASS；`npm run typecheck` → 0 错

- [ ] **Step 5: Commit**

```bash
git add src/shared/plan-types.ts src/shared/validation.ts test/validation.spec.ts
git commit -m "feat(contract): PlanDocument.due_date 可选字段 + validateDueDate（可选可清空）"
```

---

### Task 2: due_date 保存链路 + 计划头部 UI

**Files:**
- Modify: `src/renderer/src/stores/plan-store.ts`（新增 `setDueDate` action，与 patchComponent 同款防抖保存）
- Modify: `src/renderer/src/components/ContentArea.tsx`（计划头部 due_date 行：未设→按钮；已设→date 输入+清除+过期红）
- Modify: `src/renderer/src/styles/workspace.css`（`.due-date` 行样式 + `.due-date.overdue` 警示色）
- Modify: `src/renderer/src/i18n/locales/zh-CN.ts`、`en-US.ts`（`content.dueDateAdd` / `content.dueDateClear` / `content.dueDateOverdue` / `content.dueDateLabel`）

**Interfaces:**
- Consumes: `validateDueDate`（Task 1）、`usePlanStore.getState().document`（PlanDocument，含 due_date）、`saveState`
- Produces: `usePlanStore.getState().setDueDate(due?: string)`——赋值 document.due_date（''/undefined 时删键）+ pendingMutate + 防抖 flush（与 `patchComponent` 同路径）

- [ ] **Step 1: setDueDate**

```ts
// plan-store.ts actions 内追加（Patch 模式同 patchComponent）
setDueDate: (due?: string) =>
  mutate((doc) => {
    if (due) {
      doc.due_date = due
    } else {
      delete doc.due_date // 清空=删键（旧文档兼容：undefined 即未设置）
    }
  })
```

（`mutate` 已做 dirty 标记 + 防抖；错误提示复用现有 flush 弹窗路径，不新增。）

- [ ] **Step 2: ContentArea 计划头部行（在 crumbs 行之后、组件列表渲染之前插入）**

```tsx
// ContentArea.tsx，const { setDueDate } = usePlanStore() 解构
// doc 非空时渲染（doc = usePlanStore((s) => s.document)）
{doc && (
  <div className={`due-date${doc.due_date && doc.due_date < todayStr() ? ' overdue' : ''}`}>
    <span className="due-label">{t('content.dueDateLabel')}</span>
    {doc.due_date ? (
      <>
        <input
          type="date"
          className="due-input"
          value={doc.due_date}
          onChange={(e) => void setDueDate(e.target.value || undefined)}
        />
        <Button size="small" type="text" onClick={() => void setDueDate(undefined)}>
          {t('content.dueDateClear')}
        </Button>
        {doc.due_date < todayStr() && <span className="due-overdue">{t('content.dueDateOverdue')}</span>}
      </>
    ) : (
      <Button size="small" type="text" icon={<CalendarOutlined />} onClick={() => void setDueDate(todayStr())}>
        {t('content.dueDateAdd')}
      </Button>
    )}
  </div>
)}
```

模块级辅助（ContentArea.tsx 内）：

```ts
function todayStr(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
```

i18n 键（中英对照）：

```ts
// zh-CN
content: { dueDateLabel: '截止日期', dueDateAdd: '＋ 截止日期', dueDateClear: '清除', dueDateOverdue: '已过期' }
// en-US
content: { dueDateLabel: 'Due date', dueDateAdd: '＋ Due date', dueDateClear: 'Clear', dueDateOverdue: 'Overdue' }
```

css：

```css
.due-date { display: flex; align-items: center; gap: 8px; padding: 6px 0 2px; font-size: 13px; color: var(--text-3); }
.due-input { font: inherit; color: var(--text-2); border: none; background: transparent; }
.due-input:focus { outline: none; border-bottom: 1px solid var(--trace-500); }
.due-date.overdue .due-input { color: #cf1322; }
.due-overdue { font-size: 12px; color: #cf1322; }
```

- [ ] **Step 3: 验证（typecheck + 单测回归 + CDP 冒烟）**

Run: `npm run typecheck && npm run test` → 0 错 / 100 绿
CDP（`npx electron-vite dev -- --remote-debugging-port=9222` 启动，Node 内置 WebSocket 连 `/json/list` page）：
1. 展开任意计划（`setExpanded(['', 'Daily_Plan'])` + loadChildren）→ 真实点击行打开
2. `Runtime.evaluate` 断言 `.due-date` 存在；点「＋ 截止日期」→ 断言 `.due-input` 值=今天
3. 等待防抖保存（或 evaluate `window.__planStore`——无探针，改用检查磁盘）：`node` 读该计划 `plan.json` 断言 `due_date` 存在；点「清除」→ 再读盘断言键已删
- 注意：改动 `plan-store` 前先 `taskkill //F //IM electron.exe` 清场（单实例锁/端口占用的历史坑）

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/stores/plan-store.ts src/renderer/src/components/ContentArea.tsx src/renderer/src/styles/workspace.css src/renderer/src/i18n/locales/zh-CN.ts src/renderer/src/i18n/locales/en-US.ts
git commit -m "feat(plan): 计划截止日期——计划头部设置/清除/过期警示（due_date 可选字段）"
```

---

### Task 3: 新组件契约 + 校验（TDD）

**Files:**
- Modify: `src/shared/plan-types.ts`（ComponentType 扩 3 值；MoodPayload/HeadingPayload/CustomPayload；ComponentPayload 联合扩）
- Modify: `src/shared/validation.ts`（`validateScore`）
- Test: `test/validation.spec.ts`（追加用例）

**Interfaces:**
- Produces:

```ts
export interface MoodPayload { score: number; text: string; mood_date: string; created_at: string }
export interface HeadingPayload { title: string; size: number }
export interface CustomPayload { content: string; source?: string }
export type ComponentType = 'single_plan' | 'multi_plan' | 'task_list' | 'task_detail' | 'note' | 'mood' | 'heading' | 'custom'
export function validateScore(x: unknown): number // 抛错或返回收敛后数字（0-100，≤2 位小数）
```

- [ ] **Step 1: 追加失败测试（validation.spec.ts）**

```ts
import { validateScore } from '../src/shared/validation'

describe('validateScore', () => {
  it('数字与小数收敛通过', () => {
    expect(validateScore(87.5)).toBe(87.5)
    expect(validateScore(87.123)).toBe(87.12)
    expect(validateScore('50')).toBe(50) // 输入框字符串容错
  })
  it('边界与越界', () => {
    expect(validateScore(0)).toBe(0)
    expect(validateScore(100)).toBe(100)
    expect(() => validateScore(-1)).toThrow(TraceError)
    expect(() => validateScore(101)).toThrow(TraceError)
    expect(() => validateScore('abc')).toThrow(TraceError)
  })
})
```

- [ ] **Step 2: 运行确认失败** → `npx vitest run test/validation.spec.ts` FAIL（validateScore 未定义）

- [ ] **Step 3: 实现**

```ts
// validation.ts 追加
// 心情评分：0-100 数字，可小数（收敛 ≤2 位）
export function validateScore(x: unknown): number {
  const n = typeof x === 'string' && x.trim() !== '' ? Number(x) : (x as number)
  if (typeof n !== 'number' || Number.isNaN(n) || n < 0 || n > 100) {
    throw new TraceError(ERR.VALIDATION, '心情评分需在 0-100 之间')
  }
  return Math.round(n * 100) / 100
}
```

- [ ] **Step 4: 运行确认通过** → vitest PASS + `npm run typecheck` 0 错

- [ ] **Step 5: Commit**

```bash
git add src/shared/plan-types.ts src/shared/validation.ts test/validation.spec.ts
git commit -m "feat(contract): mood/heading/custom 组件契约 + validateScore"
```

---

### Task 4: mood / heading 卡渲染（cards.tsx + 工厂 + 菜单）

**Files:**
- Modify: `src/renderer/src/components/cards.tsx`（MoodCard / HeadingCard + ComponentRenderer 分发）
- Modify: `src/renderer/src/components/ContentArea.tsx`（makeComponent 工厂 3 个新 default；insertItems 扩 3 项）
- Modify: `src/renderer/src/styles/workspace.css`
- Modify: `src/renderer/src/i18n/locales/zh-CN.ts`、`en-US.ts`

**Interfaces:**
- Consumes: `MoodPayload/HeadingPayload`（Task 3）、`validateScore/validateTitle`（Task 3/Task 0）、`usePlanMutations().patchComponent`（现有）
- Produces: 工厂 default（mood: `{ score: 50, text: '', mood_date: today, created_at: now }`；heading: `{ title: '', size: 18 }`；custom: `{ content: '' }`）、`scoreColor(score)` 辅助（模块级导出供测试）

- [ ] **Step 1: scoreColor 辅助 + 工厂 + 菜单项（ContentArea.tsx）**

```ts
// 工厂新增 case（makeComponent switch 内）
case 'mood':
  return { id, type, payload: { score: 50, text: '', mood_date: todayStr(), created_at: now } }
case 'heading':
  return { id, type, payload: { title: '', size: 18 } }
case 'custom':
  return { id, type, payload: { content: '' } }
```

```ts
// insertItems 追加
{ key: 'mood', label: t('content.insertMood') },
{ key: 'heading', label: t('content.insertHeading') },
{ key: 'custom', label: t('content.insertCustom') }
```

- [ ] **Step 2: MoodCard（cards.tsx）**

```tsx
// 心情色阶：≤30 冷灰蓝 → ≥80 暖橙（线性）
export function scoreColor(score: number): string {
  const t = Math.max(0, Math.min(1, (score - 30) / 50))
  const from = [96, 130, 182] // 冷
  const to = [255, 122, 69] // 暖
  const mix = from.map((c, i) => Math.round(c + (to[i] - c) * t))
  return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`
}

function MoodCard({ comp, index, total }: { comp: Component; index: number; total: number }): React.JSX.Element {
  const { t } = useTranslation()
  const { patchComponent } = usePlanMutations()
  const p = comp.payload as MoodPayload
  return (
    <CardShell kind="mood" componentId={comp.id} index={index} total={total} extraClass="mood">
      <div className="mood-row">
        <div className="mood-score" style={{ color: scoreColor(p.score) }}>{p.score}</div>
        <InputNumber
          min={0} max={100} step={1} precision={2}
          className="mood-input"
          value={p.score}
          onChange={(v) => {
            try {
              patchComponent(comp.id, (payload) => { (payload as MoodPayload).score = validateScore(v) })
            } catch {
              // 非法输入静默拒绝（不改 store）
            }
          }}
        />
      </div>
      <Input.TextArea variant="borderless" autoSize placeholder={t('cards.moodPlaceholder')}
        value={p.text}
        onChange={(e) => { validateNoteText(e.target.value, t('cards.moodLabel')); patchComponent(comp.id, (pl) => { (pl as MoodPayload).text = e.target.value }) }} />
      <div className="mood-meta">
        <input type="date" className="mood-date" value={p.mood_date}
          onChange={(e) => { if (e.target.value) patchComponent(comp.id, (pl) => { (pl as MoodPayload).mood_date = e.target.value }) }} />
        <span>{p.created_at.slice(0, 10)}</span>
      </div>
    </CardShell>
  )
}
```

- [ ] **Step 3: HeadingCard（cards.tsx）**

```tsx
function HeadingCard({ comp, index, total }: { comp: Component; index: number; total: number }): React.JSX.Element {
  const { t } = useTranslation()
  const { patchComponent } = usePlanMutations()
  const p = comp.payload as HeadingPayload
  const replace = (fn: (pl: HeadingPayload) => void) => patchComponent(comp.id, fn)
  return (
    <CardShell kind="heading" componentId={comp.id} index={index} total={total} extraClass="heading">
      <Input variant="borderless" placeholder={t('cards.headingPlaceholder')} className="heading-input"
        style={{ fontSize: p.size }}
        maxLength={200}
        value={p.title}
        onChange={(e) => replace((pl) => { pl.title = e.target.value })}
      />
      <div className="heading-tools">
        <Slider min={14} max={32} value={p.size} onChange={(v) => replace((pl) => { pl.size = v })} />
        <span className="heading-size">{p.size}px</span>
      </div>
    </CardShell>
  )
}
```

ComponentRenderer 分发追加：

```ts
case 'mood': return <MoodCard key={x.id} comp={x} index={i} total={components.length} />
case 'heading': return <HeadingCard key={x.id} comp={x} index={i} total={components.length} />
case 'custom': return <CustomCard key={x.id} comp={x} index={i} total={components.length} /> // Task 5 定义
```

（ComponentRenderer 的 switch 结构见 cards.tsx:404-415 现有分发。）

- [ ] **Step 4: CSS（workspace.css 追加）**

```css
.card.mood { border-left: 4px solid var(--split); }
.mood-row { display: flex; align-items: center; gap: 12px; }
.mood-score { font-size: 28px; font-weight: 700; min-width: 56px; text-align: right; font-variant-numeric: tabular-nums; }
.mood-input { width: 120px; }
.mood-meta { display: flex; gap: 12px; align-items: center; font-size: 12px; color: var(--text-4); margin-top: 4px; }
.mood-date { font: inherit; border: none; background: transparent; color: var(--text-3); }
.card.heading { padding-top: 4px; padding-bottom: 4px; }
.heading-input { font-weight: 600; color: var(--text-1); }
.heading-tools { display: flex; align-items: center; gap: 8px; }
.heading-tools .ant-slider { flex: 1; }
.heading-size { font-size: 12px; color: var(--text-4); min-width: 36px; text-align: right; }
```

- [ ] **Step 5: i18n（对照补键）**

```ts
content: { addTask: '＋ 任务', insertMood: '今日心情', insertHeading: '标题', insertCustom: '自定义组件', /* zh */ }
cards: { moodLabel: '心情', moodPlaceholder: '今天的心情怎么样？…', headingPlaceholder: '标题…' }
/* en: insertMood 'Mood today', insertHeading 'Heading', insertCustom 'Custom'，moodLabel 'Mood', moodPlaceholder 'How do you feel today?…', headingPlaceholder 'Title…' */
```

- [ ] **Step 6: 验证**

Run: `npm run typecheck && npm run test` → 全绿
CDP：打开计划 → 顶部「＋」菜单插入 mood/heading → 断言 `.mood-score` 显示 50、`input[type=number]` 可改、日期默认今天；heading 滑杆调整后 `.heading-input` style fontSize 变化；重启 dev 后数据已持久（plan.json 含 payload）

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/cards.tsx src/renderer/src/components/ContentArea.tsx src/renderer/src/styles/workspace.css src/renderer/src/i18n/locales/zh-CN.ts src/renderer/src/i18n/locales/en-US.ts
git commit -m "feat(cards): mood 今日心情/heading 标题组件（工厂+菜单+渲染）"
```

---

### Task 5: MdContent 抽取 + NoteCard 改造 + CustomCard

**Files:**
- Create: `src/renderer/src/components/md-content.tsx`（`MdContent`：content 值受控 + onChange + view/edit 双态，内部用 NoteMarkdown）
- Modify: `src/renderer/src/components/cards.tsx`（NoteCard 改用 MdContent；新增 CustomCard）
- Modify: `src/renderer/src/i18n/locales/zh-CN.ts`、`en-US.ts`（`cards.customSource`：来源预设提示）

**Interfaces:**
- Consumes: `NoteMarkdown`（现有）、`CustomPayload`（Task 3）、`validateNoteText`（现有）
- Produces:

```tsx
export function MdContent(props: {
  content: string
  onChange: (next: string) => void
  placeholder?: string
  allowEmpty?: boolean // 初始空内容=直接编辑态（NoteCard 用 true，CustomCard 用 false）
}): React.JSX.Element
export function CustomCard({ comp, index, total }: { comp: Component; index: number; total: number }): React.JSX.Element
```

- [ ] **Step 1: 创建 MdContent（抽取 NoteCard 现逻辑）**

```tsx
// md-content.tsx
// Markdown 双态内容区：有内容默认渲染（view），空/切编辑进 textarea（edit）
import { useState } from 'react'
import { Button, Input } from 'antd'
import { EditOutlined } from '@ant-design/icons'
import { useTranslation } from '../i18n'
import { NoteMarkdown } from './note-md'

function openLink(url: string): void {
  if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer')
}

export function MdContent(props: { content: string; onChange: (next: string) => void; placeholder?: string; allowEmpty?: boolean }): React.JSX.Element {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(props.allowEmpty !== false && props.content.trim() === '')
  return editing ? (
    <>
      <Input.TextArea variant="borderless" placeholder={props.placeholder ?? t('cards.notePlaceholder')} autoSize
        value={props.content}
        onChange={(e) => props.onChange(e.target.value)} />
      <div className="note-actions">
        <Button size="small" type="text" onClick={() => setEditing(false)}>{t('cards.noteDone')}</Button>
        <span className="note-hint">{t('cards.noteMdHint')}</span>
      </div>
    </>
  ) : (
    <>
      <NoteMarkdown content={props.content} onLink={openLink} />
      <div className="note-actions note-actions-end">
        <Button size="small" type="text" icon={<EditOutlined />} onClick={() => setEditing(true)}>{t('cards.noteEdit')}</Button>
      </div>
    </>
  )
}
```

- [ ] **Step 2: NoteCard 改为使用 MdContent（行为等价）**

```tsx
function NoteCard({ comp, index, total }: { comp: Component; index: number; total: number }): React.JSX.Element {
  const { t } = useTranslation()
  const { patchComponent } = usePlanMutations()
  const p = comp.payload as NotePayload
  return (
    <CardShell kind="note" componentId={comp.id} index={index} total={total} extraClass="note">
      <MdContent
        content={p.content}
        onChange={(next) => {
          validateNoteText(next, t('cards.noteLabel'))
          patchComponent(comp.id, (payload) => { (payload as NotePayload).content = next })
        }}
      />
      <div className="note-time">{p.created_at.slice(0, 10)}</div>
    </CardShell>
  )
}
```

- [ ] **Step 3: CustomCard**

```tsx
function CustomCard({ comp, index, total }: { comp: Component; index: number; total: number }): React.JSX.Element {
  const { t } = useTranslation()
  const { patchComponent } = usePlanMutations()
  const p = comp.payload as CustomPayload
  return (
    <CardShell kind="custom" componentId={comp.id} index={index} total={total} extraClass="custom">
      <MdContent
        content={p.content}
        allowEmpty={false}
        onChange={(next) => {
          validateNoteText(next, t('cards.customLabel'))
          patchComponent(comp.id, (payload) => { (payload as CustomPayload).content = next })
        }}
      />
      {p.source && <div className="custom-source">{t('cards.customSource', { source: p.source })}</div>}
    </CardShell>
  )
}
```

- [ ] **Step 4: i18n**

```ts
/* zh */ cards: { customLabel: '自定义', customSource: '来自预设「{{source}}」' }
/* en */ cards: { customLabel: 'Custom', customSource: 'From preset "{{source}}"' }
```

css（workspace.css）：`.custom-source { font-size: 11px; color: var(--text-4); margin-top: 2px; }`

- [ ] **Step 5: 验证**

Run: `npm run typecheck && npm run test` → 全绿（note-md 现有 8 用例保绿=NoteCard 改造行为等价）
CDP：打开含代码块的计划（如 `Daily_Plan/Daily_Plan-20260825-心情差迭代期`）→ note 仍渲染 `<pre><code>`（回归）；插入 custom → 写完 md 后「完成」→ `.note-md` 渲染代码块；记事回归通过后进下一步

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/md-content.tsx src/renderer/src/components/cards.tsx src/renderer/src/styles/workspace.css src/renderer/src/i18n/locales/zh-CN.ts src/renderer/src/i18n/locales/en-US.ts
git commit -m "feat(cards): MdContent 双态抽取（note 回归等价）+ custom 自定义组件卡"
```

---

### Task 6: 自定义组件预设（pref-store + 对话框参数化 + 菜单子菜单/保存为预设）

**Files:**
- Modify: `src/renderer/src/stores/pref-store.ts`（`customPresets` + `addPreset`/`removePreset`）
- Modify: `src/renderer/src/stores/ui-store.ts`（NameDialogType 扩 `customize` 扩展位 + `openNameDialog` 支持）
- Modify: `src/renderer/src/components/NameDialogModal.tsx`（按 customize 分支：校验/文案/提交动作）
- Modify: `src/renderer/src/components/ContentArea.tsx`（「自定义组件」子菜单：预设列表+新建；CustomCard 卡内"保存为预设"——经 ui-store 广播触发）
- Modify: `src/renderer/src/components/cards.tsx`（CustomCard 追加"保存为预设"按钮）
- Modify: `src/renderer/src/i18n/locales/zh-CN.ts`、`en-US.ts`（预设相关文案键）

**Interfaces:**
- Produces (pref-store):

```ts
export interface CustomPreset { id: string; name: string; content: string }
// PrefState 新增: customPresets: CustomPreset[]; addPreset: (name: string, content: string)=>void; removePreset: (id: string)=>void
```

- Produces (ui-store): `openNameDialog(opts)` 增可选 `customize?: { titleKey: string; placeholderKey: string; okTextKey: string; validate: (s: string) => string | null; onSubmit: (name: string) => Promise<void> }`；`NameDialogModal` 在 customize 存在时走该分支（submit/输入校验/文案），否则旧路径

- [ ] **Step 1: pref-store**

```ts
// PrefState 增
customPresets: CustomPreset[]
// actions 增
addPreset: (name, content) => set((s) => ({ customPresets: [...s.customPresets, { id: crypto.randomUUID(), name, content }] }))
removePreset: (id) => set((s) => ({ customPresets: s.customPresets.filter((p) => p.id !== id) }))
// 初始态: customPresets: []
```

- [ ] **Step 2: ui-store 参数化（NameDialogModal 与 openNameDialog）**

```ts
// ui-store.ts: 既有 NameDialogMode 不动，note 上扩展位
export interface NameDialogCustomize {
  titleKey: string
  placeholderKey: string
  okTextKey: string
  validate: (name: string) => string | null // 违规返回消息，空=通过
  onSubmit: (name: string) => Promise<void>
}
// nameDialog 状态型不变；openNameDialog 入参对象型追加 customize?: NameDialogCustomize
```

```tsx
// NameDialogModal.tsx submit 分支：dialog.customize 存在时先 validate（弹 message.error),
// 否则旧逻辑；okText/title/placeholder 依 customize 取 t(customize.key)
const submit = async (): Promise<void> => {
  if (!dialog) return
  const name = value.trim()
  if (customize) {
    const err = customize.validate(name)
    if (err) { message.error(err); return } // message 静态方法已由 F1 修复受管
    await customize.onSubmit(name)
    close()
    return
  }
  // 旧分支不变
}
```

- [ ] **Step 3: ContentArea 菜单（insertItems 的 custom 项改为子菜单）**

```tsx
// 用 Menu.ItemGroup/子菜单:
{
  key: 'custom',
  label: t('content.insertCustom'),
  children: [
    { key: 'custom-new', label: t('content.customNew'), onClick: () => makeComponentAt('custom') },
    ...presets.map((p) => ({ key: `custom-${p.id}`, label: p.name, onClick: () => insertCustomWithPreset(p) })),
  ],
}
// insertCustomWithPreset(p): replaceComponent(makeComponent('custom')) 后 patchComponent 设 content=p.content/source=p.name——即插入快照
```

注意：`insertItems` 现为 antd Dropdown `menu={{ items }}` 结构——子菜单 items 用 `type: 'group'` + children 是合法形态；同时保留顶层「新建自定义组件」（custom-new 已含）。

- [ ] **Step 4: CustomCard「保存为预设」按钮（cards.tsx）**

```tsx
<div className="note-actions">
  <Button size="small" type="text" icon={<SaveOutlined />} onClick={() => {
    const content = (comp.payload as CustomPayload).content
    if (!content.trim()) { message.warning(t('cards.customEmpty')); return }
    useUiStore.getState().openNameDialog({ mode: 'preset', targetPath: '', initialName: '', customize: {
      titleKey: 'dialog.savePreset', placeholderKey: 'dialog.presetNamePlaceholder', okTextKey: 'dialog.saveBtn',
      validate: (name: string) => {
        if (!name.trim()) return t('dialog.presetNameEmpty')
        if (name.trim().length > 60) return t('dialog.presetNameTooLong')
        return null
      },
      onSubmit: async (name: string) => { usePrefStore.getState().addPreset(name.trim(), content) },
    }})
  }}>
    {t('cards.customSavePreset')}
  </Button>
</div>
```

（`mode: 'preset'` 仅为非空判别，NameDialog 对 preset 分支走 customize；ui-store `NameDialogMode` 追加 `'preset'`。）

- [ ] **Step 5: i18n**

```ts
/* zh */ dialog: { savePreset: '保存为预设', presetNamePlaceholder: '预设名称…', saveBtn: '保存', presetNameEmpty: '预设名称不能为空', presetNameTooLong: '预设名称过长（上限 60）' }
         content: { customNew: '新建自定义组件' }
         cards: { customSavePreset: '保存为预设', customEmpty: '内容为空，无法保存预设' }
/* en */ dialog: { savePreset: 'Save as preset', presetNamePlaceholder: 'Preset name…', saveBtn: 'Save', presetNameEmpty: 'Preset name required', presetNameTooLong: 'Preset name too long (max 60)' }
         content: { customNew: 'New custom' }
         cards: { customSavePreset: 'Save as preset', customEmpty: 'Empty content — nothing to save' }
```

- [ ] **Step 6: 验证**

Run: `npm run typecheck && npm run test` → 全绿
CDP：插入 custom → 写内容 → 保存为预设 → 菜单出现预设名 → 点击菜单插入新卡断言 `source` 字段与快照内容 → 修改预设中 content（即改的是独立卡？改预设需二卡场景：预设卡+新快照卡内容独立——断言两卡内容不同）→ localStorage `trace-prefs` 断言有 customPresets → 删除预设条目消失

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/stores/pref-store.ts src/renderer/src/stores/ui-store.ts src/renderer/src/components/NameDialogModal.tsx src/renderer/src/components/ContentArea.tsx src/renderer/src/components/cards.tsx src/renderer/src/i18n/locales/zh-CN.ts src/renderer/src/i18n/locales/en-US.ts
git commit -m "feat(custom): 自定义组件预设（快照插入/保存/删除，pref-store 持久化）"
```

---

### Task 7: 搜索索引 3 类（TDD）

**Files:**
- Modify: `src/main/services/search-service.ts`（indexComponentInto 增 3 case）
- Test: `test/search-service.spec.ts`（追加用例）

**Interfaces:**
- Consumes: `indexPlanInto(path, doc, docs)` 现有（从 `indexComponentInto` 走）
- Produces: 无新导出；行为：mood→scope `note`（text=payload.text）、heading→scope `plan`（text=payload.title）、custom→scope `note`（text=payload.content）

- [ ] **Step 1: 追加失败测试（test/search-service.spec.ts 末尾新 describe。该 spec 为集成形态：beforeEach 建库放语料 → search.start → query 断言；`putDoc(path, partial)` 是现成 helper（Object.assign 后 savePlan））**

```ts
describe('新组件类型索引（mood/heading/custom）', () => {
  it('三类组件入索引且 scope 正确', async () => {
    await putDoc('学期计划', {
      components: [
        { id: 'm1', type: 'mood', payload: { score: 88.5, text: '今天松弛，写了代码', mood_date: '2026-09-09', created_at: '2026-09-09T00:00:00Z' } },
        { id: 'h1', type: 'heading', payload: { title: '溯源计划本', size: 22 } },
        { id: 'x1', type: 'custom', payload: { content: '记录 python 代码片段，含**加粗**', source: '日常' } }
      ]
    })
    search.start(root)
    await waitReady()
    expect(search.query(['松弛']).some((h) => h.scope === 'note' && h.component_id === 'm1')).toBe(true)
    expect(search.query(['溯源计划本']).some((h) => h.scope === 'plan' && h.component_id === 'h1')).toBe(true)
    expect(search.query(['代码片段']).some((h) => h.scope === 'note' && h.component_id === 'x1')).toBe(true)
  })
})
```

- [ ] **Step 2: 运行确认失败**（mood case 缺失 → note_content 未索引）

- [ ] **Step 3: 实现**

```ts
// search-service.ts indexComponentInto case 区追加
case 'mood': {
  const text = `${str('text')} ${str('mood_date')}`.trim()
  if (text) docs.push({ scope: 'note', path, component_id: c.id, text, matched_field: 'note_content', snippetSource: str('text') })
  break
}
case 'heading': {
  const text = str('title')
  if (text) docs.push({ scope: 'plan', path, component_id: c.id, text, matched_field: 'title', snippetSource: text })
  break
}
case 'custom': {
  const text = str('content')
  if (text) docs.push({ scope: 'note', path, component_id: c.id, text, matched_field: 'note_content', snippetSource: text })
  break
}
```

- [ ] **Step 4: 运行确认通过** → `npm run test` 全绿 + typecheck 0 错

- [ ] **Step 5: Commit**

```bash
git add src/main/services/search-service.ts test/search-service.spec.ts
git commit -m "feat(search): mood/heading/custom 索引入口（scope 复用 note/plan 分组）"
```

---

### Task 8: i18n 全量核对 + 全量回归 + 变更文档

**Files:**
- Modify: `src/renderer/src/i18n/locales/zh-CN.ts`、`en-US.ts`（逐键核对批次内全部新增键两语言对齐）
- Docs: `docs/changelog/` 追加本次变更说明（按 Workflow §12 模板简短记录）

**Interfaces:**
- Consumes: 前 7 任务所有 i18n 键（content/cards/dialog 段）

- [ ] **Step 1: 双语言键齐平检查**

用 grep 对照两个 locale 文件同段键名（`grep -oP "(?<=^    [a-zA-Z]+):" zh-CN.ts | sort > a.txt` 与 en-US 对比 diff——本项目曾用同法验收），必含：mood/heading/custom 全卡片文案、due-date 4 键、dialog preset 5 键、content insert 3+新建 1 键，无一多一漏

- [ ] **Step 2: 全量验证** → `npm run typecheck && npm run test`（预期 8 spec / ≥108 用例全绿）

- [ ] **Step 3: 真机冒烟（CDP 全链路）**

启动 dev（先 taskkill 清场）→ 展开树 → 打开含代码块计划（note 回归）→ 插入 mood/heading/custom → custom 保存预设+快照插入 → due_date 设置/清除 → 顶部搜索「心情」（mood 描述命中）+「溯源计划本」（heading 命中）→ 逐项断言后杀掉 dev

- [ ] **Step 4: 变更文档 + Commit**

```bash
git add src/renderer/src/i18n/locales/zh-CN.ts src/renderer/src/i18n/locales/en-US.ts docs/changelog/
git commit -m "feat(i18n): 组件批次中英全量文案 + 变更记录"
```

---

## Self-Review 记录

- **Spec 覆盖**：mood ✓ Task4/7，heading ✓ Task4/7，custom+预设 ✓ Task4/5/6，due_date ✓ Task1/2，搜索 ✓ Task7，i18n ✓ Task2/4/5/6/8，测试策略 ✓ 各任务+Task8（估算 108± 用例）
- **占位检查**：无 TBD；Step 3 中 Menu 子菜单用 antd `items children` 形态（现有 TopBar 菜单同款先例）；`genDoc` 在现有 spec 中若命名为其它则以现名为准（单点微调允许）
- **类型一致性**：`MoodPayload{score,text,mood_date,created_at}` / `HeadingPayload{title,size}` / `CustomPayload{content,source?}` / `setDueDate(due?: string)` / `md-content` 的 `MdContent{content,onChange,placeholder?,allowEmpty?}` 全计划一致；validateScore/validateDueDate 签名 Task1/3 定义一致
- **现有依赖确认**：`Slider/InputNumber/SaveOutlined/CalendarOutlined` 均为 antd 内置（零新依赖）；`message.warning` 静态方法已被 F1 修（主进程侧可依赖）
