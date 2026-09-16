import type { ThemeConfig } from 'antd'

// CSS 语义色是真源；antd 算法需要已解析颜色，不能直接消费 var()。
export function readAntdSemanticTheme(): ThemeConfig {
  const style = getComputedStyle(document.documentElement)
  const color = (name: string): string => style.getPropertyValue(name).trim()
  const primary = color('--trace-700')
  const dangerText = color('--danger-text')
  const link = color('--link')
  const onPrimary = color('--on-primary')
  return {
    token: {
      colorPrimary: primary,
      colorPrimaryText: link,
      colorPrimaryTextHover: link,
      colorPrimaryTextActive: link,
      colorError: dangerText,
      colorErrorText: dangerText,
      colorErrorTextHover: dangerText,
      colorErrorTextActive: dangerText,
      colorLink: link,
      colorLinkHover: link,
      colorLinkActive: link
    },
    components: {
      Button: {
        colorPrimary: link,
        colorPrimaryHover: link,
        colorPrimaryActive: link,
        primaryColor: onPrimary,
        colorError: dangerText,
        colorErrorHover: dangerText,
        colorErrorActive: dangerText,
        dangerColor: onPrimary
      }
    }
  }
}
