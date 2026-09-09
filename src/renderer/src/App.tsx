// App：阶段推导视图（无路由，前端详细设计 §2.1）；全局事件订阅随生命周期挂载/释放
import { useEffect } from 'react'
import { Spin } from 'antd'
import OnboardingView from './views/OnboardingView'
import WorkspaceView from './views/WorkspaceView'
import DiaryView from './views/DiaryView'
import { useAppStore, subscribeAppEvents } from './stores/app-store'
import { subscribeTreeEvents, useTreeStore } from './stores/tree-store'
import { subscribePlanEvents } from './stores/plan-store'
import { subscribeSearchEvents, useSearchStore } from './stores/search-store'
import { useUiStore } from './stores/ui-store'
import { useTranslation } from './i18n'

export default function App(): React.JSX.Element {
  const { t } = useTranslation()
  const phase = useAppStore((s) => s.phase)
  const bootstrap = useAppStore((s) => s.bootstrap)
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
    void Promise.all([tree.loadChildren(''), tree.loadChildren('Diary')])
      .catch(() => undefined) // 刷新失败不阻断定位：计划仍会打开，最多树高亮缺席
      .then(() => {
        void useSearchStore.getState().locate({ scope: 'plan', path: `Diary/${date}`, snippet: '', matched_field: 'path' })
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
  return phase === 'onboarding' ? <OnboardingView /> : view === 'diary' ? <DiaryView onOpenInTree={openInTree} /> : <WorkspaceView />
}
