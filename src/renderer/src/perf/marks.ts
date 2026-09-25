export const TRACE_METRICS = [
  'trace:app-interactive',
  'trace:plan-open',
  'trace:edit-commit',
  'trace:task-render',
  'trace:tree-expand',
  'trace:search-query',
  'trace:muya-activate',
  'trace:muya-diagram'
] as const

export type TraceMetric = (typeof TRACE_METRICS)[number]
export type TraceMeasureDetail = Readonly<Record<string, number | string | boolean | null>>

const MAX_TRACE_MEASURES = 2000
const detailedSamplingEnabled = import.meta.env.DEV || isTraceSamplingRequested()

function isTraceSamplingRequested(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('trace-perf') === '1'
}

export function traceNow(): number | null {
  if (!detailedSamplingEnabled || typeof performance === 'undefined') return null
  return performance.now()
}

export function markTrace(name: TraceMetric): void {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return
  performance.clearMarks(name)
  performance.mark(name)
}

export function startTraceMeasure(
  name: TraceMetric,
  startedAt: number | null = traceNow(),
  detail?: TraceMeasureDetail
): () => number | undefined {
  if (startedAt === null || typeof performance === 'undefined' || typeof performance.measure !== 'function') {
    return () => undefined
  }

  let finished = false
  return () => {
    if (finished) return undefined
    finished = true

    const endedAt = performance.now()
    const duration = Math.max(0, endedAt - startedAt)
    const traceMeasureCount = performance
      .getEntriesByType('measure')
      .filter((entry) => TRACE_METRICS.includes(entry.name as TraceMetric)).length
    if (traceMeasureCount >= MAX_TRACE_MEASURES) {
      for (const metric of TRACE_METRICS) performance.clearMeasures(metric)
    }
    performance.measure(name, { start: startedAt, end: endedAt, detail })
    return duration
  }
}
