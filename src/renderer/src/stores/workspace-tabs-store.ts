import { create } from 'zustand'
import type { WorkspaceTabsState } from '@shared/workspace-tabs-types'
import { invoke } from '../ipc-client'

export interface WorkspaceTabPlanActions {
  flushPlan: () => Promise<boolean>
  openPlan: (path: string) => Promise<boolean>
  closePlan: () => void
  currentPlanPath: () => string | null
}

export interface WorkspaceTabsPort {
  load: () => Promise<WorkspaceTabsState>
  save: (state: WorkspaceTabsState) => Promise<void>
  flushPlan: () => Promise<boolean>
  openPlan: (path: string) => Promise<boolean>
  closePlan: () => void
  focusComponent?: (componentId: string) => void
  selectPlan?: (path: string) => void
  currentPlanPath?: () => string | null
}

type RestoreStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface WorkspaceTabsStore extends WorkspaceTabsState {
  rootKey: string | null
  restoreStatus: RestoreStatus
  hydrate: (rootKey: string | null) => Promise<boolean>
  openPlan: (path: string, focusComponentId?: string) => Promise<boolean>
  activate: (path: string) => Promise<boolean>
  closeTab: (path: string) => Promise<boolean>
  closeUnder: (path: string) => Promise<boolean>
  remapPrefix: (oldPath: string, newPath: string) => Promise<boolean>
}

function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`)
}

function focusComponent(componentId: string): void {
  if (typeof document === 'undefined') return
  window.setTimeout(() => {
    const target = Array.from(document.querySelectorAll<HTMLElement>('[data-component-id]'))
      .find((element) => element.dataset.componentId === componentId)
    if (!target) return
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    target.classList.remove('pulse')
    void target.offsetWidth
    target.classList.add('pulse')
  }, 200)
}

export function createWorkspaceTabsStore(api: WorkspaceTabsPort) {
  let generation = 0
  let interactionRevision = 0
  const empty = (rootKey: string | null): Pick<WorkspaceTabsStore, 'rootKey' | 'library_id' | 'open_paths' | 'active_path'> => ({
    rootKey,
    library_id: '',
    open_paths: [],
    active_path: null
  })

  return create<WorkspaceTabsStore>()((set, get) => {
    const save = async (next: WorkspaceTabsState, currentGeneration: number): Promise<boolean> => {
      if (currentGeneration !== generation) return false
      if (!next.library_id) return false
      try {
        await api.save(next)
        if (currentGeneration !== generation) return false
        if (get().restoreStatus === 'error') set({ restoreStatus: 'ready' })
        return true
      } catch {
        if (currentGeneration === generation) set({ restoreStatus: 'error' })
        return false
      }
    }

    const activate = async (path: string, add: boolean, componentId?: string): Promise<boolean> => {
      const state = get()
      if (!state.rootKey) return false
      const exists = state.open_paths.some((item) => item.path === path)
      if (!exists && !add) return false
      interactionRevision += 1
      if (path === state.active_path) {
        api.selectPlan?.(path)
        if (componentId) (api.focusComponent ?? focusComponent)(componentId)
        return true
      }
      const currentGeneration = generation
      if (!(await api.flushPlan()) || currentGeneration !== generation) return false
      if (!(await api.openPlan(path)) || currentGeneration !== generation) return false
      const latest = get()
      const next: WorkspaceTabsState = {
        library_id: latest.library_id,
        open_paths: latest.open_paths.some((item) => item.path === path) ? latest.open_paths : [...latest.open_paths, { path }],
        active_path: path
      }
      set(next)
      api.selectPlan?.(path)
      await save(next, currentGeneration)
      if (componentId && currentGeneration === generation) (api.focusComponent ?? focusComponent)(componentId)
      return true
    }

    return {
      ...empty(null),
      restoreStatus: 'idle',
      hydrate: async (rootKey) => {
        if (rootKey === get().rootKey && get().restoreStatus === 'ready') return true
        const currentGeneration = ++generation
        const switchingRoot = get().rootKey !== rootKey
        if (switchingRoot && get().rootKey !== null) api.closePlan()
        if (switchingRoot) set({ ...empty(rootKey), restoreStatus: rootKey ? 'loading' : 'idle' })
        else set({ restoreStatus: rootKey ? 'loading' : 'idle' })
        if (!rootKey) return true
        const startingInteraction = interactionRevision
        try {
          const loaded = await api.load()
          if (currentGeneration !== generation) return false
          const session = get()
          const paths = [...loaded.open_paths]
          for (const item of session.open_paths) {
            if (!paths.some((loadedItem) => loadedItem.path === item.path)) paths.push(item)
          }
          const userInteracted = interactionRevision !== startingInteraction
          const activePath = userInteracted ? session.active_path : (session.active_path ?? loaded.active_path)
          set({ library_id: loaded.library_id, open_paths: paths, active_path: activePath, restoreStatus: 'ready' })
          if (userInteracted) {
            if (session.open_paths.length > 0) await save({ library_id: loaded.library_id, open_paths: paths, active_path: activePath }, currentGeneration)
            return true
          }
          if (activePath && !session.active_path) {
            const restoringInteraction = interactionRevision
            const opened = await api.openPlan(activePath)
            if (currentGeneration !== generation) return false
            if (!opened) {
              if (interactionRevision === restoringInteraction && get().active_path === activePath) {
                set({ active_path: null, restoreStatus: 'error' })
              }
              return false
            }
            if (interactionRevision === restoringInteraction && get().active_path === activePath) api.selectPlan?.(activePath)
          }
          return true
        } catch {
          if (currentGeneration === generation) set({ restoreStatus: 'error' })
          return false
        }
      },
      openPlan: (path, componentId) => activate(path, true, componentId),
      activate: (path) => activate(path, false),
      closeTab: async (path) => {
        const state = get()
        if (!state.open_paths.some((item) => item.path === path)) return false
        interactionRevision += 1
        const currentGeneration = generation
        if (path === state.active_path && !(await api.flushPlan())) return false
        if (currentGeneration !== generation) return false
        const latest = get()
        const index = latest.open_paths.findIndex((item) => item.path === path)
        if (index < 0) return false
        if (path !== latest.active_path) {
          const next = { library_id: latest.library_id, open_paths: latest.open_paths.filter((item) => item.path !== path), active_path: latest.active_path }
          set(next)
          return save(next, currentGeneration)
        }
        const remaining = latest.open_paths.filter((item) => item.path !== path)
        const neighbor = latest.open_paths[index - 1] ?? latest.open_paths[index + 1]
        if (neighbor && !(await api.openPlan(neighbor.path))) return false
        if (currentGeneration !== generation) return false
        if (!neighbor) api.closePlan()
        const next = { library_id: latest.library_id, open_paths: remaining, active_path: neighbor?.path ?? null }
        set(next)
        if (neighbor) api.selectPlan?.(neighbor.path)
        return save(next, currentGeneration)
      },
      closeUnder: async (path) => {
        const state = get()
        const remaining = state.open_paths.filter((item) => !under(item.path, path))
        if (remaining.length === state.open_paths.length) return true
        const currentGeneration = generation
        const activeRemoved = state.active_path !== null && under(state.active_path, path)
        let neighborPath: string | null = null
        let neighborOpened = false
        if (activeRemoved) {
          const index = state.open_paths.findIndex((item) => item.path === state.active_path)
          const left = state.open_paths.slice(0, index).reverse().find((item) => !under(item.path, path))
          const right = state.open_paths.slice(index + 1).find((item) => !under(item.path, path))
          neighborPath = left?.path ?? right?.path ?? null
          api.closePlan()
          if (neighborPath) neighborOpened = await api.openPlan(neighborPath)
        }
        if (currentGeneration !== generation) return false
        const latest = get()
        const latestRemaining = latest.open_paths.filter((item) => !under(item.path, path))
        const activePath = latest.active_path && under(latest.active_path, path)
          ? (neighborOpened && neighborPath && latestRemaining.some((item) => item.path === neighborPath) ? neighborPath : null)
          : latest.active_path
        const next = { library_id: latest.library_id, open_paths: latestRemaining, active_path: activePath }
        set(next)
        if (activePath) api.selectPlan?.(activePath)
        return save(next, currentGeneration)
      },
      remapPrefix: async (oldPath, newPath) => {
        const state = get()
        if (!state.open_paths.some((item) => under(item.path, oldPath))) return true
        const currentGeneration = generation
        let opened = true
        const expectedActivePath = state.active_path && under(state.active_path, oldPath)
          ? newPath + state.active_path.slice(oldPath.length)
          : state.active_path
        if (expectedActivePath !== state.active_path && expectedActivePath !== api.currentPlanPath?.()) {
          if (!(await api.flushPlan()) || currentGeneration !== generation) return false
          if (expectedActivePath) opened = await api.openPlan(expectedActivePath)
        }
        if (currentGeneration !== generation) return false
        const latest = get()
        const renamed = latest.open_paths.map((item) => under(item.path, oldPath)
          ? { ...item, path: newPath + item.path.slice(oldPath.length) }
          : item)
        const activeAffected = latest.active_path !== null && under(latest.active_path, oldPath)
        const activePath = activeAffected
          ? (opened ? newPath + latest.active_path!.slice(oldPath.length) : null)
          : latest.active_path
        if (!opened && activeAffected) api.closePlan()
        const next = { library_id: latest.library_id, open_paths: renamed, active_path: activePath }
        set(next)
        if (activePath) api.selectPlan?.(activePath)
        return (await save(next, currentGeneration)) && opened
      }
    }
  })
}

let planActions: WorkspaceTabPlanActions | null = null

const workspaceTabsPort: WorkspaceTabsPort = {
  load: () => invoke('workspace-tabs:get'),
  save: async (state) => { await invoke('workspace-tabs:set', { state }) },
  flushPlan: () => planActions?.flushPlan() ?? Promise.resolve(false),
  openPlan: (path) => planActions?.openPlan(path) ?? Promise.resolve(false),
  closePlan: () => planActions?.closePlan(),
  currentPlanPath: () => planActions?.currentPlanPath() ?? null
}

export function registerWorkspaceTabPlanActions(actions: WorkspaceTabPlanActions | null): void {
  planActions = actions
}

export function registerWorkspaceTabSelection(selectPlan: (path: string) => void): void {
  workspaceTabsPort.selectPlan = selectPlan
}

export const useWorkspaceTabsStore = createWorkspaceTabsStore(workspaceTabsPort)
