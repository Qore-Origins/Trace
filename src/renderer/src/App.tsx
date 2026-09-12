// App：阶段推导视图（无路由，前端详细设计 §2.1）；全局事件订阅随生命周期挂载/释放
// 全局交互底座（评审 Important-1）：搜索浮层/命名对话框/设置弹窗 + 全局快捷键在此单点挂载，
// 工作台与日记两视图共用——view 路由切换不再使底座随 WorkspaceView 卸载而静默失效
// （修复：日记视图下 Ctrl+F 搜索 / Ctrl+N 新建计划 / 文件→设置 全部无效）
import { useEffect, useState } from 'react'
import { Button, Descriptions, Modal, Radio, Spin } from 'antd'
import OnboardingView from './views/OnboardingView'
import WorkspaceView from './views/WorkspaceView'
import DiaryView from './views/DiaryView'
import NameDialogModal from './components/NameDialogModal'
import SearchOverlay from './components/SearchOverlay'
import { useAppStore, subscribeAppEvents } from './stores/app-store'
import { subscribeTreeEvents, useTreeStore } from './stores/tree-store'
import { subscribePlanEvents } from './stores/plan-store'
import { subscribeSearchEvents, useSearchStore } from './stores/search-store'
import { useUiStore } from './stores/ui-store'
import { usePrefStore, type DealDirection, type Language, type ScoreAnim, type ThemeMode } from './stores/pref-store'
import { invoke } from './ipc-client'
import { DIARY_DIR } from '@shared/plan-types'
import { useTranslation } from './i18n'

// 输入控件内不劫持快捷键（Ctrl+N/F5 等不作用于输入框；Ctrl+F 例外——输入框内也应打开溯源）
function isTypingTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (!t) return false
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable
}

export default function App(): React.JSX.Element {
  const { t } = useTranslation()
  const phase = useAppStore((s) => s.phase)
  const bootstrap = useAppStore((s) => s.bootstrap)
  const rootDir = useAppStore((s) => s.rootDir)
  const view = useUiStore((s) => s.view)
  const setView = useUiStore((s) => s.setView)

  // 「在树中打开」（Task 5 日记深化接线）：定位 Diary/<date> 计划并切回工作台。
  // 复用搜索回溯定位 locate（expandTo → select → open → 滚动），不新建并行定位路径；
  // 定位前定向双刷新（评审 Important-1：refreshAll 清空全树会震树，展开组 spinner 常亮，改用不震树的定向刷新）：
  //   loadChildren('') 补日记根节点、loadChildren('Diary') 补今日页节点（diary:ensure 直写磁盘不发 plan-changed 事件，树可能是旧快照；
  //   expandTo 只刷未加载层，补不了已加载层的 stale，故须在 locate 前显式刷这两层）
  const openInTree = (date: string): void => {
    setView('workspace')
    const tree = useTreeStore.getState()
    void Promise.all([tree.loadChildren(''), tree.loadChildren(DIARY_DIR)])
      .catch(() => undefined) // 刷新失败不阻断定位：计划仍会打开，最多树高亮缺席
      .then(() => {
        void useSearchStore.getState().locate({ scope: 'plan', path: `${DIARY_DIR}/${date}`, snippet: '', matched_field: 'path' })
      })
  }

  useEffect(() => {
    const offApp = subscribeAppEvents()
    const offTree = subscribeTreeEvents()
    const offPlan = subscribePlanEvents()
    const offSearch = subscribeSearchEvents()
    void bootstrap()
    return () => {
      offApp()
      offTree()
      offPlan()
      offSearch()
    }
  }, [bootstrap])

  // 全局快捷键（ready 阶段生效，两视图共用）：Ctrl+, 设置 / Ctrl+F 搜索 / Ctrl+N 新建计划 / F5 刷新 / Ctrl+Shift+I 开发者工具
  // 树选中相关（F2 重命名 / Delete 删除）留在 WorkspaceView——日记视图下选中不可见，全局触发会误删隐藏选中
  useEffect(() => {
    if (phase !== 'ready') return
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault()
        useUiStore.getState().setSettingsOpen(true)
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        useSearchStore.getState().setOpen(true)
        return
      }
      if (isTypingTarget(e)) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        useUiStore.getState().openNameDialog({ mode: 'create-plan', targetPath: '', initialName: '' })
        return
      }
      if (e.key === 'F5') {
        e.preventDefault()
        void useTreeStore.getState().refreshAll()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'i') {
        e.preventDefault()
        void invoke('window:toggleDevtools').catch(() => undefined)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase])

  if (phase === 'checking') {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin tip={t('app.openingLibrary')}>
          <div style={{ minHeight: 60 }} />
        </Spin>
      </div>
    )
  }
  // ready 阶段按 ui-store view 路由：diary=日记视图（Task 4），workspace 照旧（导航入口 Task 5 接线）
  // DiaryView key=rootDir（评审 Important-2）：switchRootDir 全程 phase 保持 ready（无 checking 过渡 → 不换分支不卸载），
  // 用 key 强制重挂——diary:ensure 与月数据重拉随重挂自然恢复，切根后月历无旧库残留、新根 ensure 照常执行
  return phase === 'onboarding' ? (
    <OnboardingView />
  ) : (
    <>
      {view === 'diary' ? (
        <DiaryView key={rootDir ?? 'none'} onOpenInTree={openInTree} />
      ) : (
        <WorkspaceView />
      )}
      <NameDialogModal />
      <SearchOverlay />
      <TopBarSettingsHost />
    </>
  )
}

// 设置弹窗单点挂载（Ctrl+, 与 文件菜单共用 ui-store 开合）——App 级：日记视图下「文件→设置」同样可用
function TopBarSettingsHost(): React.JSX.Element {
  const { t } = useTranslation()
  const open = useUiStore((s) => s.settingsOpen)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)
  const { rootDir, switchRootDir } = useAppStore()
  const { language, dealDirection, scoreAnim, theme: themeMode, setLanguage, setDealDirection, setScoreAnim, setTheme } = usePrefStore()
  const [version, setVersion] = useState('')

  useEffect(() => {
    if (open && !version) {
      void invoke('app:getAppInfo')
        .then((info) => setVersion(t('about.version', { version: info.appVersion, format: info.formatVersion })))
        .catch(() => setVersion('-'))
    }
  }, [open, version, t])

  const shortcuts: Array<[string, string]> = [
    ['Ctrl + F', t('settings.scSearch')],
    ['Ctrl + N', t('settings.scNewPlan')],
    ['F2', t('settings.scRename')],
    ['Delete', t('settings.scDelete')],
    ['F5', t('settings.scRefresh')],
    ['Ctrl + ,', t('settings.scSettings')],
    ['Ctrl + Shift + I', t('settings.scDevtools')]
  ]

  const prefLabel = (text: string): React.CSSProperties => ({ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 })

  return (
    <Modal title={t('settings.title')} open={open} onCancel={() => setSettingsOpen(false)} footer={<Button onClick={() => setSettingsOpen(false)}>{t('common.close')}</Button>}>
      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label={t('settings.prefs')}>
          <div style={{ display: 'grid', gap: 12, minWidth: 260 }}>
            <div>
              <div style={prefLabel(t('settings.language'))}>{t('settings.language')}</div>
              <Radio.Group
                optionType="button"
                buttonStyle="solid"
                size="small"
                value={language}
                onChange={(e) => setLanguage(e.target.value as Language)}
              >
                <Radio.Button value="zh-CN">{t('settings.langZh')}</Radio.Button>
                <Radio.Button value="en-US">{t('settings.langEn')}</Radio.Button>
              </Radio.Group>
            </div>
            <div>
              <div style={prefLabel(t('settings.dealDirection'))}>{t('settings.dealDirection')}</div>
              <Radio.Group
                optionType="button"
                buttonStyle="solid"
                size="small"
                value={dealDirection}
                onChange={(e) => setDealDirection(e.target.value as DealDirection)}
              >
                <Radio.Button value="top">{t('settings.dealTop')}</Radio.Button>
                <Radio.Button value="bottom">{t('settings.dealBottom')}</Radio.Button>
              </Radio.Group>
            </div>
            <div>
              <div style={prefLabel(t('settings.scoreAnim'))}>{t('settings.scoreAnim')}</div>
              <Radio.Group
                optionType="button"
                buttonStyle="solid"
                size="small"
                value={scoreAnim}
                onChange={(e) => setScoreAnim(e.target.value as ScoreAnim)}
              >
                <Radio.Button value="roll">{t('settings.scoreAnimRoll')}</Radio.Button>
                <Radio.Button value="none">{t('settings.scoreAnimNone')}</Radio.Button>
              </Radio.Group>
            </div>
            <div>
              <div style={prefLabel(t('settings.theme'))}>{t('settings.theme')}</div>
              <Radio.Group
                optionType="button"
                buttonStyle="solid"
                size="small"
                value={themeMode}
                onChange={(e) => setTheme(e.target.value as ThemeMode)}
              >
                <Radio.Button value="light">{t('settings.themeLight')}</Radio.Button>
                <Radio.Button value="dark">{t('settings.themeDark')}</Radio.Button>
                <Radio.Button value="system">{t('settings.themeSystem')}</Radio.Button>
              </Radio.Group>
            </div>
          </div>
        </Descriptions.Item>
        <Descriptions.Item label={t('settings.rootDir')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 260 }}>
            <span style={{ flex: 1, wordBreak: 'break-all', fontSize: 12 }}>{rootDir ?? t('settings.notConfigured')}</span>
            <Button size="small" onClick={() => void switchRootDir()}>
              {t('settings.switchBtn')}
            </Button>
          </div>
        </Descriptions.Item>
        <Descriptions.Item label={t('settings.version')}>{version || '…'}</Descriptions.Item>
        <Descriptions.Item label={t('settings.data')}>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{t('settings.dataDesc')}</span>
        </Descriptions.Item>
        <Descriptions.Item label={t('settings.shortcuts')}>
          <div style={{ fontSize: 12, lineHeight: 1.9 }}>
            {shortcuts.map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-3)' }}>{v}</span>
                <span style={{ fontFamily: 'Consolas, monospace' }}>{k}</span>
              </div>
            ))}
          </div>
        </Descriptions.Item>
      </Descriptions>
    </Modal>
  )
}
