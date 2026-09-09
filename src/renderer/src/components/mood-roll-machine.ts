// mood-roll-machine：心情分数轮带（V1 轮带式定稿）纯状态机——布局规范串 + 逐列物理索引
// 定稿出处 demo/mood-score-roll-demo.html（2026-09-09 用户定案：V2 翻页式剔除，仅 轮带式/无动画 两项）
// 无 DOM/无 React，行为可单测（test/mood-roll.spec.ts）；DOM 执行层见 mood-score-roll.tsx
//
// 设计要点（与 demo 一致）：
//   - 布局规范串：d = max(当前小数位, 目标小数位)——进位尾 0 保留（45.29+0.01 → 45.30）
//   - 每列记录物理位置 phys（绝对索引），短路径绕行（差 >5 反向，0↔9 只滚 1 格）——
//     修复"进位停在 0 复制槽、链式下一次滚动空跳"的历史瞬变（旧实现按数字反推索引）
//   - 结构增长（新增列）→ insert：先建补齐起点（新列 0）再滚到目标；
//     结构缩减（整数位变少）→ shrink：在共同大结构上滚动（toFilled 前导补 0，100→099），
//     滚动完成后移除多余前导列——机械计数器无"缩短"，任何值变化都有滚动
//   - 值先 norm（±2dp）防浮点串化进入格式决策

const BLOCKS = 12 // 初始 0-9 块数
const BLOCK_ROWS = 10 // 每块行数
export const ROLL_INIT_ROWS = BLOCKS * BLOCK_ROWS
export const CENTER = BLOCKS * 5 // 初始 phys = CENTER + 数字（±50 链式余量）

export interface ColState {
  phys: number // 当前物理行索引（strip 内绝对位置）
  rows: number // 当前行数（底部溢出时追加块）
}

export interface ColumnRoll {
  from: number // 起点数字
  to: number // 目标数字
  phys: number // 滚动后物理索引
  rows: number // 滚动后行数
  rebuildCol: boolean // 顶部溢出兜底：整列重建居中（需 50+ 次连续向下绕行，实际不可达）
}

export type RollAction = 'noop' | 'roll' | 'insert' | 'shrink'

export interface RollCommit {
  action: RollAction
  buildStr: string // insert/shrink 需要重建起点时（如 100→99.9 需先补出 .0）；其余空
  startCols: ColState[] // 重建时各列的定位（phys 初始索引）
  transitions: ColumnRoll[] // 逐列滚动（noop 空；shrink 含前导列 1→0 段）
  removeCols: number // 仅 shrink：滚动完成后移除的前导列数（DOM 延时收尾）
  requireReflow: boolean // 插入列需先强制 reflow 提交起点样式再滚（新列过渡起点）
}

export interface RollState {
  str: string // 当前显示规范串（最后目标语义）
  sig: string // 结构签名 '整数位.小数位'
  cols: ColState[] // 与 odom 列一一对应（不含小数点）
}

function decCount(s: string): number {
  const i = s.indexOf('.')
  return i === -1 ? 0 : s.length - i - 1
}

function intLen(s: string): number {
  const i = s.indexOf('.')
  return i === -1 ? s.length : i
}

function sigOf(s: string): string {
  return `${intLen(s)}.${decCount(s)}`
}

// 值 → 规范串：d 位小数（不足补 0；d ≥ 值自带小数位，保证不截断）
function fmtVal(val: number, d: number): string {
  const [iPart, dPart = ''] = String(val).split('.')
  return d > 0 ? `${iPart}.${dPart.padEnd(d, '0')}` : iPart
}

// 旧显示串 → 目标结构下的补齐串（整数字左补 0，小数右补 0）
function fmtPadded(s: string, toIntLen: number, toDecLen: number): string {
  const [iPart, dPart = ''] = s.split('.')
  const ints = iPart.padStart(toIntLen, '0')
  return toDecLen > 0 ? `${ints}.${dPart.padEnd(toDecLen, '0')}` : ints
}

function digitsOf(s: string): number[] {
  return [...s].filter((c) => c !== '.').map(Number)
}

function buildCols(str: string): ColState[] {
  return digitsOf(str).map((d) => ({ phys: CENTER + d, rows: ROLL_INIT_ROWS }))
}

// 短路径差：±5 内取直；否则反向绕 +10（0↔9 只滚 1 格）
function diffShort(n: number): number {
  if (n > 5) return n - 10
  if (n < -5) return n + 10
  return n
}

// 逐列计算滚动（from/to 结构一致——含补齐）
function rollPairs(fromStr: string, toStr: string, cols: ColState[]): { transitions: ColumnRoll[]; cols: ColState[] } {
  const f = digitsOf(fromStr)
  const t = digitsOf(toStr)
  const transitions: ColumnRoll[] = []
  const out: ColState[] = []
  for (let i = 0; i < t.length; i++) {
    const fd = f[i]
    const td = t[i]
    let phys = cols[i].phys + diffShort(td - fd)
    let rows = cols[i].rows
    let rebuildCol = false
    if (phys < 2) {
      rebuildCol = true
      phys = CENTER + td
      rows = ROLL_INIT_ROWS
    } else if (phys > rows - 2) {
      rows += BLOCK_ROWS // 底部溢出：追加块（DOM 侧执行，无视觉跳变）
    }
    out.push({ phys, rows })
    transitions.push({ from: fd, to: td, phys, rows, rebuildCol })
  }
  return { transitions, cols: out }
}

export function initRollState(str: string): RollState {
  return { str, sig: sigOf(str), cols: buildCols(str) }
}

// 状态推进：给出动作与终态（DOM 层按要求执行；toValue 先 norm 防浮点串化）
export function stepRoll(state: RollState, toValue: number): { commit: RollCommit; state: RollState } {
  const v = Math.round(toValue * 100) / 100
  const fromStr = state.str
  const toStr = fmtVal(v, Math.max(decCount(fromStr), decCount(String(v))))
  if (toStr === fromStr) {
    return { commit: { action: 'noop', buildStr: '', startCols: [], transitions: [], removeCols: 0, requireReflow: false }, state }
  }
  if (intLen(fromStr) > intLen(toStr)) {
    // 结构缩减：在共同大结构上滚动（toStr 前导补 0），滚动后移除多余前导列
    const dec = decCount(toStr)
    const fromFilled = fmtPadded(fromStr, intLen(fromStr), dec) // '100' → '100.0'（dec 同时增长时）
    const toFilled = fmtPadded(toStr, intLen(fromStr), dec) // '99.9' → '099.9'
    const needBuild = fromFilled !== fromStr
    const cols0 = needBuild ? buildCols(fromFilled) : state.cols
    const r = rollPairs(fromFilled, toFilled, cols0)
    const removeCols = intLen(fromStr) - intLen(toStr)
    const { transitions, cols } = r
    return {
      commit: {
        action: 'shrink',
        buildStr: needBuild ? fromFilled : '',
        startCols: needBuild ? cols0 : [],
        transitions,
        removeCols,
        requireReflow: needBuild
      },
      state: { str: toStr, sig: sigOf(toStr), cols: cols.slice(removeCols) }
    }
  }
  const fromPadded = fmtPadded(fromStr, intLen(toStr), decCount(toStr))
  if (sigOf(toStr) === state.sig) {
    // 同结构：逐列滚
    const r = rollPairs(fromPadded, toStr, state.cols)
    return {
      commit: { action: 'roll', buildStr: '', startCols: [], transitions: r.transitions, removeCols: 0, requireReflow: false },
      state: { str: toStr, sig: sigOf(toStr), cols: r.cols }
    }
  }
  // 结构增长：先建补齐起点（新列 0），再滚到目标
  const startCols = buildCols(fromPadded)
  const r = rollPairs(fromPadded, toStr, startCols)
  return {
    commit: { action: 'insert', buildStr: fromPadded, startCols, transitions: r.transitions, removeCols: 0, requireReflow: true },
    state: { str: toStr, sig: sigOf(toStr), cols: r.cols }
  }
}
