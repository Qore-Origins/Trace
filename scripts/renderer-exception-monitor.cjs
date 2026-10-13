'use strict'

class RendererExceptionMonitor {
  constructor() {
    this.countsByClient = new Map()
    this.lastClientName = null
  }

  recordProtocolEvent(clientName, message) {
    if (message?.method !== 'Runtime.exceptionThrown') return false

    const normalizedClientName = typeof clientName === 'string' && clientName.length > 0
      ? clientName
      : 'unknown'
    this.countsByClient.set(normalizedClientName, (this.countsByClient.get(normalizedClientName) ?? 0) + 1)
    this.lastClientName = normalizedClientName
    return true
  }

  snapshot() {
    const byClient = Object.fromEntries([...this.countsByClient.entries()].sort(([left], [right]) => left.localeCompare(right)))
    return {
      total: Object.values(byClient).reduce((sum, count) => sum + count, 0),
      byClient,
      lastClientName: this.lastClientName
    }
  }
}

async function enableRuntimeExceptionEvents(client) {
  await client.send('Runtime.enable')
}

function waitForWebSocketClose(webSocket, isClosed, timeoutMs) {
  if (isClosed()) return Promise.resolve()

  return new Promise((resolve, reject) => {
    let timer
    const finish = (callback, value) => {
      clearTimeout(timer)
      webSocket.removeEventListener('close', onClose)
      callback(value)
    }
    const onClose = () => finish(resolve)
    timer = setTimeout(() => finish(reject, new Error(`CDP websocket close timed out after ${timeoutMs}ms`)), timeoutMs)
    timer.unref?.()
    webSocket.addEventListener('close', onClose, { once: true })

    if (isClosed()) onClose()
  })
}

async function closeRendererClientAfterTargetCloses(client, waitForTargetClose, waitForClientClose) {
  try {
    await waitForTargetClose()
    await waitForClientClose()
  } finally {
    client.close()
  }
}

module.exports = {
  RendererExceptionMonitor,
  enableRuntimeExceptionEvents,
  waitForWebSocketClose,
  closeRendererClientAfterTargetCloses
}
