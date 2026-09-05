// 存储契约 v1 类型（唯一事实源：docs/lifecycle/02-系统设计 Design/数据库设计说明书 DB Design.md §5.2）
// 双进程共享：主进程读写、渲染器类型校验均引用本文件

export type ComponentType = 'single_plan' | 'multi_plan' | 'task_list' | 'task_detail' | 'note'

export type TaskStatus = 'not_started' | 'in_progress' | 'done'

export interface PlanDocument {
  format_version: '1'
  created_at: string // ISO 8601 UTC
  updated_at: string // 每次原子写更新；savePlan CAS 锚点
  children_order?: string[] // 子计划文件夹名有序列表；缺席=按名称升序
  components: Component[] // 渲染顺序 = 数组顺序
}

export interface PlanLibraryMeta {
  format_version: '1'
  library_id: string // uuid32，初始化分配后不变
  created_at: string
  schema_info: string[] // 预留扩展位，如 ["min", "v1"]
  children_order?: string[] // 顶层计划顺序（实现期契约补充：根层无 plan.json，顶层顺序存库元数据）
}

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

export type ComponentPayload =
  | SinglePlanPayload
  | MultiPlanPayload
  | TaskListPayload
  | TaskDetailPayload
  | NotePayload
