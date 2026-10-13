# 跨计划引用实施计划

> For agentic workers: REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans`, according to the user's chosen execution mode. `docs/HANDOFF-CURRENT.md` is authoritative for file ownership; do not overlap an active owner.
>
> 状态：实施中（Task 1–4 已完成并独立审查；Task 5 导入冲突重映射与隔离实窗验收进行中。当前代码基线 `1d09c2d`，精确所有权见 `docs/HANDOFF-CURRENT.md`）。创建日期：2026-09-30。此计划依赖 `Plan-260930-01-计划标签栏` 的工作区打开/聚焦接口；按顺序执行，不与标签计划或组件备注计划并行修改共享文件。

## 目标

允许用户在当前计划库内创建普通计划/组件关联或只读软链接；以稳定 `plan_id` 和现有组件 ID 解析目标，不复制原件。原件重命名、移动、删除时，先让用户了解影响并明确选择；导入、导出和失效目标均可解释且不越过计划库边界。

## 架构

- `PlanDocument.plan_id?: string` 是按需写入的稳定计划身份；旧文件继续可读，不批量迁移。普通链接可指向计划或原生组件；软链接必须指向非 `plan_reference` 原生组件。
- `plan_reference` 组件存放在来源计划中，保存关系类型、目标身份与仅用于显示的名称/路径快照。目标解析只以 `plan_id` / `component.id` 为准，快照从不作为磁盘访问路径。
- 主进程 `PlanReferenceService` 是计划库内目标解析、反向引用枚举、惰性分配 ID 与影响校验的唯一所有者。所有路径经现有 `path-safety.ts`，所有文档写入复用 `PlanRepository` 原子写及现有 CAS/文件监视约定。
- Renderer 通过正式 IPC 获取目标候选、解析目标、预览变更影响及提交用户选择；所有请求携带当前 `library_id` 而不携带 root，主进程在操作前后复核活动库身份和 generation。计划引用卡片以安全占位或只读原件预览呈现，使用 `workspace-tabs` store 导航并聚焦原组件。
- 重命名/删除使用两阶段流程：先返回影响摘要，确认后主进程重读目标和反向引用集合；集合变化则拒绝过期确认并要求重新预览。替换多个来源文件时逐个原子写；任一更新失败即停止，不删除原目标，已成功替换的引用仍有效，重试只处理仍指向旧目标的引用。

## 已确认规格

`docs/superpowers/specs/2026-09-30-plan-references-remarks-tabs-design.md`

## 前置条件

- `Plan-260930-01-计划标签栏` 已完成且文件边界释放。
- `WorkspaceTabsStore.openPlan(path, focusComponentId?)` 已可激活既有标签或打开来源计划并聚焦组件。
- 执行前重新读取 `docs/HANDOFF-CURRENT.md`、本计划及当前分支状态；先登记执行者与精确文件边界。

## 全局约束

- 只支持当前计划库，不支持任意路径、其他库或 Web 地址作为计划引用目标。
- 组件 ID 必须在单个计划内唯一；目标 plan ID 校验为 `uuid32`。坏 JSON、损坏引用或不可读目标降级为局部失效 UI，不崩溃整页。
- 普通关联可指向计划或原生组件；软链接只指向一个非引用原生组件；`plan_reference` 永不作为目标，因而不存在嵌套预览或递归图。
- 路径快照只展示，不用于解析；所有查找按稳定身份从当前库重建，必须拒绝越界 symlink/junction。
- 多文档写入不是跨文件事务。提交前校验全部来源和替代目标，写入失败时目标计划/组件保留且错误反馈可重试。
- 不改 `format_version`、不全库迁移 ID、不更改旧文档字段；导入新功能文档时按本计划重映射内部冲突 ID。
- UI 颜色使用 workspace 语义 token；反馈/确认使用 `getMessage()` / `getModal()`；中英文文案同步。任何 token、原始用户内容或绝对路径不得写入日志/错误反馈。

## 主要类型与接口

共享模型：

```ts
export type PlanReferenceMode = 'link' | 'embed'

export interface PlanReferencePayload {
  mode: PlanReferenceMode
  target_plan_id: string
  target_component_id?: string
  target_path_snapshot: string
  target_name_snapshot: string
}

export interface PlanReferenceTarget {
  plan_id: string
  path: string
  plan_name: string
  component_id?: string
  component_type?: Exclude<ComponentType, 'plan_reference'>
  component_name?: string
}
```

规则：`mode === 'embed'` 时 `target_component_id` 必填；`mode === 'link'` 可不带组件 ID。`target_name_snapshot` 是可编辑的显示名称快照；用户确认同步目标重命名时更新它，选择保留时不变。`PlanDocument.plan_id` 和 `Component.remark` 均为可选扩展字段。引用端不得直接收到含绝对路径的 DTO。

新增 IPC 的精确请求/响应签名在实现时写入 `src/shared/ipc-contract.ts`，至少包含：当前库内目标搜索、按稳定 ID 解析引用、目标变更影响预览、带选择的 rename/delete 提交和组件 rename commit。每个请求包含用于防切库竞态的 `library_id`；`PlanReferenceService` 的 public methods 以这些 DTO 为合约，服务从注入的当前 root 读取库路径，renderer 不能传 root。主进程在异步扫描/写入期间确认 root generation 未变化，过期结果不得继续读写。

## 实施任务

### Task 1 — 建立引用模型与旧文档兼容校验

**Status: completed** — 初始提交 `3c2477d1`；修复提交 `4a44b8f4`、`f52e7dc1`。最终 round 2 聚焦 3 files / 23 tests、全量 54 files / 569 tests、typecheck 与 diff-check 通过；独立复审确认两项 finding 均关闭，0 Critical / 0 Important。报告：`.superpowers/sdd/Cross-Plan-References-Implementation-Plan/task-1-review.md`、`task-1-re-review1.md`、`task-1-re-review2.md`。

**Files:**

- Modify: `src/shared/plan-types.ts`
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/main/services/plan-repository.ts` (validate only the new optional fields at the read boundary; preserve the rest of the legacy document)
- Modify: `src/renderer/src/components/cards/card-registry.tsx` (temporary fallback registration required to keep the persisted component union exhaustive until Task 3)
- Create: `src/shared/plan-reference-types.ts`
- Create: `src/shared/plan-reference-validation.ts`
- Test: `test/plan-reference-validation.spec.ts` (new)
- Test: `test/plan-repository.spec.ts`
- Test: `test/card-registry.spec.tsx` (cover the temporary reference fallback)

The Task 1 registry entry is a safe `FallbackBlock` only; the functional reference renderer and insertion UI remain exclusively in Task 3.

**Steps:**

1. 先为无 `plan_id` / `remark` 的旧计划、有效可选 `plan_id`、普通计划链接、普通组件链接、软链接组件目标、缺失 embed component ID、未知 mode、格式错误 ID、用户可编辑名称快照与 `plan_reference` 作为软链接目标写 RED 测试。另测试 JSON parse/clone 不丢弃新增可选字段。
2. 运行 `npx vitest run test/plan-reference-validation.spec.ts test/plan-repository.spec.ts`，确认新增契约测试因类型/校验逻辑不存在而失败。
3. 增加 `plan_reference` 到 `ComponentType` 与 payload 联合类型；在 `PlanDocument` 增加可选 `plan_id`，在公共 `Component` 增加可选 `remark`，但本任务不实现备注 UI。
4. 实现纯共享校验：`plan_id` / 目标 ID 格式、mode 与 component ID 的关联约束、引用组件禁止作为目标、名称快照长度与文本校验。旧组件没有新字段时必须原样兼容。
5. 在仓库读取边界仅对新字段作类型形状守卫；未知、坏引用不得导致其他组件无法读取。运行聚焦测试与 `npm run typecheck`，提交 `feat(references): define compatible reference model`。

**Done when:** 旧 plan v1 仍读写兼容；引用合法性由共享单测定义；新字段不会被计划读写、克隆和保存静默丢弃。

### Task 2 — 实现按需身份分配、当前库目标目录与安全解析

**Status: completed** — Task 2 initial commit `50f793e7`; fixes `4314b32a`, `d918793d`, `a2fe3088`, `e0f45fa0`. Four independent fix reviews closed the root-switch, same-plan writer, missing child-directory, failed root setup, concurrent window-state write and delayed cold-load findings. Final focused ConfigService+AppService 2 files / 10 tests, full 58 files / 595 tests, node/web typecheck and diff-check passed. Re-review 4 approved, 0 Critical / 0 Important; one optional Minor test idea recorded. Residual: if candidate root persistence applies but reports failure and rollback also fails, memory stays old while disk may retain attempted root. Reports: `task-2-review.md`, `task-2-re-review1.md` to `task-2-re-review4.md`, `task-2-fix-3-report.md`, `task-2-fix-4-report.md`.

**Files:**

- Create: `src/main/services/plan-reference-service.ts`
- Modify: `src/main/services/plan-repository.ts` (only add a safe traversal/read helper if the service cannot use existing public methods)
- Modify: `src/main/index.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/preload/index.ts`
- Test: `test/plan-reference-service.spec.ts` (new)
- Test: `test/plan-reference-ipc.spec.ts` (new)
- Test: `test/plan-repository.spec.ts` (only for any registered helper)

**Steps:**

1. Write temporary-library tests: resolving a legacy target allocates exactly one stable ID only when it becomes a target; re-resolution preserves it; plan/component IDs resolve after same-root rename and move; missing plan/component returns a typed missing result; plan_reference is never returned as an eligible component target; an async resolve begun under library A cannot continue reading/writing after the active root switches to B.
2. Add security tests proving a library-external symlink/junction plan or `plan.json` is rejected for both target search and resolution; malformed plans do not prevent other valid plans from being found; no absolute root is present in renderer DTOs.
3. Run the focused service tests and record the expected RED. Implement a per-current-root service that scans only real plan directories under the active root, calls `resolveWithin` plus real-path containment checks before reading, and builds the reverse-reference map from plan files as a derived index.
4. Assign `plan_id` to a target only when a link/embed is committed; perform that assignment with an atomic `writePlanAtomic` after re-reading its latest document. If the plan already has an ID, never rewrite it just to search or preview. Detect duplicate IDs in the library and return an explicit conflict instead of binding to an arbitrary plan.
5. Add target search/list and stable-ID resolve DTOs. Filter soft-link candidates to ordinary native components and exclude all `plan_reference` cards. Keep the reverse index invalidation tied to successful plan save, append/remove, move, rename, delete, import, and external file-change events; never treat the index as truth.
6. Register only typed IPC channels through `ipc-contract.ts` and preload allowlist. Test unauthorized channel rejection, root omitted from requests, stale `library_id` rejection, and sanitized response shape. Run `npx vitest run test/plan-reference-service.spec.ts test/plan-reference-ipc.spec.ts` and node/web typecheck; commit `feat(references): resolve library-scoped targets safely`.

**Done when:** lazy IDs are stable and library-unique; resolver and reverse references are derived from current safe disk state; paths outside the active plan root cannot be read or disclosed.

### Task 3 — 新建引用卡片、普通跳转与只读软链接

**Status: completed and independently reviewed** — Initial commit `d2e0b70f450d438e8d044d9e0844ad5b98a7ff07`; fixes `3a97d8a8c2ef17741b965548789d13a86007fc58`, `534fc46076166add54cb02eb1b0601d127f6c62c`, and `21caa6fe168a010e62a90eedb30c272c40e7d384`. Round 3 closes the partial Markdown import cache invalidation gap by emitting one tree/reference invalidation after any attempted level write, including failure; no import transaction redesign. Final validation: focused 5 files / 65 tests, `npm run typecheck`, full 60 files / 622 tests, and diff-check passed. Independent review report `task-3-re-review3.md` is APPROVED (0 Critical / 0 Important / 0 new Minor); reviewer reran focused 65/65, typecheck, and exact diff-check. Deferred Minors remain: unavailable/missing/conflict auto-retry; duplicate component IDs can highlight multiple picker rows without incorrect insertion. No manual Electron UI verification yet, reserved for Task 5.

**Fix-round 2 scope:** `src/shared/event-types.ts`, `src/main/ipc/register.ts`, `src/preload/index.ts`, `src/main/services/storage-service.ts`, `src/main/services/transfer-service.ts`, `src/main/services/plan-reference-service.ts`, `src/renderer/src/components/cards/PlanReferenceCard.tsx`, and their five focused specs (`plan-reference-card`, `plan-reference-service`, `storage-service`, `transfer-service`, `plan-reference-ipc`). Ordinary mutations announce only prior/resulting stable plan IDs; rename/move/delete announce valid IDs from the safely traversed subtree; successful `.plan` imports announce valid imported IDs. Embed cards refresh only for matching IDs. The resolver shares a scan and in-flight promise within a root-generation/change-revision key. The round 2 independent review found a new import-failure invalidation finding; fix round 3 commit `21caa6fe` changes `transfer-service.ts` and `test/transfer-service.spec.ts` to invalidate after a failed partial Markdown import.

**Files:**

- Modify: `src/renderer/src/components/ContentArea.tsx`
- Modify: `src/renderer/src/components/cards.tsx`
- Modify: `src/renderer/src/components/cards/card-registry.tsx`
- Modify: `src/renderer/src/components/cards/CardShell.tsx` (only add the localized `plan_reference` kind label; delete-impact workflow remains Task 4)
- Create: `src/renderer/src/components/cards/PlanReferenceCard.tsx`
- Create: `src/renderer/src/components/PlanReferencePicker.tsx`
- Create: `src/renderer/src/styles/plan-reference.css`
- Create: `src/renderer/src/stores/plan-reference-store.ts`
- Modify: `src/renderer/src/stores/plan-store.ts`
- Modify: `src/renderer/src/i18n/locales/zh-CN.ts`
- Modify: `src/renderer/src/i18n/locales/en-US.ts`
- Modify: `src/renderer/src/styles/workspace.css` (ordered stylesheet import only)
- Test: `test/plan-reference-picker.spec.tsx` (new)
- Test: `test/plan-reference-card.spec.tsx` (new)
- Test: `test/plan-editing.spec.ts`
- Modify: `test/style-boundaries.spec.ts` (only add the new feature stylesheet to the ordered workspace import allowlist)

**Steps:**

1. Add picker tests for plan-only versus component target selection, allowed link/embed mode, embed filtering, library-scoped target display, editable display-name snapshot defaulting to the target's current name, cancel without insertion, and preserving the source plan if asynchronous search finishes after a plan switch.
2. Add card tests for ordinary plan navigation, component navigation with focus ID, live embed refresh after target save, “编辑原件” opening/focusing the unique original, no source mutation controls in preview, missing plan/component placeholder, and a broken embed not affecting sibling cards.
3. Run the focused tests as RED. Implement picker around the Task 2 DTOs, and add the insertion entry to the existing component menu. Committing a new reference must first obtain the target's stable ID, then append one local `plan_reference` component using `usePlanMutations`; on any failure, do not leave a half-created card.
4. Implement `PlanReferenceCard`: link mode presents an explicit open action; plan target activates the plan tab; component target activates the plan tab and passes `component_id` for scrolling/focus; embed mode resolves current content through reference store and renders an isolated, read-only renderer with no drag/delete/done interactions. Expose an accessible way to edit the card's display-name snapshot. Do not mount Muya for the embed. Keep `plan-reference.css` as the feature stylesheet and add only its ordered import to `workspace.css`.
5. Ensure refreshed target plans update all visible embeds via stable identity, without re-reading paths from snapshots. Failed or stale resolver requests may update only their originating component/root generation.
6. Use semantic theme tokens, accessible labels and localized loading/missing states. Run `npx vitest run test/plan-reference-picker.spec.tsx test/plan-reference-card.spec.tsx test/plan-editing.spec.ts`, `npm run typecheck`, `npm run test`, and `git diff --check`; commit `feat(references): add link and read-only embed cards`.

**Done when:** users can create both relationships, ordinary links navigate correctly, embeds reflect original changes and stay read-only, and missing targets degrade locally.

### Task 4 — 为引用影响提供可复核的 rename/delete 工作流

**Status: completed and independently reviewed** — Initial commit `0f530f992c2fd0d37dcb8c0c5337b85d108a1e93` (`feat(references): confirm inbound reference changes`) plus fix commit `1d09c2d85359c7b9f87fb3aba256c8d7634e0371`. Final implementation validation: affected 4 suites / 27 tests, `npm run typecheck`, full `npm run test` 64 files / 651 tests, and diff-check passed; IPC queue-order regression was observed RED then GREEN; worktree clean. Independent quality re-review `task-4-re-review.md` APPROVED (0 Critical / 0 Important / 2 Minor); reviewer ran relevant tests 80/80, full suite 651/651, Node/Web typecheck, exact diff-check. Independent security re-review `task-4-security-re-review.md` APPROVED (0 Critical / 0 Important / 0 Minor); reviewer ran focused 5 files / 53 tests, typecheck and exact diff-check. Remaining Minor/residual: canceling plan deletion may move tree focus; a narrow TOCTOU remains for an independent process directly editing library files. Electron focus/motion and import behavior remain in Task 5. Per user direction, agent-feature planning starts next; Task 5 remains open and is not represented as verified.

**Fix-round 1 files:** production `src/main/services/plan-reference-service.ts`, `src/main/services/storage-service.ts`, `src/main/ipc/register.ts`, `src/renderer/src/stores/tree-store.ts`, `src/renderer/src/stores/plan-store.ts`, `src/renderer/src/components/PlanTreePanel.tsx`; tests `test/plan-reference-impact.spec.ts`, `test/plan-reference-component-rename.spec.tsx`, `test/plan-tree-actions.spec.tsx`, `test/storage-service.spec.ts`, and newly registered `test/plan-reference-ipc.spec.ts`. Any further boundary expansion requires coordinator approval before editing.

**Fix-round 1 required regressions (implemented in `1d09c2d`):** edit during delete-animation wait is preserved or deletion aborts; explicit rename cancel restores the old title while CAS/save errors retain drafts; a newly arriving inbound ref during multi-source writes prevents target rename/delete without bypassing the retry semantics; duplicate plan IDs block affected plan-level rename and subtree deletion; raw renderer `storage:savePlan` cannot structurally rename/delete a referenced component, while ordinary content-only saves continue to work; renderer `transfer:importPlan` and `storage:appendComponent` mutations serialize with the same impact queue. User decision: if import is ordered after deletion, external-to-import-subtree references may be preserved as broken; if ordered before deletion, the final inbound recheck must include them. Task 5 owns end-to-end import/remap and broken-state acceptance. Validation complete; independent quality/security scoped re-review is the current gate. Manual Electron UI acceptance remains in Task 5.

**Files:**

- Modify: `src/main/services/plan-reference-service.ts`
- Modify: `src/main/services/storage-service.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/stores/tree-store.ts`
- Modify: `src/renderer/src/stores/plan-store.ts`
- Modify: `src/renderer/src/components/PlanTreePanel.tsx`
- Modify: `src/renderer/src/components/cards/CardShell.tsx`
- Modify: `src/renderer/src/components/cards/SinglePlanCard.tsx`
- Modify: `src/renderer/src/components/cards/MultiPlanCard.tsx`
- Modify: `src/renderer/src/components/cards/TaskListCard.tsx`
- Modify: `src/renderer/src/components/cards/TaskDetailCard.tsx`
- Modify: `src/renderer/src/components/cards/HeadingCard.tsx`
- Create: `src/renderer/src/components/ReferenceImpactDialog.tsx`
- Modify: `src/renderer/src/i18n/locales/zh-CN.ts`
- Modify: `src/renderer/src/i18n/locales/en-US.ts`
- Test: `test/plan-reference-impact.spec.ts` (new)
- Test: `test/storage-service.spec.ts`
- Test: `test/plan-tree-actions.spec.tsx`
- Test: `test/card-shell.spec.tsx`
- Test: `test/plan-reference-component-rename.spec.tsx` (new)
- Test: `test/name-dialog-template.spec.tsx` (update the plan-rename IPC expectation as it moves to the reference impact workflow)
- Modify: `src/shared/plan-reference-types.ts`

**Steps:**

1. RED-test that the active plan flushes before impact preview/commit; plan rename and component rename previews with/without incoming refs; per-reference display update/keep-old/cancel; plan subtree delete excluding references removed with the same subtree; component delete including a surviving inbound reference in the same source plan; replacements validated independently for each ref; embed replacements restricted to native components; stale impact set rejected; write failure leaves delete target intact; retry touches only references still targeting the original.
2. Define a shared component display-name projection from the type's primary title/name (with a localized type fallback for untitled components). Only title-bearing native component types (`single_plan`, `multi_plan`, `task_list`, `task_detail`, `heading`) are renamed through this flow; other target types use localized fallback names. Keep the title input as a draft and commit on blur/Enter through a typed main-process `references:renameComponent` operation. If incoming references exist, show one confirmation before applying the title; Update refreshes reference snapshots, Keep preserves snapshots while stable IDs continue resolving, and Cancel restores the prior title. No-reference renames retain direct behavior. The request carries the expected source `updated_at`; a CAS mismatch retains the draft and asks the user to reload/retry rather than overwriting concurrent edits.
3. Implement typed impact summaries keyed by `source_path + source_component_id`, containing safe display snapshots but no absolute paths or note contents. Plan rename, component rename and deletion display impact only when surviving incoming refs exist. Rename/move keeps stable target IDs. Move requires no extra confirmation.
4. Before rename/delete commit, re-read target, every surviving source and the current reverse index. Compare the affected-reference identity set to the preview; if it changed, return a stale-confirmation result and require a new preview instead of executing against stale data.
5. Validate all replacement targets and source documents before writes. Group edits by source plan so a component rename/delete and any affected refs in that same `plan.json` are committed in one atomic document write; write other source documents one at a time atomically. If any write fails, stop and do not delete the plan/component target; provide a recoverable partial-update error without leaking content or paths. Delete only after every selected update succeeds. Preserve invalid refs only by explicit user choice; show their missing-target state rather than silently deleting them.
6. Route PlanTreePanel rename/delete, title commit points in the listed card components and CardShell delete through this workflow. When an open source/target plan is affected, flush its current editor before preview and reload/rebase after successful main-process mutation; stale save/CAS failures retain user edits and abort the structural operation. Preserve current stale-confirmation guards and keyboard-focus restoration. All dialogs use `getModal()`/`getMessage()`, never antd static methods.
7. Run `npx vitest run test/plan-reference-impact.spec.ts test/plan-reference-component-rename.spec.tsx test/storage-service.spec.ts test/plan-tree-actions.spec.tsx test/card-shell.spec.tsx test/name-dialog-template.spec.tsx`, `npm run typecheck`, `npm run test`, and `git diff --check`; commit `feat(references): confirm inbound reference changes`.

**Done when:** rename, component/plan subtree delete and their cancel/preserve/replace branches match the confirmed design; stale previews cannot authorize a destructive operation; target deletion never continues after an incomplete replacement write.

### Task 5 — 导入冲突重映射、完整回归与真实窗口验收

**Status: completed.** Implementation commit `54e9cacb7e40cf165ccf9e40873abe5e00398bc0` plus renderer race fix `ca378166d72ac6db6a3aaa7ecfdfd20388b3781d`. The implementer verified card tests 19/19, full suite 64 files / 672 tests, `npm run typecheck`, `npm run build`, and `git diff --check`. The cumulative independent review of `1d09c2d..ca37816` approved with 0 Critical / 0 Important findings; the reviewer independently ran transfer/service/picker 48/48 and card tests 19/19. In an isolated Electron library, verified plan/component links and embeds render after tab changes; target navigation and return; rename cancel/keep/update; per-reference replacement and broken-reference preservation; repair of a broken embed; plan rename/move with stable identity; and export/import with an ID collision plus a missing external reference. The renderer race was caused by the active workspace tab being published after the source document; adding `activePath` to the card resolution effect dependencies fixed the stuck loading state. Two non-blocking warnings remain recorded: PlantUML localhost `ECONNRESET` test noise and the existing store circular-chunk build warning. Cross-file writes are not fully transactional and a narrow local filesystem TOCTOU remains documented. The exact disposable QA directory was removed after stopping its isolated Electron/Vite processes. No version, merge, push, installer build, or release work is included.

**Files:**

- Modify: `src/main/services/transfer-service.ts`
- Modify: `src/main/services/plan-reference-service.ts`
- Modify: `src/main/services/storage-service.ts` (only if a shared structural-change notification is needed)
- Modify: `src/renderer/src/stores/plan-reference-store.ts`
- Modify: `src/renderer/src/components/cards/PlanReferenceCard.tsx`
- Modify: `src/renderer/src/components/PlanReferencePicker.tsx`
- Modify: `src/renderer/src/i18n/locales/en-US.ts`
- Modify: `src/renderer/src/i18n/locales/zh-CN.ts`
- Test: `test/transfer-service.spec.ts`
- Test: `test/plan-reference-service.spec.ts`
- Test: `test/plan-reference-card.spec.tsx`
- Test: `test/plan-reference-picker.spec.tsx`
- Modify: this plan Markdown and `plan.json`
- Modify: `docs/Plan/README.md` and `docs/HANDOFF-CURRENT.md`

**Steps:**

1. RED-test export/import of a subtree with internal plan references and ID conflicts: imported conflicting plan IDs are reassigned, internal references follow new IDs, external-to-subtree references retain their original IDs and resolve to broken state if absent. Verify all existing optional fields survive byte-semantic JSON roundtrip.
2. Implement import remap as a preflight transformation over the complete extracted subtree: validate every document and ID before writing; construct old-to-new mapping for collisions; rewrite only references whose targets are inside the imported subtree; retain external references unchanged. Import failure before writes must not partially remap or overwrite existing plans.
3. Add move/rename tests proving path snapshots are refreshed lazily from identity while prior display snapshots remain stable when user chose “keep old display.” Add external delete/move tests for non-crashing broken state and user repair/replacement entry.
4. Run focused suites, then `npm run typecheck`, `npm run test`, `npm run build`, and `git diff --check`. Record actual test counts and build result in Markdown, `plan.json`, README and HANDOFF; do not claim manual success without running the app.
5. In a disposable isolated plan library, create A→B plan link, A→B component link, and A→B component embed; edit original, move/rename it, test update/keep/cancel, per-reference delete replacement, broken preservation, reopen target tab, and import/export collision. Verify no real user library or its resources were touched; record and remove only the exact QA directory created for this test.
6. Obtain a separate read-only implementation review. Address all Critical/Important findings in newly registered boundaries, re-run impacted tests, and only then release ownership. Do not update version, build installer, push or publish as part of this plan.
7. Fix the isolated-window loading race by registering `PlanReferenceCard.tsx` and `test/plan-reference-card.spec.tsx`; the regression models `currentPath` becoming active before the workspace tab state catches up. Commit `ca378166`; focused tests 19/19, full suite 64 files / 672 tests, typecheck, build and diff-check pass. Cumulative independent review approved with 0 Critical / 0 Important findings.

**Acceptance evidence:** the exact disposable library was initialized only under `qa-electron-20261003-1248/library`, exercised through the real Electron window and public UI/IPC, then the Electron/Vite process set and exact QA directory were removed. Two malformed launcher attempts selected `D:\Desktop\Plan`, but no mutating IPC was issued; the inspected `.trace` and Diary page timestamps predated those attempts and no persistent plan-file changes or probe residue were found. The launcher may briefly have run a create/delete write probe; this uncertainty is retained rather than claiming absolute non-access.

**Done:** import/export preserves and correctly remaps internal relationships; all registered plan-reference acceptance paths and automated gates are verified; cumulative reviewer and real-window evidence are recorded; code ownership is released.

## 完成边界

本计划实现普通关联、只读软链接、按需稳定身份、引用影响确认与导入/导出语义。不实现多人/云同步、跨库或 URL 引用、不允许引用卡嵌套/循环。完成后，组件 Markdown 备注由 `Plan-260930-03-组件Markdown备注` 独立实施。
