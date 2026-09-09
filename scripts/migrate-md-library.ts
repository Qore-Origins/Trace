// 迁移脚本：旧 Markdown 计划库（D:\Desktop\Plan 格式）→ Trace 磁盘结构（一次性目录适配）
// 语义定案（2026-09-09 用户决策）：
//   1) 计划目录名 = 原文件 base 名（完整，含类型前缀，如 Daily_Plan-20260825-心情差迭代期）
//   2) 原始 .md 移入其计划目录（物理结构 = 树结构，一一对应）
//   3) 不可解析命名的 md（无日期/标题，如 Future_Plan-20260828-.md）→ 从内容一级标题提取标题，仍迁移
//   4) 执行前全量备份到 <库根>-backup-<YYYYMMDD>（回滚方案；已存在则复用=允许断点续跑）
//   5) 非 .md 文件（pdf/html 资源/网页 assets）原地不动；docs/、resource/、空目录保留为纯文件夹节点
// 转换逻辑复用 Trace 自身定典（transfer-service 的 markdownToPlanDocument / parseMdFileName），不复制。
// 用法：npm run migrate:md          （默认库根 D:/Desktop/Plan）
//       npm run migrate:md -- 库根  （其他旧库，planLibrary 需为 Trace 原生或为空）
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { PlanRepository } from '../src/main/services/plan-repository'
import { markdownToPlanDocument, parseMdFileName } from '../src/main/services/transfer-service'

const DEFAULT_ROOT = 'D:/Desktop/Plan'

async function main(): Promise<void> {
  const root = process.argv[2] ?? DEFAULT_ROOT
  const backupDir = `${root}-backup-20260909`

  // 0. 备份 + 只读探测（回滚方案就绪后才动数据）
  if (!(await exists(backupDir))) {
    console.log(`[1/4] 备份全量库 → ${backupDir}`)
    await fs.cp(root, backupDir, { recursive: true })
  } else {
    console.log(`[1/4] 备份已存在（复用）→ ${backupDir}`)
  }

  // 1. 扫描：收集所有 .md 文件（跳过隐藏/点前缀，与 treeGetChildren 规则一致；不进入备份目录）
  type MdEntry = { dir: string; name: string; mdAbs: string; base: string }
  const mds: MdEntry[] = []
  const stack: string[] = [root]
  while (stack.length > 0) {
    const dir = stack.pop() as string
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const abs = join(dir, e.name)
      if (e.isDirectory()) {
        stack.push(abs)
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        mds.push({ dir, name: e.name, mdAbs: abs, base: e.name.slice(0, -3) })
      }
    }
  }
  mds.sort((a, b) => (a.mdAbs < b.mdAbs ? -1 : 1))
  console.log(`[2/4] 发现 ${mds.length} 个 .md 文件`)

  // 2. 迁移：每个 md → 同名（base）目录 + plan.json + md 移入
  const repo = new PlanRepository()
  const report = { tasks: 0, notes: 0 }
  const done: Array<{ rel: string; renamed: boolean; titleSource: string }> = []
  const skipped: Array<{ rel: string; why: string }> = []

  for (const m of mds) {
    const relDir = m.dir.length > root.length ? m.dir.slice(root.length + 1) + '/' + m.base : m.base
    const targetDir = join(m.dir, m.base)
    const targetRel = relDir.replace(/\\/g, '/')
    // 幂等守卫：md 已在同名计划目录内（目录名=base 或目录含 plan.json）→ 视为已迁移，跳过（防二次嵌套）
    const insideOwnPlan = (await exists(join(m.dir, 'plan.json'))) || m.dir.endsWith(m.base)
    if (insideOwnPlan || (await exists(join(targetDir, 'plan.json')))) {
      skipped.push({ rel: targetRel, why: insideOwnPlan ? '已在计划目录内（疑似已迁移）' : '同目录已存在计划' })
      continue
    }

    const content = await fs.readFile(m.mdAbs, 'utf8')
    const parsed = parseMdFileName(m.base)
    let title: string
    let ymd: string
    if (parsed) {
      title = parsed.title
      ymd = parsed.ymd
    } else {
      // 兜底：内容一级标题（去类型前缀），无标题则用 base 名
      const h1 = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? ''
      title = h1.replace(/^[A-Za-z][A-Za-z0-9_\-]*?-\d{8}-(.+)$/, '$1') || m.base
      ymd = h1.match(/^\S*?(\d{8})/)?.[1] ?? ''
    }

    const doc = markdownToPlanDocument(title, ymd, content, report)
    await fs.mkdir(targetDir, { recursive: true })
    await repo.writePlanAtomic(root, targetRel, doc)
    await fs.rename(m.mdAbs, join(targetDir, m.name)) // 同盘 rename，跨盘风险不存在（库根内）
    done.push({ rel: targetRel, renamed: true, titleSource: parsed ? 'parseMdFileName' : 'content-h1' })
  }

  // 3. 自检：每个迁移目录 plan.json 可读且形状正确；md 已移入
  const bad: string[] = []
  for (const d of done) {
    try {
      const raw = JSON.parse(await fs.readFile(join(root, d.rel, 'plan.json'), 'utf8'))
      if (raw.format_version !== '1' || !Array.isArray(raw.components) || raw.components.length === 0) bad.push(d.rel)
      // 原始 md 已移入计划目录（目录内应存在同名 .md）
      const seg = d.rel.split('/').pop()
      if (!(await exists(join(root, d.rel, `${seg}.md`)))) bad.push(`${d.rel}（md 未移入）`)
    } catch {
      bad.push(d.rel)
    }
  }

  console.log(`[3/4] 迁移完成：${done.length} 个计划 / ${report.tasks} 个任务 / ${report.notes} 条保底注释 / 跳过 ${skipped.length}`)
  for (const s of skipped) console.log(`  - 跳过 ${s.rel}（${s.why}）`)
  if (bad.length > 0) {
    console.error('自检失败（plan.json 异常）：' + bad.join(', '))
    process.exitCode = 1
    return
  }
  console.log(`[4/4] 自检通过：plan.json 全部可读且含组件`)
  console.log('树结构（迁移后，[计划]/[文件夹]）：')
  console.log(await outline(root, backupDir))
}

// 树轮廓：目录拓扑 + 计划标记（与 Trace 树口径一致：目录可见、. 前缀隐藏、plan.json=计划）
async function outline(root: string, backupDir: string): Promise<string> {
  const lines: string[] = []
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const entries = (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    for (const e of entries) {
      if (e.name.startsWith('.') || !e.isDirectory() || join(dir, e.name).startsWith(backupDir)) continue
      const kind = (await exists(join(dir, e.name, 'plan.json'))) ? '计划' : '文件夹'
      lines.push(`${prefix}${e.name}  [${kind}]`)
      await walk(join(dir, e.name), prefix + '  ')
    }
  }
  await walk(root, '')
  return lines.join('\n')
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

void main().catch((e) => {
  console.error(`迁移失败（未产生部分写入或备份已就绪可回滚）：${e?.message ?? e}`)
  process.exitCode = 1
})
