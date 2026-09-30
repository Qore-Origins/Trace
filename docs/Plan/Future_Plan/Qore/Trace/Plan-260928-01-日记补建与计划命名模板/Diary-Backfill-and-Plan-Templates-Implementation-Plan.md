# 日记补建与计划命名模板实施计划

> For agentic workers: REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to execute this plan task-by-task. Keep the registered file boundaries in `docs/HANDOFF-CURRENT.md` authoritative.
>
> 状态：Task 1–5 实现与自动验证完成；Follow-up A 四文件扩展修复与独立复审通过，Follow-up B 和 UI Minor scoped review 通过。全量复验和真实 UI 验收待完成。用户接受记录 realpath-操作间 TOCTOU。创建日期：2026-09-28。

## Goal

计划库激活后在后台补齐应有的空白日记，自动创建的日记在输入真实心情前不参与打卡统计，并让计划创建对话框按目标文件夹套用可配置命名模板。已有日记和计划内容不迁移、不覆盖；窗口首显不等待回填。

## Architecture

- Diary service owns date validation, idempotent per-library checkpointing, blank-day creation, and memory eligibility. Its operations remain rooted at the main-process-selected library path and use `PlanRepository` for atomic writes/internal-write suppression.
- A main-process coordinator starts only after root activation/window display, re-runs on root changes, local midnight, and window focus, and reports success/failure without holding the startup gate. Root-generation checks suppress stale notifications after library switches.
- A pure shared template module owns validation, defaults, and formatting. A main-process service reads/writes per-library configuration under `.trace/`, while typed IPC remains the only renderer access path.
- The settings surface manages folder-specific templates. The shared `NameDialogModal` fetches the target folder’s rule, accepts only the custom title when configured, previews the final name, and still submits through existing `storage:createPlan` validation.

## Tech Stack

Electron main/preload/renderer, React 19, TypeScript, Zustand, Ant Design, Vitest, existing `PlanRepository` and IPC contract. No new runtime dependency is planned.

## Approved Spec

`docs/superpowers/specs/2026-09-27-diary-backfill-and-plan-name-templates-design.md`

## Global Constraints

- Before each implementation task, update `docs/HANDOFF-CURRENT.md` with the worker and exact files; do not overlap Claude Code ownership or any newly registered boundary.
- Execute the five tasks serially with fresh task workers/reviews as selected previously. Tasks 2–4 touch shared IPC/preload/localization/UI hosts; release and re-register each boundary before the next task rather than running overlapping edits in parallel.
- Keep `Resource/pic/` and `Resource/vid/` untouched and untracked. Never stage build outputs or user resources.
- Use local calendar dates and validate real dates, including leap days. Never overwrite an existing `plan.json`; only advance the checkpoint after the complete requested range succeeds.
- Keep root paths out of renderer payloads. Validate folder paths and template strings in main/shared code; preserve existing `storage:createPlan` name/path checks.
- Preserve old documents and numeric mood scores. New unfilled mood values are nullable; do not count null as zero or as a check-in.
- UI colors must use workspace semantic tokens. Ant Design messages/modals must use `getMessage()` / `getModal()`, and setting descriptions retain the 2-second hover delay.
- Do not change package version, build/release assets, or publish as part of this feature plan.

## Review Focus

- First-run range selection, restart after a partial write, malformed checkpoint behavior, and no resurrection of user-deleted dates before the checkpoint.
- Startup stays responsive; root switching cannot leak writes, refresh events, or errors into the newly active library; midnight scheduling follows local date/DST.
- A blank generated diary stays available in Diary but not Memories; an entered score, mood text, note, or added component makes it eligible, while old records remain unchanged.
- Default/custom template resolution, exact parent-path scoping, safe removal of a built-in default, filename validation, duplicate errors, and all plan-creation entry points.
- Invalid config remains intact and errors remain visible/retryable; test the real Electron window after automated checks.

## Execution Tasks

### Task 1 — Backfill diary data safely and represent unfilled mood（已完成）

**Files owned for this task:**

- `src/main/services/diary-service.ts`
- `src/shared/plan-types.ts`
- `src/renderer/src/components/cards/MoodCard.tsx`
- `src/renderer/src/views/diary-view-utils.ts`
- `test/diary-service.spec.ts`
- `test/diary-view-utils.spec.ts`
- `test/diary-mood-card.spec.tsx` (new)

**Steps:**

1. Add failing service tests for valid local dates, leap/month/year boundaries, first-run backfill from the earliest valid dated Diary folder, empty-library creation of today only, idempotency, missing `plan.json` in an existing date folder, existing-file byte/content preservation, and checkpoint advancement only after all writes succeed.
2. Add failure/retry tests proving malformed checkpoint JSON is not overwritten, a partially completed interval resumes safely, and a past date deleted before an already persisted checkpoint is not recreated.
3. Implement `reconcileDiaryPages(planRoot, today)` with deterministic date input for tests, plus one idempotent date-page helper serialized by root/date so foreground `diary:ensure` cannot race the background write for today. Ensure today first, then choose the first-run range; this preserves “today only” for an empty library and still backfills from an older existing date when present. Persist `.trace/diary-automation.json` via `PlanRepository.writeAppJson`; use `resolveWithin`, existing repository writes, and `markInternalWrite`; validate checkpoint dates. Do not advance the checkpoint until the entire range succeeds.
4. Change only newly generated mood cards to `score: null`. Update `MoodPayload` and `MoodCard` to display a clear unfilled state, keep the input empty/clearable, and only apply score color/rolling animation to numeric scores.
5. Add failing tests for null scores being excluded from average/check-in/trend, and for a generated all-empty day being excluded from Memories until it has a score, mood text, note content, or an additional component. Implement the eligibility predicate without mutating old documents.
6. Run focused tests: `npx vitest run test/diary-service.spec.ts test/diary-view-utils.spec.ts test/diary-mood-card.spec.tsx`.

**Done when:** service behavior is idempotent and data-preserving under retry; null mood is handled end-to-end in types, card UI, statistics, and memory filtering; focused tests pass.

**实际完成与审查：**提交 `d0dc689471707ac42dfb4f120daea25a8cf0db7f`。定向测试 3 files / 77 tests、全量 `npm run test` 41 files / 443 tests、`npm run typecheck`（node/web）、严格 TSC 和 `git diff --check` 均通过。独立规格/质量审查结论 Approved，无 Critical/Important；Minor 记录为系统时钟相关测试应固定日期，以及硬链接不支持时后续错误提示需清晰。Task 2 必须测试补建部分成功后失败的刷新行为：服务会 reject 且 checkpoint 不推进，先前已经创建的日期页仍有效；后续重试可能 `createdDates` 为空，不能只在成功且 `createdDates` 非空时刷新。详见 SDD `task-1-report.md` 与 Task 1 review。

### Task 2 — Run reconciliation after window display and keep views synchronized（独立审查通过）

**Files owned for this task:**

- `src/main/services/diary-automation-coordinator.ts` (new)
- `src/main/index.ts`
- `src/main/ipc/register.ts`
- `src/shared/event-types.ts`
- `src/preload/index.ts`
- `src/renderer/src/components/StatusBar.tsx`
- `src/renderer/src/views/DiaryView.tsx`
- `src/renderer/src/i18n/locales/zh-CN.ts`
- `src/renderer/src/i18n/locales/en-US.ts`
- `test/diary-automation-coordinator.spec.ts` (new)
- `test/diary-automation-ipc.spec.ts` (new)
- `test/plantuml-ipc.spec.ts` (only scope its exact `ipcRenderer.on` count assertion to the PlantUML status channel)

**Steps:**

1. Write failing coordinator tests with injected clock/timer/reconcile/report dependencies: activation after root activation, no awaited work on window show, root replacement, local-midnight trigger, focus retry, one in-flight reconcile per root, and stale completion suppression after a switch.
2. Implement a disposable coordinator that schedules the next local midnight (not a fixed 24-hour interval), starts work asynchronously after the existing `ready-to-show`/root-activation sequence, and retries failed work on the next focus or date boundary. It must not block bootstrap, root activation, or window display.
3. In `src/main/index.ts`, connect root activation and `BrowserWindow` focus to the coordinator, and dispose timers/listeners during application shutdown. After successful creation, invalidate the Diary tree cache and emit one scoped refresh notification; ensure the current Diary month reloads and the existing search/tree subscribers are refreshed without a full tree reload per generated day. On reconciliation failure, also publish a scoped refresh for the still-active root before surfacing the retryable error: Task 1 can have created some pages before rejecting, and its subsequent retry may return no `createdDates`; never let a stale root publish into the newly active library.
4. Keep `diary:ensure` as a fast, idempotent foreground safeguard for today; route it through the serialized diary service so opening Diary during background work is safe. If foreground ensure actually creates today's page before background reconciliation, invalidate the Diary tree cache and emit one scoped `trace:plan-changed` notification so tree/search subscribers do not miss the new page; never emit into a root that ceased to be active during the await.
5. Add a typed status event for running/complete/error, whitelist it in preload, and surface failures/retry availability in the existing status bar using localized text. Install a preload-level observer early enough to cache status events that arrive before the renderer subscribes, and replay only the latest diary status to a later subscriber. Root replacement must promptly publish the new root's current state; stale prior-root completions must remain suppressed. Do not include diary content or absolute paths in error messages/logs.
6. Run focused tests: `npx vitest run test/diary-automation-coordinator.spec.ts test/diary-automation-ipc.spec.ts test/startup-coordinator.spec.ts test/diary-service.spec.ts`.

**Done when:** startup remains non-blocking; activation, root switch, focus, and local-midnight behavior are covered; calendar/tree/search refresh and visible retryable failure state work without cross-library notifications.

**实际完成与验证：**实现提交 `f923e2b126fbba324abe67e51e0da2bf899312f0`。定向 5 files / 115 tests、全量 `npm run test` 43 files / 464 tests、`npm run typecheck`（node/web）、新增测试严格 TSC、`git diff --check` 均通过。独立规格/质量审查 Approved，无 Critical/Important。Minor：`diary:ensure` 锁外 `lstat` 不能严格证明本次调用实际创建页面，并发后台 reconcile 可能重复触发 scoped 刷新；Task 5 加并发通知计数回归，再决定是否需要锁内创建结果契约。全量测试尾部 Muya/happy-dom 本机 SVG 请求 `ECONNRESET` stderr，exit 0、无失败/unhandled-error，记录为非阻断噪声，不跨界修改 Muya。真实 Electron 窗口验收留给 Task 5。

### Task 3 — Add library-scoped template rules and safe IPC（独立审查通过）

**Files owned for this task:**

- `src/shared/plan-name-templates.ts` (new)
- `src/shared/ipc-contract.ts`
- `src/main/services/plan-name-template-service.ts` (new)
- `src/main/index.ts` (inject the existing watcher-aware repository into the service)
- `src/main/ipc/register.ts`
- `src/preload/index.ts`
- `test/plan-name-templates.spec.ts` (new)
- `test/plan-name-template-service.spec.ts` (new)
- `test/plan-name-template-ipc.spec.ts` (new)

**Steps:**

1. Write failing shared tests for the six specified built-in patterns, `{date}` local `YYYYMMDD` replacement, exactly one `{title}`, rejection of unknown placeholders/missing title/invalid plan-name results, and unchanged title text handling.
2. Implement pure shared default/validate/format helpers. Keep `{date}` optional and do not introduce scripting, nested inheritance, or extra placeholder syntax.
3. Write service tests using isolated temporary libraries for library separation, exact parent-relative-path matching, missing-file defaults, atomic save, invalid template rejection, unsafe/nonexistent folder rejection, malformed-file preservation, and remove/reset behavior.
4. Implement `.trace/plan-name-templates.json` persistence using `resolveWithin` and `PlanRepository.writeAppJson`. In `main/index.ts`, inject the existing `PlanRepository` whose writes call `WatchService.markInternalWrite`; do not create a second unmarked repository. IPC must derive the library root in main, never accept a root path from renderer, and preserve a corrupt config rather than replacing it.
5. Use the approved schema in design spec §4.2: persist `disabled_default_paths` separately from `templates`; setting a built-in path clears its disabled marker, removing a built-in records the disabled path, and removing a custom rule deletes only its override. Preserve malformed configuration instead of replacing it.
6. Add typed get/set/remove IPC channels and preload allowlisting; test successful calls, validation errors, and root isolation.
7. Run focused tests: `npx vitest run test/plan-name-templates.spec.ts test/plan-name-template-service.spec.ts test/plan-name-template-ipc.spec.ts`.

**Done when:** defaults and per-folder rules resolve deterministically per active library; invalid/unsafe writes are rejected; removed built-ins stay disabled; no renderer filesystem access is introduced.

**实际完成与审查：**实现提交 `daf3ad244240c4c263752042c18880ab46a03cba`；独立审查发现固定非法字符会被占位符校验放过，fix round 1 提交 `d00e1eb2c185eb426dab9382a23c4d23d3d0d28f`，scoped re-review 全部 ADDRESSED、无新破坏。最终 Task3 focused suites 14/14、修复前全量 46 files / 476 tests、typecheck node/web、严格测试 TSC 与 diff checks 均通过；修复后 focused suites 重跑 14/14。Reviewer Cannot-verify 项经协调者核实关闭：模板 handler 与 app root 操作共用 `regRootState` 串行队列；模板 service 使用带 watcher 抑制的既有 PlanRepository，writeAppJson 走 tmp→fsync→rename。Task 5 仍需在修复后重跑完整回归/build 与真实窗口验收。

### Task 4 — Configure templates in Settings and apply them to every new-plan entry point（已完成，独立审查通过）

**Files owned for this task:**

- `src/renderer/src/components/PlanNameTemplateSettings.tsx` (new)
- `src/renderer/src/components/NameDialogModal.tsx`
- `src/renderer/src/App.tsx`
- `src/renderer/src/i18n/locales/zh-CN.ts`
- `src/renderer/src/i18n/locales/en-US.ts`
- `src/renderer/src/styles/workspace.css`
- `test/plan-name-template-settings.spec.tsx` (new)
- `test/name-dialog-template.spec.tsx` (new)

**Steps:**

1. Add failing renderer tests for folder-scoped load/save/remove, adding a rule for an existing nested folder, 2-second descriptions, loading/error states, and avoiding stale rules when the active root changes.
2. Add a Settings section that lets the user choose an existing folder and add/edit/remove its rule. Show the resolved example name; make API errors visible and preserve the last saved state on failure. Use semantic CSS tokens and the shared antd host.
3. Update the shared `NameDialogModal` to fetch the selected parent folder’s effective rule only for `create-plan`; keep folder creation, rename, preset save, and unconfigured folder behavior unchanged.
4. When a rule exists, treat input as `{title}`, show the exact final-name preview using the same shared formatter, and submit the formatted name through the existing `createPlan` action. Validate blank input and duplicate/filename errors without closing the dialog. Guard asynchronous template loads against a later dialog/root change.
5. Verify all callers still use the single shared modal (tree, menu, shortcut, empty-library guidance); add an explicit contract test if a caller bypasses it.
6. Run focused tests: `npx vitest run test/plan-name-template-settings.spec.tsx test/name-dialog-template.spec.tsx test/accessibility-contract.spec.tsx`.

**Done when:** configured folders require only a title and show a matching preview; unconfigured folders retain old full-name entry; settings changes are root-specific, accessible, and survive restart through IPC persistence.

**实际完成与审查：**提交 `6ffc22b679bf206deeebd60e29cddf800fcd27a6`，提交仅含登记的八个 UI/测试文件。聚焦 4 suites / 23 tests、`npm run typecheck`（node/web）与 `git diff --check` 均通过。独立规格/质量审查 Approved，无 Critical/Important；原记录的三项 Minor 中，计划节点作为模板父目录已由用户明确确认，属于预期行为；英文界面校验错误语言、跨本地午夜的静态日期预览交 Task 5 全分支审查裁定。详细证据见 SDD `task-4-report.md` 与 `task-4-review.md`。

### Task 5 — Full regression, real-window acceptance, and shared handoff（自动回归、计划命名真实 UI、in-flight 根切换主进程/IPC 验收完成；任务仍待五个 QA Temp 目录清理，renderer 切库动线留作人工验收）

**Files owned for this task:**

- all feature tests touched by Tasks 1–4
- `src/renderer/src/styles/workspace.css` (only add an ordered import for the feature stylesheet)
- `src/renderer/src/styles/plan-name-templates.css` (new; move the Task 4 feature rules out of the compatibility entry)
- `test/style-boundaries.spec.ts` (assert the import order and feature selector ownership)
- `src/main/services/diary-service.ts` (expose an atomic lock-protected creation result while preserving the existing `ensureTodayPage` return contract)
- `src/main/ipc/register.ts` (use the atomic creation result for the foreground refresh event)
- `docs/superpowers/specs/2026-09-27-diary-backfill-and-plan-name-templates-design.md` (only to record the approved config removal detail)
- this implementation plan and sibling `plan.json`
- `docs/Plan/README.md`
- `docs/HANDOFF-CURRENT.md`
- `docs/changelog/CHANGELOG.md`

**Steps:**

1. Review the complete diff for data-loss, root-switch races, stale async updates, unhandled null mood reads, IPC allowlist gaps, and accidental changes to folder/plan/rename/import semantics.
   - Add a coordinated background-reconcile + concurrent foreground `diary:ensure` case and assert the total scoped refresh count; resolve Task 2 review Minor (lock-outside `lstat` can cause a duplicate refresh) as harmless or register a narrowly scoped creation-result contract fix before modifying code.
   - Keep Task 1 Minor observations in the final audit: date-sensitive tests should use a fixed clock, and unsupported hard-link failures need clear user-facing retry guidance if surfaced in the final error review.
2. Run `npm run typecheck`, `npm run test`, `npm run build`, and `git diff --check`; record exact counts/output and implementation commit hashes in this plan, `plan.json`, README, and HANDOFF. Do not report expected results as completed results.
3. Add an `[Unreleased]` changelog section describing diary backfill, unfilled mood semantics, and folder naming templates; do not assign a release version in this feature batch.
4. Launch the real Electron app and verify: empty library creates only today after the window is visible; a library with dated gaps backfills without replacing an existing file; a deliberately deleted past date stays deleted after restart; switching libraries keeps progress/events isolated; an open Diary view refreshes as backfill finishes.
5. Verify six built-in name previews and creation, custom nested-folder add/edit/remove, title-only submission, legacy full-name behavior in an unconfigured folder, duplicate/invalid-name feedback, and persistence after app restart.
6. Mark only genuinely verified tasks done. Record any manual scenario that cannot be exercised locally as pending user acceptance; implementation completion does not authorize a release.

**Done when:** automated checks and build pass, real-window paths are recorded with observed results, docs/Markdown/JSON/HANDOFF agree, and no release/version change is included.

**In-flight 根切换定向回归（2026-09-30）：**实际运行 `npm exec vitest run test/diary-automation-ipc.spec.ts test/diary-automation-coordinator.spec.ts`，2 files / 22 tests 通过。现有集成场景覆盖旧 root reconcile 未结束时切换到新 root，之后旧操作失败不能向当前窗口发过期状态/刷新通知。此为主进程协调器/IPC 回归，不代表真实 renderer 切库鼠标动线已验收。

## Current Stage

- Confirmed: user approved the execution plan and the explicit disabled-default behavior for removing one of the six built-in templates.
- Completed: Task 1 implementation commit `d0dc689471707ac42dfb4f120daea25a8cf0db7f`; its seven-file boundary is released after independent review Approved (no Critical/Important findings).
- Completed: Task 2 implementation commit `f923e2b126fbba324abe67e51e0da2bf899312f0` and independent review Approved, no Critical/Important; its 12-file boundary is released. Minor duplicate-refresh and test-stderr observations are deferred to Task 5 as listed above.
- Completed: Task 3 implementation commits `daf3ad244240c4c263752042c18880ab46a03cba` and `d00e1eb2c185eb426dab9382a23c4d23d3d0d28f`; independent review/fix re-review clean, nine-file boundary released.
- Completed implementation: Task 4 commit `6ffc22b679bf206deeebd60e29cddf800fcd27a6`; the eight-file implementation boundary is released. Focused 4 suites / 23 tests, node/web typecheck and diff-check passed; exact evidence is in SDD `task-4-report.md`.
- Completed and reviewed: Task 4 commit `6ffc22b679bf206deeebd60e29cddf800fcd27a6`; independent review Approved with no Critical/Important findings; eight-file boundary released. Focused 4 suites / 23 tests, node/web typecheck and diff-check passed; three Minor findings are recorded above and in the SDD ledger for final review.
- Completed implementation: Task 5 commit `fda547f56f46612f9b22aa093f50f1bb66e93257`; full automated verification passed (typecheck, 48 files / 492 tests, build, diff-check). Isolated Electron smoke passed service/IPC paths but did not exercise Settings or plan-dialog interactions. The full-branch review and follow-up findings are recorded below and in the current HANDOFF.
- Latest acceptance: real Electron verified Settings save, title-only input, local-date preview, and matching plan/plan.json creation. The focused coordinator/IPC root-switch regression passed 2 files / 22 tests; real renderer library-switch interaction remains untested and is explicitly left for optional manual acceptance.
- User decision (2026-09-29): plan nodes are directories and may be selected as naming-template parent directories. This resolves the selector-scope review question as intended behavior; no code change is needed for this item.
- User approved fixing the remaining two UI Minor through the existing React component test seams: English localization of template-setting errors and refreshing the name preview across local midnight. `/root/diary_ui_minor_fix` owns only `PlanNameTemplateSettings.tsx`, `NameDialogModal.tsx`, both locale files, and their existing two component specs; this boundary does not overlap either main-service follow-up.
- Follow-up A expanded implementation and independent review are complete. All three public reads guard Diary/date/plan.json containment; month/memory traversal checks valid-date junctions before directory-type filtering. Static outside links yield `PATH_UNSAFE`; selected root symlink aliases remain usable. Focused 4 specs / 90 tests, node/web typecheck, and four-file diff-check passed; independent review PASS, no P0–P3 findings. User accepts the local TOCTOU interval between realpath validation and file operations as a documented residual; no handle/no-follow architecture expansion.
- Follow-up B second-round implementation and scoped review are complete with conditional pass: 23 focused tests, node/web typecheck, diff-check passed. Residual P3 window remains between filesystem identity recheck and non-recursive `rmdir`.
- UI localization/midnight-preview follow-up is implemented and scoped review passed: 2 component specs / 15 tests, node/web typecheck, diff-check. Real Electron UI acceptance on 2026-09-30 saved the root naming template, asserted the local-date preview `Daily-20260930_Automation QA`, and verified creation of the matching isolated plan directory/`plan.json`. The new Electron UI QA root is one of five isolated QA Temp directories that remain because deletion was blocked by execution policy; no alternate deletion method was attempted. The bare build omitted `plantuml:prepare`, so PlantUML was unavailable and is outside this naming-template acceptance result.
- Full coordinator verification (2026-09-29): `npm run typecheck` passed; `npm run test` passed all 48 files / 512 tests (exit 0; known happy-dom/PlantUML loopback `ECONNRESET` stderr noise, no failures); `npm run build` passed (main 27 / preload 1 / renderer 7,158 modules). The feature worktree `npm run build` was rerun and passed on 2026-09-30. `git diff --check` and `plan.json` JSON parsing are rechecked during this handoff. `build:win`, version changes, push, and release were not run/authorized.
- Next: ask the user to remove all five exact QA Temp directories documented in `docs/HANDOFF-CURRENT.md`, then verify no related artifacts/processes remain. Keep the actual renderer library-switch interaction as a clearly labeled optional manual acceptance item.
- Baseline finding: before Task 5 implementation, `npm run typecheck` passed; `npm run test` reported 48 files / 490 tests, with 1 failure in `test/style-boundaries.spec.ts`: feature selectors had been appended directly to `workspace.css`, which must remain the ordered compatibility import entry. This exact three-file stylesheet-boundary repair is registered in `docs/HANDOFF-CURRENT.md`.
- Concurrent refresh RED: a real `createDiaryAutomationCoordinator` + `reconcileDiaryPages` + `diary:ensure` overlap writes one day but emits two identical scoped refreshes. The exact `diary-service.ts` / `register.ts` creation-result contract fix and two service/IPC tests are registered in `docs/HANDOFF-CURRENT.md`; no other production source is authorized.
- Waiting: user cleanup of all five exact QA Temp directories; no external credentials are needed.
- Remaining: confirm all five Temp directories are removed; optionally exercise the untested renderer library-switch interaction; retain the accepted diary-path TOCTOU residual and storage cleanup P3 in final handoff. No version bump, push, or release is authorized by this plan.
