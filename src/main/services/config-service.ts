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
    const config = await this.load()
    config.root_dir = dirAbs
    await this.repo.writeAppJson(this.configFile(), config)
  }

  async getWindowState(): Promise<WindowState> {
    const config = await this.load()
    return config.window
  }

  async saveWindowState(state: WindowState): Promise<void> {
    const config = await this.load()
    config.window = state
    await this.repo.writeAppJson(this.configFile(), config)
  }
}
