import { app, BrowserWindow, dialog, shell } from 'electron'
import { spawn as spawnChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { PlanRepository } from './services/plan-repository'
import { ConfigService } from './services/config-service'
import { StorageService } from './services/storage-service'
import { AppService } from './services/app-service'
import { WatchService } from './services/watch-service'
import { TransferService } from './services/transfer-service'
import { SearchService } from './services/search-service'
import { setDiaryRepo } from './services/diary-service'
import { ExportService, resolveRendererSource } from './services/export-service'
import { registerIpc } from './ipc/register'
import { bus } from './services/event-bus'
import { createExternalLinkWindowHandler } from './services/external-link-service'
import { checkPlantumlEndpoint, createPlantumlService, type PlantumlChildProcess } from './services/plantuml-service'
import { createApplicationQuitCoordinator, createStartupCoordinator } from './services/startup-coordinator'

// 安全基线（接口设计文档 §2.3）：contextIsolation/sandbox/webSecurity 显式声明
const SECURITY_BASE = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true
} as const

// ---------- 服务装配 ----------
// watch 经惰性引用绑定（终审延后项）：repo/storage/watch 三者构造互依，原写法靠
// "构造期不触回调"的隐式约定规避 TDZ——改为 watchRef 空安全调用，构造期若误触回调
// 显式 no-op（不崩），装配完成后回调即接通
let watchRef: WatchService | null = null
const repo = new PlanRepository({
  onInternalWrite: (abs) => watchRef?.markInternalWrite(abs)
})
setDiaryRepo(repo) // diary 自写事件同样经 markInternalWrite 抑制（评审 F1：防外部变更误报）
const config = new ConfigService(app.getPath('userData'), repo)
const storage = new StorageService(repo)
const watch = new WatchService(storage.treeCache)
watchRef = watch
const search = new SearchService(repo)
const transfer = new TransferService(repo, storage.treeCache, () => {
  const r = storage.getRootAbs()
  if (!r) throw new Error('计划库根目录未初始化')
  return r
})
const appService = new AppService(config, repo, storage, (rootAbs) => {
  watch.start(rootAbs)
  search.start(rootAbs) // 根目录变化 → 索引重建（含首启全量）
}, () => search.getState())
// 导出为（BR-008）：离屏窗口渲染，PDF/PNG 双路；渲染层源与主窗口同源加载
const exportService = new ExportService(repo, () => storage.getRootAbs() ?? '', resolveRendererSource(__dirname), join(__dirname, '../preload/index.js'))
const plantumlService = createPlantumlService({
  spawn: (executablePath, args, options) =>
    spawnChildProcess(executablePath, args, options) as unknown as PlantumlChildProcess,
  checkPlantumlEndpoint,
  resolveResources: () => {
    const runtimeDirectory = app.isPackaged
      ? join(process.resourcesPath, 'plantuml')
      : join(__dirname, '../../.build/plantuml-runtime')
    return {
      runtimeDirectory,
      plantumlJar: join(runtimeDirectory, 'plantuml-lgpl-1.2026.8.jar')
    }
  }
})

let mainWindow: BrowserWindow | null = null
let appMayCloseWindows = false

function createWindow(bounds: { width: number; height: number }, startup: ReturnType<typeof createStartupCoordinator>): void {
  const window = new BrowserWindow({
    width: bounds?.width ?? 1200,
    height: bounds?.height ?? 800,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: '溯源 Trace',
    // 无边框自绘窗口控制（保留 Windows 原生窗口行为：阴影/圆角/Win+方向贴靠/动画）
    // 取舍：自绘按钮无 Win11 Snap Layouts 悬停气泡（那是系统按钮专属）
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    // 打包后窗口图标取自 exe 资源；开发态显式指定（否则任务栏显示默认 Electron 图标）
    icon: app.isPackaged ? undefined : join(__dirname, '../../resources/icon.ico'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      ...SECURITY_BASE
    }
  })
  mainWindow = window

  // 最大化状态推送（自绘按钮图标切换）
  window.on('maximize', () => bus.emit('trace:window-state', { maximized: true }))
  window.on('unmaximize', () => bus.emit('trace:window-state', { maximized: false }))

  // 界面就绪后再显示（避免白屏闪烁）
  window.once('ready-to-show', () => {
    window.show()
    startup.onWindowShown()
  })

  // 新窗口始终拒绝；合法 HTTP(S) 链接交给系统浏览器，协议校验在主进程再次执行。
  window.webContents.setWindowOpenHandler(
    createExternalLinkWindowHandler(
      (url) => shell.openExternal(url),
      () => console.warn('[trace] Failed to open an external link in the system browser')
    )
  )
  window.webContents.on('will-navigate', (event, url) => {
    if (process.env['ELECTRON_RENDERER_URL'] && url.startsWith(process.env['ELECTRON_RENDERER_URL'])) return
    event.preventDefault()
  })

  window.on('close', (event) => {
    // 窗口状态持久化（LLD §5.3）
    const bounds = mainWindow?.getBounds()
    if (bounds) {
      void config.saveWindowState({
        width: bounds.width,
        height: bounds.height,
        maximized: mainWindow?.isMaximized() ?? false
      })
    }

    // 未确认子进程退出时保留窗口，用户可再次尝试关闭。
    if (process.platform !== 'darwin' && !appMayCloseWindows) {
      event.preventDefault()
      app.quit()
    }
  })

  window.on('closed', () => {
    mainWindow = null
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
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

    // 只等待轻量配置加载；根目录初始化延后到窗口首显之后。
    await config.load()

    const winState = await config.getWindowState()
    const startup = createStartupCoordinator({
      activateConfiguredRoot: () => appService.activateConfiguredRoot(),
      onRootActivationError: () => console.error('[trace] Configured plan library activation failed')
    })

    // IPC 先注册，renderer bootstrap 可在 ready-to-show 前安全排队等待根目录激活。
    const disposeIpc = registerIpc({
      app: appService,
      storage,
      config,
      transfer,
      export: exportService,
      search,
      plantuml: plantumlService,
      startup,
      getWindow: () => mainWindow,
      log: (channel, code, detail) => {
        // 日志脱敏：仅通道/错误码/消息，不含计划正文（LLD §7.2）
        if (code !== 0) console.log(`[ipc] ${channel} code=${code} ${detail ?? ''}`)
      }
    })
    const quitCoordinator = createApplicationQuitCoordinator({
      shutdown: () => plantumlService.shutdown(),
      disposeIpc,
      quit: () => {
        appMayCloseWindows = true
        app.quit()
      },
      onShutdownFailure: (status) => {
        console.error(`[trace] PlantUML shutdown not confirmed; quit prevented (${status?.errorCode ?? 'unknown'})`)
        dialog.showErrorBox(
          '溯源 Trace 尚未退出',
          '本地 PlantUML 子进程尚未确认退出。为避免留下后台服务，Trace 保持运行；请稍后重试关闭。'
        )
      }
    })
    app.on('before-quit', (event) => quitCoordinator.beforeQuit(event))

    // 首屏窗口创建链路不等待根目录激活、PlantUML 或全量搜索索引。
    createWindow({ width: winState.width, height: winState.height }, startup)
    if (mainWindow && winState.maximized) mainWindow.maximize()
    void bus // 事件转发已在 registerIpc 内建立
  })

  app.on('window-all-closed', () => {
    watch.stop()
    search.stop()
    if (process.platform === 'darwin') {
      void plantumlService.stop()
      return
    }
    if (!appMayCloseWindows) app.quit()
  })
}
