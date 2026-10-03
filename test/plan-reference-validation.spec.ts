import { describe, expect, it } from 'vitest'
import { isPlanId, isPlanReferencePayload, isReferenceTargetType } from '../src/shared/plan-reference-validation'

const planId = '0123456789abcdef0123456789abcdef'
const componentId = 'abcdef0123456789abcdef0123456789'
const snapshots = { target_path_snapshot: 'Projects/Plan', target_name_snapshot: 'My display name' }

describe('plan reference validation', () => {
  it('accepts optional legacy plan identity and a valid stable ID', () => {
    expect(isPlanId(undefined)).toBe(true)
    expect(isPlanId(planId)).toBe(true)
    expect(isPlanId('not-an-id')).toBe(false)
  })

  it('accepts plan links, component links, and component embeds', () => {
    expect(isPlanReferencePayload({ mode: 'link', target_plan_id: planId, ...snapshots })).toBe(true)
    expect(isPlanReferencePayload({ mode: 'link', target_plan_id: planId, target_component_id: componentId, ...snapshots })).toBe(true)
    expect(isPlanReferencePayload({ mode: 'embed', target_plan_id: planId, target_component_id: componentId, ...snapshots })).toBe(true)
  })

  it('rejects invalid modes, missing embed targets, and malformed IDs', () => {
    expect(isPlanReferencePayload({ mode: 'embed', target_plan_id: planId, ...snapshots })).toBe(false)
    expect(isPlanReferencePayload({ mode: 'future', target_plan_id: planId, ...snapshots })).toBe(false)
    expect(isPlanReferencePayload({ mode: 'link', target_plan_id: 'bad', ...snapshots })).toBe(false)
    expect(isPlanReferencePayload({ mode: 'link', target_plan_id: planId, target_component_id: 'bad', ...snapshots })).toBe(false)
  })

  it('keeps the editable name snapshot as display text', () => {
    expect(isPlanReferencePayload({ mode: 'link', target_plan_id: planId, ...snapshots, target_name_snapshot: 'Renamed label' })).toBe(true)
    expect(isPlanReferencePayload({ mode: 'link', target_plan_id: planId, ...snapshots, target_name_snapshot: '' })).toBe(false)
    expect(isPlanReferencePayload({ mode: 'link', target_plan_id: planId, ...snapshots, target_name_snapshot: 'a'.repeat(201) })).toBe(false)
    expect(isPlanReferencePayload({ mode: 'link', target_plan_id: planId, ...snapshots, target_name_snapshot: 'bad\u0000name' })).toBe(false)
  })

  it('rejects reference components as targets', () => {
    expect(isReferenceTargetType('note')).toBe(true)
    expect(isReferenceTargetType('plan_reference')).toBe(false)
    expect(isPlanReferencePayload({ mode: 'embed', target_plan_id: planId, target_component_id: componentId, ...snapshots }, 'plan_reference')).toBe(false)
  })
})
