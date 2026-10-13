# 右侧计划标签栏实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to execute this plan task-by-task. Before each task, register exact file ownership in `docs/HANDOFF-CURRENT.md`.
>
> 状态：Task 1–3 已实现并独立审查通过；Task 4 自动回归已提交 `76578c5d60d72dc4515678e36e82e6f643c574fa`，聚焦/全量测试、typecheck 与 build 通过。当前待完成 fresh scoped review 和隔离 Electron 用户路径验收。创建日期：2026-09-30。此计划是三项已确认功能中的第一阶段；计划引用本计划提供的标签激活与组件聚焦入口。

**Goal:** 在右侧内容区同时打开多个计划，以标签切换/关闭，并按计划库保存和恢复工作区状态。

**Architecture:** 主进程通过 `.trace/workspace-tabs.json` 持久化每个库的相对计划路径和活动路径；Renderer 只通过新增的类型化 IPC 读写该状态。单个 `PlanDocument` 仍由既有 `plan-store` 活动编辑，切换标签前先 flush，避免把多文档编辑状态复制成第二套真源。

**Tech Stack:** Electron 44、React 19、TypeScript 5、Zustand 4、Ant Design 5、Vitest；沿用 `PlanRepository` 原子 JSON 写、现有 IPC 白名单、工作区主题 token。

## Global Constraints

- 本计划只实现右侧内容区标签；不改变顶部“计划 / 日记 / 回忆”导航或左侧树语义。
- Renderer 不使用 `fs` / Electron；所有库内状态通过 `shared/ipc-contract.ts`、`src/main/ipc/register.ts` 和 preload 白名单。
- `.trace/workspace-tabs.json` 只存相对路径，不存计划正文；根目录来自主进程当前激活库，不接受 Renderer 传入绝对根路径。
- 标签列表对每个计划库独立；相同计划路径只保留一个标签，树/搜索/文件夹视图重复打开时激活既有标签。
- 标签关闭不删除磁盘计划；切换或关闭活动标签、切库前先通过现有 PlanStore `flush()`，失败则保留原活动标签和编辑内容。
- 文件路径必须经现有路径安全工具验证；设置损坏时不得静默覆写原始配置。
- 所有新增样式使用 workspace 语义 token；键盘可达、有 `:focus-visible`，并尊重 `prefers-reduced-motion`。
- 与 Plan-260930-02 / Plan-260930-03 串行执行；涉及 `ipc-contract.ts`、`preload/index.ts`、`register.ts`、`ContentArea.tsx`、`tree-store.ts` 或 `cards.tsx` 时，前一阶段必须先释放文件所有权。
- 不增加运行依赖，不更新版本，不打包、不推送、不发布；`Resource/pic/` 与 `Resource/vid/` 保持原样。

---

## 批次执行顺序与共享边界

本计划先于引用计划执行，因为普通组件关联需要“打开计划并聚焦组件”的统一工作区入口。实现中每项工作先登记唯一执行者和精确文件；另一智能体可审查，但不得同时修改同一文件。此阶段完成并释放边界后，Plan-260930-02 才能接入导航。

## 文件地图

| 文件 | 职责 |
|---|---|
| `src/shared/workspace-tabs-types.ts` | 库级标签持久化 DTO 与验证形状 |
| `src/main/services/workspace-tabs-service.ts` | 对当前库安全读写、校验和恢复标签文件 |
| `src/shared/ipc-contract.ts`、`src/main/ipc/register.ts`、`src/preload/index.ts` | 增加 workspace-tabs IPC 类型、处理器和白名单 |
| `src/main/index.ts` | 装配标签服务并注入 IPC |
| `src/renderer/src/stores/workspace-tabs-store.ts` | 标签状态机、持久化、活动计划加载及失效路径清理 |
| `src/renderer/src/stores/plan-store.ts` | 仅为安全标签切换提供可靠 flush 结果与事务式 open 结果；保持现有 CAS/冲突重放逻辑 |
| `src/renderer/src/components/PlanTabs.tsx` | 右侧标签栏交互和无障碍语义 |
| `ContentArea.tsx`、`PlanTreePanel.tsx`、`tree-store.ts`、`search-store.ts`、`App.tsx` | 统一树/搜索/文件夹/启动/切库的打开路径 |
| `src/renderer/src/styles/plan-tabs.css`、`workspace.css` | 标签栏主题、滚动和减少动态效果 |
| `src/renderer/src/i18n/locales/{zh-CN,en-US}.ts` | 标签、关闭、恢复失败文案 |
| `test/workspace-tabs-service.spec.ts`、`test/workspace-tabs-ipc.spec.ts`、`test/workspace-tabs-store.spec.ts`、`test/plan-tabs.spec.tsx` | 主进程、IPC、状态机和 UI 回归 |

## 接口约定

持久化 DTO 定义在 `workspace-tabs-types.ts`：

```ts
export interface WorkspaceTabsState {
  library_id: string
  open_paths: Array<{ path: string; plan_id?: string }>
  active_path: string | null
}
```

Main service 构造器为 `new WorkspaceTabsService(repo: PlanRepository, getRoot: () => string | null)`，公开 `load(): Promise<WorkspaceTabsState>` 与 `save(state: WorkspaceTabsState): Promise<void>`。`library_id` 来自当前库元数据；IPC 为 `workspace-tabs:get`（无参数读取）和 `workspace-tabs:set`（请求 `{ state: WorkspaceTabsState }`，响应 `null`），set 必须验证 state 的 library_id 与调用时主进程当前库匹配。路径按库内 `/` 分隔的相对路径保存，renderer 绝不提供 root。

Renderer store 暴露 `hydrate(rootKey: string | null)`、`openPlan(path: string, focusComponentId?: string)`、`activate(path: string)`、`closeTab(path: string)`、`remapPrefix(oldPath: string, newPath: string)` 与 `closeUnder(path: string)`。`openPlan` 在成功激活后可按可选组件 ID 聚焦；搜索与后续计划引用复用此接口。

## Task 1 — 建立每库标签持久化与安全 IPC

**Files:**

- Create: `src/shared/workspace-tabs-types.ts`
- Create: `src/main/services/workspace-tabs-service.ts`
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Test: `test/workspace-tabs-service.spec.ts`
- Test: `test/workspace-tabs-ipc.spec.ts`

**Interfaces:**

- Consumes: `PlanRepository.writeAppJson`、`resolveWithin`、`PlanRepository.hasPlanFile`、现有 `Channels` 和 preload 的 `ALLOWED_PREFIXES`。
- Produces: `WorkspaceTabsState`、`WorkspaceTabsService.load/save`、`workspace-tabs:get/set`。

- [x] **Step 1: 写服务 RED 测试**：临时库 A 保存两个计划路径（目标已有 `plan_id` 时随标签保存）和活动项后能读回；库 B 返回带其自身 `library_id` 的独立空状态；库切换后 A 的延迟保存被拒绝且不写入 B；重复路径和非活动路径作为 active path 均拒绝；配置 JSON 损坏时读取报错且原始字节不变。

```ts
const state = await service.load()
await service.save({ ...state, open_paths: [{ path: 'A' }, { path: 'B' }], active_path: 'B' })
expect(await service.load()).toEqual({ ...state, open_paths: [{ path: 'A' }, { path: 'B' }], active_path: 'B' })
```

- [x] **Step 2: 运行 RED 并确认失败**：`npx vitest run test/workspace-tabs-service.spec.ts`；预期因新 DTO/service 尚不存在而失败。
- [x] **Step 3: 实现 DTO 与服务**：读取/写入 `.trace/workspace-tabs.json`；状态携带当前 `plan-library.json` 的 `library_id`。IPC 保存前比较请求 ID 与主进程当前库 ID，拒绝切库后迟到的旧库写入；旧配置无 ID 或 ID 不匹配时不恢复其标签。用 `resolveWithin` 固定配置路径，用 `normalizeRel` 规范标签相对路径；对每个标签验证 `hasPlanFile`，丢弃已删除项并把不存在的 active path 置空；保留目标已有的 `plan_id`，但不得为标签额外分配计划 ID；写入复用 `repo.writeAppJson` 原子路径。损坏配置不得自动覆盖。
- [x] **Step 4: 接入类型化 IPC**：在 `Channels` 新增 `workspace-tabs:get/set`；注册到 `registerIpc` 并由 `main/index.ts` 注入服务；preload 只开放 `workspace-tabs:`，新增测试确认未授权通道仍拒绝。
- [x] **Step 5: 运行 GREEN 与提交**：运行 `npx vitest run test/workspace-tabs-service.spec.ts test/workspace-tabs-ipc.spec.ts`，确认全绿后提交 `feat(workspace-tabs): persist per-library tab state`。

**Done when:** 状态只落入当前库 `.trace`，路径受限且损坏配置不被覆盖；两条通道仅通过 preload 白名单可达。

**Independent review:** APPROVED; Critical 0 / Important 0. One Minor path-link regression-coverage item and two non-blocking observations are tracked for Task 4 in `.superpowers/sdd/Plan-Tabs-Implementation-Plan/task-1-review.md`.

## Task 2 — 建立标签状态机并统一打开入口

**Files:**

- Create: `src/renderer/src/stores/workspace-tabs-store.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/PlanTreePanel.tsx`
- Modify: `src/renderer/src/components/ContentArea.tsx`
- Modify: `src/renderer/src/stores/tree-store.ts`
- Modify: `src/renderer/src/stores/search-store.ts`
- Modify: `src/renderer/src/stores/app-store.ts`
- Modify: `src/renderer/src/stores/plan-store.ts` (narrow dependency extension: transactional open and reliable flush result)
- Test: `test/workspace-tabs-store.spec.ts`
- Test: `test/plan-editing.spec.ts` (regression coverage for the PlanStore transition contract)
- Test: `test/tree-store-move.spec.ts` (review-fix regression for editing during a deferred filesystem move)

**Interfaces:**

- Consumes: Task 1 IPC；`usePlanStore.getState().flush/open/close`；树的 `select/expandTo`。Task 2 also owns a narrow PlanStore extension because current `flush()` swallows errors/returns during in-flight saves, while `open()` clears the current document before loading the target.
- Produces: 单一 `openPlan/activate/closeTab/remapPrefix/closeUnder` 状态机，供标签栏和之后的计划引用复用。

- [x] **Step 1: 写状态机 RED 测试**：重复打开同路径只有一个标签；激活另一标签前调用 `flush`，flush 失败时活动项和编辑文档不变；目标计划读取失败时 `open` 必须保留当前路径与原文档；flush 遇到 in-flight 保存时等待最终结果，保存失败不得切换；关闭当前标签选择左邻、若无则右邻；关闭非活动项不重载计划；rootKey 改变时旧库路径和当前计划不泄漏；应用内移动/重命名按路径前缀更新标签，同时保留已有 `plan_id`；关闭等待 flush 时并发打开也保留最新标签状态。
- [x] **Step 2: 运行 RED**：`npx vitest run test/workspace-tabs-store.spec.ts`；预期缺少 store 行为而失败，并补充目标读取失败、移动后读取失败与并发关闭/打开的 RED 回归。
- [x] **Step 3: 实现可注入端口的 Store 工厂与最小 PlanStore 过渡契约**：公开 `createWorkspaceTabsStore(api)`，端口包含 `load/save/flushPlan/openPlan/closePlan`；`flushPlan/openPlan` 返回布尔结果，状态只保存标签 DTO、rootKey 与恢复状态。激活流程先等待可靠 `flush()`（返回 true 才继续），再通过 `PlanStore.open(path)` 载入；`open` 只在目标读取成功后替换当前路径/文档，失败返回 false 并保留旧状态。仅为该契约更新 `plan-store.ts` 与 `test/plan-editing.spec.ts`，不重构其他保存行为。

```ts
export interface WorkspaceTabsPort {
  load: () => Promise<WorkspaceTabsState>
  save: (state: WorkspaceTabsState) => Promise<void>
  flushPlan: () => Promise<boolean>
  openPlan: (path: string) => Promise<boolean>
  closePlan: () => void
}
```

- [x] **Step 4: 接通所有现有计划打开入口**：树计划行、文件夹内计划项和搜索命中都调用 `openPlan`；纯文件夹仍显示原容器视图且不生成标签；计划 rename/move 调用 `remapPrefix`，计划删除成功后调用 `closeUnder`；搜索定位把 `component_id` 传给聚焦入口。
- [x] **Step 5: 接通启动与切库**：`App` 在 workspace ready/rootKey 变化后调用 `hydrate`；`app-store.setRootDir` 在改变当前库前先 flush；切换库成功后载入新库标签，失败保留旧库编辑态；启动配置没有标签文件时以空标签状态工作，不改写计划文件。
- [x] **Step 6: 运行 GREEN 与提交**：最终定向 `npx vitest run test/workspace-tabs-store.spec.ts test/plan-editing.spec.ts`（2 files / 24 tests）、`npm run typecheck`（node/web）、`npm run test`（51 files / 534 tests）、`git diff --check` 均退出码 0；提交 `9d1f65d941a10fbd4228b83b10588e68ba70e970` (`feat(workspace-tabs): route plan opens through tab store`)。

**Done when:** 从树、文件夹容器和搜索打开计划均复用唯一标签；切换、关闭和切库不会丢失未保存内容或串库。

**Independent review history:** 首轮 `NEEDS-FIX`（Critical 0 / Important 3），详情与复现见 `.superpowers/sdd/Plan-Tabs-Implementation-Plan/task-2-review.md`。修复提交 `585350e0c23670b73c4fa579125edb25f08448ad` 的 fixed-range scoped re-review 已 **APPROVED**（0 Critical / 0 Important）；报告 `.superpowers/sdd/Plan-Tabs-Implementation-Plan/task-2-rereview.md`。非阻断 Minor：启动恢复期间用户发起的计划打开失败时，持久化活动选择暂不自动恢复；标签仍可手动打开，无数据丢失，Task 4 评估。

### Task 2 — Review fix round 1

**Base:** `9d1f65d941a10fbd4228b83b10588e68ba70e970`. Keep the original ten-file Task 2 boundary, and add only the following new regression file plus one narrowly scoped build-config adjustment. Preserve malformed `.trace/workspace-tabs.json` bytes and do not change Task 3 UI.

- Modify: `src/renderer/src/stores/workspace-tabs-store.ts` — recovery/hydrate concurrency, usable session opens after recoverable persistence errors, merge structural changes with latest tab state.
- Modify: `src/renderer/src/stores/plan-store.ts` — preserve active edits and retarget the save path atomically with a successful move/rename.
- Modify: `src/renderer/src/stores/tree-store.ts` — structure-change completion must handle migration/flush failure rather than report a successful move while the active path is stale.
- Modify: `electron.vite.config.ts` — extract only the renderer `workspace-tabs-store.ts` into a named chunk so the existing initial-entry limit remains enforced; do not change the budget threshold, other chunk rules, or dependencies.
- Test: `test/workspace-tabs-store.spec.ts` — deferred restore/open race, error recovery, and concurrent open during `closeUnder` / `remapPrefix`.
- Test: `test/plan-editing.spec.ts` — moved active document remains editable and subsequent saves target the new path.
- Create: `test/tree-store-move.spec.ts` — defer `storage:movePlan`, edit after initial flush, complete move, and assert the active document and persisted content remain recoverable at the new path (or explicit rollback preserves a savable document).

- [x] **Step 7: RED — recoverable restore and structural-operation races**: reproduced restored A being superseded by user-opened B; recoverable restore/load/save failures; malformed config preservation; and concurrent B opens during deferred `closeUnder` / `remapPrefix`. Initial focused runs recorded 7 failures plus the additional save-error recovery failure.
- [x] **Step 8: RED — edit during active-plan move**: delayed move IPC after initial flush, edited the active plan, completed the filesystem move, and verified the document remains editable with latest content saved to the new path; structural migration failures are surfaced.
- [x] **Step 9: GREEN — implement the smallest transactional fixes**: commit `585350e0c23670b73c4fa579125edb25f08448ad`; hydrate merges current session state, structural async continuations use latest state, and active-plan moves gate/retarget saves while preserving edits. Exact seven-file scope is recorded in HANDOFF and `task-2-report.md`.
- [x] **Step 10: preserve and verify the bundle budget**: `npm run build` passed without circular chunk warning; renderer entry 570,927 B (<716,800 B), workspace-tabs chunk 10,022 B; `npx vitest run test/bundle-budget.spec.ts` 3/3 passed. Existing threshold and budget tests unchanged.
- [x] **Step 11: validate and report**: focused + bundle budget 4 files / 36 tests; `npm run typecheck` node/web passed; `npm run test` 52 files / 543 tests passed; `git diff --check` passed. Fix report appended and commit created; fresh scoped independent re-review APPROVED before Task 3.

Fix brief: `.superpowers/sdd/Plan-Tabs-Implementation-Plan/task-2-brief.md` (regenerated from this exact Task 2 section). Fix report appends to `.superpowers/sdd/Plan-Tabs-Implementation-Plan/task-2-report.md`.

## Task 3 — 实现右侧标签栏及响应式交互

**Files:**

- Create: `src/renderer/src/components/PlanTabs.tsx`
- Create: `src/renderer/src/styles/plan-tabs.css`
- Modify: `src/renderer/src/components/ContentArea.tsx`
- Modify: `src/renderer/src/styles/workspace.css`
- Modify: `src/renderer/src/i18n/locales/zh-CN.ts`
- Modify: `src/renderer/src/i18n/locales/en-US.ts`
- Test: `test/plan-tabs.spec.tsx`
- Test: `test/style-boundaries.spec.ts`

**Interfaces:**

- Consumes: Task 2 store 的 `open_paths`、`active_path`、`activate`、`closeTab`。
- Produces: 右侧内容区专属 `PlanTabs`，关闭按钮与活动标签均具备本地化可访问名称。

- [x] **Step 1: 写组件 RED 测试**：先覆盖标签顺序、活动项、激活、关闭不冒泡、可访问名称与键盘入口；实现前 `npx vitest run test/plan-tabs.spec.tsx` 因组件缺失失败（1 suite failed / 0 tests collected）。
- [x] **Step 2: 运行 RED**：确认模块缺失时聚焦套件退出码 1；自审发现 stale/null active path 下 roving keyboard entry 缺口后追加回归。
- [x] **Step 3: 实现 PlanTabs**：按 store 的打开顺序渲染；选中态只读取 `active_path`；点击与关闭只调用既有 store action，关闭阻止冒泡；支持可本地化语义名称、Enter/Space 和 Left/Right/Home/End 键盘交互。
- [x] **Step 4: 接入 ContentArea 与样式**：标签仅在右侧内容区且置于面包屑/画布前；独立 `plan-tabs.css` 经 `workspace.css` 有序入口导入；横向滚动、语义 token、可见焦点和 `prefers-reduced-motion` 已实现。
- [x] **Step 5: 添加中文/英文文案并运行聚焦测试**：`npx vitest run test/plan-tabs.spec.tsx test/style-boundaries.spec.ts` 通过，2 files / 12 tests；样式边界覆盖 720px 横向滚动与 token/动效约束。
- [x] **Step 6: 验证并提交 UI**：`npm run typecheck` 通过；`npm run test` 53 files / 552 tests；`npm run build` 通过（renderer 7,160 modules）；commit diff-check 通过。提交 `6cf131b6743d1c052bc09872034a2f56dd17d2a9`。等待 fresh scoped review。

**Done when:** 标签视觉上只属于右侧内容区；关闭不删计划；窄窗口、键盘、主题及减少动态效果契约均通过。

**Independent review:** APPROVED, Critical 0 / Important 0. Report: `.superpowers/sdd/Plan-Tabs-Implementation-Plan/task-3-review.md`. One non-blocking Minor (focus falls back to body after close) is registered for Task 4.

## Task 4 — 补齐恢复、结构变化和真实窗口回归

**Files:**

- Modify: `src/renderer/src/stores/workspace-tabs-store.ts`
- Modify: `src/main/services/workspace-tabs-service.ts`
- Modify: `src/renderer/src/components/PlanTabs.tsx` (narrow review follow-up: restore keyboard focus to an adjacent tab after close)
- Modify: `src/renderer/src/components/ContentArea.tsx` (only if needed to expose a sensible focus target after closing the last tab)
- Modify: `test/workspace-tabs-service.spec.ts`
- Modify: `test/workspace-tabs-store.spec.ts`
- Modify: `test/plan-tabs.spec.tsx`
- Coordinator-owned synchronization only: this plan Markdown, `plan.json`, `docs/Plan/README.md`, and `docs/HANDOFF-CURRENT.md` (implementation agent must not edit or commit these shared user-owned documents).

**Interfaces:**

- Consumes: Task 1–3 已实现的服务、IPC、store 和 UI。
- Produces: 重启恢复、失效路径处理、应用内移动/重命名、tab 不重复、编辑 flush 的联合验收证据。

- [x] **Step 1: 增补边界 RED 测试**：新增隔离库 `.trace`/计划目录外部 junction、有效根 junction alias、伪造 `plan_id`、恢复顺序/手动重激活，以及活动/最后标签关闭后实际 `document.activeElement` 断言。首次定向运行 36 tests 中 34 passed、2 failed；失败证实两种标签关闭后焦点都回落到 body。
- [x] **Step 2: 运行定向回归并实现缺口**：只修复已复现的焦点问题；相邻标签关闭后焦点移至保留标签，最后标签关闭后聚焦当前内容区入口。Junction/身份/恢复用例均在既有服务/store 逻辑上通过，因此没有无证据修改其生产代码。Task 2 启动选择 Minor 保留为非阻断，手动重新激活恢复标签已有回归验证。
- [x] **Step 3: 完成项目门槛**：聚焦 `3 files / 36 tests`、`npm run typecheck`、全量 `53 files / 559 tests`、`npm run build`（renderer 7,160 modules）、`git diff --check` 均通过。PlantUML happy-dom loopback 输出 `ECONNRESET`，但 Vitest exit 0、全绿。报告：`.superpowers/sdd/Plan-Tabs-Implementation-Plan/task-4-report.md`；提交 `76578c5d60d72dc4515678e36e82e6f643c574fa`。
- [x] **Step 4: Electron 用户路径验收**：在专用 A/B 临时库真实打开 Alpha / Bravo / Charlie，重复打开不重复；Ctrl+F 搜索命中回溯；关闭 Alpha 后 IPC 仍可读原文件；F2 重命名及树拖拽移动后标签路径映射正确；进程重启恢复 A 库标签顺序/活动项；切 B 初始为空、返回 A 状态完整；Win32 将真实 Electron 窗口缩至 720x800，3 标签横向滚动且未越出内容区。证据和启动隔离失误复核见 `.superpowers/sdd/Plan-Tabs-Implementation-Plan/task-4-report.md`，截图 `.superpowers/sdd/Plan-Tabs-Implementation-Plan/qa-720-native-window.png`。Temp QA 根已送回收站，不操作或修改用户默认库计划/日记内容。
- [x] **Step 5: 更新共享计划并审查**：同步本 Markdown、`plan.json`、`docs/Plan/README.md`、`docs/HANDOFF-CURRENT.md`；实现提交 `76578c5d60d72dc4515678e36e82e6f643c574fa`；独立 fixed-range review APPROVED（0 Critical / 0 Important，1 非阻断焦点 Minor）。聚焦 3 files / 36 tests、完整 53 files / 559 tests、typecheck、build 与 diff-check 均通过；真实 Electron 验收完成。

**Done when:** 三跑、独立审查、真实 Electron 用户路径通过；标签状态按库隔离；交接文档记录准确 HEAD、真实验证与一个明确的非阻断焦点 Minor。已完成。

## 交付边界

此计划不包含跨计划引用服务、软链接预览、组件备注、版本更新、Windows 安装包、远端推送或 Release。Task 4 完成后释放所有标签相关文件，随后依次执行 Plan-260930-02 与 Plan-260930-03。
