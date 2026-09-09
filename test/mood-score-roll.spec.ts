// MoodScoreRoll 结构单测（SSR 首帧）：常驻列结构 = 滚动不再"消失又出现"的根基
// （此前故障：滚动帧为折叠帧（plain）后新挂载，CSS transition 不触发——只显示"替换瞬变"）
// 断言首帧即渲染 digit-col 双行结构（而非 plain 单行），且未变化位字符两行一致（不滚）
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { MoodScoreRoll } from '../src/renderer/src/components/cards'

describe('MoodScoreRoll（首帧结构）', () => {
  it('首帧渲染常驻 digit-col 双行（无 mood-count-plain）', () => {
    const html = renderToStaticMarkup(createElement(MoodScoreRoll, { score: 50, color: 'rgb(96, 130, 182)' }))
    expect(html).toContain('digit-col')
    expect(html).not.toContain('mood-count-plain')
    // 两位（'5','0'）：各列内部两行（相同字符——未变化=不滚）
    const colCount = (html.match(/digit-col/g) ?? []).length
    expect(colCount).toBe(2)
    // 每列两行内容一致（未变化=不滚；列结构常驻）
    expect(html).toContain('<span>5</span><span>5</span>')
    expect(html).toContain('<span>0</span><span>0</span>')
  })

  it('十进制小数结构：每个字符一列（含小数点', () => {
    const html = renderToStaticMarkup(createElement(MoodScoreRoll, { score: 88.5, color: 'rgb(255, 122, 69)' }))
    expect((html.match(/digit-col/g) ?? []).length).toBe(4) // '8','8','.','5'
  })
})
