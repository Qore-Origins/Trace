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

export interface SearchHit {
  scope: 'plan' | 'task' | 'note'
  path: string
  component_id?: string
  snippet: string
  matched_field: string
}

export interface PlanTreeNode {
  path: string // 相对根目录，'/' 分隔
  name: string
  has_children: boolean
  order: number
  kind: 'plan' | 'folder' // plan=含 plan.json 的计划；folder=纯容器（无 plan.json）
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

// ---------- diary 域 ----------
// 域：diary（日记深化 2026-09-10；契约零变更——日计划仍是普通计划）
export interface DiaryMonthEntry {
  date: string            // 'YYYY-MM-DD'（目录名=聚合键）
  score: number | null    // 当日 mood 卡分数；无 mood 卡为 null（不参与均分/打卡）
  notePreview: string     // 首个 note 组件文首 60 字符；无则 ''
  compCount: number
}
export interface DiaryDayComponent {
  kind: string            // 组件 kind（复用 ComponentType）
  label: string           // 渲染标签（heading=null 用 '标题'；由视图层 i18n 映射；此处可空）
  excerpt: string         // 摘要文本（mood=分数文本；note/custom=首行；task 类=任务数/标题；heading='heading'）
}
export interface DiaryDaySummary {
  date: string
  components: DiaryDayComponent[]
}
export const IPC_DIARY_ENSURE = 'diary:ensure'
export const IPC_DIARY_MONTH = 'diary:month'
export const IPC_DIARY_DAY = 'diary:day'

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
  'storage:createFolder': { req: { parent_path: string; name: string }; res: PlanTreeNode }
  'storage:renamePlan': { req: { path: string; new_name: string }; res: { path: string } }
  'storage:deletePlan': { req: { path: string; confirmed: boolean }; res: null }
  'storage:movePlan': { req: { path: string; target_parent_path: string }; res: null }
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
  // search（溯源检索）
  'search:query': { req: { keywords: string[] }; res: SearchHit[] }
  'search:getStatus': { req: void; res: { state: 'building' | 'ready' | 'error'; indexed: number } }
  // config
  'config:getWindow': { req: void; res: { width: number; height: number; maximized: boolean } }
  'config:setWindow': { req: { width: number; height: number; maximized: boolean }; res: null }
  // window（无边框自绘窗口控制）
  'window:minimize': { req: void; res: null }
  'window:toggleMaximize': { req: void; res: { maximized: boolean } }
  'window:close': { req: void; res: null }
  'window:getMaximized': { req: void; res: { maximized: boolean } }
  'window:toggleDevtools': { req: void; res: null }
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
  // diary（日记深化 2026-09-10；月历/日摘要取数——renderer 不供给路径，根由 main 自解析）
  'diary:ensure': { req: {}; res: null }
  'diary:month': { req: { year: number; month: number }; res: { entries: DiaryMonthEntry[] } }
  'diary:day': { req: { date: string }; res: DiaryDaySummary }
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
