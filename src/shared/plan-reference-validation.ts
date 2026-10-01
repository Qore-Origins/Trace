import type { ComponentType } from './plan-types'
import type { PlanReferencePayload } from './plan-reference-types'

const UUID32_PATTERN = /^[0-9a-f]{32}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/
const MAX_NAME_LENGTH = 200
const MAX_PATH_SNAPSHOT_LENGTH = 1024

function isUuid32(value: unknown): value is string {
  return typeof value === 'string' && UUID32_PATTERN.test(value)
}

export function isPlanId(value: unknown): value is string | undefined {
  return value === undefined || isUuid32(value)
}

export function isReferenceTargetType(value: unknown): value is Exclude<ComponentType, 'plan_reference'> {
  return value === 'single_plan' || value === 'multi_plan' || value === 'task_list' ||
    value === 'task_detail' || value === 'note' || value === 'mood' ||
    value === 'heading' || value === 'custom'
}

function isDisplayText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 &&
    value.length <= maxLength && !CONTROL_CHARACTER_PATTERN.test(value)
}

export function isPlanReferencePayload(
  value: unknown,
  targetComponentType?: unknown
): value is PlanReferencePayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (candidate.mode !== 'link' && candidate.mode !== 'embed') return false
  if (!isUuid32(candidate.target_plan_id)) return false
  if (candidate.target_component_id !== undefined && !isUuid32(candidate.target_component_id)) return false
  if (candidate.mode === 'embed' && candidate.target_component_id === undefined) return false
  if (!isDisplayText(candidate.target_path_snapshot, MAX_PATH_SNAPSHOT_LENGTH)) return false
  if (!isDisplayText(candidate.target_name_snapshot, MAX_NAME_LENGTH)) return false
  if (targetComponentType !== undefined && !isReferenceTargetType(targetComponentType)) return false
  return true
}
