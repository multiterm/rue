import { randomUUID } from 'node:crypto'
import { afterEach, expect, test, vi } from 'vitest'
import { ConfigSchema } from '../../src/config/index.js'
import { openDatabase, listMessages, listSessionParts } from '../../src/storage/index.js'
import { Bus } from '../../src/bus/index.js'
import { listen, type RueServer } from '../../src/server/listen.js'
import { Bridge, beginPairing, client } from '../../../../../extensions/rue/bridge.mjs'

let server: RueServer | undefined, bridge: Bridge | undefined
const streams: AbortController[] = []
const networkFetch = globalThis.fetch
afterEach(async () => { streams.splice(0).forEach(s => s.abort()); bridge?.stop(); bridge = undefined; await server?.close(); server?.ctx.db.close(); server = undefined; vi.unstubAllEnvs(); vi.restoreAllMocks() })
async function setup(runtime?: string) {
  vi.stubEnv('RUE_TERMINAL_BRIDGE', runtime ? 'false' : 'true')
  if (runtime) vi.stubEnv('SANDBLOCKS_RUNTIME', runtime)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
    if (String(url) === 'https://identity.test/v1/token/verify') {
      const token = JSON.parse(String(options?.body)).token
      return ['alice','bob'].includes(token) ? Response.json({ token: { subject: token, principalType: 'user' } }) : new Response(null, { status: 401 })
    }
    return networkFetch(url, options)
  })
  const db = openDatabase(':memory:')
  server = await listen({ ctx: { db, bus: new Bus(), config: ConfigSchema.parse({ server: { hostname: '127.0.0.1', port: 0 }, keyname: { enabled: true, apiUrl: 'https://identity.test' } }) }, config: ConfigSchema.parse({ server: { hostname: '127.0.0.1', port: 0 } }) })
  const url = server.url, origin = 'https://rue.test', sent: string[] = []
  const fetcher = async (target: string, init: RequestInit) => { sent.push(String(init.body ?? '')); return networkFetch(url + new URL(target).pathname, init) }
  const account = (path: string, data?: unknown, owner = 'alice', method = data ? 'POST' : 'GET') => networkFetch(url + path, { method, headers: { authorization: `Bearer ${owner}`, 'content-type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) })
  const pairing = await beginPairing(origin, 'pi-session', fetcher)
  const { code } = await (await account(`/terminal/requests/${pairing.requestId}/approve`, { expectedOwnerSubject: 'alice', botName: 'Test computer' })).json()
  const grant = await client(origin, undefined, fetcher)('/exchange', { requestId: pairing.requestId, verifier: pairing.verifier, code })
  await client(origin, grant.token, fetcher)('/activate', { confirmOwnerSubject: 'alice' })
  return { db, origin, grant, fetcher, account, sent }
}
test('legacy development container tag enables the bridge; production does not', async () => {
  await setup('develop')
  await server!.close(); server!.ctx.db.close(); server = undefined
  await expect(setup('production')).rejects.toMatchObject({ status: 401 })
})
test('real HTTP dashboard → locally approved agent → persisted reply; revoked credentials stop access', async () => {
  const { db, origin, grant, fetcher, account, sent } = await setup()
  const streamAbort = new AbortController(); streams.push(streamAbort)
  const response = await networkFetch(server!.url + '/event', { headers: { authorization: 'Bearer alice' }, signal: streamAbort.signal })
  let events = ''
  const readEvents = (async () => { try { for await (const chunk of response.body!) events += new TextDecoder().decode(chunk) } catch {} })()
  const save = vi.fn(), send = vi.fn(), cancel = vi.fn(), confirm = vi.fn(async () => true)
  bridge = new Bridge({ ...grant, origin, outbox: [] }, { save }, { idle: () => true, send, cancel, confirm, notify: vi.fn() }, fetcher)
  await bridge.start(); clearInterval(bridge.timer)
  expect((await account(`/terminal/computers/${grant.id}`, { expectedOwnerSubject: 'bob', name: 'Stolen', remoteEnabled: true, expectedRevision: 0 }, 'bob', 'PATCH')).status).toBe(409)
  expect((await account(`/terminal/computers/${grant.id}`, { expectedOwnerSubject: 'alice', name: 'Computer', remoteEnabled: true, expectedRevision: 0 }, 'alice', 'PATCH')).status).toBe(200)
  const requestId = randomUUID(), prompt = '/never-run-as-a-command Please say hello'
  const first = await account(`/session/${grant.sessionId}/message`, { text: prompt, requestId, wait: true })
  expect(first.status).toBe(200); expect((await first.json()).stopReason).toBe('queued')
  expect((await account(`/session/${grant.sessionId}/message`, { text: prompt, requestId })).status).toBe(200)
  await bridge.tick()
  await vi.waitFor(() => expect(send).toHaveBeenCalledExactlyOnceWith(prompt))
  expect(confirm).toHaveBeenCalledOnce()
  bridge.message({ role: 'user', content: prompt }) // no echo
  bridge.message({ role: 'toolResult', content: [{ type: 'text', text: 'DO_NOT_UPLOAD_TOOL_OUTPUT' }] })
  bridge.message({ role: 'assistant', content: [{ type: 'thinking', thinking: 'DO_NOT_UPLOAD_REASONING' }, { type: 'text', text: 'Hello from the local agent' }], stopReason: 'stop', apiKey: 'DO_NOT_UPLOAD_KEY' })
  bridge.settled(); await bridge.tick()
  expect(listMessages(db, grant.sessionId)).toHaveLength(2)
  expect(listSessionParts(db, grant.sessionId).at(-1)?.payload.text).toBe('Hello from the local agent')
  await vi.waitFor(() => { expect(events).toContain('message.created'); expect(events).toContain('part.updated') })
  streamAbort.abort(); await readEvents
  expect(sent.join('\n')).not.toContain('DO_NOT_UPLOAD')
  expect(db.prepare('SELECT count(*) AS n FROM agent_settings').get()).toEqual({ n: 0 })
  expect((await account(`/session/${grant.sessionId}`, undefined, 'bob')).status).toBe(404)
  await account(`/terminal/connections/${grant.id}`, undefined, 'alice', 'DELETE')
  await bridge.tick(); expect(bridge.stopped).toBe(true)
  expect((await account('/agent/settings', undefined, grant.token)).status).toBe(401)
})
test('lost mirror acknowledgement retries once without duplicates; reconnect does not replay a claimed prompt', async () => {
  const { db, origin, grant, fetcher, account } = await setup()
  let loseAck = true
  const dropping = async (url: string, init: RequestInit) => { const r = await fetcher(url, init); if (url.endsWith('/mirror') && loseAck) { loseAck = false; throw Error('lost response') } return r }
  const state = { ...grant, origin, outbox: [] }, adapter = { idle: () => false, send: vi.fn(), cancel: vi.fn(), confirm: vi.fn(async () => false), notify: vi.fn() }
  bridge = new Bridge(state, { save: vi.fn() }, adapter, dropping)
  await bridge.start(); clearInterval(bridge.timer)
  bridge.message({ role: 'user', content: 'Typed locally' })
  await bridge.tick(); expect(state.outbox).toHaveLength(1)
  await bridge.tick(); expect(state.outbox).toHaveLength(0)
  expect(listMessages(db, grant.sessionId)).toHaveLength(1)
  await account(`/terminal/computers/${grant.id}`, { expectedOwnerSubject: 'alice', name: 'Computer', remoteEnabled: true, expectedRevision: 0 }, 'alice', 'PATCH')
  await account(`/session/${grant.sessionId}/message`, { text: 'Ambiguous run', requestId: randomUUID() })
  const snapshot = await bridge.call('poll', { instance: bridge.instance })
  const id = snapshot.commands[0].id
  await bridge.call(`commands/${id}/claim`, { instance: bridge.instance })
  await bridge.call(`commands/${id}/start`, { instance: bridge.instance })
  bridge.stop()
  bridge = new Bridge(state, { save: vi.fn() }, adapter, fetcher)
  await bridge.start(); clearInterval(bridge.timer)
  expect(adapter.send).not.toHaveBeenCalled()
  expect(db.prepare('SELECT status FROM terminal_commands WHERE id=?').get(id)).toEqual({ status: 'interrupted' })
})
