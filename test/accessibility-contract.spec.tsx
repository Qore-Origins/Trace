import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ActionButton } from '../src/renderer/src/components/ui/ActionButton'

describe('ActionButton 语义契约', () => {
  it('图标动作有可访问名称和原生 button 类型', () => {
    const html = renderToStaticMarkup(createElement(ActionButton, { intent: 'icon', label: '删除任务', icon: createElement('span', null, 'X'), onClick: () => undefined }))
    expect(html).toContain('aria-label="删除任务"')
    expect(html).toContain('type="button"')
    expect(html).toContain('title="删除任务"')
  })
  it('非图标动作显示具体文字', () => {
    for (const intent of ['primary', 'secondary', 'quiet', 'danger'] as const) {
      expect(renderToStaticMarkup(createElement(ActionButton, { intent, label: '确认保存', onClick: () => undefined }))).toContain('确认保存')
    }
  })
  it('loading 禁止重复点击并暴露忙碌状态', () => {
    const html = renderToStaticMarkup(createElement(ActionButton, { intent: 'primary', label: '保存', loading: true, onClick: () => undefined }))
    expect(html).toContain('disabled=""')
    expect(html).toContain('aria-busy="true"')
  })
})
