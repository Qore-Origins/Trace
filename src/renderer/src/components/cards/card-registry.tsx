import type React from 'react'
import type { ComponentType } from '@shared/plan-types'
import type { CardRenderProps } from './CardShell'
import { FallbackBlock } from './FallbackBlock'
import { HeadingCard } from './HeadingCard'
import { MoodCard } from './MoodCard'
import { MultiPlanCard } from './MultiPlanCard'
import { SinglePlanCard } from './SinglePlanCard'
import { TaskDetailCard } from './TaskDetailCard'
import { TaskListCard } from './TaskListCard'

export type CardRenderer = React.ComponentType<CardRenderProps>
export type CardRegistry = Record<ComponentType, CardRenderer>

export function createCardRegistry(noteRenderer: CardRenderer): CardRegistry {
  return {
    single_plan: SinglePlanCard,
    multi_plan: MultiPlanCard,
    task_list: TaskListCard,
    task_detail: TaskDetailCard,
    note: noteRenderer,
    mood: MoodCard,
    heading: HeadingCard,
    custom: FallbackBlock
  }
}

export function resolveCardRenderer(registry: CardRegistry, type: string): CardRenderer {
  return Object.prototype.hasOwnProperty.call(registry, type)
    ? registry[type as ComponentType]
    : FallbackBlock
}
