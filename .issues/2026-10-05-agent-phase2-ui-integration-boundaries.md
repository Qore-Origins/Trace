# 小沅 Phase 2 UI 接入前服务边界缺口

- 状态：开放；在 7B 正式 UI 暴露前修复并独立复审
- 发现日期：2026-10-05
- 来源：Task 7B 只读 IPC/服务调用链盘点
- 代码状态：相关 Agent 服务代码仍在未合并隔离 worktree，尚未发布给用户

## 1. 日记路径可作为计划目标授权

Phase 2 明确不允许 Agent 修改 Diary，但 `AgentTargetService.parseSelection`/`grant` 当前允许 `Diary/...` 作为 plan/folder grant。`plan.read` 可读取该目标，组件 add/update 等调用能够进入计划保存路径；`validateAgentAuditedPath` 只保护部分操作结果路径，不能阻止这些读写。风险范围是尚未合入的 Phase 2 实现。

**预期修复：** main process 在 plan/folder 目标 grant、validate、refresh 与 capture 的统一边界拒绝 `Diary` 根目录及其后代，并考虑 Windows 大小写路径；不能只在 renderer picker 隐藏选项。保留 Phase 1 明确授权的按篇日记读取。

**回归：** typed IPC 临时库测试拒绝 Diary plan/folder grant、后续 validate/refresh 及工具读写路径；确认普通计划目标和按篇日记上下文选择仍可用。

## 2. Agent 回收站工具批次预览缺少权威影响摘要

`AgentOperationService.confirmationPreviewFor()` 当前没有映射 `PreparedOperation.trashPreview`。Main 已有 `plan_count`、`reference_count`、`original_relative_path`、`restore_relative_path`，但 `AgentOperationBatchRead` 的预览 DTO 丢弃这些信息，renderer 无法忠实展示恢复/永久清除影响。

**预期修复：** 扩展共享预览 DTO，仅传递调用/操作/条目身份、原位置、恢复位置、计划数与入站引用数；不传底层 commit token、绝对路径或正文。UI 只渲染 main 提供的值。

**回归：** operation service/IPC 覆盖 restore 与 purge 预览中的这些字段，以及不得泄露 token/绝对路径；renderer 检查差异和引用摘要可见。

## 3. 续轮外发取消后无显式重新预览路径

当前 IPC 在本地工具执行后只自动尝试一次模型续轮。用户取消隔离外发确认后，拒绝被吞掉；批次可能保持 `awaiting-outbound-preview`，但没有 renderer 可调用的重新预览路由。续轮基础快照仅保存在 main 内存，进程重启后缺失。

**预期修复：** 为 `{sessionId,batchId}` 增加 main 守卫的 typed 续轮预览入口：先核对 awaiting 状态、工具结果完整、请求无后续 assistant/streaming，再走现有冻结快照与隔离审批窗。应用重启后无法证明原快照时 fail closed 并明确提示，不得重放工具或外发新内容。

**回归：** loopback provider 测试覆盖取消时零外发、再次预览须经隔离审批、成功续轮、无效/重复/重启后续轮拒绝、批次状态准确；不绕过现有 main 审批门。

## 4. 已确认无须新增的关联字段

批次审计已有 `assistantMessageId`，每一轮来源唯一；不能只按 `requestId` 或时间匹配。Renderer 可按此 ID 精确归属每个操作批次消息。重试 attempt 使用 `attemptOf`。Session parser 可补消息/tool call 引用一致性验证，但不必新增持久 `batchId` 字段。

## 5. 7A 回收站 UI 独立安全审查发现：异步预览竞态

2026-10-05 安全 reviewer 对 TrashDialog 只读审查时发现：恢复与永久清除预览的 IPC 响应没有绑定发起时的条目/请求世代。取消条目 A 后切换到条目 B，如果 A 的迟到响应写入当前预览状态，确认 UI 会显示 B 但持有 A 的一次性 token；同名条目时可将确认错误地提交到 A。

**修复要求：** 将预览状态绑定到操作类型、当前 entry ID 与单调请求序号；取消/换条目/切库/关闭时使旧请求失效。仅在响应仍属于当前操作且返回的 `entry_id` 匹配时设置预览；提交时再次验证预览与当前 entry ID/operation 匹配。为 restore 与 purge 分别添加 out-of-order、取消后迟到、换条目/切库失效回归，断言旧 token 永不提交。

**同轮质量 Minor：** 还原目的地文件夹列表 IPC 失败当前被静默转换为空列表。向用户呈现明确的可重试错误，不应让失败伪装成空库；补回归测试。

**当前所有权：** `/root/task7_trash_ui_resume` 仅重新拥有隔离 worktree `src/renderer/src/components/TrashDialog.tsx` 和 `test/trash-dialog.spec.tsx`，只修以上审查发现。不得修改其余 Task 7A 文件、Agent/main/preload/shared 或共享文档。修复完成后由两位只读 reviewer 复审并由协调者复验，再释放。

## 6. 7A 二轮双轴复审发现：提交在途时仍可关闭并丢弃结果

旧预览错配已修，双方 reviewer 复核后发现新的提交生命周期问题：restore/purge commit IPC 发出且等待期间，嵌套确认 Modal 的取消按钮、X、Escape，以及父级 Trash Modal 关闭事件仍能清空当前 entry/sequence。主进程请求不会因此取消；若随后成功，commit handler 在刷新后因为 entry 不再 current 而静默 return，可能导致不可逆 purge 或恢复已执行但用户没有收到结果提示。用户容易将关闭理解为取消。

**修复要求：** 只在实际 commit 在途期间（不能把可取消的 preview loading 一并锁死）禁用嵌套与父级 Modal 的 X/Escape/mask/取消操作；commit 完成且结果已处理后再允许关闭或由成功流程自动收起。确保成功/失败响应不被忽略。分别为 restore/purge 添加 deferred commit 用例：提交未返回时尝试取消、X、Escape/父层关闭，确认界面不消失/关联不失效；解析成功或失败后，用户能看到相应反馈或安全错误。

审查补充：restore 名称与目标目录控件在 commit 在途时也必须锁定，避免用户修改触发 `invalidatePreview`；若库切换或组件状态变化仍令 UI preview identity 失效，已发起 commit 的返回值要绑定独立 transaction identity 处理，不能仅用 preview 的 currentness 决定是否展示结果。另有一项 Minor：切库后旧库 `entries` 在新 `trash:list` 返回前仍显示且可操作，应在切换时清空或禁用旧条目并待新库加载。

**当前所有权：** `/root/task7_trash_ui_resume` 仅重新拥有隔离 worktree 的 `src/renderer/src/components/TrashDialog.tsx`、`test/trash-dialog.spec.tsx`，解决本节、锁定恢复/清除相关表单并关闭切库旧条目 Minor，同时保留第 5 节已修行为；不修改其他文件。两轴 reviewer 复审 Ready 后协调者复验并释放。

## 8. Task 7B UI 实现边界

**前置门已闭环（2026-10-05 22:45 +08:00）：** Task 7B0-C 及全工作树修复均完成；两轴审查 Ready: Yes，协调者复验 7 个定向 specs / 190 tests、Node/Web typecheck、进程启动时 `TZ=America/New_York` 的串行全量 82 files / 1066 tests 均通过。P3 精确容量等值/溢出回归建议为非阻断待办。

**原实现边界（已释放）：** `/root/xiaoyuan_workbench_ui_impl` 曾独占隔离 worktree 中 `src/renderer/src/views/AgentView.tsx`、`src/renderer/src/views/agent-chat/**`、`src/renderer/src/styles/agent-view.css`、`src/renderer/src/i18n/locales/agent-chat-{zh-CN,en-US}.ts`、`test/agent-view.spec.tsx`、`test/agent-view-preview.spec.tsx`、`test/agent-view-test-support.ts`，以及 `test/agent-target-picker.spec.tsx`、`test/agent-operation-view.spec.tsx`；该轮已停止写入并释放。使用 `task-7b-ui-brief.md` 与已验收 Task 6 Demo；仅通过既有 typed IPC。不得改 App/TopBar/WorkspaceView、非 Agent stores、Task 7A Trash、main/preload/shared/IPC/schema、依赖或共享文档；需要扩界时先停并向协调者说明具体理由。不得 stage/commit/merge/version/build/push/release。

**安全撤销补充边界（2026-10-05 23:34 +08:00）：** 全量测试基线前复核发现 retry/continue 成功操作虽然在 attempt ledger 中可见，但缺少按 attempt 撤销入口。现将实现者的当前所有权暂时收窄为仅 `src/renderer/src/views/agent-chat/AgentOperationView.tsx` 与 `test/agent-operation-view.spec.tsx`：为成功、可撤销、`undoStatus === 'available'` 的 attempt 项显示入口；调用既有 undo route 时传该 attempt 的 batchId 与 callId；reconciliation-required/outcome-unknown、不可撤销项必须保持锁定/无入口。RED 已实跑 9 passed / 2 failed，首轮 GREEN 11/11；仍需补锁定回归与 typecheck。实施者释放后再恢复 Task 7B 其他 UI 文件的协调者审查，不扩大到主进程、IPC、schema 或 UI 外文件。

**安全撤销闭环（2026-10-05 23:40 +08:00）：** 实施者完成并释放两文件；最终 operation-view spec 16/16，覆盖 successful retry/continue attempt 的 batchId/callId 路由、root 与 attempt 不确定状态、失败/不可逆/unavailable 排除。协调者独立复跑该 spec 16/16、Node/Web typecheck、diff-check 均通过。只读规格/交互与安全/质量复审已启动；串行全量测试在复审后重跑。

**复审 findings 与修复所有权（2026-10-05 23:53 +08:00）：** 规格 reviewer Ready No，发现 sibling attempt 状态锁未传递到独立渲染的 pending-confirmation/executing 子卡（Major）；另有左侧桌面栏 280px 低于 Demo 已确认的 340px 最小目标（Minor）。安全 reviewer Ready Yes、未发现可利用绕过；标准 reviewer 发现窄屏 tab 的 aria-controls 未配 tabpanel/aria-labelledby、无 roving tabindex 且 pointer preventDefault 阻断活动 tab 获焦（Minor）。现单一 owner `/root/xiaoyuan_workbench_ui_impl` 仅持有 `src/renderer/src/views/agent-chat/AgentOperationView.tsx`、`test/agent-operation-view.spec.tsx`、`src/renderer/src/views/agent-chat/AgentChatPage.tsx`、`src/renderer/src/styles/agent-view.css`、`test/agent-view.spec.tsx`；测试先 RED 后 GREEN，锁定 sibling uncertainty、ARIA/tab焦点和340px布局目标。不得改其他文件；完成后释放，再只读复审与协调者全量验证。

**设计约束：** 桌面默认双栏——左侧当前批次对话与底部常驻单一 composer，右侧预检/执行/恢复任务流；两侧独立滚动。约 960px 以下可切换工作面，但 composer 不卸载、不丢草稿/焦点/选区/IME。按批次编年，attempt 与 item receipts 在各批次内折叠；空 `@` 允许普通对话/新建，但既有对象操作必须显式目标；每次外发都走 main-controlled isolated preview。禁止 implicit context upload、自动滚动/无必要动效、重做 Demo 或 renderer 绕过 IPC/安全确认。

## 7. Task 7A 最终复审与闭环；Task 7B0-A 完成及 B 登记

Task 7A 三轮修复后，最终质量与安全 reviewer 均 Ready: Yes，未留 Critical/Important/Minor。最终发现并修复的刷新反馈问题是：`refresh()` 把较新请求替代的旧请求返回 `false`，commit handler 在 A→B→A 切库且旧响应最后到达时把 `stale` 误当成真实失败。现在刷新结果显式区分 `refreshed | failed | stale`；只有真实列表失败或树刷新 reject 才显示“刷新失败”。A→B→A 回归确保旧结果不覆盖最新 A 列表且不误报。提交在途锁、确认 token 与 operation/entry/root/request sequence 绑定、切库隐藏旧垃圾列表等修复均经复审确认。

协调者独立验证：`npx vitest run test/trash-dialog.spec.tsx test/plan-tree-actions.spec.tsx test/style-boundaries.spec.ts --pool=threads --maxWorkers=1`，3 specs / 38 tests；`npm run typecheck`（Node/Web）；`git diff --check`，全部通过。7A owner 已释放其两文件，未暂存/提交。

**Task 7B0-A 闭环（2026-10-05 19:36 +08:00）：** `/root/diary_target_guard_impl` 已释放两文件。修复前 RED 14/35；修复后 `npm run test -- test/agent-target-ipc.spec.ts` 45/45、Node/Web `npm run typecheck`、`git diff --check` 全通过。独立安全审查 Ready Yes，未发现绕过。非阻断建议：为中间路径别名最终解析到 Diary 加一个单独回归；当前 canonical realpath guard 已拒绝此目标。

**Task 7B0-B 闭环（2026-10-05 20:09 +08:00）：** `/root/trash_impact_dto_impl` 已释放三文件；映射只从 frozen `PreparedOperation.trashPreview` 取安全字段，restore/purge typed IPC 54/54、独立审查 Ready Yes。协调者全量 `npm run test -- --maxWorkers=1` 82 files / 1057 tests、Node/Web typecheck 与 diff-check 均通过。混合 restore/purge 因既有 structural footprint 冲突仍按原规则拒绝，未改策略。

**Task 7B0-C 实现已释放（2026-10-05 21:25 +08:00）：** `{sessionId,batchId}` route 只在完整 awaiting receipts、目标 assistant 仍为该请求最后 assistant、无 streaming/后续 assistant 时复用当前进程 frozen snapshot 进入既有隔离审批；重启 fail closed，未重放工具/授权。实施者 36/36、Node/Web typecheck 与 diff-check 通过。用户选择的全工作树基线审查结果：route 本身符合；另登记三个精确修正：`/root/audit_limit_constant_impl` 仅拥有 `src/main/services/agent-operation-service.ts`、`src/main/services/agent-session-repository.ts`，将重复的审计值 `50_000` 抽成共享命名常量、不改变边界；`/root/demo_scope_impl` 仅拥有 `demo/xiaoyuan-phase2/README.md`、`demo/xiaoyuan-phase2/index.html`，移除本期不支持的任务组件 Trash 示例，保留计划/文件夹示例；`/root/trash_single_modal_impl` 仅拥有 `src/renderer/src/components/TrashDialog.tsx`、`test/trash-dialog.spec.tsx`，以一个 Modal 在列表/恢复/清除步骤间切换，避免叠层并保留现有安全确认/请求失效语义。三个范围互不重叠；必须先按 TDD 增加/运行对应行为测试，再修复并独立复审。完成后协调者复验并进入 UI Task 7B。未 stage/commit/merge/version/build/push/release。

**7B0-C 首轮整改及新标准边界（2026-10-05 21:51 +08:00）：** 首轮常量/Demo/单 Modal 修复均已完成并释放；规格轴复审 Ready: Yes。协调者相关 4 specs / 126 与 Node/Web typecheck 通过。全量测试在新标准 finding 出现后中止，未完成。标准复审仍 Ready: No，后续精确 owner：`/root/agent_tool_limits_impl` 仅拥有 `src/main/services/agent-tool-registry.ts`、`src/main/services/agent-operation-service.ts`、`test/agent-operation-ipc.spec.ts`，复用 `AGENT_MAX_TOOL_CALLS_PER_REQUEST` 并约束 retry callIds；`/root/agent_session_limits_impl` 仅拥有 `src/main/services/agent-session-repository.ts`，命名 2048 batches、4096 relative path chars、64 changes 边界；`/root/plan_move_preview_limit_impl` 仅拥有 `src/main/services/plan-reference-service.ts`，命名 64 move preview cache 上限。三组范围不重叠，修复后做标准复审、全工作树双轴复审与协调者串行全量验收。未 stage/commit/merge/version/build/push/release。

## 交接

修复顺序：Task 7A Trash UI 完成、复验和独立审查后，新增一个精确登记的 Task 7B0 服务/API 修复批次，完成 Diary 拒绝、trash preview DTO、续轮 preview 路由及 parser 回归；该批次经独立只读复审后，再将能力接入 Task 7B Agent 工作台。
