# 多个 Agent 的工具调用实现参考

日期：2026-10-02
阶段：只读调研，供 Trace「小沅」设计参考；不是代码实现计划，也不代表外部项目的完整安全审计。

## 结论先行

工具由 Trace 定义、注册并在本地执行。模型不是工具的提供者，也不能直接调用 Trace 的进程、文件系统或 IPC；它只是在请求中收到 Trace 提供的工具描述/schema 后，按所用 API 协议返回“调用工具 X，参数为 Y”的结构化内容。Trace 主进程再解析、校验、授权、执行，并把关联了 `tool_call_id` 的结果发回模型继续本轮对话。

因此，“工具调用能力”应准确理解为：**用户当前选择的供应商端点、模型和 API 配置能否按 OpenAI Chat Completions 原生 `tool_calls` 协议完成这一往返**。它不是模型智力评分，也不是说工具由模型定义。能力探测用于识别具体配置/代理端点的兼容性问题。首发按用户确认只实现原生结构化 `tool_calls`，不实现普通文本或 JSON 指令兜底。

## 参考实现观察

| 实现 | 与 Trace 首发协议的关系 | 值得借鉴的结构 | 不直接照搬的部分 |
|---|---|---|---|
| Claude Code | 采用 Anthropic `tool_use` / `tool_result` 消息块，**不是** Chat Completions 线协议 | 模型循环只负责收集 tool-use 请求；工具编排和实际执行分层；schema 校验、语义校验与权限判定都在执行前；工具结果按原 `tool_use_id` 回传；并发仅用于标记为安全的工具 | Anthropic 的消息类型和字段；庞大的 shell/MCP/插件/子代理框架 |
| DeepCode | 直接实现 OpenAI-compatible Chat Completions，是本次最贴近 Trace 的协议参考 | 将 `tools` 定义传入请求；解析 assistant `tool_calls`；流式 `delta.tool_calls` 按 index 累积 name/arguments 后再解析；保存 assistant 调用消息，执行本地工具，再用相同 call ID 追加 `role: tool` 结果并进入下一轮模型请求；工具白名单和并发安全性属于本地 runtime 策略 | JSON 修复、不同供应商字段透传/ID 改写等广泛兼容逻辑超出 Trace 首发范围；不可因兼容性“修复”而猜测或改写未知工具名 |
| Codex | 主要走 OpenAI Responses API，**不是** Trace 首发的 Chat Completions adapter | `model_visible_specs` 与 executor registry 分离；模型返回项先转换为 typed tool call，再由本地 router/registry 找 handler；未知工具/不匹配的 payload 会作为失败返回；调用有独立 lifecycle、结果与 hook/权限边界 | Responses API 的事件与调用结构、shell/sandbox 等代码执行能力 |
| OpenClaw | 多供应商、多传输格式的兼容层，覆盖面大于 Trace 首发 | 流式调用需要跨 delta 组装；历史重放需校正调用 ID 与结果配对；工具名兼容只应对已暴露的允许列表进行解析 | 它对名字大小写、前缀、分隔符甚至 ID 的宽容规范化是为多供应商历史兼容服务；Trace 首发应先精确匹配已发送的工具名，未知/歧义调用 fail closed |
| OpenCode | 当前本地快照的 `packages` 仅有 `tui` 与 `ui`，未找到模型请求/工具 runtime 源码 | 可作为后续 UI 展示参考 | 本次不据此推断其工具调用实现 |

## 可定位的本地参考文件

以下文件均位于 `D:\Code\Project\智能体记忆系统研究\.Agent`；本次只读，没有修改这些外部源码，也没有将实现代码复制到 Trace。

- Claude Code：
  - `Claude Code/src/query.ts`：读取流中的 `tool_use` 块并驱动后续轮次（约 554 行、830 行附近）。
  - `Claude Code/src/services/tools/toolOrchestration.ts`：串行与受限并发编排，按工具的 concurrency-safe 标志分组。
  - `Claude Code/src/services/tools/toolExecution.ts`：输入 schema `safeParse`（约 615 行）、语义 `validateInput`（约 683 行）、`canUseTool` 权限路径及 `tool_result` 回传。
- DeepCode：
  - `DeepCode/core/agent_runtime/runner.py`：发送工具定义（约 851 行），接收 `should_execute_tools` 后执行、保存 checkpoint、关联 `tool_call_id` 并续问模型（约 509–560、960 行以后）。
  - `DeepCode/core/providers/openai_compat.py`：Chat Completions 非流式 tool-call 解析（约 829 行以后）与按 index 累积流式 `delta.tool_calls`（约 953 行以后）。
- Codex：
  - `Codex/codex-rs/core/src/tools/router.rs`：模型可见 spec、Responses 项到 typed call 的转换、本地 dispatch。
  - `Codex/codex-rs/core/src/tools/registry.rs`：注册表解析、未知工具/类型不匹配拒绝、hook 与执行入口。
  - `Codex/codex-rs/core/src/session/turn.rs`：采样请求循环和工具 runtime 生命周期。
- OpenClaw：
  - `Openclaw/src/agents/embedded-agent-runner/run/attempt.tool-call-normalization.ts`：历史/供应商兼容调用的工具名与 ID 规范化；首发仅借鉴“有允许列表”的边界，不借用宽松推断。
  - `Openclaw/src/agents/openai-transport-stream.ts` 及同目录测试：Chat Completions 请求/流式契约周边参考。

## 对 Trace 的建议（设计建议，待纳入完整规格）

1. **分清三层所有权**：`ToolCatalog` 描述“模型可请求什么”；`ToolRegistry` 是 main process 中唯一可执行实现；`AgentPolicy` 根据本次 `@` 目标、读取/写入授权和权限模式决定暴露哪些描述、以及某次调用是否可执行。模型传来的名字不是执行权限。
2. **工具调用循环**：构造本轮获准的 `tools` 描述并发起 Chat Completions → 检查响应是否带原生 `tool_calls` → 精确按工具名查 registry、验证 JSON/参数 schema → 做业务级检查（计划库范围、目标 ID、`@` 授权、版本/CAS、引用影响、用户确认）→ 执行 → 按 call ID 回传结果 → 再请求模型，直到普通最终答复或达到本地轮次/超时上限。
3. **首发不扩成通用执行器**：不提供 Shell、任意文件读写或动态代码执行；只声明 Trace 已批准的窄计划/文件夹/日记工具。禁止模型自行改变权限、扩展调用目标或从错误恢复中跳过用户确认。
4. **流式与非流式都要正确闭环**：若启用 SSE，函数名/参数可能拆成多个 delta；按 index 暂存并在调用完整后做一次严格解析，不要收到半截 JSON 就执行。非流式路径与流式路径应共享同一内部 `ToolCallRequest` 类型和校验/调度路径。
5. **失败保持结构完整**：未知工具、参数畸形、权限拒绝、执行异常都不产生写入；以同一 call ID 回传可理解的工具错误，避免 assistant call 与孤立 result 破坏下一轮上下文。用户已确认多步操作任一步失败即停止剩余批次并交由用户选择恢复方式，这条优先于参考项目的并发执行能力。
6. **首发全部串行**：用户确认同一模型响应中的全部工具调用先整体预检/预览，再严格按响应顺序串行执行；任一步失败就停止剩余调用。首发不并行执行任何工具（包括只读工具），未来是否优化须由实际性能证据决定，且不能绕过外发内容预览。
7. **能力探测不是判断模型“强不强”**：用户已确认由本人主动触发，界面先提示外部请求可能产生费用；只发不含个人上下文的最小合成测试消息和一个无副作用探测工具 schema，验证当前 profile 能否返回可解析且匹配的原生调用，不执行探测工具。API 端点、协议或模型配置改变后检测状态失效并需重测。无论模型总体能力如何，base URL、模型别名、代理层或服务配置都可能影响协议往返。未通过时配置仍可聊天/润色，Agent 计划工具暂不可用；不做 JSON 文本回退。
8. **为每次用户请求设置双重循环上限**：用户确认首发固定最多 8 轮返回工具调用的模型往返，且最多执行 20 个工具调用，任一上限先达到即停止自动执行和后续模型请求。界面本地呈现已完成与未执行项；继续由用户显式发起为新请求，并重新确认外发上下文；首发不开放上限设置。
9. **provider/网络异常不自动重试**：用户确认由用户显式选择重试或取消；此前成功的本地工具操作不自动回滚，保留操作溯源并将当前 AI 轮次标记为未完成。显式重试不重放已完成的本地工具调用，但按新的模型请求重新预览外发上下文。
10. **API Key 本地存储策略（已确认）**：用户明确每位用户各自配置、各自使用 API Key，不存在 Trace 提供或多人共享的凭据。用户确认普通设置密码框输入期间 renderer 可短暂接触 Key；必须经专用 IPC 交给 main 后立即清空，不得持久化在 renderer state/localStorage/日志/聊天记录，provider 请求只由 main 发起。用户批准采用 Electron `safeStorage` 异步 API，将 Key 加密后保存在本机应用数据；OS 加密暂不可用时允许用户重新输入，只驻留 main process 内存供当前会话使用，界面明确提示不会保存、关闭后需重新输入，禁止明文落盘。Electron 官方说明 `safeStorage` 仅在 main process 可用、推荐异步接口；Windows 使用 DPAPI，保护其他 Windows 账户边界但不防同一用户下其他应用。参考：[Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)。
11. **已保存 API Key 的设置展示（已确认）**：Settings 仅显示“已配置”状态，提供替换/移除，不将已保存 Key 解密回传 renderer 供查看或复制。移除只清除密钥，保留 profile 元数据并标记为未配置。

## AI Resource Hub 服务商预设调研

用户希望 Trace 设置提供预设模型服务商，让用户通常只需填写自己的 API Key，并指定本地 `D:\Code\Project\AI Resource Hub` 作为资料来源。本轮只读查看 Hub 的 `src/config/*ProviderPresets.ts`，重点对照 `opencodeProviderPresets.ts` 与既有官方 API 兼容性报告；未修改 Hub、未读取/输出 Key 值，也未调用任何服务。

- Hub 预设是按不同客户端/协议分别维护的配置，不是可原样移植的中立目录。同一供应商会同时出现 Anthropic、OpenAI Chat、Responses、Coding Plan 等端点；只凭供应商名称不能推断它适用于 Trace 首发协议。
- 可作为候选发现的例子：Bailian 的 OpenAI-compatible 根地址与 Trace 官方资料报告相符；Hub 的 DeepSeek 配置使用 `/v1` 路径；而 StepFun 示例指向 `/step_plan/v1`，GLM 示例指向 `/api/coding/paas/v4`，属于特定产品/编码计划入口，不能直接当作通用服务地址。Hub 还包含 ModelScope、MiniMax、Xiaomi MiMo、OpenRouter 等条目，但它们的地区、模型与官方 Chat Completions/tool-calling 适用范围需逐项核对。
- 既有官方调研报告中可作为首批直连候选的服务包括百炼、DeepSeek、Kimi、火山方舟、硅基流动与百度千帆；腾讯云 TokenHub 可作为独立标记的聚合服务候选。智谱的通用工具/流式兼容、MiniMax 中国大陆端点在既有报告中尚未核实，不应在没有补充核验前承诺“只填 Key 即可”。
- 建议以 Trace 自有、经官方资料核验的静态目录为准；Hub 用于扩大候选，不作为 API 规范真源。预设至少包含显示名称、协议类型、base URL、默认模型或模型选择提示、官方文档链接/地域说明；绝不内置凭据。用户只输入 Key 是默认顺畅路径，但若服务要求 workspace/部署 ID、地区专属地址或特定模型名，界面应明确该额外条件，不伪称 Key 单字段必然可用。
- 预设只能声明“连接参数已预填”，不能声明工具调用兼容。`tool_calls` 的可用状态依具体供应商、端点、账号和模型而定，仍以用户主动运行的合成能力测试结果为准；测试通过后若 endpoint、model 或协议变化，状态失效并重测。
- **首批目录范围已由用户确认（2026-10-02）**：国内直连服务商先纳入阿里百炼、DeepSeek、Kimi、火山方舟、硅基流动和百度千帆；腾讯云 TokenHub 单独作为聚合服务分组；GLM、MiniMax、ModelScope 等未充分核实项留待后续；Coding Plan 专用端点不当作通用预设。保留自定义 OpenAI-compatible profile，供非目录服务商使用。

## 调研范围与验证

- 仅用 `rg` 与文件读取对上述本地源码进行静态只读查看；没有运行这些外部项目、没有调用模型 API、没有读取/收集用户密钥。
- OpenCode 快照未包含 runtime 源码，因此明确不对它的底层工具调度做结论。
- 本文是模式提炼，不替代模型/API 官方协议文档；供应商对工具选择、流式调用和扩展字段的差异仍应以已存档的官方文档调研报告及具体配置探测为准。
- Trace 本轮没有产品代码改动、测试或版本变更；仅新增研究文档并同步共享交接记录。
