// scoreColor 色阶单测（mood 卡唯一纯函数：≤30 冷 → ≥80 暖，线性夹逼）
import { describe, expect, it } from 'vitest'
import { scoreColor } from '../src/renderer/src/components/cards'

describe('scoreColor', () => {
  it('端点夹逼：0/30 冷端，80/100 暖端', () => {
    expect(scoreColor(0)).toBe('rgb(96, 130, 182)')
    expect(scoreColor(30)).toBe('rgb(96, 130, 182)')
    expect(scoreColor(80)).toBe('rgb(255, 122, 69)')
    expect(scoreColor(100)).toBe('rgb(255, 122, 69)')
  })
  it('中点线性插值（score=50 → t=0.4）', () => {
    expect(scoreColor(50)).toBe('rgb(160, 127, 137)')
  })
  it('越界夹逼（-10/120 不炸）', () => {
    expect(scoreColor(-10)).toBe('rgb(96, 130, 182)')
    expect(scoreColor(120)).toBe('rgb(255, 122, 69)')
  })
})
