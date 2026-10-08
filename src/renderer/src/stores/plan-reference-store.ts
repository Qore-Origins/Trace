import { create } from 'zustand'
import type { PlanReferenceResolution } from '@shared/ipc-contract'
import { invoke } from '../ipc-client'

export interface PlanReferenceResolveRequest {
  library_id: string
  plan_id: string
  component_id?: string
}

export type PlanReferenceResolutionState =
  | { status: 'loading' }
  | { status: 'found'; resolution: Extract<PlanReferenceResolution, { status: 'found' }> }
  | { status: 'missing' }
  | { status: 'conflict' }
  | { status: 'error' }

interface PlanReferenceStoreState {
  resolutions: Record<string, PlanReferenceResolutionState>
  resolve: (
    key: string,
    request: PlanReferenceResolveRequest,
    isCurrent: () => boolean,
    force?: boolean
  ) => Promise<PlanReferenceResolution | undefined>
  forget: (key: string) => void
}

export function createPlanReferenceStore(
  resolveTarget: (request: PlanReferenceResolveRequest) => Promise<PlanReferenceResolution>
) {
  const requestRevisions = new Map<string, number>()
  let nextRequestRevision = 0

  return create<PlanReferenceStoreState>()((set, get) => ({
    resolutions: {},
    resolve: async (key, request, isCurrent, force = false) => {
      const existing = get().resolutions[key]
      if (!force && existing?.status === 'found') return existing.resolution
      if (!force && existing?.status === 'missing') return { status: 'missing' }
      if (!force && existing?.status === 'conflict') return { status: 'conflict' }

      const revision = ++nextRequestRevision
      requestRevisions.set(key, revision)
      set((state) => ({ resolutions: { ...state.resolutions, [key]: { status: 'loading' } } }))

      try {
        const resolution = await resolveTarget(request)
        if (requestRevisions.get(key) !== revision || !isCurrent()) return undefined
        const nextState: PlanReferenceResolutionState = resolution.status === 'found'
          ? { status: 'found', resolution }
          : { status: resolution.status }
        set((state) => ({ resolutions: { ...state.resolutions, [key]: nextState } }))
        return resolution
      } catch {
        if (requestRevisions.get(key) !== revision || !isCurrent()) return undefined
        set((state) => ({ resolutions: { ...state.resolutions, [key]: { status: 'error' } } }))
        return undefined
      }
    },
    forget: (key) => {
      requestRevisions.delete(key)
      set((state) => {
        if (!(key in state.resolutions)) return state
        const resolutions = { ...state.resolutions }
        delete resolutions[key]
        return { resolutions }
      })
    }
  }))
}

export const usePlanReferenceStore = createPlanReferenceStore((request) =>
  invoke('plan-reference:resolve', request)
)
