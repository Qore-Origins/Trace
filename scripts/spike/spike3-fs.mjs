// SPIKE-3: 跨盘移动策略 与 Windows 长路径实测
// 运行：node scripts/spike/spike3-fs.mjs
import { rename, mkdir, rm, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const TMP_D = 'D:\\__trace_spike_tmp'
const TMP_C = 'C:\\__trace_spike_tmp'

async function setup(dir) {
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
}
async function cleanup() {
  await rm(TMP_D, { recursive: true, force: true }).catch(() => {})
  await rm(TMP_C, { recursive: true, force: true }).catch(() => {})
}

// ---- 1. 跨盘 rename ----
async function crossDrive() {
  await setup(TMP_D)
  await setup(TMP_C)
  const src = join(TMP_D, 'plan-a')
  const dst = join(TMP_C, 'plan-a')
  await mkdir(src)
  await writeFile(join(src, 'plan.json'), '{}')
  try {
    await rename(src, dst)
    console.log('[跨盘 rename] 成功（未抛 EXDEV）——同 API 可直接跨盘')
    return 'direct'
  } catch (e) {
    console.log(`[跨盘 rename] 失败 code=${e.code}（预期 EXDEV）——需 fallback: copy+rm`)
    return 'fallback-needed'
  }
}

// ---- 2. 长路径（>260 字符）----
async function longPath() {
  // 构造约 300 字符的深层路径（根为 TEMP，避免污染仓库）
  const base = join(TMP_D, 'library')
  let deep = base
  const seg = '学期计划文件夹名足够长以测试路径限制abcdefgh'
  while (deep.length < 300) deep = join(deep, seg)
  try {
    await mkdir(deep, { recursive: true })
    await stat(deep)
    console.log(`[长路径] 成功创建 ${deep.length} 字符路径（LongPaths 生效或 Node 已启用长路径前缀）`)
    return `ok(${deep.length} chars)`
  } catch (e) {
    console.log(`[长路径] 失败 code=${e.code} msg=${e.message.slice(0, 80)}`)
    return `fail(${e.code})`
  } finally {
    await rm(base, { recursive: true, force: true }).catch(() => {})
  }
}

const cross = await crossDrive()
const long = await longPath()
await cleanup()
console.log(`SUMMARY: crossDrive=${cross} longPath=${long}`)
console.log('DONE_SPIKE3')
