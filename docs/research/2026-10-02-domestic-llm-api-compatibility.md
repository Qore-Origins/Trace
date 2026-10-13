# 国内模型服务的 OpenAI Chat Completions 兼容性调研

- 调研日期：2026-10-02
- 目的：评估 Trace 首期是否可把 OpenAI-compatible Chat Completions 作为国内模型服务的通用接入协议。
- 范围：仅查阅模型/云服务厂商官方文档及厂商官方 SDK 仓库；未调用任何供应商 API，未使用或索取密钥。
- 结论边界：样本用于判断工程上的共同接口，不构成市场份额、供应商总数或“90% 支持率”的统计。

## 结论

OpenAI-compatible Chat Completions 是本次样本中最适合作为 Trace 首期通用协议的选择：多家国内模型平台明确提供 `chat.completions` 请求形状、OpenAI SDK 适配或等价的标准路径，并且多个官方来源确认了流式输出和 function tools。它能显著减少首期需要实现的协议种类。

但“兼容”不等于“完全相同”：服务根地址、API 路径、模型 ID、区域/账号、额外参数各不相同；工具调用、流式工具增量、推理字段及采样参数的支持还可能按模型变化。因此建议把“公共请求/响应处理”与“供应商配置及能力差异”分开，而不是把任意服务都当成同一台 OpenAI API。

本次样本**不能证明“90% 的国内模型供应商支持”**。没有建立完整供应商总体、抽样规则或分母；此处只能说它是一个有多家一手文档支持、值得优先实现的共同接口。

## 供应商核验

| 服务 | 官方文档中确认的 OpenAI Chat Completions 接入 | SDK / 请求格式 | 流式 | 工具调用 | 已知差异与边界 |
|---|---|---|---|---|---|
| 阿里云百炼（通义千问） | 是。文档区分 OpenAI-compatible Chat Completions、Responses、Anthropic Messages 与 DashScope 原生格式。常用兼容根地址为 `https://dashscope.aliyuncs.com/compatible-mode/v1`；也有绑定 Workspace/地域的地址。 | 官方文档提供 OpenAI Python/Node SDK 及 Chat Completions 示例。 | 是，文档说明 `stream: true` 及流式选项。 | 是，Chat Completions 参考包含 `tools` / function calling。 | 根地址与 API Key 必须匹配地域；Workspace 场景可使用 Workspace 专属根地址。不同兼容协议不是可互换的路径。 |
| DeepSeek | 是。官方示例使用 `base_url=https://api.deepseek.com`，请求 `/chat/completions`。 | 官方文档提供 OpenAI SDK 风格 `client.chat.completions.create`，并说明 Chat Completions 请求格式。 | 是，`stream` 返回 SSE 风格增量。 | 是，工具调用指南包含 `tools`，流式响应支持工具调用增量。 | 工具选择存在模式差异：官方文档指出 thinking 模式下 `tool_choice=required` 及指定函数选择有限制；不能假设所有 OpenAI 参数在所有模式都可用。 |
| 智谱（GLM） | **部分确认，仍需复核。** 智谱官方 Python SDK 仓库展示 `client.chat.completions.create`，并配置 `https://open.bigmodel.cn/api/paas/v4/`。官方 OpenAI 兼容指南 URL 已定位，但本次研究工具无法抓取该页面内容，故不把“可直接换用 OpenAI 官方 SDK”记为已独立核实。 | 已核实厂商 SDK 的 Chat Completions 调用示例；官方 OpenAI-compatible 指南的正文未能读取。 | 未在本次可读取的一手来源中独立确认通用 Chat Completions 的流式细节。 | 未在本次可读取的一手来源中独立确认通用 Chat Completions 的 function tools 细节。 | 生产接入前应复核兼容指南与所选模型的能力表；本行不作为 SDK/工具能力的确定性依据。 |
| 月之暗面（Kimi） | 是。官方 API 概览明确列出 OpenAI Chat Completions，根地址 `https://api.moonshot.cn/v1`，路径 `/chat/completions`。 | 官方文档列出 OpenAI Python/Node SDK，示例以 `client.chat.completions.create` 调用。 | 是，Chat API 文档说明流式响应。 | 是，文档说明工具调用及 `tool_calls`。 | 官方文档明确 `thinking` 等部分参数是 Kimi 扩展，需通过 `extra_body` 传递；此外 Kimi 还提供 Responses 与 Anthropic Messages 兼容入口。 |
| 火山引擎方舟（豆包等模型） | 是。官方文档示例的北京地域根地址为 `https://ark.cn-beijing.volces.com/api/v3`，Chat 路径为 `/chat/completions`。 | 官方提供 OpenAI SDK 兼容指南，并展示 OpenAI SDK 配置。 | 是，Chat API 文档提供流式响应格式。 | 是，Chat API 文档包含 `tools` / `tool_choice` 与工具增量响应。 | 地域会影响服务地址；工具调用及部分参数需按模型能力确认。官方兼容指南也说明并非所有产品类型都由此兼容 API 覆盖。 |
| 硅基流动 | 是。官方 Chat Completions API 路径为 `https://api.siliconflow.cn/v1/chat/completions`。 | 官方接口参考给出 OpenAI Python SDK 示例及 `base_url=https://api.siliconflow.cn/v1`。 | 是，文档明确 SSE 与 `data: [DONE]` 结束标志。 | 是，文档含 function tools 示例，并展示与流式调用组合使用。 | 文档提示模型可能上下线或调整能力；接口虽共用，扩展字段与具体模型适用范围不同。 |
| 百度智能云千帆 | 是。官方文档说明千帆 v2 推理接口兼容 OpenAI，示例根地址为 `https://qianfan.baidubce.com/v2`。 | 官方展示 OpenAI Python SDK 的 `chat.completions.create` 示例。 | 是，SDK/API 示例包含流式调用。 | 是，官方 function calling 文档说明通过 `tools` 传入函数定义。 | Function calling 仅适用于文档列出的模型；`tool_choice` 的 `required` / 指定函数等行为也有模型范围差异。不能将平台支持该字段等同于每个模型都支持。 |
| MiniMax（补充） | 国际站官方文档确认 OpenAI-compatible Chat Completions；示例 endpoint 为 `https://api.minimax.io/v1/chat/completions`。 | 官方文档提供 OpenAI Chat Completions 格式示例。 | 是，文档列出 `stream`。 | 是，文档列出 function tools。 | 此次可读取来源是 `platform.minimax.io` 国际站；中国大陆站点、地域、账号和密钥的适用关系未在本次核实，不应直接据此给大陆用户预设地址。官方文档也含有 MiniMax 自有推理参数。 |

### 聚合平台补充：腾讯云 TokenHub

TokenHub 不是独立模型供应商，不计入上表供应商样本。其官方文档（2026-09-23 更新）称平台聚合混元、DeepSeek、GLM、Kimi、MiniMax 等模型，并统一提供 `/v1/chat/completions`，OpenAI Chat Completions 覆盖其模型列表。文档同时明确：工具、思考模式、多模态及部分参数仍依具体模型而异，个别字段可能被忽略或降级。它说明“统一入口”可由聚合网关提供，但没有证明各厂商原生接口完全同质。

## 对 Trace 设计的建议

1. **首期协议：OpenAI Chat Completions。** 以 `messages`、`chat.completions`、标准 function tools 和可选 SSE 流式为共同基线。
2. **配置分离：** 每个供应商/自定义端点至少独立保存 `base_url`、模型 ID 与凭据；不要把某家供应商的 URL、模型名称或额外参数写进协议通用层。区域和账号类型可能要求不同地址。
3. **能力按模型标记：** `stream`、工具调用、强制工具选择、JSON 输出、推理开关等应按“供应商 + 模型”展示/校验；缺少官方依据时不承诺支持。工具结果和流式 tool-call 参数仍由客户端按增量正确拼接及校验。
4. **扩展参数显式化：** 供应商专属字段只通过单独的扩展配置或经过校验的额外请求体传递，不混入跨供应商默认请求。兼容接口接受请求不代表服务会执行或保留所有字段。
5. **后续验证：** 实现前由官方资料补齐智谱工具/流式兼容和 MiniMax 大陆端点；实现后以可配置的无密钥适配器测试验证拼装逻辑，并由用户在本地自行填入凭据进行真实连通性测试。本研究没有发起服务请求，不能替代运行时兼容验证。

## 官方来源

以下均为厂商官方文档或厂商官方 SDK 仓库。引用用于支持该供应商行中的接口与能力说明；页面内容/能力列表可能更新，实施时应再核对目标模型对应文档。

- 阿里云百炼：[通义千问 OpenAI Chat Completions 调用](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)、[模型 API 格式概览](https://help.aliyun.com/zh/model-studio/qwen-api-reference)、[流式输出](https://help.aliyun.com/zh/model-studio/stream)
- DeepSeek：[创建 Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion/)、[工具调用指南](https://api-docs.deepseek.com/guides/tool_calls/)
- 智谱：[官方 OpenAI 兼容指南（本次无法抓取正文）](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction)、[MetaGLM 官方 Python SDK 仓库](https://github.com/MetaGLM/zhipuai-sdk-python-v4)、[官方 AI 搜索示例（展示 SDK Chat Completions 调用）](https://docs.bigmodel.cn/cn/best-practice/case/ai-search-engine)
- 月之暗面：[API 概览与协议兼容性](https://platform.kimi.com/docs/api/overview)、[Chat Completions API](https://platform.kimi.com/docs/api/chat)
- 火山引擎方舟：[OpenAI SDK 兼容指南](https://docs.volcengine.com/docs/ark/compatible-with-openai-sdk?lang=en)、[Chat API](https://docs.volcengine.com/docs/ark/chat-api?lang=zh&redirect=1)
- 硅基流动：[Chat Completions API](https://docs.siliconflow.cn/docs/api/chat-completions-post)、[流式输出指南](https://docs.siliconflow.cn/docs/userguide/capabilities/stream-mode)
- 百度智能云千帆：[Python SDK 调用对话 Chat](https://cloud.baidu.com/doc/qianfan-docs/s/Fm9l6ocai)、[Function calling](https://cloud.baidu.com/doc/qianfan-docs/s/xm95lyys5)
- MiniMax：[OpenAI-compatible Chat Completions](https://platform.minimax.io/docs/api-reference/text-chat-openai)
- 腾讯云 TokenHub（补充聚合平台）：[语言模型调用概览](https://cloud.tencent.com/document/product/1823/130079)、[OpenAI Chat Completions 协议字段说明](https://cloud.tencent.com/document/product/1823/135872)
