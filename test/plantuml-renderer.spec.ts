import { describe, expect, it, vi } from 'vitest'
import { resolvePlantumlRenderConfig } from '../src/renderer/src/components/muya-note/muya-config'
import { renderPlantumlPreview } from '../src/renderer/src/components/note-diagram'
import type { PlantUmlStatusDto } from '../src/shared/plantuml-types'

const localPreferences = {
  plantumlHydrated: true,
  plantumlMode: 'local' as const,
  plantumlPort: 18080,
  plantumlServer: ''
}

const stopped: PlantUmlStatusDto = { state: 'stopped', port: 18080, errorCode: null }

function createTarget(): HTMLElement & { children: unknown[] } {
  const target = {
    children: [{ tagName: 'IMG', src: 'previous-render' }],
    replaceChildren(...children: unknown[]) {
      this.children = children
    },
    appendChild(child: unknown) {
      this.children.push(child)
      return child
    }
  }
  return target as unknown as HTMLElement & { children: unknown[] }
}

describe('PlantUML render configuration', () => {
  it.each([
    {
      name: 'local service ready on selected port',
      preferences: localPreferences,
      status: { state: 'running', port: 18080, errorCode: null } as PlantUmlStatusDto,
      expected: { server: 'http://127.0.0.1:18080/plantuml', state: 'ready' }
    },
    {
      name: 'local service running on another port',
      preferences: { ...localPreferences, plantumlPort: 18081 },
      status: { state: 'running', port: 18080, errorCode: null } as PlantUmlStatusDto,
      expected: { server: null, state: 'starting' }
    },
    {
      name: 'local service starting',
      preferences: localPreferences,
      status: { state: 'starting', port: 18080, errorCode: null } as PlantUmlStatusDto,
      expected: { server: null, state: 'starting' }
    },
    {
      name: 'local service stopped while local mode is selected',
      preferences: localPreferences,
      status: stopped,
      expected: { server: null, state: 'starting' }
    },
    {
      name: 'local service error',
      preferences: localPreferences,
      status: { state: 'error', port: 18080, errorCode: 'process_exit' } as PlantUmlStatusDto,
      expected: { server: null, state: 'error' }
    },
    {
      name: 'custom HTTP service',
      preferences: { ...localPreferences, plantumlMode: 'custom' as const, plantumlServer: 'https://uml.example/plantuml' },
      status: stopped,
      expected: { server: 'https://uml.example/plantuml', state: 'ready' }
    },
    {
      name: 'invalid custom URL',
      preferences: { ...localPreferences, plantumlMode: 'custom' as const, plantumlServer: 'javascript:alert(1)' },
      status: stopped,
      expected: { server: null, state: 'unconfigured' }
    },
    {
      name: 'off mode with retained remote URL',
      preferences: { ...localPreferences, plantumlMode: 'off' as const, plantumlServer: 'https://uml.example/plantuml' },
      status: stopped,
      expected: { server: null, state: 'disabled' }
    },
    {
      name: 'preferences not hydrated yet',
      preferences: { ...localPreferences, plantumlHydrated: false, plantumlMode: 'custom' as const, plantumlServer: 'https://uml.example/plantuml' },
      status: { state: 'running', port: 18080, errorCode: null } as PlantUmlStatusDto,
      expected: { server: null, state: 'unconfigured' }
    }
  ])('resolves $name fail-closed', ({ preferences, status, expected }) => {
    expect(resolvePlantumlRenderConfig(preferences, status)).toEqual(expected)
  })
})

describe('PlantUML renderer lifecycle', () => {
  it.each(['disabled', 'starting', 'error', 'unconfigured'] as const)(
    'does not load a renderer or create an image while %s',
    async (state) => {
      const target = createTarget()
      const loadRenderer = vi.fn()

      await expect(renderPlantumlPreview(
        '@startuml\nAlice -> Bob\n@enduml',
        { server: null, state },
        target,
        loadRenderer
      )).resolves.toBe(state)

      expect(loadRenderer).not.toHaveBeenCalled()
      expect(target.children).toEqual([])
    }
  )

  it('loads the PlantUML renderer only after ready and targets the configured local endpoint', async () => {
    const target = createTarget()
    const source = '@startuml\nAlice -> Bob\n@enduml'
    const insertImgElement = vi.fn((element: HTMLElement) => element.appendChild({ tagName: 'IMG' }))
    const parse = vi.fn(() => ({ insertImgElement }))
    const loadRenderer = vi.fn().mockResolvedValue({ parse })
    const config = resolvePlantumlRenderConfig(localPreferences, {
      state: 'running',
      port: 18080,
      errorCode: null
    })

    await expect(renderPlantumlPreview(source, config, target, loadRenderer)).resolves.toBe('ready')

    expect(loadRenderer).toHaveBeenCalledOnce()
    expect(parse).toHaveBeenCalledWith(source, 'http://127.0.0.1:18080/plantuml')
    expect(insertImgElement).toHaveBeenCalledOnce()
    expect(target.children).toEqual([{ tagName: 'IMG' }])
  })

  it.each([
    { label: 'missing endpoint', config: { server: null, state: 'ready' as const } },
    { label: 'invalid endpoint', config: { server: 'javascript:alert(1)', state: 'ready' as const } }
  ])('fails closed and skips the renderer for a ready config with $label', async ({ config }) => {
    const target = createTarget()
    const loadRenderer = vi.fn()

    await expect(renderPlantumlPreview('source', config, target, loadRenderer)).resolves.toBe('unconfigured')

    expect(loadRenderer).not.toHaveBeenCalled()
    expect(target.children).toEqual([])
  })

  it.each([
    { state: 'error' as const, label: 'service error' },
    { state: 'disabled' as const, label: 'off mode' }
  ])('clears the previously rendered image after ready → $label', async ({ state }) => {
    const target = createTarget()
    const loadRenderer = vi.fn().mockResolvedValue({
      parse: () => ({ insertImgElement: (element: HTMLElement) => element.appendChild({ tagName: 'IMG', src: 'new-render' }) })
    })
    const ready = { server: 'http://127.0.0.1:18080/plantuml', state: 'ready' as const }

    await renderPlantumlPreview('source', ready, target, loadRenderer)
    expect(target.children).toEqual([{ tagName: 'IMG', src: 'new-render' }])

    await expect(renderPlantumlPreview('source', { server: null, state }, target, loadRenderer)).resolves.toBe(state)

    expect(target.children).toEqual([])
    expect(loadRenderer).toHaveBeenCalledOnce()
  })

  it('drops a stale renderer load before parsing or creating an image', async () => {
    const target = createTarget()
    const parse = vi.fn()

    await expect(renderPlantumlPreview(
      'source',
      { server: 'https://uml.example/plantuml', state: 'ready' },
      target,
      async () => ({ parse }),
      () => false
    )).resolves.toBe('cancelled')

    expect(parse).not.toHaveBeenCalled()
    expect(target.children).toEqual([])
  })
})
