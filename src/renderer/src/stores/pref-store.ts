// prefStore：用户偏好（界面语言 / 树动效发牌方向 / 自定义组件预设）——localStorage 持久化，渲染器本地（不出设备）
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { i18n } from '../i18n'

export type Language = 'zh-CN' | 'en-US'
export type DealDirection = 'top' | 'bottom'

export interface CustomPreset {
  id: string
  name: string
  content: string
}

interface PrefState {
  language: Language
  dealDirection: DealDirection // 树展开/收拢的发牌波次方向（默认首张先发）
  customPresets: CustomPreset[] // 自定义组件预设（插入即快照：插入时复制 content，改预设不影响已插入卡）
  setLanguage: (language: Language) => void
  setDealDirection: (dealDirection: DealDirection) => void
  addPreset: (name: string, content: string) => void
  removePreset: (id: string) => void
}

export const usePrefStore = create<PrefState>()(
  persist(
    (set) => ({
      language: 'zh-CN',
      dealDirection: 'top',
      // 旧持久化数据（trace-prefs 无此键）经 persist 浅合并取默认 []，不破坏既有契约
      customPresets: [],
      setLanguage: (language) => {
        void i18n.changeLanguage(language)
        set({ language })
      },
      setDealDirection: (dealDirection) => set({ dealDirection }),
      addPreset: (name, content) =>
        set((s) => ({ customPresets: [...s.customPresets, { id: crypto.randomUUID(), name, content }] })),
      removePreset: (id) => set((s) => ({ customPresets: s.customPresets.filter((p) => p.id !== id) }))
    }),
    { name: 'trace-prefs' }
  )
)
