import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { streamChatCompletion } from '../src/main/services/agent-provider'

const servers: Server[] = []
async function serve(handler: Parameters<typeof createServer>[0]): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing loopback address')
  return `http://127.0.0.1:${address.port}/v1`
}
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))) })

const input = (endpoint: string, signal?: AbortSignal) => ({ endpoint, model: 'synthetic-model', apiKey: 'test-only-key', messages: [{ role: 'user' as const, content: 'hello' }], signal })
const chunk = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`

describe('OpenAI Chat Completions HTTP stream', () => {
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
