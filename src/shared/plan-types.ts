// 存储契约 v1 类型（唯一事实源：docs/lifecycle/02-系统设计 Design/数据库设计说明书 DB Design.md §5.2）
// 双进程共享：主进程读写、渲染器类型校验均引用本文件

export type ComponentType = 'single_plan' | 'multi_plan' | 'task_list' | 'task_detail' | 'note' | 'mood' | 'heading' | 'custom'

export type TaskStatus = 'not_started' | 'in_progress' | 'done'

export interface PlanDocument {
  format_version: '1'
  created_at: string // ISO 8601 UTC
  updated_at: string // 每次原子写更新；savePlan CAS 锚点
  components: Component[] // 渲染顺序 = 数组顺序
  due_date?: string // 'YYYY-MM-DD'；undefined=未设置（旧文档缺键即未设置）
}

export interface PlanLibraryMeta {
  format_version: '1'
  library_id: string // uuid32，初始化分配后不变
  created_at: string
  schema_info: string[] // 预留扩展位，如 ["min", "v1"]
}

// 2026-09-08 排序定稿：树统一按文件名排序（zh-CN），children_order 顺序载体退役；
// 历史文件中的 children_order 字段读取时忽略（JSON 多余键无害，不再写入）

export interface Component {
  id: string // uuid32
  type: ComponentType
  payload: ComponentPayload
}

export interface SinglePlanPayload {
  title: string
  done: boolean
  summary?: string
  created_at: string
  due_date?: string // 'YYYY-MM-DD'；undefined=未设置（组件级截止日期，可选可清空）
}

export interface MultiPlanOption {
  id: string
  text: string
  checked: boolean
}

export interface MultiPlanPayload {
  title: string
  summary?: string
  options: MultiPlanOption[]
}

export interface TaskItem {
  id: string
  title: string
  status: TaskStatus
  planned_at?: string // YYYY-MM-DD
  completed_at?: string
  note?: string
}

export interface TaskListPayload {
  title: string
  items: TaskItem[]
}

export interface TaskDetailPayload {
  title: string
  description?: string
  planned_at?: string
  status: TaskStatus
  completed_at?: string
  note?: string
  created_at: string
}

export interface NotePayload {
  content: string
  created_at: string
}

export interface MoodPayload {
  score: number
  text: string
  mood_date: string
  created_at: string
}

export interface HeadingPayload {
  title: string
  size: number
}

export interface CustomPayload {
  content: string
  source?: string
}

export type ComponentPayload =
  | SinglePlanPayload
  | MultiPlanPayload
  | TaskListPayload
  | TaskDetailPayload
  | NotePayload
  | MoodPayload
  | HeadingPayload
  | CustomPayload
