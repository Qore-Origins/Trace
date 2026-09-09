// mood-score-roll：心情分数轮带显示（V1 轮带式定稿移植；demo: demo/mood-score-roll-demo.html）
// DOM 执行层：机器层（mood-roll-machine）产出动作与终态，本层绝对执行（值改 DOM 不重渲染）。
// 结构与 CSS 类：.mood-score-roll > .roll-col（每列 0-9 循环带）> .roll-strip > span
// 注意事项：
//   - 列容器必须为 flex（非替换 inline 不可变换，见 ERROR 库 inline-span-transform-ignored）
//   - insert（结构增长）需先 force reflow 提交起点样式，否则新建列 transition 不触发
import { useEffect, useRef, useState } from 'react'
import {
  ROLL_INIT_ROWS,
  initRollState,
  stepRoll,
  type ColState,
  type RollCommit,
  type RollState
} from './mood-roll-machine'

const LINE = 32 // 行高（workspace.css .mood-score-roll 行高 32px）
const BLOCKS = 12 // 初始 0-9 块数（与机器 ROLL_INIT_ROWS 对应）

function appendBlock(strip: HTMLElement): void {
  const frag = document.createDocumentFragment()
  for (let i = 0; i < 10; i++) {
    const s = document.createElement('span')
    s.textContent = String(i)
    frag.appendChild(s)
  }
  strip.appendChild(frag)
}

function buildFrame(el: HTMLElement, str: string, cols: ColState[]): void {
  el.innerHTML = ''
  let ci = 0
  for (const ch of str) {
    if (ch === '.') {
      const p = document.createElement('span')
      p.className = 'roll-point'
      p.textContent = '.'
      el.appendChild(p)
      continue
    }
    const col = document.createElement('span')
    col.className = 'roll-col'
    const strip = document.createElement('span')
    strip.className = 'roll-strip'
    for (let b = 0; b < BLOCKS; b++) appendBlock(strip)
    strip.style.transform = `translateY(-${cols[ci].phys * LINE}px)`
    col.appendChild(strip)
    el.appendChild(col)
    ci++
  }
}

function applyCommit(el: HTMLElement, commit: RollCommit): void {
  let builtRows: number[] | null = null
  if (commit.action === 'rebuild' || commit.action === 'insert') {
    buildFrame(el, commit.buildStr, commit.startCols)
    builtRows = commit.startCols.map(() => ROLL_INIT_ROWS)
    if (commit.requireReflow) void el.offsetWidth // 新列过渡起点提交（插入列 0→x 才能起 transition）
  }
  if (commit.transitions.length === 0) return
  const cols = el.querySelectorAll('.roll-col')
  builtRows = builtRows ?? new Array(cols.length).fill(ROLL_INIT_ROWS)
  commit.transitions.forEach((tr, i) => {
    const strip = cols[i].querySelector('.roll-strip') as HTMLElement
    if (tr.rebuildCol) {
      // 顶部溢出兜底：整列重建居中（机器层判定，需 50+ 次连续向下绕行，实际不可达）
      strip.replaceChildren()
      for (let b = 0; b < BLOCKS; b++) appendBlock(strip)
      builtRows![i] = ROLL_INIT_ROWS
    } else if (tr.rows > builtRows![i]) {
      appendBlock(strip)
      builtRows![i] += 10
    }
    strip.style.transform = `translateY(-${tr.phys * LINE}px)`
  })
}

export function MoodScoreRoll({ value }: { value: number }): React.JSX.Element {
  const elRef = useRef<HTMLSpanElement | null>(null)
  const stRef = useRef<RollState | null>(null)
  const [reduced] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )

  // 挂载：以当前值为显示串建轮盘（本地显示状态，不随 store 渲染重建）
  useEffect(() => {
    const el = elRef.current
    if (!el || stRef.current) return
    const init = initRollState(String(value))
    stRef.current = init
    buildFrame(el, init.str, init.cols)
    return () => {
      stRef.current = null
      el.innerHTML = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // value 变化：机器出动作 → DOM 执行
  useEffect(() => {
    if (reduced) return
    const el = elRef.current
    const st = stRef.current
    if (!el || !st) return
    const { commit, state } = stepRoll(st, value)
    if (commit.action === 'noop') return
    applyCommit(el, commit)
    stRef.current = state
  }, [value, reduced])

  if (reduced) return <span>{value}</span>
  return <span className="mood-score-roll" ref={elRef} />
}
