// preload：contextBridge 白名单暴露（接口设计文档 §2.3）
// 仅暴露 invoke(白名单通道) 与 on(事件)；不暴露任何 fs/ipcRenderer 原始能力
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { ChannelName, Channels, EventName, TraceBridge, TraceResult } from '../shared/ipc-contract'
import type { DiaryAutomationStatus, TraceEventsContract } from '../shared/event-types'

const ALLOWED_PREFIXES = ['app:', 'storage:', 'config:', 'transfer:', 'window:', 'search:', 'diary:']
const PLANTUML_CHANNELS = new Set<string>(['plantuml:configure', 'plantuml:getStatus', 'plantuml:retry'])
const PLAN_TEMPLATE_CHANNELS = new Set<string>(['plan-template:get', 'plan-template:set', 'plan-template:remove'])
const AGENT_CHANNELS = new Set<string>(['agent:provider:list', 'agent:profile:list', 'agent:profile:create', 'agent:profile:update', 'agent:profile:delete', 'agent:profile:setDefault', 'agent:key:set', 'agent:key:remove'])
for (const channel of ['agent:session:list', 'agent:session:create', 'agent:session:read', 'agent:session:update', 'agent:session:delete', 'agent:context:browse', 'agent:context:read', 'agent:preview:create', 'agent:preview:cancel']) AGENT_CHANNELS.add(channel)
for (const channel of ['agent:request:send', 'agent:request:cancel', 'agent:request:continue']) AGENT_CHANNELS.add(channel)
for (const channel of ['agent:operation:read', 'agent:operation:confirm', 'agent:operation:cancel', 'agent:operation:retry', 'agent:operation:continue', 'agent:operation:undo']) AGENT_CHANNELS.add(channel)
AGENT_CHANNELS.add('agent:capability:test')
for (const channel of ['agent:target:grant', 'agent:target:validate', 'agent:target:children', 'agent:target:release', 'agent:policy:get', 'agent:policy:set']) AGENT_CHANNELS.add(channel)
const WORKSPACE_TABS_CHANNELS = new Set<string>(['workspace-tabs:get', 'workspace-tabs:set'])
const PLAN_REFERENCE_CHANNELS = new Set<string>([
  'plan-reference:search', 'plan-reference:resolve', 'plan-reference:commitTarget', 'plan-reference:inbound',
  'plan-reference:previewImpact', 'plan-reference:commitImpact'
])
const TRASH_CHANNELS = new Set<string>([
  'trash:list', 'trash:entryTarget', 'trash:restore-preview', 'trash:restore-commit',
  'trash:purge-preview', 'trash:purge-commit'
])
const EVENT_CHANNELS = new Set<string>([
  'trace:plan-changed',
  'trace:reference-target-changed',
  'trace:save-status',
  'trace:fs-external-change',
  'trace:index-status',
  'trace:window-state',
  'trace:plantuml-status',
  'trace:diary-automation-status',
  'trace:agent-request',
  'trace:agent-operation'
])

// 首屏/页面切换的订阅可能晚于后台结束；observer 属于 preload 生命周期。
const DIARY_STATUS_EVENT = 'trace:diary-automation-status'
let latestDiaryStatus: DiaryAutomationStatus | null = null
ipcRenderer.on(DIARY_STATUS_EVENT, (_event, payload: unknown) => {
  if (!payload || typeof payload !== 'object' || !('state' in payload)) return
  const state = payload.state
  if (state === 'error') latestDiaryStatus = { state, retryable: true }
  else if (state === 'running' || state === 'complete') latestDiaryStatus = { state, retryable: false }
})

const bridge = {
  invoke: async <K extends ChannelName>(
    channel: K,
    ...args: Channels[K]['req'] extends void ? [] : [Channels[K]['req']]
  ): Promise<TraceResult<Channels[K]['res']>> => {
    const isPlantumlChannel = typeof channel === 'string' && channel.startsWith('plantuml:')
    const isPlanTemplateChannel = typeof channel === 'string' && channel.startsWith('plan-template:')
    const isAgentChannel = typeof channel === 'string' && channel.startsWith('agent:')
    const isWorkspaceTabsChannel = typeof channel === 'string' && channel.startsWith('workspace-tabs:')
    const isPlanReferenceChannel = typeof channel === 'string' && channel.startsWith('plan-reference:')
    const isTrashChannel = typeof channel === 'string' && channel.startsWith('trash:')
    if (
      typeof channel !== 'string' ||
      (isAgentChannel
        ? !AGENT_CHANNELS.has(channel)
        : isPlantumlChannel
        ? !PLANTUML_CHANNELS.has(channel)
        : isPlanTemplateChannel
          ? !PLAN_TEMPLATE_CHANNELS.has(channel)
          : isWorkspaceTabsChannel
            ? !WORKSPACE_TABS_CHANNELS.has(channel)
            : isPlanReferenceChannel
              ? !PLAN_REFERENCE_CHANNELS.has(channel)
              : isTrashChannel
                ? !TRASH_CHANNELS.has(channel)
              : !ALLOWED_PREFIXES.some((p) => channel.startsWith(p)))
    ) {
      return { ok: false, code: 50, message: '通道未开放', data: null }
    }
    return ipcRenderer.invoke(channel, args[0])
  },
  on: <K extends EventName>(event: K, cb: (payload: TraceEventsContract[K]) => void): (() => void) => {
    if (!EVENT_CHANNELS.has(event)) return () => {}
    const handler = (_e: IpcRendererEvent, payload: TraceEventsContract[K]): void => cb(payload)
    // ipcRenderer 监听器签名为 (...args: any[])，此处按契约收窄后桥接
    ipcRenderer.on(event, handler as unknown as (e: IpcRendererEvent, ...args: unknown[]) => void)
    if (event === DIARY_STATUS_EVENT && latestDiaryStatus) {
      cb({ ...latestDiaryStatus } as TraceEventsContract[K])
    }
    return () => ipcRenderer.removeListener(event, handler as never)
  }
} as TraceBridge

contextBridge.exposeInMainWorld('trace', bridge)

export type { TraceBridge }
