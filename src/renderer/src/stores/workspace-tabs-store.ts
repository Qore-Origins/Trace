import { create } from 'zustand'
import type { WorkspaceTabsState } from '@shared/workspace-tabs-types'
import { invoke } from '../ipc-client'
import { usePlanStore } from './plan-store'
import { useTreeStore } from './tree-store'

export interface WorkspaceTabsPort {
  load: () => Promise<WorkspaceTabsState>
  save: (state: WorkspaceTabsState) => Promise<void>
  flushPlan: () => Promise<boolean>
  openPlan: (path: string) => Promise<boolean>
  closePlan: () => void
  focusComponent?: (componentId: string) => void
  selectPlan?: (path: string) => void
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
  const empty = (rootKey: string | null): Pick<WorkspaceTabsStore, 'rootKey' | 'library_id' | 'open_paths' | 'active_path'> => ({
    rootKey,
    library_id: '',
    open_paths: [],
    active_path: null
  })

  return create<WorkspaceTabsStore>()((set, get) => {
    const save = async (next: WorkspaceTabsState, currentGeneration: number): Promise<boolean> => {
      if (currentGeneration !== generation) return false
      try {
        await api.save(next)
        return currentGeneration === generation
      } catch {
        if (currentGeneration === generation) set({ restoreStatus: 'error' })
        return false
      }
    }

    const activate = async (path: string, add: boolean, componentId?: string): Promise<boolean> => {
      const state = get()
      if (!state.rootKey || state.restoreStatus !== 'ready') return false
      const exists = state.open_paths.some((item) => item.path === path)
      if (!exists && !add) return false
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
        open_paths: exists ? latest.open_paths : [...latest.open_paths, { path }],
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
        if (get().rootKey !== null) api.closePlan()
        set({ ...empty(rootKey), restoreStatus: rootKey ? 'loading' : 'idle' })
        if (!rootKey) return true
        try {
          const loaded = await api.load()
          if (currentGeneration !== generation) return false
          set({ ...loaded, restoreStatus: 'ready' })
          if (loaded.active_path) {
            const opened = await api.openPlan(loaded.active_path)
            if (currentGeneration !== generation) return false
            if (!opened) {
              set({ active_path: null, restoreStatus: 'error' })
              return false
            }
            api.selectPlan?.(loaded.active_path)
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
        let activePath = state.active_path
        if (activeRemoved) {
          const index = state.open_paths.findIndex((item) => item.path === state.active_path)
          const left = state.open_paths.slice(0, index).reverse().find((item) => !under(item.path, path))
          const right = state.open_paths.slice(index + 1).find((item) => !under(item.path, path))
          activePath = left?.path ?? right?.path ?? null
          api.closePlan()
          if (activePath && !(await api.openPlan(activePath))) activePath = null
        }
        if (currentGeneration !== generation) return false
        const next = { library_id: state.library_id, open_paths: remaining, active_path: activePath }
        set(next)
        if (activePath) api.selectPlan?.(activePath)
        return save(next, currentGeneration)
      },
      remapPrefix: async (oldPath, newPath) => {
        const state = get()
        const renamed = state.open_paths.map((item) => under(item.path, oldPath)
          ? { ...item, path: newPath + item.path.slice(oldPath.length) }
          : item)
        if (renamed.every((item, index) => item.path === state.open_paths[index].path)) return true
        const currentGeneration = generation
        let opened = true
        let activePath = state.active_path && under(state.active_path, oldPath)
          ? newPath + state.active_path.slice(oldPath.length)
          : state.active_path
        if (activePath !== state.active_path) {
          if (!(await api.flushPlan()) || currentGeneration !== generation) return false
          if (activePath && !(await api.openPlan(activePath))) {
            api.closePlan()
            activePath = null
            opened = false
          }
        }
        if (currentGeneration !== generation) return false
        const next = { library_id: state.library_id, open_paths: renamed, active_path: activePath }
        set(next)
        if (activePath) api.selectPlan?.(activePath)
        return (await save(next, currentGeneration)) && opened
      }
    }
  })
}

export const useWorkspaceTabsStore = createWorkspaceTabsStore({
  load: () => invoke('workspace-tabs:get'),
  save: async (state) => { await invoke('workspace-tabs:set', { state }) },
  flushPlan: () => usePlanStore.getState().flush(),
  openPlan: (path) => usePlanStore.getState().open(path),
  closePlan: () => usePlanStore.getState().close(),
  selectPlan: (path) => useTreeStore.getState().select(path, 'plan')
})
