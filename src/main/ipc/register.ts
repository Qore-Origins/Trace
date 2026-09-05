// IPC 注册层：白名单通道 → 主进程 handler；统一校验包装（异常 → TraceResult + 脱敏日志）
import { ipcMain, type BrowserWindow } from 'electron'
import { toTraceResultError, ERR } from '../../shared/errors'
import type { TraceEvents } from '../services/event-bus'
import { fail, ok, type ChannelName, type Channels, type TraceResult } from '../../shared/ipc-contract'
import { AppService } from '../services/app-service'
import { StorageService } from '../services/storage-service'
import { ConfigService } from '../services/config-service'
import { bus } from '../services/event-bus'

interface Deps {
  app: AppService
  storage: StorageService
  config: ConfigService
  getWindow: () => BrowserWindow | null
  log: (channel: string, code: number, detail?: string) => void
}

type Handler<K extends ChannelName> = (payload: Channels[K]['req']) => Promise<Channels[K]['res']>

// wrapHandler：TraceError/未知异常 → { ok:false, code, message }；日志只含通道+错误码+消息（不含计划正文）
function wrap<K extends ChannelName>(name: K, handler: Handler<K>, log: Deps['log']) {
  return async (event: unknown, payload: Channels[K]['req']): Promise<TraceResult<Channels[K]['res']>> => {
    try {
      void event
      const data = await handler(payload)
      log(name, ERR.OK)
      return ok(data)
    } catch (e) {
      const { code, message } = toTraceResultError(e)
      log(name, code, message)
      return fail(code, message)
    }
  }
}

export function registerIpc(deps: Deps): void {
  const { app, storage, config, getWindow, log } = deps
  const reg = <K extends ChannelName>(name: K, handler: Handler<K>) => {
    ipcMain.handle(name, wrap(name, handler, log))
  }

  // ---------- app ----------
  reg('app:getAppInfo', () => app.getAppInfo())
  reg('app:bootstrap', () => app.bootstrap())
  reg('app:setRootDir', (p) => app.setRootDir(p.dirPath, p.confirmed))
  reg('app:reportError', (p) => {
    log(`renderer:${p.context}`, ERR.INTERNAL, p.message) // 渲染器上报：仅上下文与消息
    return Promise.resolve(null)
  })

  // ---------- storage ----------
  reg('storage:treeGetChildren', (p) => storage.treeGetChildren(p.parent_path))
  reg('storage:createPlan', (p) => storage.createPlan(p.parent_path, p.name))
  reg('storage:renamePlan', (p) => storage.renamePlan(p.path, p.new_name))
  reg('storage:deletePlan', (p) => storage.deletePlan(p.path, p.confirmed).then(() => null))
  reg('storage:movePlan', (p) => storage.movePlan(p.path, p.target_parent_path, p.order_index).then(() => null))
  reg('storage:resortChildren', (p) => storage.resortChildren(p.parent_path, p.ordered_names).then(() => null))
  reg('storage:readPlan', (p) => storage.readPlan(p.path))
  reg('storage:savePlan', (p) => storage.savePlan(p.path, p.document, p.expected_updated_at))
  reg('storage:appendComponent', (p) => storage.appendComponent(p.path, p.component).then(() => null))
  reg('storage:removeComponent', (p) => storage.removeComponent(p.path, p.component_id).then(() => null))
  reg('storage:moveComponent', (p) => storage.moveComponent(p.path, p.component_id, p.target_index).then(() => null))
  reg('storage:updateTask', (p) => storage.updateTask(p.path, p.component_id, p.task_id, p.patch).then(() => null))

  // ---------- config ----------
  reg('config:getWindow', () => config.getWindowState())
  reg('config:setWindow', (p) => config.saveWindowState(p).then(() => null))

  // ---------- 事件转发：bus → 渲染器 ----------
  const forward = <K extends keyof TraceEvents>(event: K): void => {
    bus.on(event, (payload) => {
      getWindow()?.webContents.send(event, payload)
    })
  }
  forward('trace:plan-changed')
  forward('trace:save-status')
  forward('trace:fs-external-change')
  forward('trace:index-status')
}
