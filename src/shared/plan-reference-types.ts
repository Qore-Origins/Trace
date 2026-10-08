import type { Component, ComponentType } from './plan-types'

export type PlanReferenceMode = 'link' | 'embed'
export type ReferenceDisplayLocale = 'zh-CN' | 'en-US'

const TYPE_FALLBACKS: Record<Exclude<ComponentType, 'plan_reference'>, Record<ReferenceDisplayLocale, string>> = {
  single_plan: { 'zh-CN': '单选计划', 'en-US': 'Single plan' },
  multi_plan: { 'zh-CN': '多选计划', 'en-US': 'Multi-option plan' },
  task_list: { 'zh-CN': '任务列表', 'en-US': 'Task list' },
  task_detail: { 'zh-CN': '任务详情', 'en-US': 'Task detail' },
  note: { 'zh-CN': '注释（旁批）', 'en-US': 'Note (margin)' },
  mood: { 'zh-CN': '心情', 'en-US': 'Mood' },
  heading: { 'zh-CN': '标题', 'en-US': 'Heading' },
  custom: { 'zh-CN': '自定义组件', 'en-US': 'Custom component' }
}

export function referenceComponentTypeFallback(
  type: Exclude<ComponentType, 'plan_reference'>,
  locale: ReferenceDisplayLocale = 'zh-CN'
): string {
  return TYPE_FALLBACKS[type][locale]
}

export function referenceComponentDisplayName(component: Component, locale: ReferenceDisplayLocale = 'zh-CN'): string {
  if (component.type === 'plan_reference') return ''
  const payload = component.payload && typeof component.payload === 'object'
    ? component.payload as unknown as Record<string, unknown> : {}
  if (['single_plan', 'multi_plan', 'task_list', 'task_detail', 'heading'].includes(component.type)) {
    const title = payload.title
    if (typeof title === 'string' && title.trim()) return title.split(/\r?\n/, 1)[0].slice(0, 200)
  }
  return referenceComponentTypeFallback(component.type, locale)
}

export interface PlanReferencePayload {
  mode: PlanReferenceMode
  target_plan_id: string
  target_component_id?: string
  target_path_snapshot: string
  target_name_snapshot: string
}

export interface PlanReferenceTarget {
  plan_id: string
  path: string
  plan_name: string
  component_id?: string
  component_type?: Exclude<ComponentType, 'plan_reference'>
  component_name?: string
}

export type ReferenceImpactOperation = 'rename-plan' | 'delete-plan' | 'rename-component' | 'delete-component'

export interface ReferenceImpactItem {
  source_path: string
  source_component_id: string
  source_updated_at: string
  target_plan_id: string
  target_component_id?: string
  mode: PlanReferenceMode
  target_path_snapshot: string
  target_name_snapshot: string
}

export interface ReferenceImpactPreview {
  operation: ReferenceImpactOperation
  path: string
  component_id?: string
  new_name?: string
  new_title?: string
  expected_updated_at?: string
  locale?: ReferenceDisplayLocale
  target_updated_at?: string
  target_plan_ids: string[]
  /** Opaque CAS digest for the target directory identity and every valid plan revision in its subtree. */
  target_snapshot_digest?: string
  references: ReferenceImpactItem[]
}

export interface PlanMoveTargetSnapshot {
  path: string
  plan_id: string | null
  updated_at: string
}

/** Main-issued frozen move snapshot. It contains relative paths and opaque identities only. */
export interface PlanMoveSnapshot {
  library_id: string
  root_generation: number
  change_revision: number
  storage_root_generation: number
  source_path: string
  target_parent_path: string
  source_directory_identity: string
  target_directory_identity: string
  source_plans: PlanMoveTargetSnapshot[]
}

export interface ReferenceImpactDecision {
  source_path: string
  source_component_id: string
  action: 'keep' | 'replace'
  replacement?: { path: string; component_id?: string }
}

export interface ReferenceImpactRequest {
  library_id: string
  operation: ReferenceImpactOperation
  path: string
  component_id?: string
  new_name?: string
  new_title?: string
  expected_updated_at?: string
  locale?: ReferenceDisplayLocale
}

export interface ReferenceImpactCommit {
  library_id: string
  preview: ReferenceImpactPreview
  rename_action?: 'update' | 'keep'
  decisions?: ReferenceImpactDecision[]
}
