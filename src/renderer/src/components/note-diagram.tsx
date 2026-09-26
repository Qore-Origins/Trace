import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from '../i18n'
import { validatePlantumlServer } from './muya-note/muya-config'
import type { PlantumlRenderConfig } from './muya-note/muya-config'
// Keep reading-mode charts on Muya's exact engine loader; each heavy renderer remains dynamically imported there.
import loadDiagramRenderer from '../../../../vendor/muya/src/utils/diagram'

export type NoteDiagramLanguage = 'mermaid' | 'vega-lite' | 'plantuml' | 'flowchart' | 'sequence'

type DiagramStatus = 'loading' | 'ready' | 'empty' | 'disabled' | 'starting' | 'unconfigured' | 'service-error' | 'error'
type PlantumlPreviewResult = PlantumlRenderConfig['state'] | 'empty' | 'cancelled'

type MermaidRenderer = {
  initialize: (options: { startOnLoad: boolean; securityLevel: 'strict'; theme: string }) => void
  parse: (source: string) => Promise<unknown>
  run: (options: { nodes: HTMLElement[] }) => Promise<void>
}

type VegaLiteRenderer = (
  target: HTMLElement,
  spec: unknown,
  options: { actions: boolean; tooltip: boolean; renderer: 'svg'; theme: string; ast: boolean }
) => Promise<unknown>

type PlantumlRenderer = {
  parse: (source: string, server: string) => { insertImgElement: (target: HTMLElement) => void }
}

type SvgRenderer = {
  parse: (source: string) => { drawSVG: (target: HTMLElement, options?: { theme?: string }) => void }
}

type PlantumlRendererLoader = () => Promise<unknown>

async function loadRenderer(language: NoteDiagramLanguage): Promise<unknown> {
  return loadDiagramRenderer(language)
}

function applySvgViewBox(target: HTMLElement): boolean {
  const svg = target.querySelector('svg')
  if (!svg || svg.getAttribute('viewBox')) return Boolean(svg)

  const width = Number.parseFloat(svg.getAttribute('width') ?? '')
  const height = Number.parseFloat(svg.getAttribute('height') ?? '')
  if (width <= 0 || height <= 0) return false

  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  return true
}

function observeSvgViewBox(target: HTMLElement): () => void {
  if (applySvgViewBox(target)) return () => undefined

  const observer = new MutationObserver(() => {
    if (applySvgViewBox(target)) observer.disconnect()
  })
  observer.observe(target, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['width', 'height']
  })
  const timeout = window.setTimeout(() => observer.disconnect(), 5000)

  return () => {
    observer.disconnect()
    window.clearTimeout(timeout)
  }
}

async function renderDiagram(
  language: NoteDiagramLanguage,
  source: string,
  target: HTMLElement
): Promise<void> {
  const renderer = await loadRenderer(language)

  if (language === 'mermaid') {
    const mermaid = renderer as MermaidRenderer
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' })
    await mermaid.parse(source)
    target.classList.add('mermaid')
    target.textContent = source
    target.removeAttribute('data-processed')
    await mermaid.run({ nodes: [target] })
    return
  }

  if (language === 'vega-lite') {
    const embed = renderer as VegaLiteRenderer
    await embed(target, JSON.parse(source) as unknown, {
      actions: false,
      tooltip: false,
      renderer: 'svg',
      theme: 'latimes',
      ast: true
    })
    return
  }

  const diagram = (renderer as SvgRenderer).parse(source)
  diagram.drawSVG(target, language === 'sequence' ? { theme: 'hand' } : undefined)
}

/** Clear any prior image before deciding whether a PlantUML request is allowed. */
export async function renderPlantumlPreview(
  source: string,
  config: PlantumlRenderConfig,
  target: HTMLElement,
  loadPlantumlRenderer: PlantumlRendererLoader = () => loadRenderer('plantuml'),
  isCurrent: () => boolean = () => true
): Promise<PlantumlPreviewResult> {
  target.replaceChildren()
  if (!source.trim()) return 'empty'
  if (config.state !== 'ready') return config.state

  let server: string
  try {
    server = validatePlantumlServer(config.server ?? '')
  } catch {
    return 'unconfigured'
  }
  if (!server) return 'unconfigured'

  try {
    const renderer = await loadPlantumlRenderer()
    if (!isCurrent()) return 'cancelled'
    const plantuml = renderer as PlantumlRenderer
    plantuml.parse(source, server).insertImgElement(target)
    return 'ready'
  } catch {
    target.replaceChildren()
    return 'error'
  }
}

export function NoteDiagram({
  language,
  code,
  plantumlConfig
}: {
  language: NoteDiagramLanguage
  code: string
  plantumlConfig: PlantumlRenderConfig
}): React.JSX.Element {
  const { t } = useTranslation()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<DiagramStatus>('loading')
  const plantumlState = language === 'plantuml' ? plantumlConfig.state : null
  const plantumlServer = language === 'plantuml' ? plantumlConfig.server : null

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return

    let cancelled = false
    let stopViewBoxObserver = (): void => undefined
    let plantumlImage: HTMLImageElement | null = null
    const handlePlantumlImageError = (): void => setStatus('error')
    const preview = document.createElement('div')
    preview.className = 'note-diagram-preview'
    host.replaceChildren(preview)

    if (!code.trim()) {
      setStatus('empty')
      return () => host.replaceChildren()
    }

    if (language === 'plantuml') {
      const config: PlantumlRenderConfig = {
        server: plantumlServer,
        state: plantumlState ?? 'unconfigured'
      }
      if (config.state !== 'ready' || !config.server) {
        const unavailableStatus = config.state === 'error'
          ? 'service-error'
          : config.state === 'ready'
            ? 'unconfigured'
            : config.state
        setStatus(unavailableStatus)
        return () => host.replaceChildren()
      }

      setStatus('loading')
      void renderPlantumlPreview(code, config, preview, undefined, () => !cancelled)
        .then((result) => {
          if (cancelled || result === 'cancelled') return
          if (result === 'ready') {
            plantumlImage = preview.querySelector('img')
            if (plantumlImage) {
              plantumlImage.alt = 'PlantUML diagram'
              plantumlImage.addEventListener('error', handlePlantumlImageError)
              if (plantumlImage.complete && plantumlImage.naturalWidth === 0) {
                setStatus('error')
                return
              }
            }
          }
          setStatus(result)
        })
        .catch(() => {
          if (cancelled) return
          preview.replaceChildren()
          setStatus('error')
        })

      return () => {
        cancelled = true
        plantumlImage?.removeEventListener('error', handlePlantumlImageError)
        host.replaceChildren()
      }
    }

    setStatus('loading')
    void renderDiagram(language, code, preview)
      .then(() => {
        if (cancelled) return
        if (language === 'flowchart' || language === 'sequence') {
          stopViewBoxObserver = observeSvgViewBox(preview)
        }
        setStatus('ready')
      })
      .catch(() => {
        if (cancelled) return
        preview.replaceChildren()
        setStatus('error')
      })

    return () => {
      cancelled = true
      stopViewBoxObserver()
      plantumlImage?.removeEventListener('error', handlePlantumlImageError)
      host.replaceChildren()
    }
  }, [code, language, plantumlServer, plantumlState])

  const statusLabels: Record<DiagramStatus, string> = {
    loading: t('cards.diagramLoading'),
    ready: '',
    empty: t('cards.diagramEmpty'),
    disabled: t('cards.plantumlDisabled'),
    starting: t('cards.plantumlStarting'),
    unconfigured: t('cards.plantumlUnconfigured'),
    'service-error': t('cards.plantumlServiceError'),
    error: t('cards.diagramError')
  }
  const statusLabel = statusLabels[status]

  return (
    <div
      className="note-diagram"
      data-diagram-language={language}
      data-diagram-state={status}
      aria-busy={status === 'loading'}
    >
      <div ref={hostRef} />
      {statusLabel && (
        <div className={`note-diagram-status${status === 'error' || status === 'service-error' ? ' error' : ''}`} role="status">
          {statusLabel}
        </div>
      )}
    </div>
  )
}
