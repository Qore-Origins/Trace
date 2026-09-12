// prefStore：用户偏好（界面语言 / 树动效发牌方向 / 心情分数动画 / 自定义组件预设）——localStorage 持久化，渲染器本地（不出设备）
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { i18n } from '../i18n'

export type Language = 'zh-CN' | 'en-US'
export type DealDirection = 'top' | 'bottom'
export type ScoreAnim = 'roll' | 'none' // 心情分数动画：轮带式 / 无动画（2026-09-09 定案：V2 翻页式剔除）
export type ThemeMode = 'light' | 'dark' | 'system' // 界面主题（system=跟随系统，实时联动）

// 树侧边栏宽度（拖拽调宽，VS Code 参考行为）——上下限约束
export const TREE_WIDTH_MIN = 180
export const TREE_WIDTH_MAX = 520
export const TREE_WIDTH_DEFAULT = 280

// 宽度约束（拖拽与 store 单点规则；纯函数供单测）
export function clampTreeWidth(w: number): number {
  return Math.max(TREE_WIDTH_MIN, Math.min(TREE_WIDTH_MAX, Math.round(w)))
}

export interface CustomPreset {
  id: string
  name: string
  content: string
}

interface PrefState {
  language: Language
  dealDirection: DealDirection // 树展开/收拢的发牌波次方向（默认首张先发）
  scoreAnim: ScoreAnim // 心情分数动画（默认轮带式）
  theme: ThemeMode // 界面主题（默认亮色）
  treeWidth: number // 树侧边栏宽度（拖拽持久化；clamp 于 [TREE_WIDTH_MIN, TREE_WIDTH_MAX]）
  customPresets: CustomPreset[] // 自定义组件预设（插入即快照：插入时复制 content，改预设不影响已插入卡）
  setLanguage: (language: Language) => void
  setDealDirection: (dealDirection: DealDirection) => void
  setScoreAnim: (scoreAnim: ScoreAnim) => void
  setTheme: (theme: ThemeMode) => void
  setTreeWidth: (treeWidth: number) => void
  addPreset: (name: string, content: string) => void
  removePreset: (id: string) => void
}

export const usePrefStore = create<PrefState>()(
  persist(
    (set) => ({
      language: 'zh-CN',
      dealDirection: 'top',
      scoreAnim: 'roll',
      theme: 'light',
      treeWidth: TREE_WIDTH_DEFAULT,
      // 旧持久化数据（trace-prefs 无此键）经 persist 浅合并取默认 []，不破坏既有契约
      customPresets: [],
      setLanguage: (language) => {
        void i18n.changeLanguage(language)
        set({ language })
      },
      setDealDirection: (dealDirection) => set({ dealDirection }),
      setScoreAnim: (scoreAnim) => set({ scoreAnim }),
      setTheme: (theme) => set({ theme }),
      // store 侧同样 clamp（持久化数据可能来自手改/旧版本）
      setTreeWidth: (treeWidth) => set({ treeWidth: clampTreeWidth(treeWidth) }),
      addPreset: (name, content) =>
        set((s) => ({ customPresets: [...s.customPresets, { id: crypto.randomUUID(), name, content }] })),
      removePreset: (id) => set((s) => ({ customPresets: s.customPresets.filter((p) => p.id !== id) }))
    }),
    { name: 'trace-prefs' }
  )
)
