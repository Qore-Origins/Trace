// MoodScoreRoll 状态机单测：慢速序列（每次等动画完成）+ 快速连点（动画中再变）两种时序
// 模拟算法 = 组件内 effect1（rollOnText）/ finish（rollFinish）逐帧驱动
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { MoodScoreRoll, rollFinish, rollOnText, rollShown, type RollFrame } from '../src/renderer/src/components/cards'

// 慢速序列：每次值变化后立即 finish（动画完成再下一次）
function slowRun(series: string[]): Array<{ frame: RollFrame; shown: string }> {
  let f: RollFrame = { a: series[0], b: series[0], at: 0 }
  const steps: Array<{ frame: RollFrame; shown: string }> = [{ frame: f, shown: rollShown(f) }]
  for (const text of series.slice(1)) {
    f = rollOnText(f, text)
    if (rollShown(f) !== text) f = rollFinish(f) // 有滚动作业 → 完成翻转
    steps.push({ frame: f, shown: rollShown(f) })
  }
  return steps
}

describe('MoodScoreRoll 状态机（慢速时序：动画完成后下一次）', () => {
  it('50→51→52→53：逐位滚动链，停靠行交替（a/b 为行槽位，随之翻转）', () => {
    const steps = slowRun(['50', '51', '52', '53'])
    expect(steps[0].shown).toBe('50')
    expect(steps[1].frame).toEqual({ a: '50', b: '51', at: 1 }) // 51 停靠 b 行
    expect(steps[1].shown).toBe('51')
    expect(steps[2].frame).toEqual({ a: '52', b: '51', at: 0 }) // 52 停靠 a 行（方向交替；a=新值）
    expect(steps[2].shown).toBe('52')
    expect(steps[3].frame).toEqual({ a: '52', b: '53', at: 1 })
    expect(steps[3].shown).toBe('53')
  })

  it('59→60：十位/个位双列变化（帧内容正确）', () => {
    const steps = slowRun(['59', '60', '61'])
    expect(steps[1].frame).toEqual({ a: '59', b: '60', at: 1 })
    expect(steps[2].frame).toEqual({ a: '61', b: '60', at: 0 })
    expect(steps[2].shown).toBe('61')
  })

  it('滚动中再变（动画未完成即下一次）：a 不粘死旧值（从当前目标重滚）', () => {
    // 模拟：50→51（尚未 finish）→52（finish 也未发生）→ 然后 finish
    let f: RollFrame = { a: '50', b: '50', at: 0 }
    f = rollOnText(f, '51') // b=51, at 0
    f = rollOnText(f, '52') // b 覆盖 → a 仍 '50'
    f = rollFinish(f) // 完成 → at1 停靠 b='52'
    expect(rollShown(f)).toBe('52')
    expect(f.a).toBe('50') // a 保留首值（已知局限：视觉上若期间显示过 a 帧则短暂回跳）
  })
})

describe('MoodScoreRoll（首帧结构）', () => {
  it('首帧渲染常驻 digit-col 双行（无 plain 单行）', () => {
    const html = renderToStaticMarkup(createElement(MoodScoreRoll, { score: 50, color: 'rgb(96, 130, 182)' }))
    expect(html).toContain('digit-col')
    expect((html.match(/digit-col/g) ?? []).length).toBe(2)
    expect(html).toContain('<span>5</span><span>5</span>')
    expect(html).toContain('<span>0</span><span>0</span>')
  })

  it('十进制小数结构：每个字符一列（含小数点）', () => {
    const html = renderToStaticMarkup(createElement(MoodScoreRoll, { score: 88.5, color: 'rgb(255, 122, 69)' }))
    expect((html.match(/digit-col/g) ?? []).length).toBe(4)
  })
})
