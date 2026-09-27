# 日记补建与计划命名模板实施计划

> For agentic workers: REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to execute this plan task-by-task. Keep the registered file boundaries in `docs/HANDOFF-CURRENT.md` authoritative.
>
> 状态：实施计划已形成，待用户审阅；尚未修改产品代码。创建日期：2026-09-28。

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

### Task 1 — Backfill diary data safely and represent unfilled mood

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

### Task 2 — Run reconciliation after window display and keep views synchronized

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

**Steps:**

1. Write failing coordinator tests with injected clock/timer/reconcile/report dependencies: activation after root activation, no awaited work on window show, root replacement, local-midnight trigger, focus retry, one in-flight reconcile per root, and stale completion suppression after a switch.
2. Implement a disposable coordinator that schedules the next local midnight (not a fixed 24-hour interval), starts work asynchronously after the existing `ready-to-show`/root-activation sequence, and retries failed work on the next focus or date boundary. It must not block bootstrap, root activation, or window display.
3. In `src/main/index.ts`, connect root activation and `BrowserWindow` focus to the coordinator, and dispose timers/listeners during application shutdown. After successful creation, invalidate the Diary tree cache and emit one scoped refresh notification; ensure the current Diary month reloads and the existing search/tree subscribers are refreshed without a full tree reload per generated day.
4. Keep `diary:ensure` as a fast, idempotent foreground safeguard for today; route it through the serialized diary service so opening Diary during background work is safe.
5. Add a typed status event for running/complete/error, whitelist it in preload, and surface failures/retry availability in the existing status bar using localized text. Do not include diary content or absolute paths in error messages/logs.
6. Run focused tests: `npx vitest run test/diary-automation-coordinator.spec.ts test/diary-automation-ipc.spec.ts test/startup-coordinator.spec.ts test/diary-service.spec.ts`.

**Done when:** startup remains non-blocking; activation, root switch, focus, and local-midnight behavior are covered; calendar/tree/search refresh and visible retryable failure state work without cross-library notifications.

### Task 3 — Add library-scoped template rules and safe IPC

**Files owned for this task:**

- `src/shared/plan-name-templates.ts` (new)
- `src/shared/ipc-contract.ts`
- `src/main/services/plan-name-template-service.ts` (new)
- `src/main/ipc/register.ts`
- `src/preload/index.ts`
- `test/plan-name-templates.spec.ts` (new)
- `test/plan-name-template-service.spec.ts` (new)
- `test/plan-name-template-ipc.spec.ts` (new)

**Steps:**

1. Write failing shared tests for the six specified built-in patterns, `{date}` local `YYYYMMDD` replacement, exactly one `{title}`, rejection of unknown placeholders/missing title/invalid plan-name results, and unchanged title text handling.
2. Implement pure shared default/validate/format helpers. Keep `{date}` optional and do not introduce scripting, nested inheritance, or extra placeholder syntax.
3. Write service tests using isolated temporary libraries for library separation, exact parent-relative-path matching, missing-file defaults, atomic save, invalid template rejection, unsafe/nonexistent folder rejection, malformed-file preservation, and remove/reset behavior.
4. Implement `.trace/plan-name-templates.json` persistence using `resolveWithin` and `PlanRepository.writeAppJson`. IPC must derive the library root in main, never accept a root path from renderer, and preserve a corrupt config rather than replacing it.
5. Make built-in defaults removable without silently reappearing: persist explicit disabled-default paths separately from string template overrides; custom-template removal deletes its override. Record this small schema extension in the approved design spec before implementation if the user does not request a different behavior during plan review.
6. Add typed get/set/remove IPC channels and preload allowlisting; test successful calls, validation errors, and root isolation.
7. Run focused tests: `npx vitest run test/plan-name-templates.spec.ts test/plan-name-template-service.spec.ts test/plan-name-template-ipc.spec.ts`.

**Done when:** defaults and per-folder rules resolve deterministically per active library; invalid/unsafe writes are rejected; removed built-ins stay disabled; no renderer filesystem access is introduced.

### Task 4 — Configure templates in Settings and apply them to every new-plan entry point

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

### Task 5 — Full regression, real-window acceptance, and shared handoff

**Files owned for this task:**

- all feature tests touched by Tasks 1–4
- `docs/superpowers/specs/2026-09-27-diary-backfill-and-plan-name-templates-design.md` (only to record the approved config removal detail)
- this implementation plan and sibling `plan.json`
- `docs/Plan/README.md`
- `docs/HANDOFF-CURRENT.md`
- `docs/changelog/CHANGELOG.md`

**Steps:**

1. Review the complete diff for data-loss, root-switch races, stale async updates, unhandled null mood reads, IPC allowlist gaps, and accidental changes to folder/plan/rename/import semantics.
2. Run `npm run typecheck`, `npm run test`, `npm run build`, and `git diff --check`; record exact counts/output and implementation commit hashes in this plan, `plan.json`, README, and HANDOFF. Do not report expected results as completed results.
3. Add an `[Unreleased]` changelog section describing diary backfill, unfilled mood semantics, and folder naming templates; do not assign a release version in this feature batch.
4. Launch the real Electron app and verify: empty library creates only today after the window is visible; a library with dated gaps backfills without replacing an existing file; a deliberately deleted past date stays deleted after restart; switching libraries keeps progress/events isolated; an open Diary view refreshes as backfill finishes.
5. Verify six built-in name previews and creation, custom nested-folder add/edit/remove, title-only submission, legacy full-name behavior in an unconfigured folder, duplicate/invalid-name feedback, and persistence after app restart.
6. Mark only genuinely verified tasks done. Record any manual scenario that cannot be exercised locally as pending user acceptance; implementation completion does not authorize a release.

**Done when:** automated checks and build pass, real-window paths are recorded with observed results, docs/Markdown/JSON/HANDOFF agree, and no release/version change is included.

## Current Stage

- Next: user reviews this execution plan, especially the explicit disabled-default behavior for removing one of the six built-in templates.
- Waiting: plan review/confirmation.
- Remaining: Tasks 1–5, their task-by-task reviews, and real Electron acceptance.
