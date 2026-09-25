import { afterEach, describe, expect, it } from 'vitest'
import { markTrace, startTraceMeasure } from '../src/renderer/src/perf/marks'

afterEach(() => {
  performance.clearMarks()
  performance.clearMeasures()
})

describe('Trace performance marks', () => {
  it('keeps only the latest occurrence of a stable mark name', () => {
    markTrace('trace:app-interactive')
    markTrace('trace:app-interactive')

    expect(performance.getEntriesByName('trace:app-interactive', 'mark')).toHaveLength(1)
  })

  it('records a detailed measure once and returns its duration', () => {
    const finish = startTraceMeasure('trace:plan-open', undefined, { sampleSize: 10 })

    const duration = finish()
    expect(duration).toBeGreaterThanOrEqual(0)
    expect(finish()).toBeUndefined()
    expect(performance.getEntriesByName('trace:plan-open', 'measure')).toHaveLength(1)
    expect(performance.getEntriesByName('trace:plan-open', 'measure')[0].detail).toEqual({ sampleSize: 10 })
  })
})
