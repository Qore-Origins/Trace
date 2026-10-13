# 组件 Markdown 备注实施计划

> For agentic workers: REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans`, according to the user's chosen execution mode. `docs/HANDOFF-CURRENT.md` is authoritative for file ownership; do not overlap an active owner.
>
> 状态：待实施。创建日期：2026-09-30。依赖 `Plan-260930-01-计划标签栏` 与 `Plan-260930-02-跨计划引用` 完成并释放共享文件；按序实施，不与其并行编辑卡片公共层、计划类型或 IPC。

## 目标

使任意组件都能拥有一段可选 Markdown 备注，并沿用现有注释的渲染、链接和实时编辑体验。备注作为组件次级信息显示在主体之后；空备注显示轻量添加入口；只有用户开始编辑该备注时才挂载 Muya，退出编辑后卸载。

## 架构

- 持久化字段使用公共 `Component.remark?: string`；字段不放进各 payload，任务列表中的每条 `TaskItem` 首期仍不单独增加备注。
- 现有 `NoteMarkdown` 是只读渲染路径；现有 `MuyaNoteEditor`、单编辑器状态与保存/CAS 路径作为实时编辑基础。抽出复用层时必须保留 PlantUML 当前配置、自动渲染/换行设置、语言与链接策略。
- 所有卡片复用 `CardShell` 中的一套备注呈现和编辑控制，不为每张卡常驻一个 Muya 实例。普通 Markdown 渲染不初始化 Muya；计划引用组件本身同样可备注，备注与引用预览彼此独立。
- 备注内容作为当前 `PlanDocument` 的普通编辑操作，经现有 zustand 本地编辑、防抖保存和 CAS flush 持久化；点击卡片外退出编辑时按现有注释组件语义 flush 并卸载，不引入独立 Save/Cancel 工作流；切卡、切库和退出前沿用当前 flush/conflict 保留语义。
- 备注链接与正文链接通过同一个安全外链处理；点击链接必须执行打开行为而非误进入编辑。清空备注时删除 `remark` 属性，而不是保存空白字段。

## 已确认规格

`docs/superpowers/specs/2026-09-30-plan-references-remarks-tabs-design.md`

## 前置条件

- `Plan-260930-01-计划标签栏`、`Plan-260930-02-跨计划引用` 已验收，相关文件边界已释放。
- 已实现的 `plan_reference` 也必须纳入公共 `CardShell` 备注能力；不要在软链接预览的只读原件内部嵌套显示原件的可编辑控制，但可以对本地引用组件自身的 remark 进行编辑。
- 执行前更新 `docs/HANDOFF-CURRENT.md`，逐项登记所有被分配文件与执行者。

## 全局约束

- 不扩展 TaskItem 级别备注，不另建注释组件，不改变现有 NoteCard 内容字段语义。
- Muya 实例按需创建：查看备注、未编辑或仅浏览其他卡片时均不初始化编辑器；退出编辑必须 flush 最新 markdown 并销毁实例。
- 备注编辑使用现有 Markdown 校验上限与安全 Markdown renderer；不允许 HTML 脚本、绕过 `NoteMarkdown` 的不可信 HTML 或未授权外链行为。
- CAS 冲突时由现有 plan-store 重放本地操作，不能丢弃正在编辑的备注；异步 Muya 初始化若发生卡片卸载/计划切换，必须安全取消并 flush/保留最后一次输入。
- 备注展示不得改变同类型卡片主操作、尺寸/布局稳定性或卡片拖动行为；颜色使用 workspace 语义 token，反馈用 `getMessage()` / `getModal()`，新增中英文文案。
- 不更改计划格式版本、不移除既有 `note` 独立组件、不更新版本号或发布产物。

## 接口与状态约定

```ts
interface Component {
  id: string
  type: ComponentType
  payload: ComponentPayload
  remark?: string
}
```

计划 store 复用 `patchComponent(componentId, patch)` 更新单一组件的顶层 `remark`，并使用 `mutate` 的 operation replay/CAS 机制。UI 备注编辑状态使用 `component.id` 作为目标，并且全应用最多一个 remark Muya 编辑器处于活动状态；编辑 NoteCard 正文与组件 remark 时不得同时挂载两个 Muya。

## 实施任务

### Task 1 — 统一备注视图与编辑状态，不改变业务卡片

**Files:**

- Modify: `src/renderer/src/components/cards.tsx`
- Modify: `src/renderer/src/components/cards/CardShell.tsx`
- Modify: `src/renderer/src/stores/note-editor-store.ts`
- Modify: `src/renderer/src/components/muya-note/MuyaNoteEditor.tsx` (only if a shared lifecycle prop is required)
- Modify: `src/renderer/src/components/note-md.tsx` (only if an explicit safe renderer wrapper is required)
- Create: `src/renderer/src/components/cards/ComponentRemark.tsx`
- Create: `src/renderer/src/styles/component-remark.css`
- Modify: `src/renderer/src/i18n/locales/zh-CN.ts`
- Modify: `src/renderer/src/i18n/locales/en-US.ts`
- Modify: `src/renderer/src/styles/workspace.css` (ordered stylesheet import only)
- Test: `test/component-remark.spec.tsx` (new)
- Test: `test/muya-note-integration.spec.tsx`

**Steps:**

1. Add failing view tests for undefined/empty remark showing “添加备注”, nonempty content rendering through `NoteMarkdown`, edit entry, live update, outside-click exit/flush and clear; links still invoke the existing safe link handler and do not trigger edit; ordinary render mounts no Muya.
2. Add lifecycle regression tests that opening one remark mounts exactly one editor, switching its target closes/flushes the previous editor, async mount completion after unmount does not mutate the new plan, and note-body editing cannot run concurrently with remark editing.
3. Run `npx vitest run test/component-remark.spec.tsx test/muya-note-integration.spec.tsx` and record RED. Implement `ComponentRemark` with explicit view/edit modes and one shared active-editor discriminator (`note-body` or `component-remark`, component ID). Use the existing editor options/config and renderer/link handler.
4. As Muya emits changes, patch the component's top-level `remark` through the existing local edit operation; outside click/focus exit flushes `getMarkdown()` before unmount. Clearing all remark content removes `remark`. If component/plan disappears during editing, retain the latest editor text through the existing stale-plan/conflict guard; never apply it to a different component with the same render slot.
5. Add semantic-token styles for secondary content and compact focusable controls; no hard-coded colors and no inline style drift. Localize all control names and editor state labels.
6. Run focused component/Muya tests, `npm run typecheck`, and `git diff --check`; commit `feat(remarks): add lazy markdown remark editor`.

**Done when:** shared view/edit lifecycle is test-covered, ordinary views do not mount Muya, Markdown links remain functional, and live save/clear behavior is explicit.

### Task 2 — 将统一备注接入全部组件卡片

**Files:**

- Modify: `src/renderer/src/components/cards/CardShell.tsx`
- Modify: `src/renderer/src/components/cards/SinglePlanCard.tsx`
- Modify: `src/renderer/src/components/cards/MultiPlanCard.tsx`
- Modify: `src/renderer/src/components/cards/TaskListCard.tsx`
- Modify: `src/renderer/src/components/cards/TaskDetailCard.tsx`
- Modify: `src/renderer/src/components/cards/HeadingCard.tsx`
- Modify: `src/renderer/src/components/cards/MoodCard.tsx`
- Modify: `src/renderer/src/components/cards/FallbackBlock.tsx`
- Modify: `src/renderer/src/components/cards/PlanReferenceCard.tsx`
- Modify: `src/renderer/src/components/cards.tsx`
- Modify: `src/shared/plan-types.ts` (only if prior reference task did not already add `Component.remark`)
- Test: `test/component-remark-cards.spec.tsx` (new)
- Test: `test/style-boundaries.spec.ts`
- Test: `test/transfer-service.spec.ts`

**Steps:**

1. Build a parameterized card test matrix for `single_plan`, `multi_plan`, `task_list`, `task_detail`, `note`, `mood`, `heading`, `custom`, and `plan_reference`: absent remark, existing remark, update, clear. Verify each card renders it exactly once after main content and keeps its primary control available.
2. Add interaction tests confirming TaskList's component remark is not confused with each `TaskItem.note`, the NoteCard body and its component remark are separate values, and the local `plan_reference` remark remains editable while the embedded original preview stays read-only.
3. Run RED for the card matrix. Add one optional remark slot to `CardShell`; all renderers pass their `comp.remark` and update through the common component-id patch method. Keep the FallbackBlock remark on the unknown/custom component shell path rather than creating a special persistence route.
4. Ensure all existing CardShell placements—including NoteCard renderer and plan-reference renderer—use one shared `ComponentRemark`. Preserve card headings, dragging, move/delete controls, checkbox state and the last-child/empty-card spacing contract.
5. Add an architecture boundary assertion that no card renderer imports or constructs Muya directly and that the shared component is the only remark editor mount point. Put feature rules in `component-remark.css`; `workspace.css` remains an ordered import entrypoint. Run tests in the matrix plus `test/style-boundaries.spec.ts`.
6. Verify `.plan` export/import round trips retain top-level `remark` on every component type, including `plan_reference`, without turning embedded preview contents into copied data.
7. Run `npm run typecheck`, `npm run test`, `npm run build`, and `git diff --check`; record exact results and commit `feat(remarks): support markdown remarks on every card`.

**Done when:** every current ComponentType including plan_reference supports an optional component-level remark without duplicating editors or changing the task-item note contract.

### Task 3 — CAS、保存、切换与性能联合回归

**Files:**

- Modify: `src/renderer/src/stores/plan-store.ts` (only to fix a failing remark operation replay/conflict test)
- Modify: `src/renderer/src/stores/note-editor-store.ts`
- Modify: `src/renderer/src/components/PlanTabs.tsx`
- Modify: `src/renderer/src/components/cards/ComponentRemark.tsx`
- Test: `test/plan-editing.spec.ts`
- Test: `test/component-remark.spec.tsx`
- Test: `test/component-remark-cards.spec.tsx`
- Test: `test/plan-tabs.spec.tsx`
- Modify: this plan Markdown and `plan.json`
- Modify: `docs/Plan/README.md` and `docs/HANDOFF-CURRENT.md`

**Steps:**

1. Add tests showing concurrent external change/CAS conflict replays remark edits without overwriting other component changes; switching tabs flushes the edited remark before activating the next plan; failed save leaves editor content available for retry; root switch cannot apply old component text to the new plan.
2. Add a large-card-list test or injected editor factory assertion proving that N non-editing cards instantiate zero Muya editors, and only the selected remark creates one editor; moving focus to another remark destroys/flushes the first before initializing the second.
3. Run focused regression tests as RED, then fix only within this registered boundary. Keep normal renderer stable and avoid re-mounting all cards as the remark field changes; update `patchComponent` only if existing operation replay cannot preserve the new top-level field.
4. Run `npx vitest run test/plan-editing.spec.ts test/component-remark.spec.tsx test/component-remark-cards.spec.tsx test/plan-tabs.spec.tsx`, followed by `npm run typecheck`, `npm run test`, `npm run build`, and `git diff --check`.
5. Use isolated test plans in the actual Electron renderer to verify view → edit → live markdown, save/reopen, cancel, clear, link click, switching between remarks and between plan tabs, light/dark themes, narrow width and reduced motion. Record startup/edit responsiveness and verify no editor is mounted in display-only cards. Do not touch the user's normal library.
6. Obtain an independent read-only review; record exact review findings, verification commands/results, and plan queue mirror state in README/HANDOFF. Do not update version or publish in this plan.

**Done when:** CAS and lifecycle regressions pass, the Muya lazy-mount property is verified, actual renderer behavior matches the existing comment editor, and all task files are released.

## 完成边界

交付为所有计划卡片提供的可选组件级 Markdown 备注；保留现有独立注释卡、任务条目 note 与其语义，不实现条目级备注或第二个 Markdown 内核。版本升级、安装包、GitHub/Gitee 推送与 Release 均不在本计划内。
