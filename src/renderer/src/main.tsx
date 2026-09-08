import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import enUS from 'antd/locale/en_US'
import { I18nextProvider } from 'react-i18next'
import App from './App'
import { i18n } from './i18n'
import { usePrefStore } from './stores/pref-store'
import './styles/workspace.css'

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
