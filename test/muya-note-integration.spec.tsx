import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePrefStore } from '../src/renderer/src/stores/pref-store'
import {
  createMarkdownChangeBridge,
  shouldApplyExternalMarkdown
} from '../src/renderer/src/components/muya-note/MuyaNoteEditor'

type NotePreferenceState = {
  noteLiveRender: boolean
  noteWrap: boolean
  plantumlServer: string
  setNoteLiveRender: (value: boolean) => void
  setNoteWrap: (value: boolean) => void
  setPlantumlServer: (value: string) => void
}

const defaults = {
  noteLiveRender: true,
  noteWrap: true,
  plantumlServer: ''
}

afterEach(() => {
  vi.useRealTimers()
  usePrefStore.setState(defaults)
})

describe('Muya note formal integration preferences', () => {
  it('defaults to live rendering, wrapping, and offline PlantUML', () => {
    expect(usePrefStore.getState()).toMatchObject(defaults)
  })

  it('updates every note editor preference through explicit setters', () => {
    const preferences = usePrefStore.getState() as typeof usePrefStore extends { getState: () => infer State }
      ? State & NotePreferenceState
      : never

    preferences.setNoteLiveRender(false)
    preferences.setNoteWrap(false)
    preferences.setPlantumlServer('https://plantuml.example.test/server')

    expect(usePrefStore.getState()).toMatchObject({
      noteLiveRender: false,
      noteWrap: false,
      plantumlServer: 'https://plantuml.example.test/server'
    })
  })

  it('exposes one live-render setting with a two-second description delay', () => {
    const app = readFileSync(resolve('src/renderer/src/App.tsx'), 'utf8')
    const zhCN = readFileSync(resolve('src/renderer/src/i18n/locales/zh-CN.ts'), 'utf8')

    expect(app).toContain('Tooltip')
    expect(app).toContain('mouseEnterDelay={2}')
    expect(app).toContain('noteLiveRender')
    expect(app).toContain('noteWrap')
    expect(app).toContain('plantumlServer')
    expect(zhCN).toContain("noteLiveRender: '实时渲染'")
    expect(zhCN).not.toContain('自动渲染')
  })
})

describe('Muya note React adapter', () => {
  it('debounces Markdown updates and flushes the final source immediately', async () => {
    vi.useFakeTimers()
    const changes: string[] = []
    const bridge = createMarkdownChangeBridge((markdown) => changes.push(markdown), 150)

    bridge.schedule('first')
    bridge.schedule('second')
    vi.advanceTimersByTime(149)
    expect(changes).toEqual([])
    vi.advanceTimersByTime(1)
    expect(changes).toEqual(['second'])

    bridge.schedule('pending')
    bridge.flush('final')
    expect(changes).toEqual(['second', 'final'])
  })

  it('applies only non-echo external Markdown while the editor is not focused', () => {
    expect(shouldApplyExternalMarkdown('server', 'local', false)).toBe(true)
    expect(shouldApplyExternalMarkdown('local', 'local', false)).toBe(false)
    expect(shouldApplyExternalMarkdown('server', 'local', true)).toBe(false)
  })

  it('loads Muya lazily, destroys it on exit, and keeps an editable fallback', () => {
    const editor = readFileSync(resolve('src/renderer/src/components/muya-note/MuyaNoteEditor.tsx'), 'utf8')

    expect(editor).toContain('loadMuyaRuntime')
    expect(editor).toContain("muya.on('json-change'")
    expect(editor).toContain('muya.getMarkdown()')
    expect(editor).toContain('muya.destroy()')
    expect(editor).toContain('<Input.TextArea')
    expect(editor).toContain('note-muya-host trace-muya')
    expect(editor).toContain("classList.toggle('trace-muya-source-mode'")
  })
})

describe('NoteCard Muya integration', () => {
  it('exits edit mode on outside pointer or keyboard focus without closing Muya floating controls', () => {
    const cards = readFileSync(resolve('src/renderer/src/components/cards.tsx'), 'utf8')

    expect(cards).toContain("document.addEventListener('pointerdown'")
    expect(cards).toContain("document.addEventListener('focusin'")
    expect(cards).toContain("closest('.mu-float-wrapper')")
    expect(cards).toContain('deactivate(comp.id)')
  })

  it('keeps at most one active note component', async () => {
    const { useNoteEditorStore } = await import('../src/renderer/src/stores/note-editor-store')

    useNoteEditorStore.getState().activate('note-a')
    expect(useNoteEditorStore.getState().activeComponentId).toBe('note-a')
    useNoteEditorStore.getState().activate('note-b')
    expect(useNoteEditorStore.getState().activeComponentId).toBe('note-b')
    useNoteEditorStore.getState().deactivate('note-a')
    expect(useNoteEditorStore.getState().activeComponentId).toBe('note-b')
    useNoteEditorStore.getState().deactivate('note-b')
    expect(useNoteEditorStore.getState().activeComponentId).toBeNull()
  })

  it('replaces the textarea toolbar dual mode with the Muya adapter', () => {
    const cards = readFileSync(resolve('src/renderer/src/components/cards.tsx'), 'utf8')

    expect(cards).toContain("from './muya-note/MuyaNoteEditor'")
    expect(cards).toContain("from '../stores/note-editor-store'")
    expect(cards).toContain('<MuyaNoteEditor')
    expect(cards).toContain('patchComponent(comp.id')
    expect(cards).not.toContain('fmtButtons')
    expect(cards).not.toContain('wrapSelection')
    expect(cards).not.toContain('<Input.TextArea')
    expect(cards).not.toContain("t('cards.noteDone')")
    expect(cards).not.toContain("t('cards.noteEdit')")
  })

  it('keeps the safe static Markdown renderer for inactive notes', () => {
    const cards = readFileSync(resolve('src/renderer/src/components/cards.tsx'), 'utf8')

    expect(cards).toContain('<NoteMarkdown')
    expect(cards).toContain('activeComponentId === comp.id')
    expect(cards).toContain('noteLiveRender')
    expect(cards).toContain('plantumlServer')
  })
})
