// ConfigService：应用配置（%APPDATA% 用户数据目录 config.json，原子写）
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { PlanRepository } from './plan-repository'

export interface WindowState {
  width: number
  height: number
  maximized: boolean
}

export interface AppConfig {
  format_version: '1'
  root_dir: string | null
  window: WindowState
}

const DEFAULT_CONFIG: AppConfig = {
  format_version: '1',
  root_dir: null,
  window: { width: 1200, height: 800, maximized: false }
}

export class ConfigService {
  private cache: AppConfig | null = null
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(
    private userDataDir: string,
    private repo: PlanRepository
  ) {}

  private configFile(): string {
    return join(this.userDataDir, 'config.json')
  }

  async load(): Promise<AppConfig> {
    if (this.cache) return this.cache
    try {
      const raw = await fs.readFile(this.configFile(), 'utf8')
      this.cache = { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as AppConfig) }
    } catch {
      this.cache = { ...DEFAULT_CONFIG }
    }
    return this.cache
  }

  getRootDir(): string | null {
    return this.cache?.root_dir ?? null
  }

  async setRootDir(dirAbs: string): Promise<void> {
    return this.mutateConfig((previous) => ({ ...previous, root_dir: dirAbs }))
  }

  async getWindowState(): Promise<WindowState> {
    const config = await this.load()
    return config.window
  }

  async saveWindowState(state: WindowState): Promise<void> {
    return this.mutateConfig((previous) => ({ ...previous, window: state }))
  }

  private mutateConfig(change: (previous: AppConfig) => AppConfig): Promise<void> {
    const operation = this.mutationQueue.then(async () => {
      const previous = await this.load()
      const next = change(previous)
      try {
        await this.repo.writeAppJson(this.configFile(), next)
      } catch (error) {
        // A failed writer may have already replaced the file; keep recovery before the next mutation.
        await this.repo.writeAppJson(this.configFile(), previous).catch(() => {})
        throw error
      }
      this.cache = next
    })
    this.mutationQueue = operation.then(() => undefined, () => undefined)
    return operation
  }
}
