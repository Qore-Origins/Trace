import type { AgentProviderPreset } from './agent-types'

// Static connection examples; each profile still requires its own key and capability test.
export const AGENT_PROVIDER_PRESETS: readonly AgentProviderPreset[] = [
  { id: 'bailian', name: '阿里云百炼', category: 'direct', protocol: 'openai-chat-completions', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', note: '中国内地地址；API Key 与地域须匹配。', documentationUrl: 'https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions' },
  { id: 'deepseek', name: 'DeepSeek', category: 'direct', protocol: 'openai-chat-completions', endpoint: 'https://api.deepseek.com', model: 'deepseek-flash', note: '模型能力与账户可用性以服务商当前配置为准。', documentationUrl: 'https://api-docs.deepseek.com/' },
  { id: 'kimi', name: 'Kimi', category: 'direct', protocol: 'openai-chat-completions', endpoint: 'https://api.moonshot.cn/v1', model: 'kimi-k3', note: '中国站地址；模型权限及可用性以账号为准。', documentationUrl: 'https://platform.kimi.com/docs/api/chat' },
  { id: 'volcengine', name: '火山引擎方舟', category: 'direct', protocol: 'openai-chat-completions', endpoint: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-2-1-pro-260628', note: '北京地域；需要开通模型，部分账户可能需要部署接入点 ID。', documentationUrl: 'https://docs.volcengine.com/docs/ark/chat-api?lang=en' },
  { id: 'siliconflow', name: '硅基流动', category: 'direct', protocol: 'openai-chat-completions', endpoint: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V4-Flash', note: '模型可能上下线或调整能力。', documentationUrl: 'https://docs.siliconflow.cn/docs/api/chat-completions-post' },
  { id: 'qianfan', name: '百度智能云千帆', category: 'direct', protocol: 'openai-chat-completions', endpoint: 'https://qianfan.baidubce.com/v2', model: 'deepseek-r1-distill-qwen-32b', note: '需在千帆开通对应模型；工具能力依模型而异。', documentationUrl: 'https://cloud.baidu.com/doc/qianfan-docs/s/Fm9l6ocai' },
  { id: 'tokenhub', name: '腾讯云 TokenHub', category: 'aggregator', protocol: 'openai-chat-completions', endpoint: 'https://tokenhub.tencentmaas.com/v1', model: 'hy3', note: '广州站；先开通模型，Key 与站点须匹配。', documentationUrl: 'https://cloud.tencent.com/document/product/1823/130079' }
]
