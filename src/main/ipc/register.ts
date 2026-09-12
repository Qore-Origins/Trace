// IPC 注册层：白名单通道 → 主进程 handler；统一校验包装（异常 → TraceResult + 脱敏日志）
import { ipcMain, dialog, type BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import { basename } from 'node:path'
import { toTraceResultError, ERR, TraceError } from '../../shared/errors'
import type { TraceEvents } from '../services/event-bus'
import { fail, ok, type ChannelName, type Channels, type TraceResult } from '../../shared/ipc-contract'
import { AppService } from '../services/app-service'
import { StorageService } from '../services/storage-service'
import { ConfigService } from '../services/config-service'
import { TransferService } from '../services/transfer-service'
import { ExportService } from '../services/export-service'
import { SearchService } from '../services/search-service'
import { ensureDiaryRoot, ensureTodayPage, listMonthEntries, readDaySummary } from '../services/diary-service'
import { bus } from '../services/event-bus'

interface Deps {
  app: AppService
  storage: StorageService
  config: ConfigService
  transfer: TransferService
  export: ExportService
  search: SearchService
  getWindow: () => BrowserWindow | null
  log: (channel: string, code: number, detail?: string) => void
}

type Handler<K extends ChannelName> = (payload: Channels[K]['req']) => Promise<Channels[K]['res']>

// wrapHandler：TraceError/未知异常 → { ok:false, code, message }；日志只含通道+错误码+消息（不含计划正文）
// 未知异常（INTERNAL）额外打完整栈到主进程控制台——否则真实原因被笼统消息吞掉无法定位
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
      if (code === ERR.INTERNAL) console.error(`[ipc] ${name} internal:`, e)
      return fail(code, message)
    }
  }
}

export function registerIpc(deps: Deps): void {
  const { app, storage, config, transfer, search, getWindow, log } = deps
  const reg = <K extends ChannelName>(name: K, handler: Handler<K>) => {
    ipcMain.handle(name, wrap(name, handler, log))
  }

  // ---------- app ----------
  reg('app:getAppInfo', () => app.getAppInfo())
  reg('app:bootstrap', () => app.bootstrap())
  reg('app:setRootDir', (p) => app.setRootDir(p.dirPath, p.confirmed))
  reg('app:chooseDirectory', async () => {
    const r = await dialog.showOpenDialog(getWindow() ?? ({} as BrowserWindow), {
      properties: ['openDirectory', 'createDirectory']
    })
    return { dirPath: r.canceled ? null : (r.filePaths[0] ?? null) }
  })
  reg('app:pickSavePath', (p) =>
    dialog
      .showSaveDialog(getWindow() ?? ({} as BrowserWindow), {
        defaultPath: p.defaultName,
        filters: [{ name: 'Trace 计划包', extensions: p.extensions }]
      })
      .then((r) => ({ filePath: r.canceled ? null : (r.filePath ?? null) }))
  )
  reg('app:pickFiles', (p) =>
    dialog
      .showOpenDialog(getWindow() ?? ({} as BrowserWindow), {
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: '文件', extensions: p.extensions }]
      })
      .then((r) => ({ files: r.canceled ? [] : r.filePaths.map((path) => ({ path, name: basename(path) })) }))
  )
  reg('app:reportError', (p) => {
    log(`renderer:${p.context}`, ERR.INTERNAL, p.message) // 渲染器上报：仅上下文与消息
    return Promise.resolve(null)
  })

  // ---------- storage ----------
  reg('storage:treeGetChildren', (p) => storage.treeGetChildren(p.parent_path))
  reg('storage:createPlan', (p) => storage.createPlan(p.parent_path, p.name))
  reg('storage:createFolder', (p) => storage.createFolder(p.parent_path, p.name))
  reg('storage:renamePlan', (p) => storage.renamePlan(p.path, p.new_name))
  reg('storage:deletePlan', (p) => storage.deletePlan(p.path, p.confirmed).then(() => null))
  reg('storage:movePlan', (p) => storage.movePlan(p.path, p.target_parent_path).then(() => null))
  reg('storage:readPlan', (p) => storage.readPlan(p.path))
  reg('storage:savePlan', (p) => storage.savePlan(p.path, p.document, p.expected_updated_at))
  reg('storage:appendComponent', (p) => storage.appendComponent(p.path, p.component).then(() => null))
  reg('storage:removeComponent', (p) => storage.removeComponent(p.path, p.component_id).then(() => null))
  reg('storage:moveComponent', (p) => storage.moveComponent(p.path, p.component_id, p.target_index).then(() => null))
  reg('storage:updateTask', (p) => storage.updateTask(p.path, p.component_id, p.task_id, p.patch).then(() => null))

  // ---------- window（无边框自绘控制） ----------
  reg('window:minimize', () => {
    getWindow()?.minimize()
    return Promise.resolve(null)
  })
  reg('window:toggleMaximize', () => {
    const win = getWindow()
    if (!win) return Promise.resolve({ maximized: false })
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return Promise.resolve({ maximized: win.isMaximized() })
  })
  reg('window:close', () => {
    getWindow()?.close()
    return Promise.resolve(null)
  })
  reg('window:getMaximized', () => Promise.resolve({ maximized: getWindow()?.isMaximized() ?? false }))
  reg('window:toggleDevtools', () => {
    getWindow()?.webContents.toggleDevTools()
    return Promise.resolve(null)
  })

  // ---------- config ----------
  reg('config:getWindow', () => config.getWindowState())
  reg('config:setWindow', (p) => config.saveWindowState(p).then(() => null))

  // ---------- search ----------
  reg('search:query', (p) => Promise.resolve(search.query(p.keywords)))
  reg('search:getStatus', () => Promise.resolve({ state: search.getState(), indexed: search.indexedCount }))

  // ---------- transfer ----------
  reg('transfer:exportPlan', (p) => transfer.exportPlan(p.path, p.saveTo))
  reg('transfer:exportPdf', (p) => deps.export.exportPdf(p.path, p.saveTo))
  reg('transfer:exportPng', (p) => deps.export.exportPng(p.path, p.saveTo))
  reg('transfer:importPlan', (p) => transfer.importPlan(p.target_parent_path, p.filePath))
  reg('transfer:importMarkdown', async (p) => {
    // 文件读取在主进程（渲染器无 fs 权限）
    const files = await Promise.all(
      p.paths.map(async (path) => ({ name: basename(path), content: await fs.readFile(path, 'utf8') }))
    )
    return transfer.importMarkdown(p.target_parent_path, files)
  })

  // ---------- diary（日记深化 2026-09-10） ----------
  // 载荷不含 planRoot：renderer 不供给路径，根由 main 自解析（先例：app 经 config.getRootDir、transfer 经 storage.getRootAbs）
  const diaryRoot = (): string => {
    const r = storage.getRootAbs()
    if (!r) throw new TraceError(ERR.INTERNAL, '计划库根目录未初始化')
    return r
  }
  reg('diary:ensure', async () => {
    // 幂等：日记根 + 今日页（模板三件套）——存在即跳过，只建不补
    const root = diaryRoot()
    await ensureDiaryRoot(root)
    await ensureTodayPage(root)
    return null
  })
  reg('diary:month', async (p) => ({ entries: await listMonthEntries(diaryRoot(), p.year, p.month) }))
  reg('diary:day', async (p) => readDaySummary(diaryRoot(), p.date))

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
