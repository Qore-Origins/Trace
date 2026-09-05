// 进程内事件总线：主进程服务 ↔ IPC 推送（trace:* 事件，接口设计文档 §2.4）
import type { TraceEventsContract } from '../../shared/event-types'

export type TraceEvents = TraceEventsContract

type Handler<T> = (payload: T) => void

class EventBus {
  private handlers: { [K in keyof TraceEvents]?: Set<Handler<TraceEvents[K]>> } = {}

  on<K extends keyof TraceEvents>(event: K, handler: Handler<TraceEvents[K]>): () => void {
    let set = this.handlers[event] as Set<Handler<TraceEvents[K]>> | undefined
    if (!set) {
      set = new Set<Handler<TraceEvents[K]>>()
      // 泛型 K 与具体槽位的对应关系 TS 无法证明，写入经宽松视图
      ;(this.handlers as Record<string, Set<unknown>>)[event] = set
    }
    set.add(handler)
    return () => set.delete(handler)
  }

  emit<K extends keyof TraceEvents>(event: K, payload: TraceEvents[K]): void {
    const set = this.handlers[event]
    if (!set) return
    for (const h of set) {
      try {
        h(payload)
      } catch (e) {
        console.error(`[bus] handler error on ${event}`, e)
      }
    }
  }
}

export const bus = new EventBus()
