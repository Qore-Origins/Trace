import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { testAgentToolCapability } from '../src/main/services/agent-capability-test'

const servers: Server[] = []
async function serve(events: string[], inspect?: (body: Record<string, unknown>) => void): Promise<string> {
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (part) => { raw += part })
    request.on('end', () => {
      inspect?.(JSON.parse(raw) as Record<string, unknown>)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const event of events) response.write(`data: ${event}\n\n`)
      response.end()
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing loopback address')
  return `http://127.0.0.1:${address.port}/v1`
}
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))) })
const event = (value: unknown) => JSON.stringify({ id: 'probe-response', choices: [{ delta: value }] })

describe('synthetic tool-call capability test', () => {
  it('passes only after merging native tool-call deltas by index and never executes the probe', async () => {
    let request: Record<string, unknown> = {}
    const endpoint = await serve([
      event({ tool_calls: [{ index: 0, id: 'test-call', type: 'function', function: { name: 'trace_capability_probe', arguments: '{"value"' } }] }),
      event({ tool_calls: [{ index: 0, function: { arguments: ':"ready"}' } }] }),
      JSON.stringify({ id: 'probe-response', choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      '[DONE]'
    ], (body) => { request = body })
    const capability = await testAgentToolCapability({ endpoint, model: 'synthetic-model', apiKey: 'test-only-key' })
    expect(capability).toMatchObject({ status: 'passed', errorCategory: null })
    expect(capability.testedAt).toEqual(expect.any(String))
    expect(request).toMatchObject({ stream: true, tool_choice: { type: 'function', function: { name: 'trace_capability_probe' } } })
    expect(JSON.stringify(request)).not.toMatch(/test-only-key|计划|日记/)
    expect(request.messages).toEqual([{ role: 'user', content: 'Call the provided test function with value ready.' }])
  })

  it('fails for a wrong name, wrong schema, malformed JSON or incomplete stream', async () => {
    for (const calls of [
      [{ index: 0, id: 'call', function: { name: 'wrong', arguments: '{"value":"ready"}' } }],
      [{ index: 0, id: 'call', function: { name: 'trace_capability_probe', arguments: '{"value":"wrong"}' } }],
      [{ index: 0, id: 'call', function: { name: 'trace_capability_probe', arguments: '{bad' } }]
    ]) {
      const endpoint = await serve([event({ tool_calls: calls }), JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }), '[DONE]'])
      expect((await testAgentToolCapability({ endpoint, model: 'model', apiKey: 'test-only-key' })).status).toBe('failed')
    }
    const endpoint = await serve([event({ tool_calls: [{ index: 0, function: { name: 'trace_capability_probe', arguments: '{"value":"ready"}' } }] })])
    expect((await testAgentToolCapability({ endpoint, model: 'model', apiKey: 'test-only-key' })).status).toBe('failed')
  })

  it('rejects two interleaved native calls even when the probe arguments assemble correctly', async () => {
    const endpoint = await serve([
      event({ tool_calls: [
        { index: 0, id: 'first', type: 'function', function: { name: 'trace_capability_', arguments: '{"value"' } },
        { index: 1, id: 'second', type: 'function', function: { name: 'other', arguments: '{}' } }
      ] }),
      event({ tool_calls: [{ index: 0, function: { name: 'probe', arguments: ':"ready"}' } }] }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }), '[DONE]'
    ])
    expect(await testAgentToolCapability({ endpoint, model: 'model', apiKey: 'test-only-key' })).toMatchObject({ status: 'failed', errorCategory: 'unsupported' })
  })
})
