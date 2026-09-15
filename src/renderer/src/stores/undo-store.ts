import { create } from 'zustand'

export const UNDO_DURATION_MS = 5000
export interface UndoEntry {
  id: string
  expiresAt: number
  description: string
  undo: () => void
  restoreFocus?: () => void
  dispose?: () => void
}
interface UndoState {
  entry: UndoEntry | null
  register: (entry: Omit<UndoEntry, 'id' | 'expiresAt'>) => void
  clear: () => void
  undo: () => void
}
let timer: ReturnType<typeof setTimeout> | undefined
let sequence = 0
export const useUndoStore = create<UndoState>()((set, get) => ({
  entry: null,
  register: entry => {
    get().clear()
    set({ entry: { ...entry, id: String(++sequence), expiresAt: Date.now() + UNDO_DURATION_MS } })
    timer = setTimeout(() => get().clear(), UNDO_DURATION_MS)
  },
  clear: () => {
    clearTimeout(timer)
    timer = undefined
    get().entry?.dispose?.()
    set({ entry: null })
  },
  undo: () => {
    const entry = get().entry
    get().clear()
    if (!entry || Date.now() >= entry.expiresAt) return
    entry.undo()
    entry.restoreFocus?.()
  }
}))
