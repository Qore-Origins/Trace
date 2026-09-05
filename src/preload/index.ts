import { contextBridge } from 'electron'

// TODO(SPRINT-1): 按 src/shared/ipc-contract（LLD §3.1）暴露白名单 API：
//   window.trace = { app: {...}, storage: {...}, search: {...}, config: {...} }
//   当前仅占位（contextBridge 最小暴露，为渲染器提供类型锚点）。
const api = {
  platform: process.platform,
  appVersion: undefined as string | undefined
}

contextBridge.exposeInMainWorld('trace', api)

export type TraceBridge = typeof api
