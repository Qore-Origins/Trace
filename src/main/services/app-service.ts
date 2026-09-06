// AppService：应用级流程（getAppInfo / bootstrap / setRootDir）
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { app } from 'electron'
import { ERR, TraceError } from '../../shared/errors'
import type { AppInfo } from '../../shared/ipc-contract'
import { ConfigService } from './config-service'
import { PlanRepository } from './plan-repository'
import { StorageService } from './storage-service'
import { resolveWithin } from './path-safety'

export class AppService {
  constructor(
    private config: ConfigService,
    private repo: PlanRepository,
    private storage: StorageService,
    private onRootChanged: (rootAbs: string) => void
  ) {}

  async getAppInfo(): Promise<AppInfo> {
    const rootDir = this.config.getRootDir()
    const rootConfigured = rootDir !== null
    let rootInvalid = false
    if (rootConfigured && rootDir) {
      try {
        await fs.access(rootDir)
      } catch {
        rootInvalid = true
      }
    }
    return {
      appVersion: app.getVersion(),
      formatVersion: '1',
      rootDir,
      rootConfigured,
      rootInvalid,
      indexState: 'ready' // Sprint 3 接入 SearchService 后由索引状态驱动
    }
  }

  async bootstrap(): Promise<AppInfo> {
    return this.getAppInfo()
  }

  // 首次选择/切换根目录：校验可写 → 初始化 .trace → 生效并通知
  // 确认语义：仅"从有效根目录切走"需要确认；首次配置或旧根目录已失效 → 免确认（无数据可失去）
  async setRootDir(dirPath: string, confirmed: boolean): Promise<{ rootDir: string }> {
    const currentRoot = this.config.getRootDir()
    if (currentRoot !== null && confirmed !== true) {
      let currentValid = true
      try {
        await fs.access(currentRoot)
      } catch {
        currentValid = false
      }
      if (currentValid) {
        throw new TraceError(ERR.CONFIRMATION_REQUIRED, '切换根目录需确认（当前库数据不会迁移或删除）')
      }
    }
    // 拒绝明显非法输入；真实可写性由 ensureLibraryRoot 探测
    if (!dirPath || path.isAbsolute(dirPath) === false) {
      throw new TraceError(ERR.PATH_UNSAFE, '目录不可用，请重选')
    }
    const { abs } = resolveWithin(dirPath, '')
    const meta = await this.repo.ensureLibraryRoot(abs)
    void meta
    await this.config.setRootDir(abs)
    this.storage.setRoot(abs)
    this.onRootChanged(abs)
    return { rootDir: abs }
  }

  // 启动时若已配置根目录则激活（含根目录失效检测）
  async activateConfiguredRoot(): Promise<boolean> {
    const rootDir = this.config.getRootDir()
    if (!rootDir) return false
    try {
      await fs.access(rootDir)
    } catch {
      return false // rootInvalid → 渲染器引导重选
    }
    await this.repo.ensureLibraryRoot(rootDir)
    this.storage.setRoot(rootDir)
    this.onRootChanged(rootDir)
    return true
  }
}
