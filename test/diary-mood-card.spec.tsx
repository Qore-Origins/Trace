// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Component, MoodPayload } from '../src/shared/plan-types'
import { MoodCard } from '../src/renderer/src/components/cards/MoodCard'
import { usePlanStore } from '../src/renderer/src/stores/plan-store'
import { usePrefStore } from '../src/renderer/src/stores/pref-store'

const MOOD_ID = '00000000000000000000000000000001'
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let previousActEnvironment: unknown
let previousScoreAnim: ReturnType<typeof usePrefStore.getState>['scoreAnim']

function BoundMoodCard(): React.JSX.Element {
  const comp = usePlanStore((state) => state.document?.components[0])
  if (!comp) throw new Error('Mood fixture must contain its component')
  return createElement(MoodCard, { comp, index: 0, total: 1, today: new Date('2026-09-28T00:00:00') })
}

async function renderScore(score: number | null): Promise<void> {
  const comp: Component = {
    id: MOOD_ID,
    type: 'mood',
    payload: { score, text: '', mood_date: '2026-09-28', created_at: '2026-09-28T00:00:00Z' }
  }
  usePlanStore.setState({
    currentPath: 'Diary/2026-09-28',
    document: { format_version: '1', created_at: '', updated_at: '', components: [comp] }
  })
  await act(async () => { root.render(createElement(BoundMoodCard)) })
}

function scoreInput(): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>('.mood-input input')
  if (!input) throw new Error('MoodCard input missing')
  return input
}

async function inputValue(value: string): Promise<void> {
  const input = scoreInput()
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!nativeSetter) throw new Error('Native input value setter missing')
  await act(async () => {
    nativeSetter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  previousActEnvironment = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  previousScoreAnim = usePrefStore.getState().scoreAnim
  usePrefStore.setState({ scoreAnim: 'roll' })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  usePlanStore.getState().close()
  usePrefStore.setState({ scoreAnim: previousScoreAnim })
  host.remove()
  if (previousActEnvironment === undefined) Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  else Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousActEnvironment)
})

describe('MoodCard nullable diary mood', () => {
  it('null 保持空白输入，不显示假分数、色阶或滚动轮带', async () => {
    await renderScore(null)
    expect(scoreInput().value).toBe('')
    expect(host.querySelector('.mood-score')?.textContent).toBe('')
    expect(host.querySelector<HTMLElement>('.mood-score')?.style.color).toBe('')
    expect(host.querySelector('.mood-score-roll')).toBeNull()
  })

  it('空白分数可直接填写数值，写入真实 store 并开始数值显示', async () => {
    await renderScore(null)
    await inputValue('72')
    const mood = usePlanStore.getState().document?.components[0].payload as MoodPayload
    expect(mood.score).toBe(72)
    expect(host.querySelector('.mood-score-roll')).not.toBeNull()
    expect(scoreInput().value).toBe('72.00')
  })

  it('清空已填数值保存 null，移除分数色阶及动画', async () => {
    await renderScore(72)
    expect(host.querySelector('.mood-score-roll')).not.toBeNull()
    await inputValue('')
    const mood = usePlanStore.getState().document?.components[0].payload as MoodPayload
    expect(mood.score).toBeNull()
    expect(scoreInput().value).toBe('')
    expect(host.querySelector('.mood-score-roll')).toBeNull()
    expect(host.querySelector<HTMLElement>('.mood-score')?.style.color).toBe('')
  })

  it('真实 0 分仍显示，关闭动画后保留既有数字', async () => {
    usePrefStore.setState({ scoreAnim: 'none' })
    await renderScore(0)
    expect(host.querySelector('.mood-score')?.textContent).toBe('0')
    expect(scoreInput().value).toBe('0.00')
  })
})
