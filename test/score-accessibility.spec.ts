import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as cards from '../src/renderer/src/components/cards'
const tokens = readFileSync('src/renderer/src/styles/tokens.css', 'utf8')
function rgb(hex: string): number[] { return hex.match(/[a-f\d]{2}/gi)!.map(n => parseInt(n, 16)) }
function luminance(channels: number[]): number {
  const c = channels.map(n => { const v=n/255; return v<=.04045?v/12.92:((v+.055)/1.055)**2.4 })
  return c[0]*.2126+c[1]*.7152+c[2]*.0722
}
function contrast(a: number[], b: number[]): number {
  const x=luminance(a),y=luminance(b)
  return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)
}
describe('continuous score accessibility', () => {
  it('keeps syntax highlighting readable on the code surface in both themes', () => {
    let theme: Record<string,string>={}
    const blocks=[...tokens.matchAll(/(?:\:root|html\.theme-dark)\s*\{([^}]+)\}/g)]
    expect(blocks).toHaveLength(2)
    for (const block of blocks) {
      theme={...theme,...Object.fromEntries([...block[1].matchAll(/--([\w-]+):\s*(#[a-f\d]{6})/gi)].map(m=>[m[1],m[2]]))}
      for (const token of ['hl-keyword','hl-string','hl-comment','hl-number','hl-title','hl-type']) expect(contrast(rgb(theme[token]),rgb(theme['code-bg'])),token).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('keeps score information and badge text readable for every hundredth in both themes', () => {
    const helper=(cards as unknown as Record<string,(score:number)=>string>).scoreTextColor
    expect(helper).toBeTypeOf('function')
    let theme: Record<string,string>={}
    let minimum=Infinity
    for (const block of tokens.matchAll(/(?:\:root|html\.theme-dark)\s*\{([^}]+)\}/g)) {
      theme={...theme,...Object.fromEntries([...block[1].matchAll(/--([\w-]+):\s*(#[a-f\d]{6})/gi)].map(m=>[m[1],m[2]]))}
      expect(theme['score-badge-ink']).toBeDefined()
      for (let hundredth=0;hundredth<=10000;hundredth++) {
        const score=hundredth/100
        const original=cards.scoreColor(score).match(/\d+/g)!.map(Number)
        const expression=helper(score)
        const match=expression.match(/color-mix\(in srgb, rgb\((\d+), (\d+), (\d+)\) (\d+)%, var\(--text-1\)\)/)!
        expect(match).not.toBeNull()
        const weight=Number(match[4])/100
        const ink=rgb(theme['text-1'])
        const blended=original.map((channel,i)=>channel*weight+ink[i]*(1-weight))
        for (const surface of ['paper','paper-dim','fill','trace-bg']) minimum=Math.min(minimum,contrast(blended,rgb(theme[surface])))
        minimum=Math.min(minimum,contrast(original,rgb(theme['score-badge-ink'])))
      }
    }
    expect(minimum).toBeGreaterThanOrEqual(4.5)
  })
})
