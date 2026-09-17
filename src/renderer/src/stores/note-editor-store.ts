import { create } from 'zustand'

interface NoteEditorState {
  activeComponentId: string | null
  activate: (componentId: string) => void
  deactivate: (componentId?: string) => void
}

export const useNoteEditorStore = create<NoteEditorState>()((set, get) => ({
  activeComponentId: null,
  activate: (componentId) => set({ activeComponentId: componentId }),
  deactivate: (componentId) => {
    if (componentId !== undefined && get().activeComponentId !== componentId) return
    set({ activeComponentId: null })
  }
}))
