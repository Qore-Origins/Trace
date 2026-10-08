# Task 8 收官交接（Final Handoff）

> 2026-10-08 · Claude 撰写。本文件是 Task 8（端到端验收、独立安全复审与交接）的收官交接清单。
> 详细过程证据见 `Task8-Current-Status-2026-10-08.md`（含「恢复执行结果」节）与 `Task8-Acceptance-Report.md`（历史快照）。

## 1. 验收证据汇总

| 子项 | 结论 | 证据 |
|---|---|---|
| 8A 偶发原子保存失败 | **韧性修复已落地**（renameWithRetry：EPERM/EBUSY 短退避重试，可注入禁用；rename 日志化）；自然复现根因仍未定位（杀软/索引器瞬时句柄为最可能假设，未证实） | worktree `plan-repository.ts` + spec 3 用例（重试成功/超限转 SAVE_FAILED/moveDir EPERM 重试） |
| 8B Bundle 预算与懒加载 | 已闭环（历史记录） | task-8B 相关工件 |
| 8C 保存失败版本契约 | 已闭环（单次 EPERM 注入测试保留原语义，经 `renameRetryBackoffs: []` 禁用重试） | test/plan-repository.spec.ts 8C 用例 |
| 8D1 回收站 UI 冲突恢复 | 通过 | 完整 runner PASS + D1-only 诊断 |
| 8D2 目标失效/外发预览/失败批次 | 通过 | 完整 runner PASS |
| 8D3 删除入口与 link keep/replace | **通过**（Claude 接手后：根展开修正 + 三轮诊断迭代） | runId 1cf97c7c882860595768d57092098f8e，三入口 × 全决策链 PASS，隔离完好 provider 0 请求 |
| 全量测试门槛 | **48 文件 / 1187 用例，1186 通过 + 1 已知 flaky**（target-picker 轮换挂，已登记移交 Codex 定位）；此前 2 个 transfer fixture 失败未复现（8A 韧性修复后） | worktree 实测 2026-10-08 |
| typecheck / build | 0 错 / 通过 | worktree 实测 |

## 2. 独立复审边界（如实声明）

- 本收官由 **Claude 单智能体完成**（用户授权至 Task 8 结束），无第二 reviewer。
- **建议 Codex 做交叉复审**，重点三处：
  1. `scripts/trace-phase2-isolated-electron-runner.cjs`——Claude 修正链（根展开 + antd 空格/菜单 extra 匹配 + expectedBusinessRejections 豁免计数）；
  2. `plan-repository.ts` 的 renameWithRetry 退避语义（EPERM/EBUSY 重试是否与 8C 契约、agent 身份守卫有未预见的交互）；
  3. Context 入口「不完整选择拒绝」的业务 throw 逃逸为 window uncaught——建议 Codex 改为不逃逸的拒绝方式（message + 非抛出拒绝），可消除该豁免。

## 3. 人工验收边界（自动化不覆盖，交用户）

- 原生键鼠手感、输入法候选窗（IME）、系统 DPI 缩放、极窄/极矮窗口、屏幕阅读器体验。
- 真实安装包（NSIS）安装/卸载路径；真实杀软共存场景（8A 的自然复现环境）。

## 4. 残余风险

| 风险 | 等级 | 缓解状态 |
|---|---|---|
| 8A 偶发保存失败根因未定位（自然复现） | 低频 | renameWithRetry 韧性修复显著降低触发面；日志含每次 rename 重试记录（可回溯） |
| target-picker it.each 轮换 flaky | 中（测试可靠性） | 已登记移交 Codex 定位（dump 已入失败信息）；不豁免不跳过 |
| `writeJsonAtomic` mkdir 前的目录句柄竞争窗口 | 极低 | 未观测到复现；renameWithRetry 覆盖 EPERM 路径 |
| writeJsonAtomic 同目录 500ms 抑制窗口内的并发外部编辑可能被漏报 | 低 | 既有 markInternalWrite 语义固有；记录在案 |

## 5. 交接清单

- [x] 全部子项验收证据落盘（本文件 §1 + Task8-Current-Status「恢复执行结果」节）
- [x] runner 修正入库（`scripts/trace-phase2-isolated-electron-runner.cjs`，含 Codex 基础版本，commit 9a502e5）
- [x] 结构性待办登记：视图骨架提升（TopBar/StatusBar App 级单点）——HANDOFF 结构性待办节
- [ ] Codex 交叉复审（§2 三处）——待安排
- [ ] 用户人工验收（§3 边界）——待安排
- [ ] Task 8 关闭确认（用户判定 §3 人工边界通过后）

## 6. 合并与发布（不在 Task 8 自动步骤内）

worktree 分支 `codex/xiaoyuan-plan-operations` 含本计划全部提交；**合并回 main** 的时机与方式（merge/rebase、是否携带 phase2 进行中改动）需用户与 Codex 协调——main 当前另有 0.12.0 后的独立推进（深色主题/导出为等已直推 main），合并时注意两侧变更的冲突面（预计在 `plan-repository.ts`/`register.ts`）。
