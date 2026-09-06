// IPC 白名单契约（唯一事实源：接口设计文档 API Design）
// 渲染器/主进程共享类型；新增能力：先加类型 → 主进程注册 → preload 暴露
import type { PlanDocument, Component, TaskItem } from './plan-types'

// ---------- 统一响应信封 ----------

export type TraceResult<T> =
  | { ok: true; code: 0; message: 'ok'; data: T }
  | { ok: false; code: number; message: string; data: null }

export function ok<T>(data: T): TraceResult<T> {
  return { ok: true, code: 0, message: 'ok', data }
}

export function fail(code: number, message: string): TraceResult<null> {
  return { ok: false, code, message, data: null }
}

// ---------- DTO ----------

export interface PlanTreeNode {
  path: string // 相对根目录，'/' 分隔
  name: string
  has_children: boolean
  order: number
}

export interface AppInfo {
  appVersion: string
  formatVersion: '1'
  rootDir: string | null
  rootConfigured: boolean
  rootInvalid: boolean
  indexState: 'building' | 'ready' | 'error'
}

export interface BootstrapInfo extends AppInfo {}

// ---------- 请求/响应载荷 ----------

export interface Channels {
  // app
  'app:getAppInfo': { req: void; res: AppInfo }
  'app:bootstrap': { req: void; res: BootstrapInfo }
  'app:setRootDir': { req: { dirPath: string; confirmed: boolean }; res: { rootDir: string } }
  'app:reportError': { req: { context: string; message: string; stack?: string }; res: null }
  'app:chooseDirectory': { req: void; res: { dirPath: string | null } }
  'app:pickSavePath': { req: { defaultName: string; extensions: string[] }; res: { filePath: string | null } }
  'app:pickFiles': { req: { extensions: string[] }; res: { files: Array<{ path: string; name: string }> } }
  // storage
  'storage:treeGetChildren': { req: { parent_path: string }; res: PlanTreeNode[] }
  'storage:createPlan': { req: { parent_path: string; name: string }; res: PlanTreeNode }
  'storage:renamePlan': { req: { path: string; new_name: string }; res: { path: string } }
  'storage:deletePlan': { req: { path: string; confirmed: boolean }; res: null }
  'storage:movePlan': { req: { path: string; target_parent_path: string; order_index: number }; res: null }
  'storage:resortChildren': { req: { parent_path: string; ordered_names: string[] }; res: null }
  'storage:readPlan': { req: { path: string }; res: PlanDocument }
  'storage:savePlan': {
    req: { path: string; document: PlanDocument; expected_updated_at: string }
    res: { updated_at: string }
  }
  'storage:appendComponent': { req: { path: string; component: Component }; res: null }
  'storage:removeComponent': { req: { path: string; component_id: string }; res: null }
  'storage:moveComponent': { req: { path: string; component_id: string; target_index: number }; res: null }
  'storage:updateTask': {
    req: { path: string; component_id: string; task_id: string; patch: Partial<Pick<TaskItem, 'status' | 'title' | 'planned_at' | 'note'>> }
    res: null
  }
  // config
  'config:getWindow': { req: void; res: { width: number; height: number; maximized: boolean } }
  'config:setWindow': { req: { width: number; height: number; maximized: boolean }; res: null }
  // window（无边框自绘窗口控制）
  'window:minimize': { req: void; res: null }
  'window:toggleMaximize': { req: void; res: { maximized: boolean } }
  'window:close': { req: void; res: null }
  'window:getMaximized': { req: void; res: { maximized: boolean } }
  // transfer（.plan 导入导出 + Markdown 迁入）
  'transfer:exportPlan': { req: { path: string; saveTo: string }; res: { savedTo: string; plans: number; components: number; tasks: number } }
  'transfer:importPlan': {
    req: { target_parent_path: string; filePath: string }
    res: { imported: Array<{ path: string; renamedFrom?: string }>; plans: number; components: number; tasks: number; notes: number; skipped: string[] }
  }
  'transfer:importMarkdown': {
    req: { target_parent_path: string; paths: string[] }
    res: { imported: Array<{ path: string; renamedFrom?: string }>; plans: number; components: number; tasks: number; notes: number; skipped: string[] }
  }
}

export type ChannelName = keyof Channels

// 事件通道（主进程 → 渲染器单向推送）
export type EventName = keyof import('./event-types').TraceEventsContract

// preload 暴露给渲染器的 API 形状（window.trace）
export interface TraceBridge {
  invoke<K extends ChannelName>(
    channel: K,
    ...args: Channels[K]['req'] extends void ? [] : [Channels[K]['req']]
  ): Promise<TraceResult<Channels[K]['res']>>
  on<K extends EventName>(event: K, cb: (payload: import('./event-types').TraceEventsContract[K]) => void): () => void
}
