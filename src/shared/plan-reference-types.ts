import type { ComponentType } from './plan-types'

export type PlanReferenceMode = 'link' | 'embed'

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
