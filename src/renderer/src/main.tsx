import React, { useEffect, useSyncExternalStore } from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider, theme as antdTheme, unstableSetRender } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import enUS from 'antd/locale/en_US'
import { I18nextProvider } from 'react-i18next'
import App from './App'
import { i18n } from './i18n'
import { usePrefStore, type ThemeMode } from './stores/pref-store'
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

// 系统暗色偏好订阅（theme='system' 时实时联动；useSyncExternalStore 供 React 感知外部源变化）
function subscribeSystemDark(cb: () => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
function getSystemDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function resolveDark(theme: ThemeMode, systemDark: boolean): boolean {
  return theme === 'dark' || (theme === 'system' && systemDark)
}

// antd locale/主题随偏好联动（内置组件文案 + 暗色算法）；
// dataset.theme 同步驱动 workspace.css 的变量映射（--paper/--text-* 等在 .theme-dark 下换暗色值）。
// 切换瞬间挂 .theme-transitioning（全局颜色属性过渡 240ms，CSS 见 workspace.css）——
// 平时不启用（零开销、不干扰既有 hover/交互动画）；首挂载跳过（初始渲染无需过渡）
function AntdGate({ children }: { children: React.ReactNode }): React.JSX.Element {
  const language = usePrefStore((s) => s.language)
  const themeMode = usePrefStore((s) => s.theme)
  const systemDark = useSyncExternalStore(subscribeSystemDark, getSystemDark, getSystemDark)
  const dark = resolveDark(themeMode, systemDark)
  const firstThemeRun = React.useRef(true)
  useEffect(() => {
    document.documentElement.classList.toggle('theme-dark', dark)
    if (firstThemeRun.current) {
      firstThemeRun.current = false
      return
    }
    const root = document.documentElement
    root.classList.add('theme-transitioning')
    const t = window.setTimeout(() => root.classList.remove('theme-transitioning'), 550)
    return () => window.clearTimeout(t)
  }, [dark])
  return (
    <ConfigProvider
      locale={language === 'en-US' ? enUS : zhCN}
      theme={{
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: { colorPrimary: '#1677ff' }
      }}
    >
      {children}
    </ConfigProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <AntdGate>
        <App />
      </AntdGate>
    </I18nextProvider>
  </React.StrictMode>
)

// DEV 诊断探针：把 store 挂到 window 供主进程 executeJavaScript 做用户旅程级验证（不进生产包路径判断）
if (import.meta.env.DEV) {
  void import('./stores/tree-store').then((m) => {
    ;(window as unknown as Record<string, unknown>).__tree = m.useTreeStore
  })
}
