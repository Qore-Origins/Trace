// App：阶段推导视图（无路由，前端详细设计 §2.1）；全局事件订阅随生命周期挂载/释放
import { useEffect } from 'react'
import { Spin } from 'antd'
import OnboardingView from './views/OnboardingView'
import WorkspaceView from './views/WorkspaceView'
import DiaryView from './views/DiaryView'
import { useAppStore, subscribeAppEvents } from './stores/app-store'
import { subscribeTreeEvents } from './stores/tree-store'
import { subscribePlanEvents } from './stores/plan-store'
import { subscribeSearchEvents } from './stores/search-store'
import { useUiStore } from './stores/ui-store'
import { useTranslation } from './i18n'

export default function App(): React.JSX.Element {
  const { t } = useTranslation()
  const phase = useAppStore((s) => s.phase)
  const bootstrap = useAppStore((s) => s.bootstrap)
  const view = useUiStore((s) => s.view)

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
  return phase === 'onboarding' ? <OnboardingView /> : view === 'diary' ? <DiaryView /> : <WorkspaceView />
}
