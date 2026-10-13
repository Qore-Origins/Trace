# Task 8 收官交接（Final Handoff）

> 2026-10-08 · Claude 撰写。本文件是 Task 8（端到端验收、独立安全复审与交接）的收官交接清单。
> 详细过程证据见 `Task8-Current-Status-2026-10-08.md`（含「恢复执行结果」节）与 `Task8-Acceptance-Report.md`（历史快照）。

## v1.0.0 发布后状态（2026-10-09 05:26 +08:00）

Task 8 集成已合入 `main`，并包含于已发布的 Trace v1.0.0。GitHub/Gitee `main` 当前均指向 `aa8c99c70b5dcc28b1fa2bd87ac035172f615aed`，tag `v1.0.0` 指向发布提交 `7819ff6ad778456059f9232d69cd2c1c34986740`。GitHub Release 含 210,738,662-byte Windows x64 安装包，SHA-256 `76ED2D64F0313D0D9FDBE3333BDC306D6C10E839513BBE27D0328BDF1EA8157E`；Gitee Release 仅说明、不含 exe。

当前验证口径：typecheck/build/build:win 通过；完整测试 1187/1190，用户批准跳过 3 项，不称全绿。D3 的通过结论来自 Claude 报告，Codex 未独立重跑；CDP runner 实际 smoke 有失败记录。8A 根因未知。人工验收（NSIS 安装/卸载、原生输入/IME、DPI、窄窗口、读屏）仍待用户安排；这些属于发布后验收边界，不推翻“Release 已发布”，也不应反向表述为已验证。详细发布证据见[ v1.0.0 发布计划](../Plan-261009-01-v1.0.0正式版发布/Trace-v1.0.0-Release-Plan.md)。

## 当前 Codex 复核增补（2026-10-08 16:15 +08:00）

- 三轮 Spec/Standards 只读复核均 Ready。第二轮指出 WebSocket waiter 缺少自身回归后，已提取 `waitForWebSocketClose`，新增四类直接测试：close 已观测、readyState 已关闭但 close 事件未派发、正常 close 事件、timeout 拒绝并移除监听。聚焦 1 spec / 10 tests、Node/Web typecheck、runner/helper `node --check`、`git diff --check` 均通过；同步完成后于 16:15 再核验计划 JSON 为 222 个唯一 ID。
- 首次 attach/`Runtime.enable` 前的异常不回放仍是明确残余边界；全生命周期覆盖需单独设计早期自动附着，当前未实施。等待 CDP close 只收束该连接上已送达的消息，尚未以 Electron 实窗验证传输行为。
- Task 8 仍 `in_progress`；本批代码所有权已释放，当前无活动 owner。本轮未跑 build、D3-only、完整 runner 或全量测试；没有新增 Electron 实际运行证据。是否接受 attach 后计数边界并单独授权 D3-only，或另行设计早期附着，待用户决定；历史测试报告范围和用户人工验收仍待闭环。

## 当前 Codex 复核增补（2026-10-08 16:05 +08:00）

- 第一轮 scoped review 的 standards finding 已修复：target-close / WebSocket-close 超时改成语义化常量；以目标消失后等待 CDP WebSocket `close` 事件替代 50ms 固定延迟，并增加 target 与 socket 等待失败时确保连接清理的回归测试。当前增量 focused 1 spec / 6 tests、Node/Web typecheck、runner/helper `node --check`、`git diff --check` 通过；本轮未重跑 build、D3-only、完整 runner 或全量测试。
- Spec review 的重要边界仍需明确：当前通过 `/json/list` 发现后手动 attach，并在连接后启用 Runtime；首次 attach/启用前已发生的异常不会回放。覆盖完整窗口生命周期需要另外实现并验证 Browser CDP 的早期自动附着机制；本批未扩展。正常 WebSocket close 次序可等待先前已送达消息处理完成，但不消除 attach 前盲区。
- 两名 reviewer 正对修正后的精确增量进行第二轮只读复核。Task 8 仍 `in_progress`；无本轮 Electron 实测；D3-only 需另行授权。历史 D3/全量测试报告范围及人工验收未闭环。

## Codex 交叉复审增补（2026-10-08 15:35 +08:00）

- 独立窗口 renderer 异常覆盖已实现：新增 monitor 聚合 main renderer、external approval、main operation confirmation；所有 CDP client 在连接后启用 Runtime；审批/确认 click 后保持 websocket 直到 target 关闭并排空事件。focused spec 先 RED（最初 3 项功能测试及随后 2 项窗口关闭/事件排空时序测试均按预期失败）后 GREEN（1 spec / 5 tests）；Node/Web typecheck、`npm run build`（renderer 7,158 modules）、runner/helper 语法和本批 `git diff --check` 通过。
- 这是代码/单测与构建验证，不是独立窗口实际 Electron 运行证据；本轮未重跑 D3、完整 runner 或全量测试，本批还未由第二位 reviewer 独立复核。focused 5/5、Node/Web typecheck、Node 语法检查、差异检查及生产 build 已在 15:33–15:35 +08:00 最终复验。当前 owner 已释放，Task 8 仍 `in_progress`；下一步是独立 scoped review，再另行授权 D3-only Electron 验证。8A 根因、D3/全量历史报告范围对齐及用户侧原生输入/IME/DPI/读屏验收仍未完成。

## 历史交叉复审记录（2026-10-08 14:30 +08:00；当前状态以上方 15:35 记录为准）

- Claude 最新摘要（用户转述）报告 D3 三入口 PASS（runId `1cf97c7c882860595768d57092098f8e`）、全量测试 512/512、typecheck/build 通过，并称提交 `b403e0a` 双端同步；Codex 本轮未重跑这些步骤。已有状态文件记有较早的 D3 失败 runId `b3a51d25bc2d8c6c7663d1ed97f3e0cd` / 1179/1184；本文件旧快照另记 1186/1187。它们按时间/范围保留，当前完整测试命令与统计口径仍需对齐。
- `renameWithRetry` 复审发现 P1：Agent 的冻结 library identity 只在进入重试前校验，退避期间根变化时可能继续 rename。已在候选 worktree修复为每次 rename 前重新运行 guard；新回归按 RED→GREEN 验证身份变化后不会进行第二次 rename。有限 `EPERM/EBUSY` 重试按用户最新决定保留。重试日志已移除绝对路径与计划名，并有测试验证。该新增修复尚无第二名 reviewer 独立复核。
- Codex 实测候选 worktree：`plan-repository.spec.ts`、`plan-reference-ipc.spec.ts`、`reference-impact-dialog.spec.tsx` 共 65/65；Node/Web typecheck、`npm run build` 通过；`git diff --check` 通过（有既有 CRLF→LF 提示）。未重跑全量/D3。
- runner 复审的残余 P2：当前异常计数实现尚未证明覆盖独立审批/确认窗口 renderer。本轮未改 runner；需要补覆盖或由后续收官明确接受该验收边界。8A 自然保存失败根因未定位；有限重试仅为韧性措施。
- Task 8 仍 `in_progress`：需要统一全量/D3 报告口径、处理上述 runner 覆盖缺口，并完成原生键鼠/IME/DPI/窄矮窗口/读屏与真实安装包人工验收及用户关闭确认。未合并、升版、打包、推送或发布。

## 1. 验收证据汇总

| 子项 | 结论 | 证据 |
|---|---|---|
| 8A 偶发原子保存失败 | **用户选择保留有限重试；自然复现根因仍未定位，未宣称已解决** | 候选 worktree `plan-repository.ts` + `plan-repository.spec.ts`；Codex 新增 retry backoff identity guard 回归及日志脱敏断言 |
| 8B Bundle 预算与懒加载 | 已闭环（历史记录） | task-8B 相关工件 |
| 8C 保存失败版本契约 | 已闭环（单次 EPERM 注入测试保留原语义，经 `renameRetryBackoffs: []` 禁用重试） | test/plan-repository.spec.ts 8C 用例 |
| 8D1 回收站 UI 冲突恢复 | 通过 | 完整 runner PASS + D1-only 诊断 |
| 8D2 目标失效/外发预览/失败批次 | 通过 | 完整 runner PASS |
| 8D3 删除入口与 link keep/replace | **Claude 最新摘要报告通过；Codex 未独立重跑** | 用户转述 runId `1cf97c7c882860595768d57092098f8e`，三入口 × 全决策链 PASS，provider 0 请求；旧快照更早失败结果保留在状态文档 |
| 全量测试门槛 | **报告口径待对齐，Codex 未本轮重跑** | 用户转述 Claude 最新摘要 512/512；旧状态快照分别记录 1179/1184 与 1186/1187。Codex 本轮实测本增量 1 focused spec / 5 tests；此前交叉复审的三个候选 worktree specs 为 65/65 |
| typecheck / build | 0 错 / 通过 | worktree 实测 |

## 2. 独立复审边界（如实声明）

- Codex 已完成交叉复审：
  1. `scripts/trace-phase2-isolated-electron-runner.cjs` 修正链：根展开及定位规则；本轮新增的异常监测器已将 main renderer、独立审批窗和主进程确认窗接入聚合计数，并补了 CDP 保持到窗口关闭/事件排空的 focused 回归。代码与单测已验证，但尚无第二位 reviewer 复核，也未通过 Electron D3-only 实际运行验证。
  2. `plan-repository.ts` 的 `renameWithRetry`：发现重试后未复核 frozen library identity 的 P1，已按 TDD 修复并实测；有限重试按用户确认保留。日志绝对路径泄露已去除。
  3. Context 入口不完整选择路径：Claude 已改为非 rejection 的 warning/显式关闭控制；Codex 未重跑该功能，只纳入既有独立复审与报告。
- 交叉复审定向复验：候选 worktree 的 `plan-repository`、`plan-reference-ipc`、`reference-impact-dialog` 65/65；本轮 runner monitor spec 5/5；Node/Web typecheck、`node --check`、`git diff --check` 与生产 build 通过；未运行全量/D3 或实际 Electron runner。

## 3. 人工验收边界（自动化不覆盖，交用户）

- 原生键鼠手感、输入法候选窗（IME）、系统 DPI 缩放、极窄/极矮窗口、屏幕阅读器体验。
- 真实安装包（NSIS）安装/卸载路径；真实杀软共存场景（8A 的自然复现环境）。

## 4. 残余风险

| 风险 | 等级 | 缓解状态 |
|---|---|---|
| 8A 偶发保存失败根因未定位（自然复现） | 低频 | 有界 rename 重试为用户批准的韧性措施；不代表根因已知或已修复，日志不含目标路径 |
| target-picker it.each 轮换 flaky | 中（测试可靠性） | 已登记移交 Codex 定位（dump 已入失败信息）；不豁免不跳过 |
| D3 runner 独立审批/确认窗口异常计数尚无运行时证据 | 待收官 | 代码已覆盖三类 CDP target 并通过 focused 单测；仍需第二 reviewer 与 D3-only Electron 运行验证，不把单测外推为窗口实测 |
| `writeJsonAtomic` mkdir 前的目录句柄竞争窗口 | 极低 | 未观测到复现；renameWithRetry 覆盖 EPERM 路径 |
| writeJsonAtomic 同目录 500ms 抑制窗口内的并发外部编辑可能被漏报 | 低 | 既有 markInternalWrite 语义固有；记录在案 |

## 5. 交接清单

- [x] 全部子项验收证据落盘（本文件 §1 + Task8-Current-Status「恢复执行结果」节）
- [x] runner 修正入库（`scripts/trace-phase2-isolated-electron-runner.cjs`，含 Codex 基础版本，commit 9a502e5）
- [x] 结构性待办登记：视图骨架提升（TopBar/StatusBar App 级单点）——HANDOFF 结构性待办节
- [x] Codex 交叉复审（§2 三处）；P1 已修复并复验，runner 独立窗口异常监测已实施并通过 focused 5/5（未提交；待第二 reviewer 与 D3-only Electron 验证）
- [ ] 用户人工验收（§3 边界）——待安排
- [ ] Task 8 关闭确认（用户判定 §3 人工边界通过后）

## 6. 合并与发布结果

Task 8 split 通过 merge commit `7f120722df604420fdf21dfc09a8c46ad47fd6e4` 合入 `main`，随后纳入 v1.0.0 发布；发布提交/tag 为 `7819ff6ad778456059f9232d69cd2c1c34986740` / `v1.0.0`，发布记录提交 `aa8c99c70b5dcc28b1fa2bd87ac035172f615aed` 已同步 GitHub 与 Gitee。合并冲突 `src/main/ipc/register.ts` 已在当时解决。旧的合并预案仅作为历史保留，不再是待办。测试与人工验收边界以上方发布状态和 [Task 8 当前状态](Task8-Current-Status-2026-10-08.md)为准。
