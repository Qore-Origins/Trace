// 从品牌源 PNG 生成多尺寸 ICO（16-256 全档）到 resources/icon.ico，并复制 PNG 到 resources/icon.png
// 用法：node scripts/make-ico.mjs
// 源图标更新后重跑本脚本即可。
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as png2icons from 'png2icons'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcPng = join(root, 'Resource/ico/Trace_logo.png')
const outDir = join(root, 'resources')

const png = readFileSync(srcPng)
mkdirSync(outDir, { recursive: true })

// 全标准尺寸（forWinExe=true，Electron 推荐：16-48 BMP + 64-256 PNG 混合，防旧版 Windows 属性对话框显示问题）
const ico = png2icons.createICO(png, png2icons.BILINEAR, 0, false, true)
if (!ico) {
  console.error('ICO 生成失败：输入不是有效 PNG')
  process.exit(1)
}
writeFileSync(join(outDir, 'icon.ico'), ico)
copyFileSync(srcPng, join(outDir, 'icon.png'))

const entries = ico[4] | (ico[5] << 8) // ICO 头：偏移 4 = 图像数（偏移 2 为 type=1）
const sizes = []
for (let i = 0; i < entries; i++) {
  const o = 6 + i * 16
  sizes.push(`${ico[o] || 256}x${ico[o + 1] || 256}`)
}
console.log(`icon.ico 生成完成：${entries} 档 [${sizes.join(' ')}]，${ico.length} bytes`)
console.log(`icon.png 已复制：${png.length} bytes`)
