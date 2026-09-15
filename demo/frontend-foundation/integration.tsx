// 正式组件浏览器验收宿主；所有 IPC 在此替换为内存桥，不启动真实 Electron/计划库。
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App as AntdApp, ConfigProvider, theme } from 'antd'
import { bindAntdHost } from '../../src/renderer/src/antd-host'
import ContentArea from '../../src/renderer/src/components/ContentArea'
import PlanTreePanel from '../../src/renderer/src/components/PlanTreePanel'
import { UndoNotice } from '../../src/renderer/src/components/ui/UndoNotice'
import { usePlanStore } from '../../src/renderer/src/stores/plan-store'
import { useTreeStore } from '../../src/renderer/src/stores/tree-store'
import { useUiStore, confirmRemoveTree } from '../../src/renderer/src/stores/ui-store'
import { useAppStore } from '../../src/renderer/src/stores/app-store'
import { usePrefStore } from '../../src/renderer/src/stores/pref-store'
import type { PlanDocument } from '../../src/shared/plan-types'
import '../../src/renderer/src/styles/workspace.css'
import '../../src/renderer/src/styles/actions.css'

const sample: PlanDocument = { format_version: '1', created_at: '2026-09-16T00:00:00Z', updated_at: '2026-09-16T00:00:00Z', components: [
  { id: '11111111111111111111111111111111', type: 'task_list', payload: { title: '真实任务列表组件', items: [{ id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', title: '任务 A', status: 'not_started' }, { id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', title: '任务 B', status: 'not_started' }] } },
  { id: '22222222222222222222222222222222', type: 'multi_plan', payload: { title: '真实选项组件', options: [{ id: 'cccccccccccccccccccccccccccccccc', text: '选项 A', checked: false }, { id: 'dddddddddddddddddddddddddddddddd', text: '选项 B', checked: false }] } }
] }
const bridge = {
  invoke: async (channel: string) => {
    if (channel === 'storage:savePlan') return { ok: true, data: { updated_at: new Date().toISOString() } }
    if (channel === 'storage:readPlan') return { ok: true, data: structuredClone(sample) }
    if (channel === 'storage:treeGetChildren') return { ok: true, data: [{ path: 'demo', name: 'demo', kind: 'plan', has_children: false }] }
    throw new Error(`隔离宿主拒绝未支持 IPC: ${channel}`)
  },
  on: () => () => undefined
}
Object.assign(window, { trace: bridge })
usePrefStore.persist.setOptions({ storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined } })
function reset(): void {
  usePlanStore.getState().close()
  usePlanStore.setState({ currentPath: 'demo', document: structuredClone(sample), serverUpdatedAt: sample.updated_at, saveState: 'idle' })
  useTreeStore.setState({ selectedPath: 'demo', selectedKind: 'plan', childrenMap: { '': [{ path: 'demo', name: 'demo', kind: 'plan', has_children: false }] }, loaded: { '': true }, expandedKeys: [''] })
  usePrefStore.setState({ customPresets: [{ id: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', name: 'QA 预设', content: '快照内容' }] })
}
reset()
Object.assign(window, { integration: { reset, plan: usePlanStore, app: useAppStore, pref: usePrefStore, ui: useUiStore, confirmRemoveTree, treeDeletes: 0 } })
function Host(): React.JSX.Element {
  const { modal, message } = AntdApp.useApp()
  useEffect(() => bindAntdHost(modal, message), [modal, message])
  return <><div style={{ display: 'flex', minHeight: 0, flex: 1 }}><aside className="ws-tree"><PlanTreePanel /></aside><ContentArea /></div><UndoNotice /></>
}
function Harness(): React.JSX.Element {
  const [dark, setDark] = useState(false)
  return <ConfigProvider theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm }}><AntdApp><div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}><header style={{ padding: 12, display: 'flex', gap: 16 }}><strong>正式组件集成验收 / 仅内存</strong><button id="toggle-theme" onClick={() => { document.documentElement.classList.toggle('theme-dark', !dark); setDark(!dark) }}>切主题</button><button id="reset-sample" onClick={reset}>重置样本</button></header><Host /></div></AntdApp></ConfigProvider>
}
createRoot(document.getElementById('root')!).render(<Harness />)
