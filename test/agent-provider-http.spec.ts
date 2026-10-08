import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AGENT_REQUEST_BODY_LIMIT_BYTES, serializeAgentChatRequest, streamChatCompletion, type AgentChatMessage } from '../src/main/services/agent-provider'
import { AgentSseAccumulator, AGENT_SSE_EVENT_LIMIT_BYTES } from '../src/main/services/agent-sse'

const servers: Server[] = []
async function serve(handler: Parameters<typeof createServer>[0]): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing loopback address')
  return `http://127.0.0.1:${address.port}/v1`
}
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
  server.closeAllConnections()
  server.close(() => resolve())
}))) })

const input = (endpoint: string, signal?: AbortSignal) => ({ endpoint, model: 'synthetic-model', apiKey: 'test-only-key', messages: [{ role: 'user' as const, content: 'hello' }], signal })
const chunk = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`

describe('SSE event bounds with controlled transport chunks', () => {
  it('rejects an oversized unfinished event on the append that crosses the limit', () => {
    const accumulator = new AgentSseAccumulator()
    const prefix = `data: ${'x'.repeat(AGENT_SSE_EVENT_LIMIT_BYTES - 6)}`
    accumulator.push(prefix, Buffer.byteLength(prefix))
    expect(() => accumulator.push('x', 1)).toThrowError(expect.objectContaining({ category: 'limit' }))
  })

  it('accepts multiple bounded complete events in one oversized reader chunk', async () => {
    const text = 'x'.repeat(AGENT_SSE_EVENT_LIMIT_BYTES / 2)
    const events = Array.from({ length: 4 }, () => chunk({ choices: [{ delta: { content: text } }] }))
    expect(events.every((event) => Buffer.byteLength(event) < AGENT_SSE_EVENT_LIMIT_BYTES)).toBe(true)
    const transportChunk = events.join('') + chunk({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + ': keepalive\n\ndata: [DONE]\n\n'
    const encoded = new TextEncoder().encode(transportChunk)
    expect(encoded.byteLength).toBeGreaterThan(AGENT_SSE_EVENT_LIMIT_BYTES)
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encoded); controller.close() } })
    const reader = stream.getReader()
    const accumulator = new AgentSseAccumulator()
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        accumulator.push(new TextDecoder().decode(value), value.byteLength)
      }
      expect(accumulator.complete(false)).toEqual({ text: text.repeat(4), toolCalls: [] })
    } finally { reader.releaseLock() }
  })
})

describe('OpenAI Chat Completions HTTP stream', () => {
  it('serializes multiple native function tools with automatic selection', () => {
    const tools = [
      { type: 'function' as const, function: { name: 'plan.read', description: 'Read one plan.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
      { type: 'function' as const, function: { name: 'plan.list_children', description: 'List direct children.', parameters: { type: 'object', properties: {}, additionalProperties: false } } }
    ]
    const messages = [{ role: 'user' as const, content: 'Inspect this plan.' }]
    const body = JSON.parse(serializeAgentChatRequest('synthetic-model', messages, { tools, toolChoice: 'auto' })) as Record<string, unknown>

    expect(body).toEqual({ model: 'synthetic-model', messages, stream: true, tools, tool_choice: 'auto' })
  })

  it('accepts the specification maximum string argument length and rejects larger schemas', () => {
    const messages = [{ role: 'user' as const, content: 'Use the bounded field.' }]
    const tool = (maxLength: number) => ({ type: 'function' as const, function: {
      name: 'component.add', description: 'Add a component.', parameters: {
        type: 'object', properties: { text: { type: 'string', maxLength } }, additionalProperties: false
      }
    } })

    expect(() => serializeAgentChatRequest('synthetic-model', messages, { tools: [tool(20_000)], toolChoice: 'auto' })).not.toThrow()
    expect(() => serializeAgentChatRequest('synthetic-model', messages, { tools: [tool(20_001)], toolChoice: 'auto' }))
      .toThrowError(expect.objectContaining({ category: 'validation' }))
  })

  it('preserves assistant tool-call and matching tool-result message semantics', () => {
    const messages = [
      { role: 'assistant' as const, content: null, tool_calls: [{ id: 'call_1', type: 'function' as const, function: { name: 'plan.read', arguments: '{"ref":"abc"}' } }] },
      { role: 'tool' as const, content: '{"title":"Plan"}', tool_call_id: 'call_1' },
      { role: 'user' as const, content: 'Continue.' }
    ]
    expect(JSON.parse(serializeAgentChatRequest('synthetic-model', messages))).toMatchObject({ messages })
  })

  it('accepts a nullable mood score tool argument but rejects unrelated types', async () => {
    const tool = { type: 'function' as const, function: {
      name: 'component.add', description: 'Add a mood component.', parameters: {
        type: 'object', properties: { score: { type: ['number', 'null'], minimum: 0, maximum: 100 } },
        required: ['score'], additionalProperties: false
      }
    } }
    const endpoint = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(chunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_mood', type: 'function', function: { name: 'component.add', arguments: '{"score":null}' } }] } }] }) +
        chunk({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) + 'data: [DONE]\n\n')
    })
    const result = await streamChatCompletion(input(endpoint), { tools: [tool], toolChoice: 'auto' })
    expect(result.toolCalls).toEqual([{ id: 'call_mood', name: 'component.add', arguments: { score: null } }])

    const invalidEndpoint = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(chunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_mood', type: 'function', function: { name: 'component.add', arguments: '{"score":"none"}' } }] } }] }) +
        chunk({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) + 'data: [DONE]\n\n')
    })
    await expect(streamChatCompletion(input(invalidEndpoint), { tools: [tool], toolChoice: 'auto' }))
      .rejects.toMatchObject({ category: 'protocol' })

    const invalidSchemas = [
      { type: ['string', 'null'] },
      { type: ['number', 'null', 'boolean'] },
      { type: 'number', anyOf: [{ type: 'null' }] }
    ]
    for (const scoreSchema of invalidSchemas) {
      const invalidTool = { ...tool, function: { ...tool.function, parameters: {
        type: 'object', properties: { score: scoreSchema }, required: ['score'], additionalProperties: false
      } } }
      expect(() => serializeAgentChatRequest('synthetic-model', [{ role: 'user', content: 'test' }], {
        tools: [invalidTool], toolChoice: 'auto'
      })).toThrowError(expect.objectContaining({ category: 'validation' }))
    }
  })

  it.each([
    [{ role: 'tool', content: 'result', tool_call_id: 'orphan' }],
    [{ role: 'assistant', content: null }],
    [
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'plan.read', arguments: '{}' } }] },
      { role: 'tool', content: 'wrong result', tool_call_id: 'call_2' }
    ],
    [
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'plan.read', arguments: '{}' } }] },
      { role: 'user', content: 'skipped result' }
    ]
  ])('rejects a malformed tool transcript before serialization', (messages) => {
    expect(() => serializeAgentChatRequest('synthetic-model', messages as unknown as AgentChatMessage[])).toThrowError(expect.objectContaining({ category: 'validation' }))
  })

  it('merges interleaved tool-call fragments by index and preserves response order', async () => {
    const endpoint = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end([
        chunk({ choices: [{ delta: { tool_calls: [{ index: 1, id: 'call-', type: 'function', function: { name: 'plan.', arguments: '{"folder_ref":' } }] } }] }),
        chunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-first', type: 'function', function: { name: 'plan.read', arguments: '{"plan_ref":"first"}' } }] } }] }),
        chunk({ choices: [{ delta: { tool_calls: [{ index: 1, id: 'second', function: { name: 'list_children', arguments: '"second"}' } }] }, finish_reason: 'tool_calls' }] }),
        'data: [DONE]\n\n'
      ].join(''))
    })
    const tools = [
      { type: 'function' as const, function: { name: 'plan.read', description: 'Read one plan.', parameters: { type: 'object', properties: { plan_ref: { type: 'string' } }, required: ['plan_ref'], additionalProperties: false } } },
      { type: 'function' as const, function: { name: 'plan.list_children', description: 'List direct children.', parameters: { type: 'object', properties: { folder_ref: { type: 'string' } }, required: ['folder_ref'], additionalProperties: false } } }
    ]

    await expect(streamChatCompletion(input(endpoint), { tools, toolChoice: 'auto' })).resolves.toEqual({
      text: '',
      toolCalls: [
        { id: 'call-first', name: 'plan.read', arguments: { plan_ref: 'first' } },
        { id: 'call-second', name: 'plan.list_children', arguments: { folder_ref: 'second' } }
      ]
    })
  })

  it.each([
    { name: 'duplicate call IDs', calls: [
      { index: 0, id: 'same', type: 'function', function: { name: 'plan.read', arguments: '{}' } },
      { index: 1, id: 'same', type: 'function', function: { name: 'plan.read', arguments: '{}' } }
    ] },
    { name: 'missing call IDs', calls: [
      { index: 0, type: 'function', function: { name: 'plan.read', arguments: '{}' } }
    ] },
    { name: 'non-contiguous call order', calls: [
      { index: 1, id: 'call', type: 'function', function: { name: 'plan.read', arguments: '{}' } }
    ] },
    { name: 'invalid JSON arguments', calls: [
      { index: 0, id: 'call', type: 'function', function: { name: 'plan.read', arguments: '{bad}' } }
    ] },
    { name: 'more than twenty calls', calls: Array.from({ length: 21 }, (_, index) => ({
      index, id: `call-${index}`, type: 'function', function: { name: 'plan.read', arguments: '{}' }
    })) }
  ])('rejects $name without returning executable tool calls', async ({ calls }) => {
    const endpoint = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(chunk({ choices: [{ delta: { tool_calls: calls } }] }) + chunk({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) + 'data: [DONE]\n\n')
    })
    const tool = { type: 'function' as const, function: { name: 'plan.read', description: 'Read one plan.', parameters: { type: 'object', properties: {}, additionalProperties: false } } }

    await expect(streamChatCompletion(input(endpoint), { tools: [tool], toolChoice: 'auto' })).rejects.toMatchObject({ category: expect.stringMatching(/protocol|limit/) })
  })

  it.each([
    { name: 'missing required arguments', arguments: '{}' },
    { name: 'unknown arguments', arguments: '{"plan_ref":"ok","extra":true}' },
    { name: 'arguments with wrong types', arguments: '{"plan_ref":3}' }
  ])('rejects schema-invalid $name', async ({ arguments: args }) => {
    const endpoint = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(chunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call', type: 'function', function: { name: 'plan.read', arguments: args } }] } }] }) + chunk({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) + 'data: [DONE]\n\n')
    })
    const tool = { type: 'function' as const, function: { name: 'plan.read', description: 'Read one plan.', parameters: { type: 'object', properties: { plan_ref: { type: 'string' } }, required: ['plan_ref'], additionalProperties: false } } }
    await expect(streamChatCompletion(input(endpoint), { tools: [tool], toolChoice: 'auto' })).rejects.toMatchObject({ category: 'protocol' })
  })

  it.each([
    { name: 'wrong function name', callName: 'plan.delete', arguments: '{"plan_ref":"p1"}', category: 'unsupported' },
    { name: 'wrong schema value', callName: 'plan.read', arguments: '{"plan_ref":3}', category: 'unsupported' },
    { name: 'wrong schema value in automatic mode', callName: 'plan.delete', arguments: '{"plan_ref":"p1"}', category: 'protocol', toolChoice: 'auto' as const }
  ])('classifies $name according to capability-probe mode', async ({ callName, arguments: args, category, toolChoice }) => {
    const endpoint = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(chunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call', type: 'function', function: { name: callName, arguments: args } }] } }] }) + chunk({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) + 'data: [DONE]\n\n')
    })
    const tool = { type: 'function' as const, function: { name: 'plan.read', description: 'Read one plan.', parameters: { type: 'object', properties: { plan_ref: { type: 'string' } }, required: ['plan_ref'], additionalProperties: false } } }
    const options = { tools: [tool], toolChoice: toolChoice ?? 'plan.read' }
    await expect(streamChatCompletion(input(endpoint), options)).rejects.toMatchObject({ category })
  })

  it('sends the shared complete-envelope serialization at the exact request limit', async () => {
    let received = ''
    const endpoint = await serve((request, response) => {
      request.on('data', (part) => { received += part })
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end(chunk({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n')
      })
    })
    const base = input(endpoint)
    const prefix = '中文\n"\\'
    const size = Buffer.byteLength(JSON.stringify({ model: base.model, messages: [{ role: 'user', content: prefix }], stream: true }), 'utf8')
    const messages = [{ role: 'user' as const, content: prefix + 'x'.repeat(AGENT_REQUEST_BODY_LIMIT_BYTES - size) }]
    const serialized = serializeAgentChatRequest(base.model, messages)
    expect(Buffer.byteLength(serialized, 'utf8')).toBe(AGENT_REQUEST_BODY_LIMIT_BYTES)
    expect(await streamChatCompletion({ ...base, messages })).toEqual({ text: 'ok', toolCalls: [] })
    expect(received).toBe(serialized)
    expect(JSON.parse(received)).toEqual({ model: base.model, messages, stream: true })
  })

  it('rejects one byte over the complete envelope limit even when messages alone fit', async () => {
    let requested = false
    const endpoint = await serve((_request, response) => { requested = true; response.end('unexpected') })
    const base = input(endpoint)
    const size = Buffer.byteLength(JSON.stringify({ model: base.model, messages: [{ role: 'user', content: '' }], stream: true }), 'utf8')
    const messages = [{ role: 'user' as const, content: 'x'.repeat(AGENT_REQUEST_BODY_LIMIT_BYTES - size + 1) }]
    expect(Buffer.byteLength(JSON.stringify(messages), 'utf8')).toBeLessThan(AGENT_REQUEST_BODY_LIMIT_BYTES)
    expect(Buffer.byteLength(JSON.stringify({ model: base.model, messages, stream: true }), 'utf8')).toBe(AGENT_REQUEST_BODY_LIMIT_BYTES + 1)
    expect(() => serializeAgentChatRequest(base.model, messages)).toThrowError(expect.objectContaining({ category: 'limit' }))
    await expect(streamChatCompletion({ ...base, messages })).rejects.toMatchObject({ category: 'limit' })
    expect(requested).toBe(false)
  })

  it('rejects completion text after finish_reason without emitting the late text', async () => {
    const endpoint = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(chunk({ choices: [{ delta: { content: 'final' }, finish_reason: 'stop' }] }) + chunk({ choices: [{ delta: { content: 'late' } }] }) + 'data: [DONE]\n\n')
    })
    const pieces: string[] = []
    await expect(streamChatCompletion({ ...input(endpoint), onText: (text) => pieces.push(text) })).rejects.toMatchObject({ category: 'protocol' })
    expect(pieces).toEqual(['final'])
  })

  it.each([
    { status: 401, contentType: 'text/event-stream', category: 'authentication' },
    { status: 403, contentType: 'text/event-stream', category: 'authentication' },
    { status: 302, contentType: 'text/event-stream', category: 'http' },
    { status: 500, contentType: 'text/event-stream', category: 'http' },
    { status: 200, contentType: 'application/json', category: 'protocol' }
  ])('releases a still-open $status response with $contentType promptly', async ({ status, contentType, category }) => {
    let responseClosed = false
    const endpoint = await serve((_request, response) => {
      response.once('close', () => { responseClosed = true })
      response.writeHead(status, { 'content-type': contentType })
      response.flushHeaders()
    })
    await expect(streamChatCompletion({ ...input(endpoint), timeoutMs: 1_000 })).rejects.toMatchObject({ category })
    await vi.waitFor(() => expect(responseClosed).toBe(true), { timeout: 300, interval: 10 })
  })

  it('sends a tool-free request and yields fragmented SSE text only after a complete stream', async () => {
    let body: Record<string, unknown> = {}
    let authorization = ''
    const endpoint = await serve((request, response) => {
      authorization = request.headers.authorization ?? ''
      let raw = ''
      request.on('data', (part) => { raw += part })
      request.on('end', () => {
        body = JSON.parse(raw) as Record<string, unknown>
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        const stream = chunk({ id: 'same', choices: [{ delta: { content: 'hel' } }] }) + chunk({ id: 'same', choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n'
        for (const piece of stream.match(/.{1,3}/gs) ?? []) response.write(piece)
        response.end()
      })
    })
    const pieces: string[] = []
    const result = await streamChatCompletion({ ...input(endpoint), onText: (text) => pieces.push(text) })
    expect(result).toEqual({ text: 'hello', toolCalls: [] })
    expect(pieces).toEqual(['hel', 'lo'])
    expect(body).toMatchObject({ model: 'synthetic-model', stream: true, messages: [{ role: 'user', content: 'hello' }] })
    expect(body).not.toHaveProperty('tools')
    expect(authorization).toBe('Bearer test-only-key')
  })

  it('rejects unsafe endpoints before any request and rejects redirects without forwarding credentials', async () => {
    let redirected = false
    const target = await serve((_request, response) => { redirected = true; response.end('unexpected') })
    const endpoint = await serve((_request, response) => { response.writeHead(302, { location: `${target}/chat/completions` }); response.end() })
    await expect(streamChatCompletion(input('http://192.168.1.1/v1'))).rejects.toMatchObject({ category: 'validation' })
    await expect(streamChatCompletion(input('https://user:pass@example.com/v1'))).rejects.toMatchObject({ category: 'validation' })
    await expect(streamChatCompletion(input(endpoint))).rejects.toMatchObject({ category: 'http' })
    expect(redirected).toBe(false)
  })

  it('classifies non-2xx and malformed/truncated events without exposing server body or key', async () => {
    const unauthorized = await serve((_request, response) => { response.writeHead(401); response.end('test-only-key private data') })
    await expect(streamChatCompletion(input(unauthorized))).rejects.toMatchObject({ category: 'authentication' })
    const malformed = await serve((_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end('data: {bad}\n\n') })
    await expect(streamChatCompletion(input(malformed))).rejects.toMatchObject({ category: 'protocol' })
    const truncated = await serve((_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(chunk({ choices: [{ delta: { content: 'partial' } }] })) })
    await expect(streamChatCompletion(input(truncated))).rejects.toMatchObject({ category: 'protocol' })
  })

  it('bounds the SSE buffer and aborts a stalled request', async () => {
    const oversized = await serve((_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(`data: ${'x'.repeat(70_000)}\n\n`) })
    await expect(streamChatCompletion(input(oversized))).rejects.toMatchObject({ category: 'limit' })
    const stalled = await serve((_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.flushHeaders() })
    await expect(streamChatCompletion({ ...input(stalled), timeoutMs: 30 })).rejects.toMatchObject({ category: 'timeout' })
  })

  it('discards incomplete tool calls after cancellation', async () => {
    const controller = new AbortController()
    const endpoint = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(chunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call', function: { name: 'probe', arguments: '{' } }] } }] }))
    })
    const pending = streamChatCompletion({ ...input(endpoint, controller.signal), onText: () => {} })
    setTimeout(() => controller.abort(), 20)
    await expect(pending).rejects.toMatchObject({ category: 'cancelled' })
  })

  it('rejects unexpected native tool calls during normal chat', async () => {
    const endpoint = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(chunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call', type: 'function', function: { name: 'unsafe', arguments: '{}' } }] } }] }) + chunk({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) + 'data: [DONE]\n\n')
    })
    await expect(streamChatCompletion(input(endpoint))).rejects.toMatchObject({ category: 'protocol' })
  })

  it('rejects mismatched message IDs and hides untrusted server response content', async () => {
    const mismatched = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(chunk({ id: 'first', choices: [{ delta: { content: 'a' } }] }) + chunk({ id: 'second', choices: [{ delta: {}, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n')
    })
    await expect(streamChatCompletion(input(mismatched))).rejects.toMatchObject({ category: 'protocol' })
    const unauthorized = await serve((_request, response) => { response.writeHead(401); response.end('test-only-key private data') })
    let error: unknown
    try { await streamChatCompletion(input(unauthorized)) } catch (caught) { error = caught }
    expect(JSON.stringify(error)).not.toMatch(/test-only-key|private data/)
    expect(String(error)).not.toMatch(/test-only-key|private data/)
  })

  it('accepts one transport chunk containing many bounded SSE events', async () => {
    const endpoint = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(chunk({ choices: [{ delta: { content: 'x'.repeat(1000) } }] }).repeat(70) + chunk({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n')
    })
    expect((await streamChatCompletion(input(endpoint))).text).toHaveLength(70_000)
  })
})
