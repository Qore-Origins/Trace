import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PROFILES = {
  standard: { planCount: 100, tasksPerPlan: 10 },
  upper: { planCount: 1000, tasksPerPlan: 10 },
  'task-100': { planCount: 1, tasksPerPlan: 100 },
  'task-1000': { planCount: 1, tasksPerPlan: 1000 },
  'diagram-matrix': { planCount: 1, tasksPerPlan: 1 }
}

function uuid32() {
  return randomUUID().replaceAll('-', '')
}

function parseProfile(args) {
  const profileIndex = args.indexOf('--profile')
  if (profileIndex === -1 || !args[profileIndex + 1]) {
    throw new Error('Usage: node scripts/trace-perf-fixture.mjs --profile standard|upper|task-100|task-1000|diagram-matrix')
  }
  const profile = args[profileIndex + 1]
  if (!Object.hasOwn(PROFILES, profile)) throw new Error(`Unknown profile: ${profile}`)
  return profile
}

function createNoteContent(includeDiagramMatrix) {
  if (includeDiagramMatrix) {
    return [
      '# Static diagram regression',
      '',
      '```typescript',
      'const ordinaryCode = true',
      '```',
      '',
      '```mermaid',
      'flowchart TD',
      '  Start --> Ready',
      '```',
      '',
      '```vega-lite',
      JSON.stringify({
        $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
        data: { values: [{ category: 'A', value: 28 }, { category: 'B', value: 55 }] },
        mark: 'bar',
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'value', type: 'quantitative' }
        }
      }),
      '```',
      '',
      '```plantuml',
      '@startuml',
      'Alice -> Bob: Ready',
      '@enduml',
      '```',
      '',
      '```flowchart',
      'st=>start: Start',
      'e=>end: Ready',
      'st->e',
      '```',
      '',
      '```sequence',
      'Alice->Bob: Ready',
      '```'
    ].join('\n')
  }

  return [
    '# Muya performance sample',
    '',
    'This note is isolated test content. It can be edited or discarded safely.',
    '',
    '[External link test](https://example.com/trace-perf)',
    '',
    '```mermaid',
    'flowchart TD',
    '  Start --> Render',
    '  Render --> Ready',
    '```'
  ].join('\n')
}

function createPlan(planNumber, tasksPerPlan, createdAt, includeNote, includeDiagramMatrix) {
  const components = [
    {
      id: uuid32(),
      type: 'heading',
      payload: { title: `Performance sample ${String(planNumber).padStart(4, '0')}`, size: 22 }
    }
  ]

  if (includeNote) {
    components.push({
      id: uuid32(),
      type: 'note',
      payload: { content: createNoteContent(includeDiagramMatrix), created_at: createdAt }
    })
  }

  components.push({
    id: uuid32(),
    type: 'task_list',
    payload: {
      title: `Performance tasks (${tasksPerPlan})`,
      items: Array.from({ length: tasksPerPlan }, (_, index) => ({
        id: uuid32(),
        title: `Performance task ${String(index + 1).padStart(4, '0')}`,
        status: 'not_started'
      }))
    }
  })

  return {
    format_version: '1',
    created_at: createdAt,
    updated_at: createdAt,
    components
  }
}

async function writeAppConfig(appDataRoot, libraryRoot) {
  const config = JSON.stringify({
    format_version: '1',
    root_dir: libraryRoot,
    window: { width: 1440, height: 960, maximized: false }
  }, null, 2)

  for (const appName of ['trace', '溯源 Trace']) {
    const userDataDir = join(appDataRoot, appName)
    await mkdir(userDataDir, { recursive: true })
    await writeFile(join(userDataDir, 'config.json'), config, 'utf8')
  }
}

async function main() {
  const profileName = parseProfile(process.argv.slice(2))
  const profile = PROFILES[profileName]
  const sessionRoot = await mkdtemp(join(tmpdir(), `qore-trace-perf-${profileName}-`))
  const libraryRoot = join(sessionRoot, 'library')
  const appDataRoot = join(sessionRoot, 'appdata')
  const metadataDir = join(libraryRoot, '.trace')
  const createdAt = new Date().toISOString()

  await mkdir(metadataDir, { recursive: true })
  await writeFile(join(metadataDir, 'plan-library.json'), JSON.stringify({
    format_version: '1',
    library_id: uuid32(),
    created_at: createdAt,
    schema_info: ['min', 'v1']
  }, null, 2), 'utf8')

  for (let index = 0; index < profile.planCount; index += 1) {
    const planNumber = index + 1
    const planDir = join(libraryRoot, `Perf Plan ${String(planNumber).padStart(4, '0')}`)
    await mkdir(planDir, { recursive: true })
    await writeFile(
      join(planDir, 'plan.json'),
      JSON.stringify(createPlan(planNumber, profile.tasksPerPlan, createdAt, planNumber === 1, profileName === 'diagram-matrix'), null, 2),
      'utf8'
    )
  }

  await writeAppConfig(appDataRoot, libraryRoot)
  process.stdout.write(`${JSON.stringify({
    profile: profileName,
    planCount: profile.planCount,
    taskCount: profile.planCount * profile.tasksPerPlan,
    libraryRoot,
    appDataRoot,
    temporary: true
  }, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
