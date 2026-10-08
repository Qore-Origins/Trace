import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bindAntdHost } from '../src/renderer/src/antd-host'
import { requestReferenceImpactDecision } from '../src/renderer/src/components/ReferenceImpactDialog'

type CapturedConfirmOptions = {
  onOk?: (close: () => void) => unknown
  onCancel?: () => void
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  if (typeof value !== 'object' || value === null) return false
  return typeof (value as { then?: unknown }).then === 'function'
}

describe('reference impact confirmation', () => {
  let options: CapturedConfirmOptions | undefined
  let warning: ReturnType<typeof vi.fn>

  beforeEach(() => {
    options = undefined
    warning = vi.fn()
    const confirm = vi.fn((captured: CapturedConfirmOptions) => {
      options = captured
      return {} as never
    })
    bindAntdHost({ confirm } as never, { warning } as never)
  })

  it('keeps the dialog open for incomplete choices without returning a rejected promise', async () => {
    const decision = requestReferenceImpactDecision({
      operation: 'delete-plan',
      path: 'Target',
      target_plan_ids: ['target-plan-id'],
      references: [{
        source_path: 'Source',
        source_component_id: 'source-component-id',
        source_updated_at: 'source-revision',
        target_plan_id: 'target-plan-id',
        target_component_id: 'target-component-id',
        mode: 'link',
        target_path_snapshot: 'Target',
        target_name_snapshot: 'Target'
      }]
    }, 'library-id')
    const close = vi.fn()

    if (!options?.onOk) throw new Error('Modal confirmation handler was not registered')
    const callbackResult = options.onOk(close)
    if (isPromiseLike(callbackResult)) {
      await Promise.resolve(callbackResult).catch(() => undefined)
    }

    expect(callbackResult).toBeUndefined()
    expect(warning).toHaveBeenCalledOnce()
    expect(close).not.toHaveBeenCalled()

    let decisionSettled = false
    void decision.then(() => { decisionSettled = true })
    await Promise.resolve()
    expect(decisionSettled).toBe(false)

    options.onCancel?.()
    await expect(decision).resolves.toBeNull()
  })
})
