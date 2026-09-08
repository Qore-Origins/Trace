// prefStore：用户偏好（界面语言 / 树动效发牌方向）——localStorage 持久化，渲染器本地（不出设备）
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { i18n } from '../i18n'

export type Language = 'zh-CN' | 'en-US'
export type DealDirection = 'top' | 'bottom'

interface PrefState {
  language: Language
  dealDirection: DealDirection // 树展开/收拢的发牌波次方向（默认首张先发）
  setLanguage: (language: Language) => void
  setDealDirection: (dealDirection: DealDirection) => void
}

export const usePrefStore = create<PrefState>()(
  persist(
    (set) => ({
      language: 'zh-CN',
      dealDirection: 'top',
      setLanguage: (language) => {
        void i18n.changeLanguage(language)
        set({ language })
      },
      setDealDirection: (dealDirection) => set({ dealDirection })
    }),
    { name: 'trace-prefs' }
  )
)
