import { describe, expect, it } from 'vitest'
import type { ComponentType } from '@shared/plan-types'
import { FallbackBlock } from '../src/renderer/src/components/cards/FallbackBlock'
import { createCardRegistry, resolveCardRenderer, type CardRenderer } from '../src/renderer/src/components/cards/card-registry'

describe('card registry', () => {
  it('covers every persisted ComponentType', () => {
    const noteRenderer: CardRenderer = () => null
    const registry = createCardRegistry(noteRenderer)
    const persistedTypes: ComponentType[] = [
      'single_plan',
      'multi_plan',
      'task_list',
      'task_detail',
      'note',
      'mood',
      'heading',
      'custom'
    ]

    expect(Object.keys(registry)).toEqual(persistedTypes)
    expect((registry.note as unknown as { type: CardRenderer }).type).toBe(noteRenderer)
    expect((registry.custom as unknown as { type: CardRenderer }).type).toBe(FallbackBlock)
  })

  it('routes runtime-unknown component types to the fallback renderer', () => {
    const registry = createCardRegistry(() => null)

    expect(resolveCardRenderer(registry, 'future_component')).toBe(FallbackBlock)
  })
})
