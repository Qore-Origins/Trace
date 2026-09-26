import { useEffect, useRef, useState } from 'react'
import { Input, Spin } from 'antd'
import type { Muya } from '@muyajs/core'
import type { Language } from '../../stores/pref-store'
import { useTranslation } from '../../i18n'
import { applyMuyaPlantumlRenderConfig, createMuyaOptions } from './muya-config'
import type { PlantumlRenderConfig } from './muya-config'
import { loadMuyaRuntime } from './muya-runtime'
import { markTrace, startTraceMeasure } from '../../perf/marks'
import loadDiagramRenderer from '@muyajs/core/utils/diagram/index.js'
import './muya-theme.css'

export { applyMuyaPlantumlRenderConfig } from './muya-config'

const MARKDOWN_CHANGE_DELAY_MS = 150

interface MarkdownChangeBridge {
  schedule: (markdown: string) => void
  flush: (markdown?: string) => void
  cancel: () => void
}

export function createMarkdownChangeBridge(
  onChange: (markdown: string) => void,
  delay = MARKDOWN_CHANGE_DELAY_MS
): MarkdownChangeBridge {
  let pendingMarkdown: string | null = null
  let lastDeliveredMarkdown: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const clearTimer = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  const deliver = (): void => {
    clearTimer()
    if (pendingMarkdown === null || pendingMarkdown === lastDeliveredMarkdown) {
      pendingMarkdown = null
      return
    }
    const markdown = pendingMarkdown
    pendingMarkdown = null
    lastDeliveredMarkdown = markdown
    onChange(markdown)
  }

  return {
    schedule: (markdown) => {
      pendingMarkdown = markdown
      clearTimer()
      timer = setTimeout(deliver, delay)
    },
    flush: (markdown) => {
      if (markdown !== undefined) pendingMarkdown = markdown
      deliver()
    },
    cancel: () => {
      clearTimer()
      pendingMarkdown = null
    }
  }
}

export function shouldApplyExternalMarkdown(value: string, lastEmittedValue: string, focused: boolean): boolean {
  return value !== lastEmittedValue && !focused
}

interface MuyaNoteEditorProps {
  value: string
  onChange: (markdown: string) => void
  liveRender: boolean
  wrap: boolean
  plantumlConfig: PlantumlRenderConfig
  language: Language
  placeholder: string
}

export function MuyaNoteEditor({
  value,
  onChange,
  liveRender,
  wrap,
  plantumlConfig,
  language,
  placeholder
}: MuyaNoteEditorProps): React.JSX.Element {
  const { t } = useTranslation()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const muyaRef = useRef<Muya | null>(null)
  const onChangeRef = useRef(onChange)
  const valueRef = useRef(value)
  const liveRenderRef = useRef(liveRender)
  const wrapRef = useRef(wrap)
  const plantumlConfigRef = useRef(plantumlConfig)
  const plantumlConfigGenerationRef = useRef(0)
  const languageRef = useRef(language)
  const lastEmittedValueRef = useRef(value)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  onChangeRef.current = onChange
  valueRef.current = value
  liveRenderRef.current = liveRender
  wrapRef.current = wrap
  plantumlConfigRef.current = plantumlConfig
  languageRef.current = language

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let cancelled = false
    let jsonChangeListener: (() => void) | null = null
    let diagramObserver: MutationObserver | null = null
    let diagramMeasureFinished = false
    const finishActivationMeasure = startTraceMeasure('trace:muya-activate')
    const containsDiagram = /```\s*(?:mermaid|vega-lite|plantuml|flowchart|sequence)\b/i.test(valueRef.current)
    const finishDiagramMeasure = containsDiagram ? startTraceMeasure('trace:muya-diagram') : null
    const completeDiagramMeasure = (): void => {
      if (!finishDiagramMeasure || diagramMeasureFinished) return
      const preview = host.querySelector('.mu-diagram-preview')
      if (!preview?.querySelector('svg, img, .mu-diagram-error')) return
      diagramMeasureFinished = true
      diagramObserver?.disconnect()
      markTrace('trace:muya-diagram')
      finishDiagramMeasure()
    }
    if (containsDiagram) {
      diagramObserver = new MutationObserver(completeDiagramMeasure)
      diagramObserver.observe(host, { childList: true, subtree: true })
    }
    const bridge = createMarkdownChangeBridge((markdown) => {
      lastEmittedValueRef.current = markdown
      onChangeRef.current(markdown)
    })
    void loadMuyaRuntime()
      .then((runtime) => {
        if (cancelled) return
        const muya = new runtime.Muya(host, {
          ...createMuyaOptions(''),
          wrapCodeBlocks: wrapRef.current,
          markdown: valueRef.current
        })
        muya.locale(languageRef.current === 'zh-CN' ? runtime.zhCN : runtime.en)
        muya.init()
        muya.domNode.classList.toggle('trace-muya-source-mode', !liveRenderRef.current)
        jsonChangeListener = () => {
          const markdown = muya.getMarkdown()
          lastEmittedValueRef.current = markdown
          bridge.schedule(markdown)
        }
        muya.on('json-change', jsonChangeListener)
        muyaRef.current = muya
        const configToApply = plantumlConfigRef.current
        const plantumlGeneration = plantumlConfigGenerationRef.current
        void applyMuyaPlantumlRenderConfig(
          muya,
          configToApply,
          () => loadDiagramRenderer('plantuml'),
          () =>
            !cancelled &&
            plantumlGeneration === plantumlConfigGenerationRef.current &&
            plantumlConfigRef.current.server === configToApply.server &&
            plantumlConfigRef.current.state === configToApply.state
        )
        markTrace('trace:muya-activate')
        finishActivationMeasure()
        setLoading(false)
        completeDiagramMeasure()
      })
      .catch(() => {
        if (cancelled) return
        finishActivationMeasure()
        setLoading(false)
        setFailed(true)
      })

    return () => {
      cancelled = true
      plantumlConfigGenerationRef.current += 1
      diagramObserver?.disconnect()
      const muya = muyaRef.current
      if (muya) {
        bridge.flush(muya.getMarkdown())
        if (jsonChangeListener) muya.off('json-change', jsonChangeListener)
        muya.destroy()
        muyaRef.current = null
      } else {
        bridge.cancel()
      }
    }
  }, [])

  useEffect(() => {
    const muya = muyaRef.current
    if (!muya) return
    muya.domNode.classList.toggle('trace-muya-source-mode', !liveRender)
  }, [liveRender])

  useEffect(() => {
    muyaRef.current?.setOptions({ wrapCodeBlocks: wrap })
  }, [wrap])

  useEffect(() => {
    const generation = ++plantumlConfigGenerationRef.current
    const muya = muyaRef.current
    if (muya) {
      const configToApply = plantumlConfig
      void applyMuyaPlantumlRenderConfig(
        muya,
        configToApply,
        () => loadDiagramRenderer('plantuml'),
        () =>
          generation === plantumlConfigGenerationRef.current &&
          plantumlConfigRef.current.server === configToApply.server &&
          plantumlConfigRef.current.state === configToApply.state
      )
    }
  }, [plantumlConfig.server, plantumlConfig.state])

  useEffect(() => {
    void loadMuyaRuntime().then((runtime) => {
      muyaRef.current?.locale(language === 'zh-CN' ? runtime.zhCN : runtime.en)
    })
  }, [language])

  useEffect(() => {
    const muya = muyaRef.current
    const host = hostRef.current
    if (!muya || !host) return
    const focused = host.contains(document.activeElement)
    if (!shouldApplyExternalMarkdown(value, lastEmittedValueRef.current, focused)) return
    lastEmittedValueRef.current = value
    muya.setContent(value, false)
  }, [value])

  if (failed) {
    return (
      <>
        <Input.TextArea
          className="note-muya-fallback"
          variant="borderless"
          autoSize
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
        {plantumlStatusMessage(value, plantumlConfig, t)}
      </>
    )
  }

  return (
    <div className="note-muya-shell">
      <div ref={hostRef} className="note-muya-host trace-muya" />
      {loading ? (
        <div className="note-muya-loading" role="status" aria-live="polite">
          <Spin size="small" />
        </div>
      ) : null}
      {plantumlStatusMessage(value, plantumlConfig, t)}
    </div>
  )
}

function plantumlStatusMessage(
  markdown: string,
  config: PlantumlRenderConfig,
  translate: (key: string) => string
): React.JSX.Element | null {
  if (!/```\s*plantuml\b/i.test(markdown) || config.state === 'ready') return null

  const messageKey = {
    disabled: 'cards.plantumlDisabled',
    starting: 'cards.plantumlStarting',
    error: 'cards.plantumlServiceError',
    unconfigured: 'cards.plantumlUnconfigured'
  }[config.state]
  return (
    <div className={`note-diagram-status${config.state === 'error' ? ' error' : ''}`} role="status" aria-live="polite">
      {translate(messageKey)}
    </div>
  )
}
