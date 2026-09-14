import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('vendored Muya', () => {
  it('固定 0.2.0、MIT 许可并记录来源指纹', async () => {
    const pkg = JSON.parse(await readFile('vendor/muya/package.json', 'utf8')) as {
      name: string
      version: string
    }
    expect(pkg).toMatchObject({ name: '@muyajs/core', version: '0.2.0' })
    expect(await readFile('vendor/muya/LICENSE', 'utf8')).toContain('MIT License')
    expect(await readFile('vendor/muya/UPSTREAM.md', 'utf8')).toMatch(/SHA-256: `[a-f0-9]{64}`/)
  })

  it('PlantUML 不保留公共服务器默认值', async () => {
    const config = await readFile('vendor/muya/src/config/index.ts', 'utf8')
    const renderer = await readFile('vendor/muya/src/utils/diagram/plantuml/index.ts', 'utf8')
    expect(config + renderer).not.toContain('https://www.plantuml.com/plantuml')
  })
})
