import { useEffect, useRef, useState } from 'react'
import { validatePlantumlServer } from './muya-note/muya-config'
// Keep reading-mode charts on Muya's exact engine loader; each heavy renderer remains dynamically imported there.
import loadDiagramRenderer from '../../../../vendor/muya/src/utils/diagram'

export type NoteDiagramLanguage = 'mermaid' | 'vega-lite' | 'plantuml' | 'flowchart' | 'sequence'

type DiagramStatus = 'loading' | 'ready' | 'empty' | 'plantuml-required' | 'error'

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
  target: HTMLElement,
  plantumlServer: string
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

  if (language === 'plantuml') {
    const plantuml = renderer as PlantumlRenderer
    plantuml.parse(source, plantumlServer).insertImgElement(target)
    return
  }

  const diagram = (renderer as SvgRenderer).parse(source)
  diagram.drawSVG(target, language === 'sequence' ? { theme: 'hand' } : undefined)
}

export function NoteDiagram({
  language,
  code,
  plantumlServer
}: {
  language: NoteDiagramLanguage
  code: string
  plantumlServer: string
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<DiagramStatus>('loading')

  useEffect(() => {
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
      try {
        if (!validatePlantumlServer(plantumlServer)) {
          setStatus('plantuml-required')
          host.replaceChildren()
          return () => host.replaceChildren()
        }
      } catch {
        setStatus('plantuml-required')
        host.replaceChildren()
        return () => host.replaceChildren()
      }
    }

    setStatus('loading')
    void renderDiagram(language, code, preview, plantumlServer)
      .then(() => {
        if (cancelled) return
        if (language === 'flowchart' || language === 'sequence') {
          stopViewBoxObserver = observeSvgViewBox(preview)
        }
        if (language === 'plantuml') {
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
  }, [code, language, plantumlServer])

  const statusLabel = {
    loading: '图表加载中…',
    ready: '',
    empty: '空图表',
    'plantuml-required': 'PlantUML Server 未配置，源码未发送到网络',
    error: '图表渲染失败'
  }[status]

  return (
    <div
      className="note-diagram"
      data-diagram-language={language}
      data-diagram-state={status}
      aria-busy={status === 'loading'}
    >
      <div ref={hostRef} />
      {statusLabel && (
        <div className={`note-diagram-status${status === 'error' ? ' error' : ''}`} role="status">
          {statusLabel}
        </div>
      )}
    </div>
  )
}
