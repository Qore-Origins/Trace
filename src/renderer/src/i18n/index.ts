// i18n 基建：i18next + react-i18next（本阶段 zh-CN / en-US；初始语言读偏好持久化，缺省中文）
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import zhCN from './locales/zh-CN'
import enUS from './locales/en-US'

export type AppLanguage = 'zh-CN' | 'en-US'

// 偏好在 pref-store（zustand persist）里；初始化前先读一次持久化值，避免首帧闪中文
function persistedLanguage(): AppLanguage {
  try {
    const raw = localStorage.getItem('trace-prefs')
    if (!raw) return 'zh-CN'
    const lng = (JSON.parse(raw) as { state?: { language?: string } }).state?.language
    return lng === 'en-US' ? 'en-US' : 'zh-CN'
  } catch {
    return 'zh-CN'
  }
}

void i18next.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    'en-US': { translation: enUS }
  },
  lng: persistedLanguage(),
  fallbackLng: 'zh-CN',
  interpolation: { escapeValue: false } // React 已转义
})

export const i18n = i18next
export { useTranslation } from 'react-i18next'
