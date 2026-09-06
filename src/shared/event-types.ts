// 事件通道类型（主进程 → 渲染器；接口设计文档 §2.4）
export interface TraceEventsContract {
  'trace:plan-changed': { path: string }
  'trace:save-status': { path: string; saved: boolean; at: string }
  'trace:fs-external-change': { paths: string[]; type: 'created' | 'changed' | 'removed' }
  'trace:index-status': { state: 'building' | 'ready' | 'error'; progress?: number }
  'trace:window-state': { maximized: boolean }
}
