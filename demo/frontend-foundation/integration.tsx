// 正式组件浏览器验收宿主；所有 IPC 在此替换为内存桥，不启动真实 Electron/计划库。
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App as AntdApp, Button, ConfigProvider, Typography, theme } from 'antd'
import { bindAntdHost } from '../../src/renderer/src/antd-host'
import ContentArea from '../../src/renderer/src/components/ContentArea'
import PlanTreePanel from '../../src/renderer/src/components/PlanTreePanel'
import TopBar from '../../src/renderer/src/components/TopBar'
import AppShell from '../../src/renderer/src/components/AppShell'
import SearchOverlay from '../../src/renderer/src/components/SearchOverlay'
import StatusBar from '../../src/renderer/src/components/StatusBar'
import WorkspaceView from '../../src/renderer/src/views/WorkspaceView'
import DiaryView from '../../src/renderer/src/views/DiaryView'
import MemoriesView from '../../src/renderer/src/views/MemoriesView'
import { useSearchStore } from '../../src/renderer/src/stores/search-store'
import { UndoNotice } from '../../src/renderer/src/components/ui/UndoNotice'
import { usePlanStore } from '../../src/renderer/src/stores/plan-store'
import { useTreeStore } from '../../src/renderer/src/stores/tree-store'
import { useUiStore, confirmRemoveTree } from '../../src/renderer/src/stores/ui-store'
import { useAppStore } from '../../src/renderer/src/stores/app-store'
import { usePrefStore } from '../../src/renderer/src/stores/pref-store'
import type { PlanDocument } from '../../src/shared/plan-types'
import '../../src/renderer/src/styles/workspace.css'
import '../../src/renderer/src/styles/actions.css'
import { readAntdSemanticTheme } from '../../src/renderer/src/styles/antd-theme'
import { scoreColor, scoreTextColor } from '../../src/renderer/src/components/cards'

const sample: PlanDocument = { format_version: '1', created_at: '2026-09-16T00:00:00Z', updated_at: '2026-09-16T00:00:00Z', components: [
  { id: '11111111111111111111111111111111', type: 'task_list', payload: { title: '真实任务列表组件', items: [{ id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', title: '任务 A', status: 'not_started' }, { id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', title: '任务 B', status: 'not_started' }] } },
  { id: '22222222222222222222222222222222', type: 'multi_plan', payload: { title: '真实选项组件', options: [{ id: 'cccccccccccccccccccccccccccccccc', text: '选项 A', checked: false }, { id: 'dddddddddddddddddddddddddddddddd', text: '选项 B', checked: false }] } }
] }
let deleted = false
const bridge = {
  invoke: async (channel: string, payload?: unknown) => {
    if (channel === 'storage:savePlan') return { ok: true, data: { updated_at: new Date().toISOString() } }
    if (channel === 'storage:readPlan') return { ok: true, data: structuredClone(sample) }
    if (channel === 'storage:treeGetChildren') return { ok: true, data: deleted ? [] : [{ path: 'demo', name: 'demo', kind: 'plan', has_children: false }] }
    if (channel === 'storage:deletePlan') {
      deleted = true
      const host = window as unknown as { integration: { deleteCalls: number } }
      host.integration.deleteCalls++
      return { ok: true, data: {} }
    }
    if (channel === 'diary:ensure') return { ok: true, data: null }
    if (channel === 'diary:month') return { ok: true, data: { entries: [{ date: '2026-09-16', score: 82, notePreview: 'AppShell 响应式验收', compCount: 2 }] } }
    if (channel === 'diary:day') {
      const date = (payload as { date?: string } | undefined)?.date ?? '2026-09-16'
      return { ok: true, data: { date, components: [{ kind: 'note', label: '', excerpt: '全局宿主在切换后保持挂载' }] } }
    }
    if (channel === 'diary:memories') {
      const entry = { date: '2025-09-16', score: 76, notePreview: '去年的今天', compCount: 1 }
      return { ok: true, data: { today: '2026-09-16', history: [entry], onthisday: [entry], milestones: [{ ...entry, days: 365 }], random: entry } }
    }
    throw new Error(`隔离宿主拒绝未支持 IPC: ${channel}`)
  },
  on: () => () => undefined
}
Object.assign(window, { trace: bridge })
usePrefStore.persist.setOptions({ storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined } })
function reset(): void {
  deleted = false
  usePlanStore.getState().close()
  usePlanStore.setState({ currentPath: 'demo', document: structuredClone(sample), serverUpdatedAt: sample.updated_at, saveState: 'idle' })
  useTreeStore.setState({ selectedPath: 'demo', selectedKind: 'plan', childrenMap: { '': [{ path: 'demo', name: 'demo', kind: 'plan', has_children: false }] }, loaded: { '': true }, expandedKeys: [''] })
  usePrefStore.setState({ customPresets: [{ id: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', name: 'QA 预设', content: '快照内容' }] })
}
reset()
Object.assign(window, { integration: { reset, plan: usePlanStore, app: useAppStore, pref: usePrefStore, ui: useUiStore, tree: useTreeStore, search: useSearchStore, scoreColor, scoreTextColor, confirmRemoveTree, treeDeletes: 0, deleteCalls: 0 } })
function Host(): React.JSX.Element {
  const { modal, message } = AntdApp.useApp()
  useEffect(() => bindAntdHost(modal, message), [modal, message])
  const foundation = new URLSearchParams(location.search).has('foundation')
  return <>{foundation && <><TopBar /><div><Button id="antd-primary-probe" type="primary">确认</Button><Button id="antd-danger-probe" type="primary" danger>删除</Button><Button id="antd-danger-text-probe" type="text" danger>危险操作</Button><Button id="antd-primary-link-probe" type="link">链接</Button><Typography.Text id="antd-error-text-probe" type="danger">保存错误</Typography.Text></div></>}<div style={{ display: 'flex', minHeight: 0, flex: 1 }}><aside className="ws-tree"><PlanTreePanel /></aside><ContentArea /></div>{foundation && <><StatusBar /><SearchOverlay /></>}<UndoNotice /></>
}
function ShellHost(): React.JSX.Element {
  const { modal, message } = AntdApp.useApp()
  const view = useUiStore((state) => state.view)
  const rootDir = useAppStore((state) => state.rootDir)
  useEffect(() => bindAntdHost(modal, message), [modal, message])

  return (
    <>
      <AppShell showStatus={view === 'workspace'} className={`app-shell--${view}`}>
        {view === 'diary' ? (
          <DiaryView key={rootDir ?? 'none'} onOpenInTree={() => undefined} />
        ) : view === 'memories' ? (
          <MemoriesView key={rootDir ?? 'none'} onOpenInTree={() => undefined} />
        ) : (
          <WorkspaceView />
        )}
      </AppShell>
      <div id="shell-global-host">
        <SearchOverlay />
        <UndoNotice />
      </div>
    </>
  )
}
function Harness(): React.JSX.Element {
  const [dark, setDark] = useState(false)
  const shell = new URLSearchParams(location.search).has('shell')
  return <ConfigProvider theme={{ ...readAntdSemanticTheme(), algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm }}><AntdApp>{shell ? <ShellHost /> : <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}><header style={{ padding: 12, display: 'flex', gap: 16 }}><strong>正式组件集成验收 / 仅内存</strong><button id="toggle-theme" onClick={() => { document.documentElement.classList.toggle('theme-dark', !dark); setDark(!dark) }}>切主题</button><button id="reset-sample" onClick={reset}>重置样本</button></header><Host /></div>}</AntdApp></ConfigProvider>
}
createRoot(document.getElementById('root')!).render(<Harness />)
