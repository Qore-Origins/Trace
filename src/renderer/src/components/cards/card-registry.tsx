import { memo, type ComponentType as ReactComponentType } from 'react'
import type { ComponentType } from '@shared/plan-types'
import type { CardRenderProps } from './CardShell'
import { FallbackBlock } from './FallbackBlock'
import { HeadingCard } from './HeadingCard'
import { MoodCard } from './MoodCard'
import { MultiPlanCard } from './MultiPlanCard'
import { SinglePlanCard } from './SinglePlanCard'
import { TaskDetailCard } from './TaskDetailCard'
import { TaskListCard } from './TaskListCard'

export type CardRenderer = ReactComponentType<CardRenderProps>
export type CardRegistry = Record<ComponentType, CardRenderer>

export function createCardRegistry(noteRenderer: CardRenderer): CardRegistry {
  return {
    single_plan: memo(SinglePlanCard),
    multi_plan: memo(MultiPlanCard),
    task_list: memo(TaskListCard),
    task_detail: memo(TaskDetailCard),
    note: memo(noteRenderer),
    mood: memo(MoodCard),
    heading: memo(HeadingCard),
    custom: memo(FallbackBlock)
  }
}

export function resolveCardRenderer(registry: CardRegistry, type: string): CardRenderer {
  return Object.prototype.hasOwnProperty.call(registry, type)
    ? registry[type as ComponentType]
    : FallbackBlock
}
