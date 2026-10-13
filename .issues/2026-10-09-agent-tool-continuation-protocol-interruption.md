# 小沅工具操作后的续轮协议中断

状态：安全 schema 摘要已实现；单计划完整任务清单路径已修复并通过本地回归。原始模型调用的具体 schema 不匹配字段仍未知，待用户侧真实模型复验
发现日期：2026-10-09
关联计划：`docs/Plan/Future_Plan/Qore/Trace/Plan-261009-02-小沅请求错误诊断与复制/Agent-Request-Diagnostics-Plan.md`

## 现象

本机会话中，首轮对话完成；小沅执行 1 次计划创建工具操作并得到成功回执后，工具结果后的 assistant continuation 收到 HTTP 200，但以 `error-interrupted / protocol` 结束。UI 中的批次摘要和逐项回执是同一工具操作的两处呈现，不是重复执行。

## 当前证据边界

持久化会话只保留错误类别和 HTTP 状态，没有 SSE parser 的静态阶段码；截图不包含原始 SSE，因此尚不能确认拒绝规则。此前固定能力测试复现并修复了重复终止帧兼容问题，但不能据此推断普通对话续轮是相同原因。

## 诊断实现与验证

- 仅在 `AgentRequestService` continuation provider stream 上启用现有 `AgentStreamDiagnostic` allowlist observer，且仅限 `ELECTRON_RENDERER_URL` 开发环境；普通首轮和生产环境不记录。
- 本机开发主进程日志最多包含 request ID、HTTP 状态/归一化媒体类型、有限 SSE 结构摘要及静态阶段码；不记录 prompt、计划/消息正文、raw SSE/body、URL、API Key/Bearer，不新增 IPC 或持久化，不改变解析规则，也不自动重试。
- Loopback 测试先 RED（开发续轮无诊断），最小接线后 GREEN。`npm run test -- test/agent-request-ipc.spec.ts`：43/43；`npm run typecheck`：通过；目标 `git diff --check`：通过。
- 新 Electron dev 主进程已重启并报告 `[trace] main ready`，renderer 使用 `http://localhost:5174/`。未由此自动发起模型请求。

## 下一步

由用户在开发窗口中从原待处理批次点击“再次预览续轮外发”，核对隔离预览内容并自行确认一次。再从本机开发终端收集阶段诊断，根据具体静态 code 定位；不重发初始请求、不自动重试、不把尚未取得的诊断解释成根因。

## 真实应用续轮复现（2026-10-09 20:58 左右）

- 用户在隔离预览中确认后，开发主进程确实发出一次 continuation 请求并收到 HTTP 200 / `event-stream`。诊断显示单个 allowlist 工具调用、参数字符串长度 145、`finish_reason=tool_calls`，并正常收到 `[DONE]`。
- 失败阶段为 `completion.arguments_schema`：SSE 传输、JSON 参数解析与工具名称 allowlist 检查均已通过；正式本地参数 schema 校验拒绝了工具参数。该调用未返回给操作服务执行。已有计划创建操作仍是成功回执。
- 诊断按隐私设计没有输出具体工具名、参数字段或值，故尚不能判定实际不匹配项。此前能力探针的空 assistant 终止帧修复与本次失败阶段不同，不是本次拒绝点。
- 同时出现多条 `agent:request:continue code=21`。`21` 是本地 `ERR.STATE_MACHINE`，IPC 将内部消息收敛为通用提示；这些记录与 HTTP 200 参数校验失败是不同层的结果。现有日志不能区分每次命中状态门的具体原因，也不能据此推断触发次数。
- 下一步为开发模式增加严格脱敏的 schema mismatch 摘要：仅输出静态 allowlist 工具名、schema 定义中的路径与失败类别/实际 JSON 类型、未知字段数量；不输出参数值或任意字段名。以 loopback HTTP SSE 回归确认拒绝结果不变且无正文泄露。之后如需真实定位，需用户检查并确认新的续轮预览；本轮不自动重试或再次外发。

## 安全 schema 摘要实现与回归（2026-10-09 21:15）

- `AgentSseAccumulator` 在原有 `completion.arguments_schema` 拒绝前，通过已有开发诊断 observer 额外输出 schema mismatch 摘要：语法受限的工具名、静态 schema 路径、有限失败类别、JSON 类型、schema 预期类型，以及未知字段数量。现有普通续轮和能力测试诊断 observer 均受 `ELECTRON_RENDERER_URL` 门控。
- 未输出参数值、未知属性名或任意模型字段；不改变 schema、校验结果、错误分类、重试或外发审批流程。该诊断通过 `AgentRequestService` 仅续轮且仅 Electron 开发模式 observer 到本机终端。
- loopback HTTP SSE 新增两项测试：未知字段只报告计数且不泄露 key/value；已知字段类型不符只报告静态路径与类型，不泄露具体值。先 RED 后 GREEN。`npm run test -- test/agent-provider-http.spec.ts test/agent-request-ipc.spec.ts`：92/92；`npm run typecheck` 和 `npm run build` 通过；`git diff --check` 通过（有其它既有文件换行格式提示）。
- 下一步：重启开发 Electron 使新主进程代码生效。用户可在核对隔离预览内容后自行决定是否再确认一次真实续轮；本轮未运行真实模型请求。新诊断尚未经过真实响应验证，因此具体不匹配字段仍未知，不能据 loopback 结果宣布产品问题已修复。

### 单计划完整任务清单修复（2026-10-09）

- **目标澄清：** 用户要求把给出的一组事项创建为一个计划并全部放入其中，而非只创建空计划后停止，也不是拆成多个计划。
- **代码原因与证据边界：** 之前应用续轮在工具参数 schema 阶段被拒绝，但既有安全诊断没有保存工具名或具体字段，本轮不能断言原始模型调用到底违反了哪条约束。独立核对工具契约发现，旧 `plan.create` 只接受名称与父目录，没有表达初始任务列表；另一次 `task.add` 不能在缺少该用户消息目标授权时自动接续。因此按明确的产品目标扩展安全的单次创建契约，而不是关闭 schema 校验。
- **实现：** `plan.create` 新增严格封闭的可选 `task_list`（1–50 个任务，字段仅允许标题、日期和备注）；主进程生成 ID、强制任务状态为未开始，通过单次原子写入创建一个计划文件，预览展示完整任务列表。多任务创建作为批量操作要求确认；取消时不落盘。保留路径安全、库根/父目录身份校验和现有 CAS 提交路径。
- **回归与验证：** registry schema 测试和公开 typed IPC + loopback SSE + 临时库测试先 RED 后 GREEN；测试确认完整七项在一个计划内、任务 ID/状态由主进程提供、预览包含全部事项、取消无写入。`agent-tool-registry`、`agent-operation-ipc`、`plan-reference-ipc`、`storage-service` 四个相关 spec 最终 145/145 通过；`npm run typecheck` 与最终 `npm run build` 通过；`git diff --check` 通过。期间出现一次既有 fixture `SAVE_FAILED`，同例重跑通过，随后四个 spec 全量重跑通过；未运行全项目测试。
- **未做事项：** 未调用真实模型、未重发原始消息、未启动/重启 Electron、未改动此前已经成功创建的空计划。实际模型是否调用新工具 schema、原始 mismatch 的具体字段、安装版表现均仍待验证；不得把本地回归说成真实模型复验。
