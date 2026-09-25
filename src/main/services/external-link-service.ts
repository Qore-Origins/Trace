interface WindowOpenDetails {
  url: string
}

type OpenExternal = (url: string) => Promise<void>
type OpenErrorHandler = (error: unknown) => void

function resolveExternalHttpUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return null
    return url.toString()
  } catch {
    return null
  }
}

export function createExternalLinkWindowHandler(
  openExternal: OpenExternal,
  onError: OpenErrorHandler = () => undefined
): (details: WindowOpenDetails) => { action: 'deny' } {
  return ({ url }) => {
    const externalUrl = resolveExternalHttpUrl(url)
    if (externalUrl) void openExternal(externalUrl).catch(onError)
    return { action: 'deny' }
  }
}
