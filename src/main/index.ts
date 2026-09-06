import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { PlanRepository } from './services/plan-repository'
import { ConfigService } from './services/config-service'
import { StorageService } from './services/storage-service'
import { AppService } from './services/app-service'
import { WatchService } from './services/watch-service'
import { TransferService } from './services/transfer-service'
import { registerIpc } from './ipc/register'
import { bus } from './services/event-bus'

// 安全基线（接口设计文档 §2.3）：contextIsolation/sandbox/webSecurity 显式声明
const SECURITY_BASE = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true
} as const

// ---------- 服务装配 ----------
const repo = new PlanRepository({
  onInternalWrite: (abs) => watch.markInternalWrite(abs)
})
const config = new ConfigService(app.getPath('userData'), repo)
const storage = new StorageService(repo)
const watch = new WatchService(storage.treeCache)
const transfer = new TransferService(repo, storage.treeCache, () => {
  const r = storage.getRootAbs()
  if (!r) throw new Error('计划库根目录未初始化')
  return r
})
const appService = new AppService(config, repo, storage, (rootAbs) => watch.start(rootAbs))

let mainWindow: BrowserWindow | null = null

function createWindow(bounds?: { width: number; height: number }): void {
  mainWindow = new BrowserWindow({
    width: bounds?.width ?? 1200,
    height: bounds?.height ?? 800,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: '溯源 Trace',
    autoHideMenuBar: true,
    // 打包后窗口图标取自 exe 资源；开发态显式指定（否则任务栏显示默认 Electron 图标）
    icon: app.isPackaged ? undefined : join(__dirname, '../../resources/icon.ico'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      ...SECURITY_BASE
    }
  })

  // 界面就绪后再显示（避免白屏闪烁）
  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // 拒绝任何窗口内新窗口/外部导航（v1.0 无外部链接语义）
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (process.env['ELECTRON_RENDERER_URL'] && url.startsWith(process.env['ELECTRON_RENDERER_URL'])) return
    event.preventDefault()
  })

  mainWindow.on('close', () => {
    // 窗口状态持久化（LLD §5.3）
    const bounds = mainWindow?.getBounds()
    if (bounds) {
      void config.saveWindowState({
        width: bounds.width,
        height: bounds.height,
        maximized: mainWindow?.isMaximized() ?? false
      })
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// 单实例锁（防止多开冲突同一计划库目录）
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.setAppUserModelId('com.qore.trace')

  app.whenReady().then(async () => {
    console.log('[trace] main ready')

    // 配置加载 + 已配置根目录激活（含 chokidar 启动）
    await config.load()
    await appService.activateConfiguredRoot()

    // IPC 注册（事件转发到既有窗口）
    registerIpc({
      app: appService,
      storage,
      config,
      transfer,
      getWindow: () => mainWindow,
      log: (channel, code, detail) => {
        // 日志脱敏：仅通道/错误码/消息，不含计划正文（LLD §7.2）
        if (code !== 0) console.log(`[ipc] ${channel} code=${code} ${detail ?? ''}`)
      }
    })

    // 窗口状态恢复
    const winState = await config.getWindowState()
    createWindow({ width: winState.width, height: winState.height })
    if (mainWindow && winState.maximized) mainWindow.maximize()
    void bus // 事件转发已在 registerIpc 内建立
  })

  app.on('window-all-closed', () => {
    watch.stop()
    if (process.platform !== 'darwin') app.quit()
  })
}
