// preload：contextBridge 白名单暴露（接口设计文档 §2.3）
// 仅暴露 invoke(白名单通道) 与 on(事件)；不暴露任何 fs/ipcRenderer 原始能力
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { ChannelName, Channels, EventName, TraceBridge, TraceResult } from '../shared/ipc-contract'
import type { TraceEventsContract } from '../shared/event-types'

const ALLOWED_PREFIXES = ['app:', 'storage:', 'config:', 'transfer:', 'window:', 'search:', 'diary:']
const PLANTUML_CHANNELS = new Set<string>(['plantuml:configure', 'plantuml:getStatus', 'plantuml:retry'])
const EVENT_CHANNELS = new Set<string>([
  'trace:plan-changed',
  'trace:save-status',
  'trace:fs-external-change',
  'trace:index-status',
  'trace:window-state',
  'trace:plantuml-status'
])

const bridge = {
  invoke: async <K extends ChannelName>(
    channel: K,
    ...args: Channels[K]['req'] extends void ? [] : [Channels[K]['req']]
  ): Promise<TraceResult<Channels[K]['res']>> => {
    const isPlantumlChannel = typeof channel === 'string' && channel.startsWith('plantuml:')
    if (
      typeof channel !== 'string' ||
      (isPlantumlChannel ? !PLANTUML_CHANNELS.has(channel) : !ALLOWED_PREFIXES.some((p) => channel.startsWith(p)))
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
    return () => ipcRenderer.removeListener(event, handler as never)
  }
} as TraceBridge

contextBridge.exposeInMainWorld('trace', bridge)

export type { TraceBridge }
