import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePrefStore } from '../src/renderer/src/stores/pref-store'
import {
  applyMuyaPlantumlRenderConfig,
  createMarkdownChangeBridge,
  shouldApplyExternalMarkdown
} from '../src/renderer/src/components/muya-note/MuyaNoteEditor'
import { resolvePlantumlRenderConfig } from '../src/renderer/src/components/muya-note/muya-config'
import type { PlantUmlStatusDto } from '../src/shared/plantuml-types'

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

  it('loads Muya lazily with PlantUML disabled until safe, destroys it on exit, and keeps an editable fallback', () => {
    const editor = readFileSync(resolve('src/renderer/src/components/muya-note/MuyaNoteEditor.tsx'), 'utf8')

    expect(editor).toContain('loadMuyaRuntime')
    expect(editor).toContain("createMuyaOptions('')")
    expect(editor).toContain("loadDiagramRenderer('plantuml')")
    expect(editor).toContain("muya.on('json-change'")
    expect(editor).toContain('muya.getMarkdown()')
    expect(editor).toContain('muya.destroy()')
    expect(editor).toContain('<Input.TextArea')
    expect(editor).toContain('note-muya-host trace-muya')
    expect(editor).toContain("classList.toggle('trace-muya-source-mode'")
  })

  it('defines localized PlantUML render states in both supported languages', () => {
    const zhCN = readFileSync(resolve('src/renderer/src/i18n/locales/zh-CN.ts'), 'utf8')
    const enUS = readFileSync(resolve('src/renderer/src/i18n/locales/en-US.ts'), 'utf8')

    for (const key of ['plantumlDisabled', 'plantumlStarting', 'plantumlServiceError', 'plantumlUnconfigured']) {
      expect(zhCN).toContain(`${key}:`)
      expect(enUS).toContain(`${key}:`)
    }
  })

  it('refreshes Muya options for ready and unavailable PlantUML states without changing editing behavior', async () => {
    const setOptions = vi.fn()
    const muya = { setOptions } as never
    const readyStatus: PlantUmlStatusDto = { state: 'running', port: 18080, errorCode: null }
    const stoppedStatus: PlantUmlStatusDto = { state: 'stopped', port: 18080, errorCode: null }
    const errorStatus: PlantUmlStatusDto = { state: 'error', port: 18080, errorCode: 'process_exit' }
    const ready = resolvePlantumlRenderConfig(
      { plantumlHydrated: true, plantumlMode: 'local', plantumlPort: 18080, plantumlServer: '' },
      readyStatus
    )
    const stopped = resolvePlantumlRenderConfig(
      { plantumlHydrated: true, plantumlMode: 'local', plantumlPort: 18080, plantumlServer: '' },
      stoppedStatus
    )
    const errored = resolvePlantumlRenderConfig(
      { plantumlHydrated: true, plantumlMode: 'local', plantumlPort: 18080, plantumlServer: '' },
      errorStatus
    )
    const disabled = resolvePlantumlRenderConfig(
      { plantumlHydrated: true, plantumlMode: 'off', plantumlPort: 18080, plantumlServer: 'https://old.example/plantuml' },
      readyStatus
    )
    const custom = resolvePlantumlRenderConfig(
      { plantumlHydrated: true, plantumlMode: 'custom', plantumlPort: 18080, plantumlServer: 'https://uml.example/plantuml' },
      stoppedStatus
    )
    const loadRenderer = vi.fn().mockResolvedValue(undefined)

    await applyMuyaPlantumlRenderConfig(muya, ready, loadRenderer)
    await applyMuyaPlantumlRenderConfig(muya, stopped, loadRenderer)
    await applyMuyaPlantumlRenderConfig(muya, errored, loadRenderer)
    await applyMuyaPlantumlRenderConfig(muya, disabled, loadRenderer)
    await applyMuyaPlantumlRenderConfig(muya, custom, loadRenderer)

    expect(setOptions.mock.calls).toEqual([
      [{ plantumlServer: '' }, true],
      [{ plantumlServer: 'http://127.0.0.1:18080/plantuml' }, true],
      [{ plantumlServer: '' }, true],
      [{ plantumlServer: '' }, true],
      [{ plantumlServer: '' }, true],
      [{ plantumlServer: '' }, true],
      [{ plantumlServer: 'https://uml.example/plantuml' }, true]
    ])
    expect(shouldApplyExternalMarkdown('external', 'local', false)).toBe(true)
  })

  it('waits for the shared PlantUML renderer before installing a ready server', async () => {
    let resolveRenderer: (() => void) | undefined
    const rendererPending = new Promise<void>((resolve) => {
      resolveRenderer = resolve
    })
    const requestedServers: string[] = []
    const setOptions = vi.fn((options: { plantumlServer: string }) => {
      if (options.plantumlServer) requestedServers.push(options.plantumlServer)
    })
    const muya = { setOptions } as never
    const loadRenderer = vi.fn(() => rendererPending)
    const current = { value: true }
    const readyCustom = resolvePlantumlRenderConfig(
      { plantumlHydrated: true, plantumlMode: 'custom', plantumlPort: 18080, plantumlServer: 'https://uml.example/plantuml' },
      { state: 'stopped', port: 18080, errorCode: null }
    )

    const applying = applyMuyaPlantumlRenderConfig(muya, readyCustom, loadRenderer, () => current.value)

    expect(loadRenderer).toHaveBeenCalledOnce()
    expect(setOptions.mock.calls).toEqual([[{ plantumlServer: '' }, true]])
    expect(requestedServers).toEqual([])

    resolveRenderer?.()
    await applying

    expect(setOptions.mock.calls).toEqual([
      [{ plantumlServer: '' }, true],
      [{ plantumlServer: 'https://uml.example/plantuml' }, true]
    ])
    expect(requestedServers).toEqual(['https://uml.example/plantuml'])
  })

  it.each([
    {
      label: 'off',
      config: resolvePlantumlRenderConfig(
        { plantumlHydrated: true, plantumlMode: 'off', plantumlPort: 18080, plantumlServer: 'https://old.example/plantuml' },
        { state: 'running', port: 18080, errorCode: null }
      )
    },
    {
      label: 'error',
      config: resolvePlantumlRenderConfig(
        { plantumlHydrated: true, plantumlMode: 'local', plantumlPort: 18080, plantumlServer: '' },
        { state: 'error', port: 18080, errorCode: 'process_exit' }
      )
    }
  ])('does not reinstall a pending custom PlantUML server after switching to $label', async ({ config }) => {
    let resolveRenderer: (() => void) | undefined
    const rendererPending = new Promise<void>((resolve) => {
      resolveRenderer = resolve
    })
    const requestedServers: string[] = []
    const setOptions = vi.fn((options: { plantumlServer: string }) => {
      if (options.plantumlServer) requestedServers.push(options.plantumlServer)
    })
    const muya = { setOptions } as never
    const loadRenderer = vi.fn(() => rendererPending)
    const generation = { current: 1 }
    const readyCustom = resolvePlantumlRenderConfig(
      { plantumlHydrated: true, plantumlMode: 'custom', plantumlPort: 18080, plantumlServer: 'https://uml.example/plantuml' },
      { state: 'stopped', port: 18080, errorCode: null }
    )

    const staleApply = applyMuyaPlantumlRenderConfig(muya, readyCustom, loadRenderer, () => generation.current === 1)
    generation.current = 2
    await applyMuyaPlantumlRenderConfig(muya, config, loadRenderer, () => generation.current === 2)
    resolveRenderer?.()
    await staleApply

    expect(setOptions.mock.calls).toEqual([
      [{ plantumlServer: '' }, true],
      [{ plantumlServer: '' }, true]
    ])
    expect(requestedServers).toEqual([])
  })

  it('does not install an obsolete local port when the preference changes during renderer preload', async () => {
    let resolveFirstRenderer: (() => void) | undefined
    let resolveSecondRenderer: (() => void) | undefined
    const firstRendererPending = new Promise<void>((resolve) => {
      resolveFirstRenderer = resolve
    })
    const secondRendererPending = new Promise<void>((resolve) => {
      resolveSecondRenderer = resolve
    })
    const requestedServers: string[] = []
    const setOptions = vi.fn((options: { plantumlServer: string }) => {
      if (options.plantumlServer) requestedServers.push(options.plantumlServer)
    })
    const muya = { setOptions } as never
    const loadRenderer = vi.fn()
      .mockReturnValueOnce(firstRendererPending)
      .mockReturnValueOnce(secondRendererPending)
    const generation = { current: 1 }
    const firstPort = resolvePlantumlRenderConfig(
      { plantumlHydrated: true, plantumlMode: 'local', plantumlPort: 18080, plantumlServer: '' },
      { state: 'running', port: 18080, errorCode: null }
    )
    const secondPort = resolvePlantumlRenderConfig(
      { plantumlHydrated: true, plantumlMode: 'local', plantumlPort: 18081, plantumlServer: '' },
      { state: 'running', port: 18081, errorCode: null }
    )

    const staleApply = applyMuyaPlantumlRenderConfig(muya, firstPort, loadRenderer, () => generation.current === 1)
    generation.current = 2
    const currentApply = applyMuyaPlantumlRenderConfig(muya, secondPort, loadRenderer, () => generation.current === 2)

    resolveFirstRenderer?.()
    await staleApply
    expect(requestedServers).toEqual([])

    resolveSecondRenderer?.()
    await currentApply

    expect(requestedServers).toEqual(['http://127.0.0.1:18081/plantuml'])
    expect(setOptions.mock.calls).toEqual([
      [{ plantumlServer: '' }, true],
      [{ plantumlServer: '' }, true],
      [{ plantumlServer: 'http://127.0.0.1:18081/plantuml' }, true]
    ])
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
    expect(cards.match(/plantumlConfig=\{plantumlConfig\}/g)).toHaveLength(2)
    expect(cards).not.toContain('plantumlServer={')
  })
})
