import type { Component, MultiPlanPayload, TaskListPayload, PlanDocument } from '@shared/plan-types'
import { usePlanStore } from '../../stores/plan-store'
import { useUndoStore } from '../../stores/undo-store'
import { removeWithSnapshot, restoreSnapshot } from './action-policy'

export function focusComponent(componentId: string, rowIndex?: number): void {
  if (typeof document === 'undefined') return
  requestAnimationFrame(() => {
    const card = document.querySelector<HTMLElement>(`[data-component-id="${CSS.escape(componentId)}"]`)
    if (!card) return
    const rows = card.querySelectorAll<HTMLButtonElement>('.task-row .task-del')
    const target = rowIndex === undefined ? card : rows[Math.min(rowIndex, rows.length - 1)] ?? card
    target.focus()
  })
}
export function focusNearestCard(index: number): void {
  if (typeof document === 'undefined') return
  requestAnimationFrame(() => {
    const cards = document.querySelectorAll<HTMLElement>('[data-component-id]')
    const target = cards[Math.min(index, cards.length - 1)] ?? document.querySelector<HTMLElement>('.ws-content')
    if (target) { target.tabIndex = -1; target.focus() }
  })
}
function findComponent(doc: PlanDocument | null, id: string, type: Component['type']): Component | undefined {
  return doc?.components.find(component => component.id === id && component.type === type)
}
export function removePlanRow(componentId: string, kind: 'task' | 'option', rowId: string, description: string): void {
  const state = usePlanStore.getState()
  const path = state.currentPath
  const type = kind === 'task' ? 'task_list' : 'multi_plan'
  const component = findComponent(state.document, componentId, type)
  if (!path || !component) return
  const targetComponent: Component = component
  function execute<T extends { id: string }>(getItems: (component: Component) => T[]): void {
    const snapshot = removeWithSnapshot([...getItems(targetComponent)], rowId)
    if (!snapshot) return
    state.mutate(doc => {
      const current = findComponent(doc, componentId, type)
      if (current) removeWithSnapshot(getItems(current), rowId)
    })
    const dispose = usePlanStore.subscribe((next, previous) => {
      if (next.currentPath !== path || !next.document || next.externalAlert ||
        (next.document !== previous.document && next.saveState === 'idle') || !findComponent(next.document, componentId, type)) useUndoStore.getState().clear()
    })
    useUndoStore.getState().register({
      description, dispose, restoreFocus: () => focusComponent(componentId, snapshot.index),
      undo: () => {
        if (usePlanStore.getState().currentPath !== path) return
        usePlanStore.getState().mutate(doc => {
          const current = findComponent(doc, componentId, type)
          if (current) restoreSnapshot(getItems(current), snapshot)
        })
      }
    })
    focusComponent(componentId, snapshot.index)
  }
  if (kind === 'task') execute(current => (current.payload as TaskListPayload).items)
  else execute(current => (current.payload as MultiPlanPayload).options)
}
