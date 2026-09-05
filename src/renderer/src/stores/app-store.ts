// appStore：应用阶段/根目录/索引状态（前端详细设计 §4.1）
import { create } from 'zustand'
import { invoke, onEvent, ClientError } from '../ipc-client'
import { message } from 'antd'

export type AppPhase = 'checking' | 'onboarding' | 'ready'
export type IndexState = 'building' | 'ready' | 'error'

interface AppState {
  phase: AppPhase
  rootDir: string | null
  indexState: IndexState
  // 溯源浮层开合（Sprint 3 接 SearchService；先做壳）
  searchOpen: boolean
  bootstrap: () => Promise<void>
  setRootDir: (dirPath: string, confirmed: boolean) => Promise<void>
  setSearchOpen: (open: boolean) => void
}

export const useAppStore = create<AppState>()((set) => ({
  phase: 'checking',
  rootDir: null,
  indexState: 'ready',
  searchOpen: false,

  bootstrap: async () => {
    try {
      const info = await invoke('app:bootstrap')
      if (info.rootConfigured && !info.rootInvalid) {
        set({ phase: 'ready', rootDir: info.rootDir, indexState: info.indexState })
      } else {
        set({ phase: 'onboarding', rootDir: info.rootDir })
      }
    } catch (e) {
      message.error(e instanceof ClientError ? e.message : '启动失败')
      set({ phase: 'onboarding' })
    }
  },

  setRootDir: async (dirPath, confirmed) => {
    const r = await invoke('app:setRootDir', { dirPath, confirmed })
    set({ phase: 'ready', rootDir: r.rootDir })
  },

  setSearchOpen: (open) => set({ searchOpen: open })
}))

// 全局事件订阅（app 级：索引状态；随组件生命周期挂载/释放）
export function subscribeAppEvents(): () => void {
  const offIndex = onEvent('trace:index-status', (p) => useAppStore.setState({ indexState: p.state }))
  return offIndex
}
