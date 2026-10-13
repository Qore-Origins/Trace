# 小沅请求错误详情与复制

> 状态：诊断 UI 与 HTTP 200 / SSE、JSON 错误识别已实现；能力测试的应用内 SSE 根因已定位并验证 profile 通过；普通续轮已定位到本地工具参数 schema 阶段；单计划完整任务清单路径已本地修复，原始 mismatch 字段和真实模型复验仍待完成
> 版本：v1.0.0 发布后改进；本轮未提交、未升版或发布

## 用户问题

小沅请求异常中断时只显示通用提示，用户难以判断服务端的具体拒绝原因。用户希望查看具体错误，并通过按钮复制模型返回的信息。

## 设计与安全边界

- 对新的非成功 HTTP 响应，从 allowlist 结构化字段中提取错误摘要，并保留错误分类和 HTTP 状态。
- 有界读取响应错误体；移除当前服务 API Key、Bearer 凭据、常见 token 和控制字符；摘要长度不超过 512 字符。
- 将可选诊断附加到对应的异常中断助手消息；旧会话没有此字段时仍可读取，不伪造历史错误详情。
- 异常中断消息默认保持简洁；用户展开后查看服务、模型、请求时间、错误分类、HTTP 状态与安全摘要。
- “复制诊断信息”仅复制界面明确展示的上述字段；不复制完整 HTTP body、请求正文、对话历史、计划/日记上下文或凭据。
- 本次改善错误可观测性，不自动重试，也不声称已经修复连续请求中断的根因。

## 实施结果

- Provider 对错误响应进行最多 8 KiB 的有界解析，只接受明确允许的消息字段；敏感值脱敏后才进入持久化诊断。
- 会话 schema 严格验证可选诊断字段，限制分类、状态码、消息长度与控制字符，并只允许它出现在异常中断的助手消息中。
- UI 提供折叠诊断详情、一键复制及剪贴板拒绝时的本地反馈；中英文文案均已补充。
- 回归覆盖 loopback HTTP 错误、IPC/会话持久化、密钥与原始响应隔离、旧记录兼容、详情展示和复制内容。

## 验证记录

- `npm run test -- test/agent-request-ipc.spec.ts test/agent-session-repository.spec.ts test/agent-view-preview.spec.tsx`：3 files / 58 tests passed。
- `npm run typecheck`：通过，exit 0。
- `npm run build`：通过，exit 0。
- `git diff --check`：共享计划索引中的尾随空格已修复；最终检查记录见 `docs/HANDOFF-CURRENT.md`。
- 未运行全量测试；未启动 Electron 做真实视觉/系统剪贴板验收；未构建 Windows 安装包。

## 文件边界与后续

代码所有权清单、基线与主工作树既有改动边界见 `docs/HANDOFF-CURRENT.md`。设置弹窗、按钮间距审计、Provider 配置与其它既有工作树内容不属于本计划。

下一步由用户在 Electron 中触发一次真实服务错误，展开详情并确认复制内容。复制失败原因仍可能来自服务端、网络或兼容问题，需要用新增的诊断信息另行判断。此项在用户体验验收前不视为视觉/安装版验收完成。

## 用户实测后的跟进（2026-10-09）

用户反馈一次智谱 GLM-4.7-Flash 请求在输出部分文本后异常中断；复制信息为 `protocol` / 无 HTTP 状态 / 无可识别摘要。当前没有原始 SSE payload，不能据此断定服务端实际返回了哪种错误。

实现已让 HTTP 200 SSE 中的结构化 `error` 或顶层 `message`/`msg`/`detail` 事件，以及 HTTP 200 JSON 中的结构化错误走 allowlist 提取和脱敏路径，并让协议解析失败保留已知 HTTP 状态码。错误类别为 `provider`，界面文案为“服务端错误”；只保存安全摘要，不保存/展示原始 SSE 事件或完整响应。错误正文最多读取 8 KiB、总读取时间最多 200ms；非 2xx 的 SSE response 不等待流结束来读取错误正文，以免服务未关闭流时覆盖 HTTP 状态并拖到超时。

### 补充实现与验证结果（2026-10-09）

- Provider loopback 回归：旧实现对 HTTP 200 的结构化 SSE error 返回 `protocol`、无状态/摘要；修复后验证 `provider`、HTTP 200、白名单摘要、API Key 与 Bearer 脱敏、原始字段不外泄，并保留此前已收到的部分文本。
- IPC / 本地会话回归：验证 `provider` 分类、HTTP 200 和脱敏摘要可以持久化，原始错误事件、API Key 与 bearer token 不进入会话或事件。
- `npm run test -- test/agent-provider-http.spec.ts test/agent-request-ipc.spec.ts test/agent-session-repository.spec.ts test/agent-view-preview.spec.tsx`：4 files / 100 tests passed。
- `npm run typecheck`、`npm run build` 和代码范围 `git diff --check` 通过。
- 全量 `npm run test`：87 files / 1211 tests，1208 passed / 3 failed。失败一为 `test/style-boundaries.spec.ts` 的兼容样式 import 列表未包含既有未提交 `settings.css`；失败二为 `test/plan-reference-ipc.spec.ts` 的 fixture 准备 `savePlan → writeJsonAtomic` 返回 `SAVE_FAILED`；失败三为 `test/agent-target-picker.spec.tsx` 的多 `@` 目标 UI 等待超时。未修改这些不属于本轮的失败；SAVE_FAILED 未取得底层 errno，本轮不归因根因。
- Electron 开发窗口已由当前源码重启：main/preload 构建完成、`[trace] main ready`，Vite 地址 `http://localhost:5174/`。此项只证明开发环境启动，不等同于真实模型回归或安装包验收。
- **当时的待办验收（已由下方两项真实模型诊断完成）：** 用户需在真实模型上再请求一次，查看并复制诊断。由于没有原始响应 payload，当前修复仅证明合成 SSE/JSON 错误格式可以被安全识别，不证明它就是用户截图那次错误的具体原因，也不证明连续请求中断的整体根因已解决。

### 两项真实模型诊断结果（2026-10-09 14:50 +08:00）

- 使用当前默认服务 `智谱glm-4`、模型 `glm-4.7-Flash`、host `open.bigmodel.cn`。API Key 仅由 `AgentProfileService` 在主进程内存中解密使用，未输出、未写入临时诊断报告或共享计划。
- 无网络 Electron dry-run 通过，确认正式 Electron CLI 能运行临时入口、标记输出正确且 Trace 用户数据目录匹配。
- 连通性探针发送 1 次，使用固定短消息“请仅回复：Trace 连通性测试成功。”，在应用 Provider 的 60 秒请求超时后分类为 `timeout`；未收到 HTTP 状态或 Content-Type，不能确定该次是否到达服务端。
- 完整对话发送 1 次，通过现有会话服务创建会话、预览、精确冻结快照校验和 `AgentRequestService.send`。发往模型的消息只有用户提供的 7 项原文；无历史、计划/日记上下文、`@` 目标或工具 schema。外发批准由 harness 回调在精确快照匹配后自动放行；本轮未验证隔离审批窗的视觉或鼠标交互。服务端返回 HTTP 429，应用安全摘要为“该模型当前访问量过大，请您稍后再试”；会话中助手消息为 `error-interrupted`，正文为空。
- 完整对话测试会话保存在本地，标题“小沅对话完整性测试”，ID `23d3ea7c-0131-4f4b-9e4a-112f9f48a99a`，两条消息。用于记录这两次请求的临时 TypeScript harness、bundle 和诊断结果文件已清理。
- **定位结论：** 第二次请求确认请求到达 `open.bigmodel.cn` 并收到服务端 429，当前证据支持上游模型繁忙/限流，是完整对话失败的直接节点；本轮并未验证 HTTP 2xx、模型完整对话能力或 API Key 是否能通过成功响应认证。首次连接 timeout 原因仍未知。先前用户报告的 HTTP 200 响应格式异常未复现，不能据本轮诊断宣称已修复。
- 两次实际请求各 1 次，总计 2 次；没有重试。未改产品代码、密钥、服务配置或计划数据。本次真实模型诊断步骤已完成，但真实模型成功对话仍是未完成的验收目标，是否在服务商状态恢复后重新测试由用户决定。

### 先前真实模型发送尝试（结果未捕获，已由上方可观测诊断替代）

- 用户授权用默认智谱 GLM-4.7-Flash 配置发送一条固定测试提示，不带历史、计划/日记上下文或工具。
- 探针 bundle 编译通过；Electron 直启探针与 `--dry-run` 均返回 exit 0，但 stdout 均为空。由于无网络 dry-run 也没有可确认的探针输出，无法证明入口执行；也无法确认真实尝试是否发送了请求或获取 HTTP 状态/回复。
- 没有重试。临时 TS/CJS 探针已清理；产品代码、密钥、会话与计划数据未修改。
- **结果：** 未验证成功或失败，真实模型验收保持待办。需要用户重新授权后，再通过可观察的正式应用入口做单次测试；不得把空输出解释为模型成功。

### 工具能力协议定位（2026-10-09，独立协议探针通过；待应用内复测）

- **现象链：** 小沅正式对话只返回 Markdown 计划模板，没有调用计划工具。代码路径表明，profile 的能力状态不是 `passed` 时，`AgentConversationService` 会不给请求附带任何工具；普通对话返回模板本身不能证明模型工具调用是否正常。
- **已核实的探针契约：** 复用 `createAgentCapabilityRequest` 的固定提示 `Call the provided test function with value ready.`、工具 `trace_capability_probe`、唯一参数 `{value:"ready"}`，并依 `streamChatCompletion` 发送 forced tool choice。有效响应必须是 SSE，包含完整且结构合法的工具调用、`finish_reason=tool_calls` 及终止标记 `[DONE]`；否则按真实观察区分 `provider`、`protocol`、`unsupported`、`timeout`、`network` 等错误。
- **本轮边界：** 最多发送 1 次请求到 `open.bigmodel.cn` 的 GLM-4-Flash，不重试；只用进程内环境变量 `GLM_TEST_261009`，不输出或保存值。请求中只有上述合成提示与工具 schema，不包含用户会话或本地计划/日记。结果只记录 HTTP 状态、Content-Type、事件结构、工具名与精确固定参数匹配结果、结束原因和脱敏错误摘要；不保存原始 body。除非另行验证，不把该变量凭据等同于 Trace 设置中已保存密钥。
- **实际结果：** 一次真实请求返回 HTTP 200，Content-Type `text/event-stream; charset=UTF-8`；共 2 个 data 事件，1 个 choice，观察到工具调用片段；工具名为预期值，参数精确匹配 `{value:"ready"}`；`finish_reason=tool_calls`，收到 `[DONE]`，没有 provider error。本次独立脚本按已检查字段给出 `passed`。但响应未交给正式 `AgentSseAccumulator`，未核验其全部严格细节（如 tool-call ID 格式），所以不能等同于 Trace 内能力测试通过。
- **安全与边界：** API Key 从进程环境变量 `GLM_TEST_261009` 读取，仅驻留内存；未输出或落盘。请求仅包含合成提示与工具 schema；响应仅内存解析，无完整 body 日志或文件。最多 1 次请求，无重试。使用独立 PowerShell `HttpClient`，并未调用 Trace OS 加密密钥读取、能力 IPC 或 profile 状态写入；因此不能证明环境变量凭据与 Trace 保存密钥相同，亦不会自动将应用能力状态置为 `passed`。
- **判断：** 测试环境变量凭据、`open.bigmodel.cn` 和 `glm-4-flash` 的组合已返回所需形态的核心强制工具 SSE 内容；尚未证明完整应用解析器会接受它。正式会话此前无工具与 capability 未通过的门控吻合；剩余待区分 Trace 保存凭据、应用内 profile 配置或能力测试执行路径。不能由本探针推断之前普通流式请求异常中断的原因。
- **下一步：** 用户在 Trace「设置 → 小沅模型服务」选择对应 `glm-4-flash` 服务，确认 API Key 已正确保存后点击“测试工具能力”。如果通过，重发普通对话验证工具是否下发；如果失败，记录应用内失败分类和时间，再检查应用保存凭据与能力测试实际请求。不要将密钥粘贴到对话。

### 正式解析器复核与最小修复（2026-10-09 17:52 +08:00）

- 使用 `GLM_TEST_261009` 进程环境变量最多发送一次固定合成能力探针；未重试、未包含计划/日记/会话内容、未保存 API Key 或原始响应。相同环境变量凭据与 Trace 设置页已保存密钥是否一致仍未验证。
- 本次将真实返回交给正式 `runAgentToolCapabilityTest`、`streamChatCompletion` 和 `AgentSseAccumulator`。服务端响应为 HTTP 200 SSE；第一个 data 事件有合法 `trace_capability_probe` 工具调用和 `finish_reason=tool_calls`，随后发出同一 finish reason、空 `delta:{}` 的重复终止事件，最后是 `[DONE]`。旧解析器会在第一事件后置为 finished，并在第二事件无条件抛出 `protocol`，重现 UI 的“服务返回格式不兼容”。
- 仅修改正式累加器，接受相同终止原因且 delta 严格为空的重复终止事件；不同结束原因、含文本或工具调用等任何非空 delta，以及结构错误仍拒绝。loopback 回归按旧逻辑 RED，修复后相关终止事件测试 4/4 通过（包含既有终止后文本拒绝）；`npm run test -- test/agent-provider-http.spec.ts` 1 file / 44 tests passed，`npm run typecheck` 与 `npm run build` 通过，目标代码 `git diff --check` 通过。全量测试未运行。
- **当前状态：** 解析器级根因已复现并修复；尚未确认应用已保存密钥可用，亦未验证用户当前 Electron 窗口是否已加载新主进程代码。下一步在重启或热重载后的设置页重新点击“测试工具能力”，看状态是否通过；若仍失败，提供新的脱敏诊断与时间，继续区分密钥/profile 与其他响应结构。此修复不处理普通对话连续中断的其他可能根因。

### 应用内仍失败后的取证计划（2026-10-09 20:28 +08:00）

用户在 Electron 主进程 PID `50552`（20:22:53 启动）中，于 20:23:36 再次触发设置页能力测试，仍显示“服务返回格式不兼容”。本次截图未展示 HTTP 状态；目前不能断言是前次重复终止事件之外的哪条 SSE 规则拒绝，也不能将环境变量探针的凭据/响应等同于应用保存配置。

已实施：只在应用内固定合成能力测试路径传入诊断观察器；应用实际实例通过 `ELECTRON_RENDERER_URL` 将摘要写到本机 main 启动终端。仅记录 HTTP 状态、归一化媒体类型、前 8 个 SSE 事件的 allowlist 字段、有限的类型/长度/布尔摘要和静态失败阶段码；后续事件最多记录一次 suppressed。原始 SSE、请求正文、任意字段名/值、模型返回文本、API Key、URL 均不记录；不新增 Renderer/IPC 字段，不落盘，也不改变解析接受/拒绝规则。Loopback 回归验证阶段码与脱敏，先 RED 后 GREEN；Provider 测试 45/45、`npm run typecheck` 与目标 `git diff --check` 通过。已重启 Electron dev，main ready，renderer `http://localhost:5174/`，session `67426`（20:34:50 启动）。当前等待用户在设置页点击一次“测试工具能力”，再读取主进程脱敏日志；实际已保存凭据路径的失败阶段尚未取得。诊断不会自动重发外部请求。

### 第二次应用内证据与精确 SSE 兼容（2026-10-09 20:40 +08:00）

- **真实应用结果：** 用户点击一次“测试工具能力”后，开发环境 main 终端输出 HTTP 200、媒体类型 `event-stream`。第一 data 事件包含 1 个结构合法、名称在允许列表内的工具调用以及 `finish_reason=tool_calls`；第二事件继续带同一 finish reason，delta 字段为 `role` 和空字符串 `content`，随后收到 `[DONE]`。旧累加器将第一事件作为终止，第二事件因 delta 不完全空而以 `sse.duplicate_terminal_mismatch` 拒绝。日志不含 API Key、endpoint、请求正文、模型正文或任意原始字段值；role 的具体值未被日志记录。
- **最小修复：** 累加器现在只接受完全空 delta，或严格的 `{ role: 'assistant', content: '' }` 重复终止延续，且 finish reason 必须一致。非空内容、工具调用/其他字段、role 不符、结束原因不同及非法结构仍拒绝。没有扩展一般 SSE 容忍范围。
- **回归证据：** 精确真实形状测试按旧实现 RED；最小改动后新增接受用例与非空尾文拒绝用例均通过。`npm run test -- test/agent-provider-http.spec.ts`：1 file / 47 tests passed；`npm run typecheck` 通过；`git diff --check` 通过。
- **Electron：** 变更后首次非 TTY dev 启动在 preload 构建时因 `process.stdout.clearLine is not a function` 退出；使用 TTY 重新运行成功，main/preload 构建完成并显示 `[trace] main ready`。session `17502`，renderer `http://localhost:5174/`，Electron 主进程 PID `53948`，启动于 20:38:30。
- **应用内验收：** 变更后的 Electron 主进程出现两组完整 `capability=passed` 诊断序列；安全读取 profile 文件中的非敏感字段确认 `status=passed`、`errorCategory=null`，`testedAt=2026-10-09T12:39:19Z`。能力状态落盘已确认。诊断记录本身不判断用户触发次数。
- **结论与剩余：** 固定合成能力测试现已通过 Trace 正式路径；普通对话连续中断是否由同样的空 assistant 延续帧造成尚未验证，不能宣称中断问题已整体解决。没有自动重试或额外发起普通对话请求。

### 普通对话续轮中断诊断（2026-10-09 20:56 +08:00，等待应用复现）

- **观测结果：** 截图对应本地 session `c0c79f2a-4f08-4d31-8335-b1b4cf920b86`。首轮对话完成；1 次计划工具调用成功并产生 `created_path` 回执；工具结果后的助手续轮返回 HTTP 200，但持久化为 `error-interrupted` / `protocol`。计划批次状态为 `awaiting-outbound-preview`，UI 中批次摘要与逐项回执重复呈现的是同一操作，不是两次执行。当前会话诊断仅保存分类和 HTTP 状态，缺少 parser 静态阶段码，不能确定具体拒绝规则。
- **登记的代码与测试边界：** 仅增量修改 `src/main/services/agent-request-service.ts` 与 `test/agent-request-ipc.spec.ts`；保留这两个文件已有未提交诊断改动及整个工作树其他变更。共享文档边界见 HANDOFF。
- **拟验证行为：** loopback 首轮成功提交工具调用并完成计划操作，续轮返回 HTTP 200 格式错误；只有续轮 provider stream 在 Electron 开发模式输出有界 `AgentStreamDiagnostic` 摘要和静态失败阶段码，初始请求不输出此诊断。测试断言日志不含用户消息、raw payload、API Key/Bearer、endpoint；日志观察异常不得改变请求结果。
- **安全与产品边界：** 观察只写入本机 dev 主进程终端，不持久化、不经 IPC；仅当 `ELECTRON_RENDERER_URL` 存在时启用。不得记录 prompt/正文、raw SSE 或任意字段值；不更改 SSE 接受规则、不自动重试、不调用真实模型。实际应用复现需由用户从续轮外发预览明确确认后触发。
- **TDD 与实现：** 新增 loopback 回归先 RED：开发模式续轮没有阶段日志；生产模式不记录用例通过。最小接线后两项新用例 GREEN。仅 `AgentRequestService.dispatchContinuation` 开启 observer，且仅当 `ELECTRON_RENDERER_URL` 存在时输出现有 `AgentStreamDiagnostic` allowlist 摘要与 request ID 到主进程开发终端；普通首轮不输出。未触碰 SSE 接受规则、IPC、持久化、自动重试或外发授权边界。
- **验证：** `npm run test -- test/agent-request-ipc.spec.ts -t "logs bounded sanitized diagnostics|does not log continuation diagnostics"`：2/2；`npm run test -- test/agent-request-ipc.spec.ts`：43/43；`npm run typecheck`：通过；涉及代码与交接文件 `git diff --check`：exit 0（HANDOFF 有 Git CRLF 提示）。未运行全量测试、build 或真实模型请求。
- **当前状态：** 本地 loopback 已证明阶段码可见且日志不包含原始响应、key、用户输入或 endpoint；Electron dev 已以 TTY 重新启动，新 bundle 构建成功、main ready，renderer `http://localhost:5174/`。实际续轮阶段码仍待取得。用户需从待处理批次点击“再次预览续轮外发”，核对隔离预览内容并自行确认。任务仍在诊断中；在取得日志前，不断言普通对话中断根因，也不把能力测试通过等同于普通续轮已修复。问题记录见 `.issues/2026-10-09-agent-tool-continuation-protocol-interruption.md`。

### 普通续轮 schema mismatch 复现与下一步（2026-10-09 21:09 +08:00）

- 用户已按一次性指引核对并确认隔离预览；本机续轮请求收到 HTTP 200 / `event-stream`。SSE 形状合法，含 1 个 allowlist 工具调用，参数串长 145、终止原因 `tool_calls` 并收到 `[DONE]`；失败静态阶段为 `completion.arguments_schema`。首次计划创建成功；被拒绝的后续工具调用未执行。
- 多条 `agent:request:continue code=21` 代表本地 `ERR.STATE_MACHINE` IPC 拒绝，与已发出的 HTTP 200 请求是分离事件；没有足够证据给各次拒绝归因或推断用户点击数。
- 已实现：`agent-sse.ts` 在原拒绝阶段之前发出 `schema-mismatch` 结构诊断，字段限制为语法受限工具名、本地 schema 路径、有限失败类别/JSON 类型、预期类型及未知字段计数。普通续轮与能力测试现有诊断 observer 都受 `ELECTRON_RENDERER_URL` 门控。loopback 回归验证未知字段名/值和已知字段错误值均不会进入日志；原 schema 接受/拒绝与静态错误码保持不变。
- **验证：** 新回归先 RED 后 GREEN；`npm run test -- test/agent-provider-http.spec.ts test/agent-request-ipc.spec.ts`：2 files / 92 tests passed；`npm run typecheck`、`npm run build`、`git diff --check` 均通过。未运行真实模型请求。
- **下一步：** 重启开发 Electron 后，用户检查隔离预览并自行决定是否确认一条新的 continuation 请求。根据新 `schema-mismatch` 摘要定位实际字段；然后再判断需要修复模型提供的参数形状、provider schema 表达，还是本地 schema 定义。不能在取得具体摘要前放宽校验。

### 单计划完整任务清单修复（2026-10-09）

- 用户澄清的目标是一次创建一个计划，并把全部事项放进该计划。
- 新增严格封闭的 `plan.create.task_list` 输入；主进程负责生成任务/组件 ID、设置未开始状态，并把计划与任务清单一次原子落盘。多任务操作的确认预览显示完整清单，取消无副作用。
- registry 与公开 IPC/loopback/temp-library 回归先 RED 后 GREEN；`agent-tool-registry`、`agent-operation-ipc`、`plan-reference-ipc`、`storage-service` 共 145/145，通过 `npm run typecheck`、`npm run build` 与 `git diff --check`。
- 这修复了用户要求的创建能力，但不证明此前那次模型调用具体为何违反 schema：旧诊断没有记录工具名/字段。此前成功创建的空计划未被改写，真实模型和 Electron 复验仍待用户侧执行；未重发原始消息。
