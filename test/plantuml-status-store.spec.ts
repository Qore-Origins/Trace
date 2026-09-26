import { afterEach, describe, expect, it } from 'vitest'
import { usePlantumlStatusStore } from '../src/renderer/src/stores/plantuml-status-store'

describe('PlantUML transient status store', () => {
  afterEach(() => usePlantumlStatusStore.getState().resetStatus())

  it('keeps the initial service state in memory without persistence middleware', () => {
    expect(usePlantumlStatusStore.getState().status).toEqual({
      state: 'stopped',
      port: null,
      errorCode: null
    })
    expect(usePlantumlStatusStore).not.toHaveProperty('persist')
  })

  it('publishes service transitions and can clear them to the stopped state', () => {
    const running = { state: 'running', port: 18080, errorCode: null } as const
    usePlantumlStatusStore.getState().setStatus(running)

    expect(usePlantumlStatusStore.getState().status).toEqual(running)

    usePlantumlStatusStore.getState().resetStatus()
    expect(usePlantumlStatusStore.getState().status).toEqual({
      state: 'stopped',
      port: null,
      errorCode: null
    })
  })
})
