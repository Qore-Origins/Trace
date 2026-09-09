import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider, unstableSetRender } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import enUS from 'antd/locale/en_US'
import { I18nextProvider } from 'react-i18next'
import App from './App'
import { i18n } from './i18n'
import { usePrefStore } from './stores/pref-store'
import './styles/workspace.css'

// antd v5 静态方法（Modal.confirm/message 等）默认走 ReactDOM.render，React 19 已移除 → 静默不渲染
// （2026-09-08 删除无效根因：点删除后确认弹窗从未出现）。按官方 v5-for-19 指引注入 createRoot 渲染器
const staticRoots = new WeakMap<HTMLElement, ReturnType<typeof ReactDOM.createRoot>>()
unstableSetRender((node, container) => {
  // antd 静态容器运行时必为 div（类型声明放宽为 Element | DocumentFragment，此处收敛）
  const host = container as HTMLElement
  let root = staticRoots.get(host)
  if (!root) {
    root = ReactDOM.createRoot(host)
    staticRoots.set(host, root)
  }
  root.render(node)
  return async () => {
    await new Promise((r) => setTimeout(r, 0))
    root?.unmount()
  }
})

// antd locale 随偏好语言联动（内置组件文案：Modal 按钮/Empty/日期等）
function AntdLocaleGate({ children }: { children: React.ReactNode }): React.JSX.Element {
  const language = usePrefStore((s) => s.language)
  return <ConfigProvider locale={language === 'en-US' ? enUS : zhCN}>{children}</ConfigProvider>
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <AntdLocaleGate>
        <App />
      </AntdLocaleGate>
    </I18nextProvider>
  </React.StrictMode>
)

// DEV 诊断探针：把 store 挂到 window 供主进程 executeJavaScript 做用户旅程级验证（不进生产包路径判断）
if (import.meta.env.DEV) {
  void import('./stores/tree-store').then((m) => {
    ;(window as unknown as Record<string, unknown>).__tree = m.useTreeStore
  })
}
