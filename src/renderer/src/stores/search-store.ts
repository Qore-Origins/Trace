// searchStore：溯源检索（浮层开合/防抖查询/命中回溯定位）
import { getMessage, getModal } from '../antd-host'
import { create } from 'zustand'
import { invoke, onEvent, ClientError } from '../ipc-client'

import type { SearchHit } from '@shared/ipc-contract'
import { useTreeStore } from './tree-store'
import { usePlanStore } from './plan-store'
import { i18n } from '../i18n'

const DEBOUNCE_MS = 300

interface SearchState {
  open: boolean
  keywords: string
  hits: SearchHit[]
  querying: boolean
  setOpen: (open: boolean) => void
  setKeywords: (kw: string) => void
  locate: (hit: SearchHit) => Promise<void>
}

let timer: ReturnType<typeof setTimeout> | null = null

export const useSearchStore = create<SearchState>()((set, get) => ({
  open: false,
  keywords: '',
  hits: [],
  querying: false,

  setOpen: (open) => set({ open, ...(open ? {} : { keywords: '', hits: [] }) }),

  setKeywords: (kw) => {
    set({ keywords: kw })
    if (timer) clearTimeout(timer)
    const trimmed = kw.trim()
    if (!trimmed) {
      set({ hits: [], querying: false })
      return
    }
    set({ querying: true })
    timer = setTimeout(() => {
      void invoke('search:query', { keywords: trimmed.split(/\s+/) })
        .then((hits) => set({ hits, querying: false }))
        .catch((e) => {
          set({ querying: false })
          if (e instanceof ClientError && e.code === 23) return // 索引构建中：静默（状态栏有提示）
          getMessage().error(e instanceof ClientError ? e.message : i18n.t('errors.searchFailed'))
        })
    }, DEBOUNCE_MS)
  },

  // 回溯：浮层收起 → 树展开路径 → 打开计划 → 组件脉冲点亮（2s 渐隐）
  locate: async (hit) => {
    set({ open: false })
    const tree = useTreeStore.getState()
    await tree.expandTo(hit.path)
    tree.select(hit.path, 'plan')
    await usePlanStore.getState().open(hit.path)
    if (!hit.component_id) {
      document.querySelector('.ws-content')?.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    setTimeout(() => {
      const el = document.querySelector(`[data-component-id="${hit.component_id}"]`)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.remove('pulse')
      void (el as HTMLElement).offsetWidth // 重启动画
      el.classList.add('pulse')
    }, 200)
  }
}))

// 事件订阅：索引状态变化时若有查询词自动补查（索引构建完成场景）
export function subscribeSearchEvents(): () => void {
  const off = onEvent('trace:index-status', () => {
    const s = useSearchStore.getState()
    if (s.open && s.keywords.trim()) s.setKeywords(s.keywords)
  })
  return off
}
