// appStore：应用阶段/根目录/索引状态（前端详细设计 §4.1）
import { create } from 'zustand'
import { invoke, onEvent, ClientError } from '../ipc-client'
import { message, Modal } from 'antd'
import { i18n } from '../i18n'

export type AppPhase = 'checking' | 'onboarding' | 'ready'
export type IndexState = 'building' | 'ready' | 'error'

interface AppState {
  phase: AppPhase
  rootDir: string | null
  rootInvalid: boolean
  indexState: IndexState
  winMaximized: boolean // 无边框自绘控制用
  // 溯源浮层开合（Sprint 3 接 SearchService；先做壳）
  searchOpen: boolean
  bootstrap: () => Promise<void>
  setRootDir: (dirPath: string, confirmed: boolean) => Promise<void>
  switchRootDir: () => Promise<void>
  setSearchOpen: (open: boolean) => void
}

export const useAppStore = create<AppState>()((set) => ({
  phase: 'checking',
  rootDir: null,
  rootInvalid: false,
  indexState: 'ready',
  winMaximized: false,
  searchOpen: false,

  bootstrap: async () => {
    try {
      const info = await invoke('app:bootstrap')
      if (info.rootConfigured && !info.rootInvalid) {
        set({ phase: 'ready', rootDir: info.rootDir, rootInvalid: false, indexState: info.indexState })
      } else {
        set({ phase: 'onboarding', rootDir: info.rootDir, rootInvalid: info.rootConfigured && info.rootInvalid })
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

  // 切换计划库目录（菜单入口）：选目录 → 确认切换（主进程语义：有效根切走需 confirmed）→ 重置应用状态
  switchRootDir: async () => {
    const picked = await invoke('app:chooseDirectory')
    if (!picked.dirPath) return
    const { useTreeStore } = await import('./tree-store')
    const { usePlanStore } = await import('./plan-store')
    Modal.confirm({
      title: i18n.t('confirm.switchRootTitle'),
      content: i18n.t('confirm.switchRootDesc', { dir: picked.dirPath }),
      okText: i18n.t('confirm.switchRootBtn'),
      cancelText: i18n.t('common.cancel'),
      onOk: async () => {
        await invoke('app:setRootDir', { dirPath: picked.dirPath as string, confirmed: true })
        usePlanStore.getState().close()
        await useTreeStore.getState().refreshAll()
        const info = await invoke('app:bootstrap')
        set({
          phase: info.rootConfigured && !info.rootInvalid ? 'ready' : 'onboarding',
          rootDir: info.rootDir
        })
      }
    })
  },

  setSearchOpen: (open) => set({ searchOpen: open })
}))

// 全局事件订阅（app 级：索引状态 / 窗口最大化状态；随组件生命周期挂载/释放）
export function subscribeAppEvents(): () => void {
  const offIndex = onEvent('trace:index-status', (p) => useAppStore.setState({ indexState: p.state }))
  const offWin = onEvent('trace:window-state', (p) => useAppStore.setState({ winMaximized: p.maximized }))
  return () => {
    offIndex()
    offWin()
  }
}
