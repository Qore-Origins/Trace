# 小沅预览目标授权范围与工具调用历史顺序

- 状态：Task 4 fix round 1–3 已完成；round 3 精确差异双轴 APPROVED，问题关闭
- 发现日期：2026-10-04
- 来源：Task 4 独立规格/质量与安全复审

## 现象

一次用户外发预览只确认了 grant set 中的目标 A，但主进程将同一授权集内的 A、B 都绑定到已提交的用户消息。目标解析仅检查消息 ID，因此同一请求后续有机会解析用户没有在该预览中确认的 B。

另外，达到每请求 8 轮或 20 次工具调用的精确上限时，continuation 仍会先写入新的 `streaming` assistant；多个工具结果也可按调用方顺序逆序写入会话，产生不可重放的 Chat Completions transcript。

## 预期行为

1. 授权集仍只绑定到一条 main 生成且已持久化的用户消息，防止跨消息复用；解析范围进一步限于该消息对应、经主进程隔离预览窗实际确认的 refs。同一消息授权范围固定，不允许后续追加 refs；新目标需新用户消息。
2. 达到 8 轮或 20 次任一上限时，在会话写入前拒绝 continuation，不能留下 streaming 消息或发起下一次模型请求。
3. 工具结果作为完整调用组校验，并按 assistant 的原始 `toolCalls` 顺序持久化；无效顺序不得被 repository 接受。

## 修复与验证记录

### Task 4 fix round 1

- 提交：`1cfa1f1dc445f3fc25df603f2e94f36e1065683f`。修复 8/20 精确上限、完整有序 tool result transcript、只解析冻结预览实际展示的 refs。
- 验证：focused 3 specs 51/51；`npm run typecheck`；`npm run test -- --maxWorkers=1` 78 files / 903 tests（214.84s）；diff-check 全通过。
- 规格/质量复审 APPROVED；安全复审 NEEDS FIXES，新增两项 Important：主 renderer 可直接发送 IPC 绕过确认；同消息 grant 增量绑定只在 service 可用，当前 preview 流每次生成新的 user message ID，故后续追加确认路径未实现。
- Task 5 尚未开放计划工具执行器；没有经此路径读取计划。

### Task 4 fix round 2（已授权，待实施）

- 用户选择：使用主进程控制、与主 renderer 隔离的预览窗；一次消息仅授权该次完整快照实际确认的目标，新目标另发消息确认。
- 覆盖全部 provider 网络请求，包括聊天、工具结果续发与模型能力测试。普通 renderer 的 send IPC 只可请求 main 打开预览窗；不能授权 fetch。
- 独立 preload 仅允许读取该窗口的 main-owned snapshot 与提交一次 confirm/cancel；main 校验发送者为当前批准窗的 webContents/main frame、页面身份和 pending 状态。窗体关闭、加载失败、崩溃、导航、过期、伪造及重放均 fail closed。
- 窗口不得暴露主 renderer 通用 `window.trace`、API Key、用户路径或持久化 preview 内容；正文必须安全地纯文本渲染，完整显示实际 provider endpoint/model/body；发出请求前继续复核原冻结快照。
- 具体 owner 与文件范围记录在 `docs/HANDOFF-CURRENT.md`；实现/复审命令与结果追加到 SDD ledger。本轮状态记录时仍未开放 Task 5，未运行 build、未升版本、未推送发布。

### Task 4 fix round 2 与复审

- 实现提交：`b31a96e138fe9efd6aeeef0133f45c47ac29d0e7`。
- 行为：用户在与主 renderer 隔离的批准窗中看到实际冻结 endpoint/model/body 并确认后，main 才允许发送；聊天、工具续发与 capability probe 共用该闸门。一次用户消息的 refs 固定；关闭、崩溃、加载失败、导航、伪造、重放均 fail closed。
- 验证：focused 13 files / 195 tests、typecheck、串行全量 79 files / 920 tests、应用 build 与产物检查、bundle-budget 3/3、diff-check 全通过。
- 规格/质量复审 APPROVED（0 Critical / 0 Important / 2 Minor）：审批窗 channel/type 应纳入 `ipc-contract.ts` 单一类型合约但不暴露给 `window.trace`；stdout no-op 兼容应限定 build + non-TTY。
- 安全复审 APPROVED（0/0/0），确认 round 1 两项 Important 关闭，且无敏感数据/异常处理问题。Task 4 继续保持未关闭，Task 5 未开放；按 HANDOFF 已登记的 round 3 边界修复两个 Minor，再做双轴 scoped re-review。

### Task 4 fix round 3 最终关闭

- 提交：`3cc14393825af57498641210479136dec41527a0`；精确差异 `b31a96e138fe9efd6aeeef0133f45c47ac29d0e7..3cc14393825af57498641210479136dec41527a0`。
- 私有 approval IPC 使用独立 typed contract 与主进程统一 wrapper，仍不进入普通 `window.trace`；stdout workaround 仅在 build + non-TTY 条件启用。
- 两项既有 Minor 已关闭。规格/质量 reviewer 与安全 reviewer 均 APPROVED，0 Critical / 0 Important / 0 Minor。
- 实现者 focused 18/18、Node/Web typecheck、串行全量 79 files / 922 tests、build、diff-check 通过；协调者独立复跑 focused 18/18、typecheck、build、diff-check 通过。
- Task 4 所有权已释放；Task 5 已按共享计划登记实施。未升版本、未构建安装包、未推送或发布。
