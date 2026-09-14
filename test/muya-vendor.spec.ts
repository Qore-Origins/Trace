import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

async function hashSourceTree(root: string): Promise<string> {
  const filePaths: string[] = []

  async function collect(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = join(directory, entry.name)
      if (entry.isDirectory()) await collect(entryPath)
      else if (entry.isFile()) filePaths.push(entryPath)
    }
  }

  await collect(root)
  const manifestLines = await Promise.all(
    filePaths
      .sort()
      .map(async (filePath) => {
        const relativePath = relative(root, filePath).replaceAll('\\', '/')
        const fileHash = createHash('sha256').update(await readFile(filePath)).digest('hex')
        return `${relativePath}\t${fileHash}`
      })
  )

  return createHash('sha256').update(manifestLines.join('\n'), 'utf8').digest('hex')
}

describe('vendored Muya', () => {
  it('固定 0.2.0、MIT 许可并记录来源指纹', async () => {
    const pkg = JSON.parse(await readFile('vendor/muya/package.json', 'utf8')) as {
      name: string
      version: string
    }
    expect(pkg).toMatchObject({ name: '@muyajs/core', version: '0.2.0' })
    expect(await readFile('vendor/muya/LICENSE', 'utf8')).toContain('MIT License')
    const provenance = await readFile('vendor/muya/UPSTREAM.md', 'utf8')
    const patchedHash = provenance.match(/Trace 安全补丁后 SHA-256: `([a-f0-9]{64})`/)?.[1]

    expect(patchedHash).toBeDefined()
    expect(await hashSourceTree('vendor/muya/src')).toBe(patchedHash)
  })

  it('PlantUML 不保留公共服务器默认值', async () => {
    const config = await readFile('vendor/muya/src/config/index.ts', 'utf8')
    const renderer = await readFile('vendor/muya/src/utils/diagram/plantuml/index.ts', 'utf8')
    expect(config + renderer).not.toContain('https://www.plantuml.com/plantuml')
  })
})
