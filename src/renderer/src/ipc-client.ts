// ipc-client：渲染器唯一 IPC 调用层（类型=契约；TraceResult 非 ok 时抛 ClientError）
import type { ChannelName, Channels, TraceBridge } from '@shared/ipc-contract'
import type { TraceEventsContract } from '@shared/event-types'
import { ERR } from '@shared/errors'

export class ClientError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message)
    this.name = 'ClientError'
  }
}

function bridge(): TraceBridge {
  const t = (window as unknown as { trace?: TraceBridge }).trace
  if (!t) throw new ClientError(ERR.INTERNAL, '桥接未就绪（preload 未加载）')
  return t
}

export async function invoke<K extends ChannelName>(
  channel: K,
  ...args: Channels[K]['req'] extends void ? [] : [Channels[K]['req']]
): Promise<Channels[K]['res']> {
  const res = await bridge().invoke(channel, ...args)
  if (!res.ok) throw new ClientError(res.code, res.message)
  return res.data
}

export function onEvent<K extends keyof TraceEventsContract>(
  event: K,
  cb: (payload: TraceEventsContract[K]) => void
): () => void {
  return bridge().on(event, cb)
}
