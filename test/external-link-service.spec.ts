import { describe, expect, it, vi } from 'vitest'
import { createExternalLinkWindowHandler } from '../src/main/services/external-link-service'

describe('external link window handler', () => {
  it('opens HTTPS links in the system browser and denies an Electron child window', () => {
    const openExternal = vi.fn().mockResolvedValue(undefined)
    const handler = createExternalLinkWindowHandler(openExternal)

    expect(handler({ url: 'https://example.com/path?q=trace' })).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenCalledOnce()
    expect(openExternal).toHaveBeenCalledWith('https://example.com/path?q=trace')
  })

  it('opens HTTP links but rejects unsafe, malformed, and credentialed URLs', () => {
    const openExternal = vi.fn().mockResolvedValue(undefined)
    const handler = createExternalLinkWindowHandler(openExternal)

    expect(handler({ url: 'http://example.com' })).toEqual({ action: 'deny' })
    for (const url of ['javascript:alert(1)', 'file:///secret', 'https://', 'https://user:pass@example.com']) {
      expect(handler({ url })).toEqual({ action: 'deny' })
    }

    expect(openExternal).toHaveBeenCalledOnce()
    expect(openExternal).toHaveBeenCalledWith('http://example.com/')
  })

  it('reports system-browser failures without allowing the Electron window', async () => {
    const error = new Error('browser unavailable')
    const openExternal = vi.fn().mockRejectedValue(error)
    const onError = vi.fn()
    const handler = createExternalLinkWindowHandler(openExternal, onError)

    expect(handler({ url: 'https://example.com' })).toEqual({ action: 'deny' })
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(error))
  })
})
