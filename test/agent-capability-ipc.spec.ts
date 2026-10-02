import { createServer, type ServerResponse, type Server } from 'node:http'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import type { TraceBridge } from '../src/shared/ipc-contract'

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>()
  return {
    handlers,
    ipcMain: { handle: (name: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => handlers.set(name, handler), removeHandler: (name: string) => handlers.delete(name) },
    ipcRenderer: { invoke: (name: string, payload: unknown) => handlers.get(name)?.({}, payload), on: vi.fn(), removeListener: vi.fn() },
    contextBridge: { exposeInMainWorld: (_name: string, bridge: unknown) => Reflect.set(window, 'trace', bridge) },
    dialog: {},
    safeStorage: {
      isAsyncEncryptionAvailable: async () => true,
      encryptStringAsync: async (value: string) => Buffer.from(value).reverse(),
      decryptStringAsync: async (value: Buffer) => ({ result: Buffer.from(value).reverse().toString(), shouldReEncrypt: false })
    }
  }
})
vi.mock('electron', () => electron)
let directory: string
let server: Server
let endpoint: string
let bridge: TraceBridge
let dispose: () => void
let bodies: unknown[]
let respond: (response: ServerResponse) => void
const log = vi.fn()
const probeResponse = (response: ServerResponse): void => {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'synthetic-call', type: 'function', function: { name: 'trace_capability_probe', arguments: '{"value":"ready"}' } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`)
}
beforeEach(async () => {
  vi.resetModules()
  vi.stubGlobal('window', {}) // Preserve Node fetch for real loopback HTTP.
  log.mockClear()
  directory = await fs.mkdtemp(join(tmpdir(), 'trace-capability-ipc-'))
  bodies = []
  respond = probeResponse
  server = createServer((request, response) => {
    let raw = ''
    request.on('data', (part) => { raw += part })
    request.on('end', () => { bodies.push(JSON.parse(raw)); respond(response) })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing address')
  endpoint = `http://127.0.0.1:${address.port}/v1`
  const { registerIpc } = await import('../src/main/ipc/register')
  dispose = registerIpc({ agentUserDataDir: directory, log } as unknown as Parameters<typeof registerIpc>[0])
  await import('../src/preload/index')
  bridge = window.trace
})
afterEach(async () => {
  dispose()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await fs.rm(directory, { recursive: true, force: true })
  vi.unstubAllGlobals()
})
async function createProfile(withKey = true): Promise<string> {
  const result = await bridge.invoke('agent:profile:create', { name: 'Synthetic', endpoint, model: 'synthetic-model' })
  if (!result.ok) throw new Error('Setup failed')
  if (withKey) await bridge.invoke('agent:key:set', { id: result.data.id, key: 'test-only-credential' })
  return result.data.id
}
describe('capability testing through window.trace', () => {
  it('sends only the fixed synthetic probe and persists a redacted result', async () => {
    const id = await createProfile()
    const result = await bridge.invoke('agent:capability:test', { id })
    expect(result).toMatchObject({ ok: true, data: { status: 'passed', testedAt: expect.any(String), errorCategory: null } })
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ model: 'synthetic-model', stream: true, messages: [{ role: 'user', content: 'Call the provided test function with value ready.' }], tools: [{ type: 'function', function: { name: 'trace_capability_probe', parameters: { additionalProperties: false, required: ['value'] } } }] })
    const listed = await bridge.invoke('agent:profile:list')
    expect(listed.data).toMatchObject({ profiles: [{ capability: result.data }] })
    expect(JSON.stringify([result, listed, log.mock.calls, bodies])).not.toContain('test-only-credential')
    expect(bodies).toHaveLength(1) // No tool execution or follow-up request.
  })
  it('fails closed without a Key and rejects fields other than an existing profile ID', async () => {
    const id = await createProfile(false)
    expect(await bridge.invoke('agent:capability:test', { id })).toMatchObject({ ok: true, data: { status: 'failed', errorCategory: 'missing-key' } })
    expect(await (bridge as unknown as { invoke(channel: string, payload: unknown): Promise<unknown> }).invoke('agent:capability:test', { id, endpoint, key: 'renderer-secret' })).toMatchObject({ ok: false })
    expect(bodies).toHaveLength(0)
    expect((await bridge.invoke('agent:profile:list')).data).toMatchObject({ profiles: [{ capability: { status: 'failed', errorCategory: 'missing-key' } }] })
    expect(JSON.stringify(log.mock.calls)).not.toContain('renderer-secret')
  })
  it('redacts provider failures and persists only the error category across a restart', async () => {
    const id = await createProfile()
    respond = (response) => { response.writeHead(401); response.end('private-provider-body test-only-credential') }
    const result = await bridge.invoke('agent:capability:test', { id })
    expect(result).toMatchObject({ ok: true, data: { status: 'failed', errorCategory: 'authentication' } })
    dispose()
    const { registerIpc } = await import('../src/main/ipc/register')
    dispose = registerIpc({ agentUserDataDir: directory, log } as unknown as Parameters<typeof registerIpc>[0])
    const listed = await bridge.invoke('agent:profile:list')
    expect(listed.data).toMatchObject({ profiles: [{ capability: result.data }] })
    expect(JSON.stringify([result, listed, log.mock.calls])).not.toMatch(/private-provider-body|test-only-credential/)
  })
  it.each(['model', 'endpoint', 'key', 'remove-key', 'delete', 'endpoint-roundtrip'] as const)('does not overwrite current capability after %s changes during the probe', async (change) => {
    const id = await createProfile()
    let release!: () => void
    respond = (response) => { release = () => probeResponse(response) }
    const running = bridge.invoke('agent:capability:test', { id })
    await vi.waitFor(() => expect(bodies).toHaveLength(1))
    const input = { id, name: 'Synthetic', endpoint, model: 'synthetic-model' }
    if (change === 'model') await bridge.invoke('agent:profile:update', { ...input, model: 'new-model' })
    if (change === 'endpoint' || change === 'endpoint-roundtrip') {
      await bridge.invoke('agent:profile:update', { ...input, endpoint: `${endpoint}/changed` })
      if (change === 'endpoint-roundtrip') await bridge.invoke('agent:profile:update', input)
    }
    if (change === 'key') await bridge.invoke('agent:key:set', { id, key: 'test-only-replacement' })
    if (change === 'remove-key') await bridge.invoke('agent:key:remove', { id })
    if (change === 'delete') await bridge.invoke('agent:profile:delete', { id })
    release()
    expect(await running).toMatchObject({ ok: true, data: { status: 'needs-retest', testedAt: null, errorCategory: null } })
    const listed = await bridge.invoke('agent:profile:list')
    expect(listed.data).toMatchObject({ profiles: change === 'delete' ? [] : [{ capability: { status: 'needs-retest' } }] })
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/test-only-credential|test-only-replacement/)
  })
})
