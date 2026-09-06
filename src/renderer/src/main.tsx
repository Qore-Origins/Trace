import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import './styles/workspace.css'

// UI 设计规范 §2：antd v5 默认主题（不覆盖 token），中文 locale
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN}>
      <App />
    </ConfigProvider>
  </React.StrictMode>
)

// DEV 诊断探针：把 store 挂到 window 供主进程 executeJavaScript 做用户旅程级验证（不进生产包路径判断）
if (import.meta.env.DEV) {
  void import('./stores/tree-store').then((m) => {
    ;(window as unknown as Record<string, unknown>).__tree = m.useTreeStore
  })
}
