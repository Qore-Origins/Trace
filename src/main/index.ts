import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'

// 安全基线（接口设计文档 §2.3）：contextIsolation/sandbox/webSecurity 显式声明
const SECURITY_BASE = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true
} as const

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: '溯源 Trace',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      ...SECURITY_BASE
    }
  })

  // 界面就绪后再显示（避免白屏闪烁）
  mainWindow.on('ready-to-show', () => mainWindow.show())

  // 拒绝任何窗口内新窗口/外部导航（v1.0 无外部链接语义）
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // 仅允许开发服务器自身导航，其余一律拦截
    if (process.env['ELECTRON_RENDERER_URL'] && url.startsWith(process.env['ELECTRON_RENDERER_URL'])) return
    event.preventDefault()
  })

  // TODO(SPRINT-1): ConfigService 接入，持久化窗口位置/尺寸（config.json window.state，见 LLD §5.3）
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
    // TODO(SPRINT-1): 激活既有窗口
  })

  app.setAppUserModelId('com.qore.trace')

  app.whenReady().then(() => {
    console.log('[trace] main ready')
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
