export type WorkflowScope =
  | { kind: 'directory'; path: string }
  | { kind: 'category'; path: string }
  | { kind: 'global' }

export type WorkflowNameScope = Extract<WorkflowScope, { kind: 'category' | 'global' }>

export type WorkflowDestination = { kind: 'selected' } | { kind: 'fixed'; path: string }

export interface WorkflowNameRule {
  id: string
  scope: WorkflowNameScope
  enabled: boolean
  template: string
}

export interface WorkflowContentComponentTemplate {
  type: 'heading' | 'note' | 'task_list' | 'plan_reference' | 'mood'
  title: string
  prompt?: string
  reference_output_key?: string
}

export interface WorkflowContentTemplate {
  id: string
  name: string
  components: WorkflowContentComponentTemplate[]
}

export interface WorkflowOutput {
  id: string
  destination: WorkflowDestination
  name_template_mode: 'explicit' | 'inherit'
  name_template?: string
  content_template_id: string
  repeat: 'once' | 'each_day'
  workflow_kind?: 'regular' | 'week' | 'day'
}

export interface WorkflowPreset {
  id: string
  name: string
  scope: WorkflowScope
  enabled: boolean
  is_default: boolean
  outputs: WorkflowOutput[]
}

export interface PlanWorkflowConfig {
  format_version: '1'
  name_rules: WorkflowNameRule[]
  content_templates: WorkflowContentTemplate[]
  presets: WorkflowPreset[]
}

export interface WorkflowPeriod {
  start_date: string
  end_date: string
}

export interface WorkflowAssignedTask {
  id: string
  title: string
  target_date?: string
}

export interface WorkflowDraftInput {
  selected_path: string
  preset_id?: string
  title?: string
  target_date?: string
  period?: WorkflowPeriod
  manual_names?: Record<string, string>
  destination_overrides?: Record<string, string>
  component_overrides?: Record<string, WorkflowContentComponentTemplate[]>
  tasks?: WorkflowAssignedTask[]
}

export interface WorkflowPreviewConflict {
  code: 'name_exists' | 'same_date_candidate' | 'duplicate_output' | 'missing_name' | 'period_overlap'
  message: string
  existing_paths?: string[]
}

export interface WorkflowPreviewOutput {
  key: string
  output_id: string
  workflow_kind: 'regular' | 'week' | 'day'
  destination_path: string
  name: string | null
  relative_path: string | null
  name_rule_source: 'preset' | 'legacy-custom' | 'category' | 'global' | 'built-in' | 'manual'
  target_date?: string
  period?: WorkflowPeriod
  components: WorkflowContentComponentTemplate[]
  assigned_tasks: WorkflowAssignedTask[]
  conflicts: WorkflowPreviewConflict[]
}

export interface WorkflowPreview {
  state: 'ready' | 'candidates' | 'none'
  library_id: string
  preset_id?: string
  candidates?: Pick<WorkflowPreset, 'id' | 'name'>[]
  outputs: WorkflowPreviewOutput[]
  revision_token: string
}

export interface WorkflowLibraryState {
  library_id: string
  config: PlanWorkflowConfig
  suggestions: PlanWorkflowConfig
}

export interface WorkflowPreviewRequest {
  library_id: string
  draft: WorkflowDraftInput
}

export interface WorkflowCommitRequest extends WorkflowPreviewRequest {
  revision_token: string
}

export interface WorkflowBatchConfirmation {
  output_key: string
  action: 'create' | 'reuse'
  existing_path?: string
  merge_tasks?: boolean
}

export interface WorkflowBatchCommitRequest extends WorkflowCommitRequest {
  confirmations: WorkflowBatchConfirmation[]
}

export interface WorkflowBatchItemResult {
  output_key: string
  path: string
  status: 'created' | 'reused' | 'pending' | 'failed'
  plan_id: string
  error?: string
}

export interface WorkflowBatchResult {
  operation_id: string
  status: 'complete' | 'partial' | 'existing_draft'
  items: WorkflowBatchItemResult[]
}

export interface WorkflowBatchResumeRequest {
  library_id: string
  operation_id: string
}

export interface WorkflowBatchSummary {
  operation_id: string
  period: WorkflowPeriod
  completed_count: number
  total_count: number
}

export interface WorkflowPeriodSuggestionRequest {
  library_id: string
  selected_path: string
}

export interface WorkflowHandoffTask {
  source_plan_id: string
  source_task_id: string
  title: string
  source_date: string
}

export interface WorkflowHandoffPreview {
  previous_week_plan_id: string | null
  tasks: WorkflowHandoffTask[]
}

export interface WorkflowHandoffMoveRequest {
  library_id: string
  week_plan_id: string
  source_plan_id: string
  source_task_id: string
  target_date: string
}

export interface WorkflowHandoffMoveResult {
  status: 'complete' | 'partial'
  source_plan_id: string
  source_task_id: string
  target_plan_id: string
  target_task_id: string
}
