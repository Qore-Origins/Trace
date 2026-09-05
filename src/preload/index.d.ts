import type { TraceBridge } from './index'

declare global {
  interface Window {
    trace: TraceBridge
  }
}

export {}
