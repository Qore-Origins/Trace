// ExportService：「导出为」（BR-008）——离屏窗口渲染计划卡内容，输出 PDF / PNG
// 架构：隐藏 BrowserWindow 加载渲染层导出模式（?export=1&path=…），渲染层只挂计划卡视图；
//   PDF 走 webContents.printToPDF（打印管线不经显示，隐藏窗可用）；
//   PNG 走 capturePage——隐藏窗截帧不可靠，故 showInactive + 全透明（渲染照常、不抢焦点）
// 导出物恒为亮色纸面（打印/分享语义，不随应用主题——渲染层 ThemeGate 对导出模式跳过暗色）
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import { BrowserWindow } from 'electron'
import { ERR, TraceError } from '../../shared/errors'
import type { PlanRepository } from './plan-repository'

const EXPORT_WIDTH = 794 // A4 @96dpi
const READY_TIMEOUT_MS = 15000
const POLL_INTERVAL_MS = 100

export class ExportService {
  constructor(
    private repo: PlanRepository,
    private getRoot: () => string,
    private rendererSource: { url: string } | { file: string },
    private preloadPath: string
  ) {}

  // 渲染计划卡并输出 PDF（saveTo 为最终写盘绝对路径）
  async exportPdf(rel: string, saveToAbs: string): Promise<{ savedTo: string }> {
    const pdf = await this.withRenderWindow(rel, async (win) => {
      // 页边距全 0：.export-root 自带 32px 纸边距，默认边距会挤压内容宽致卡片右缘裁切
      return win.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { top: 0, bottom: 0, left: 0, right: 0 }
      })
    })
    await fs.writeFile(saveToAbs, pdf)
    return { savedTo: saveToAbs }
  }

  // 渲染计划卡并输出整页 PNG（窗口高度=内容高度，一次性全量截取）
  async exportPng(rel: string, saveToAbs: string): Promise<{ savedTo: string }> {
    const image = await this.withRenderWindow(rel, async (win) => {
      const h = await win.webContents.executeJavaScript(
        `document.querySelector('.export-root').scrollHeight`
      )
      win.setContentSize(EXPORT_WIDTH, Math.ceil(h))
      await sleep(120) // resize 后等待一帧重排+绘制
      return win.webContents.capturePage()
    })
    await fs.writeFile(saveToAbs, image.toPNG())
    return { savedTo: saveToAbs }
  }

  // 开隐藏导出窗 → 等渲染就绪 → 执行输出回调 → 关窗
  private async withRenderWindow<T>(
    rel: string,
    fn: (win: BrowserWindow) => Promise<T>
  ): Promise<T> {
    const root = this.getRoot()
    if (!root) throw new TraceError(ERR.INTERNAL, '计划库根目录未初始化')
    await this.repo.readPlan(root, rel) // 提前验证计划存在（错误语义与读取一致）
    const win = new BrowserWindow({
      show: false,
      width: EXPORT_WIDTH,
      useContentSize: true,
      webPreferences: {
        preload: this.preloadPath,
        sandbox: true,
        webSecurity: true
      }
    })
    try {
      // 导出模式 query：App 入口分流到 ExportView（只渲染计划卡，无顶栏/树）
      const query = `?export=1&path=${encodeURIComponent(rel)}`
      if ('url' in this.rendererSource) await win.loadURL(this.rendererSource.url + query)
      else await win.loadFile(this.rendererSource.file, { search: query })

      await this.waitForReady(win)
      // 全透明显示：capturePage 需要真实渲染管线，但不可抢焦点/不可见闪烁
      win.setOpacity(0)
      win.showInactive()
      await sleep(150) // 首帧绘制
      return await fn(win)
    } finally {
      win.destroy()
    }
  }

  // 轮询渲染层就绪标志（ExportView 渲染完成后置 window.__EXPORT_READY__ = true）
  private async waitForReady(win: BrowserWindow): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS
    while (Date.now() < deadline) {
      const ready = await win.webContents
        .executeJavaScript('window.__EXPORT_READY__ === true')
        .catch(() => false)
      if (ready) return
      await sleep(POLL_INTERVAL_MS)
    }
    throw new TraceError(ERR.INTERNAL, '导出渲染超时')
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// 渲染层源（dev=URL / prod=file）；与主窗口加载逻辑同源（main/index.ts 模式）
export function resolveRendererSource(__dirname_: string): { url: string } | { file: string } {
  if (process.env['ELECTRON_RENDERER_URL']) return { url: process.env['ELECTRON_RENDERER_URL'] }
  return { file: join(__dirname_, '../renderer/index.html') }
}
