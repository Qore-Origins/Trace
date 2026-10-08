import { describe, expect, it } from 'vitest'

const expectedNames = [
  'plan.list_children', 'plan.read', 'plan.create', 'folder.create',
  'component.add', 'component.update', 'component.delete',
  'task.add', 'task.update', 'task.delete',
  'multi_option.add', 'multi_option.update', 'multi_option.delete',
  'plan.rename', 'folder.rename', 'plan.move', 'folder.move', 'plan.trash', 'folder.trash',
  'trash.list', 'trash.restore', 'trash.purge'
]

function toolCall(name: string, args: Record<string, unknown>, id = 'call_1') {
  return { id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }
}
const authorizedRef = 'A'.repeat(43)

async function registry() {
  const loaded = await import('../src/main/services/agent-tool-registry').catch(() => null)
  expect(loaded).not.toBeNull()
  if (!loaded) throw new Error('agent tool registry is not implemented')
  return loaded
}

describe('agent built-in tool registry', () => {
  it('exposes only the fixed V1 tools with closed top-level schemas', async () => {
    const { getAgentToolDefinitions } = await registry()
    const definitions = getAgentToolDefinitions()

    expect(definitions.map((definition) => definition.function.name)).toEqual(expectedNames)
    for (const definition of definitions) {
      expect(definition.type).toBe('function')
      expect(definition.function.parameters).toMatchObject({ type: 'object', additionalProperties: false })
    }
  })

  it('serializes the registered schemas through the real provider request validator', async () => {
    const { getAgentToolDefinitions } = await registry()
    const { serializeAgentChatRequest } = await import('../src/main/services/agent-provider')
    expect(() => serializeAgentChatRequest('test-model', [{ role: 'user', content: 'test' }], {
      tools: getAgentToolDefinitions(), toolChoice: 'auto'
    })).not.toThrow()
  })

  it('declares mood scores with the exact nullable-number schema', async () => {
    const { getAgentToolDefinitions } = await registry()
    const componentAdd = getAgentToolDefinitions().find((tool) => tool.function.name === 'component.add')!
    const properties = componentAdd.function.parameters.properties as Record<string, Record<string, unknown>>
    const payloadProperties = properties.payload.properties as Record<string, Record<string, unknown>>
    expect(payloadProperties.score.type).toEqual(['number', 'null'])
  })

  it('requires an exact trash-entry grant for Agent trash listing', async () => {
    const { getAgentToolDefinitions, parseAgentToolCalls } = await registry()
    const trashList = getAgentToolDefinitions().find((tool) => tool.function.name === 'trash.list')!
    expect(trashList.function.parameters).toMatchObject({
      required: ['trash_entry_ref'],
      properties: { trash_entry_ref: { type: 'string' } }
    })
    expect(() => parseAgentToolCalls([toolCall('trash.list', {})])).toThrow()
    expect(parseAgentToolCalls([toolCall('trash.list', { trash_entry_ref: authorizedRef })])[0].arguments)
      .toEqual({ trash_entry_ref: authorizedRef })
  })

  it('accepts one valid call for every supported non-reference component type', async () => {
    const { parseAgentToolCalls } = await registry()
    const payloads: Array<[string, Record<string, unknown>]> = [
      ['single_plan', { title: 'Plan item', done: false }],
      ['multi_plan', { title: 'Options' }],
      ['task_list', { title: 'Tasks' }],
      ['task_detail', { title: 'Task detail' }],
      ['note', { content: 'A note' }],
      ['mood', { score: 70, text: 'Steady', mood_date: '2026-10-04' }],
      ['heading', { title: 'Section', size: 20 }],
      ['custom', { content: 'Custom content' }]
    ]
    const calls = payloads.map(([type, payload], index) => toolCall('component.add', {
      plan_ref: authorizedRef, expected_updated_at: '2026-10-04T00:00:00.000Z', type, payload
    }, `call_${index}`))

    const parsed = parseAgentToolCalls(calls)
    expect(parsed).toHaveLength(payloads.length)
    expect(parsed.map((intent) => intent.name)).toEqual(payloads.map(() => 'component.add'))
  })

  it('accepts null as an intentional mood score while rejecting unrelated score types', async () => {
    const { parseAgentToolCalls } = await registry()
    const valid = toolCall('component.add', {
      plan_ref: authorizedRef, expected_updated_at: '2026-10-04T00:00:00.000Z', type: 'mood',
      payload: { score: null, text: 'No score recorded', mood_date: '2026-10-04' }
    })
    expect(parseAgentToolCalls([valid])[0].arguments).toMatchObject({ payload: { score: null } })
    for (const score of ['unknown', false, {}, []]) {
      const invalid = toolCall('component.add', {
        plan_ref: authorizedRef, expected_updated_at: '2026-10-04T00:00:00.000Z', type: 'mood',
        payload: { score, text: 'Invalid score', mood_date: '2026-10-04' }
      })
      expect(() => parseAgentToolCalls([invalid])).toThrow()
    }
  })

  it.each([
    ['unknown tool', toolCall('shell.exec', { command: 'echo unsafe' })],
    ['arbitrary path', toolCall('plan.read', { plan_ref: authorizedRef, path: '../outside' })],
    ['unknown top-level property', toolCall('plan.read', { plan_ref: authorizedRef, extra: true })],
    ['unsupported component type', toolCall('component.add', { plan_ref: authorizedRef, expected_updated_at: '2026-10-04T00:00:00.000Z', type: 'plan_reference', payload: {} })],
    ['unknown nested component property', toolCall('component.add', { plan_ref: authorizedRef, expected_updated_at: '2026-10-04T00:00:00.000Z', type: 'note', payload: { content: 'safe', path: 'C:/outside' } })],
    ['overlong component text', toolCall('component.add', { plan_ref: authorizedRef, expected_updated_at: '2026-10-04T00:00:00.000Z', type: 'note', payload: { content: 'x'.repeat(20_001) } })],
    ['invalid date', toolCall('component.add', { plan_ref: authorizedRef, expected_updated_at: '2026-10-04T00:00:00.000Z', type: 'mood', payload: { score: 50, text: '', mood_date: '2026-02-31' } })],
    ['null does not mean clear', toolCall('component.update', { plan_ref: authorizedRef, component_id: '11111111111111111111111111111111', expected_updated_at: '2026-10-04T00:00:00.000Z', patch: { title: null } })],
    ['cannot clear a required field', toolCall('component.update', { plan_ref: authorizedRef, component_id: '11111111111111111111111111111111', expected_updated_at: '2026-10-04T00:00:00.000Z', clear_fields: ['title'] })],
    ['cannot update a system-owned task field', toolCall('task.update', { plan_ref: authorizedRef, list_component_id: '11111111111111111111111111111111', task_id: '22222222222222222222222222222222', expected_updated_at: '2026-10-04T00:00:00.000Z', patch: { completed_at: '2026-10-04T00:00:00.000Z' } })]
  ])('rejects %s before any execution can be staged', async (_label, call) => {
    const { parseAgentToolCalls } = await registry()
    expect(() => parseAgentToolCalls([call])).toThrow()
  })

  it('rejects the entire batch when one later call is malformed', async () => {
    const { parseAgentToolCalls } = await registry()
    expect(() => parseAgentToolCalls([
      toolCall('plan.read', { plan_ref: authorizedRef }, 'call_valid'),
      toolCall('plan.read', { plan_ref: authorizedRef, absolute_path: 'D:/private' }, 'call_invalid')
    ])).toThrow()
  })
})
