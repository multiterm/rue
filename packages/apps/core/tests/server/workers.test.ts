import { randomUUID } from 'node:crypto'
import { afterEach, expect, test, vi } from 'vitest'
import { WebSocket } from 'ws'
import { ConfigSchema } from '../../src/config/index.js'
import { openDatabase } from '../../src/storage/index.js'
import { Bus } from '../../src/bus/index.js'
import { listen, type RueServer } from '../../src/server/listen.js'
import {ProjectAuthority} from '../../src/server/project-authority.js'
import { controlSession } from '../../../worker/src/control.js'

let server: RueServer | undefined
const clients: WebSocket[] = [], aborts: AbortController[] = []
const nativeFetch = globalThis.fetch
const health = { version: '0.1.0', platform: 'linux', architecture: 'x64', dockerAvailable: true, acceptingWork: false, freeMemoryBytes: 1000, cpus: 2, capabilities: ['host-health-v1'] }
afterEach(async () => { aborts.splice(0).forEach(a => a.abort()); clients.splice(0).forEach(c => c.terminate()); await server?.close(); server?.ctx.db.close(); server = undefined; vi.restoreAllMocks(); vi.unstubAllEnvs() })
async function setup(enabled = true) {
  vi.stubEnv('RUE_SETTINGS_ENCRYPTION_KEY',Buffer.alloc(32,3).toString('base64'))
  vi.stubEnv('RUE_MANAGED_WORKERS', String(enabled)); vi.stubEnv('RUE_TERMINAL_BRIDGE', 'true')
  const auth = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url) === 'https://identity.test/v1/token/verify') {
      const token = JSON.parse(String(init?.body)).token
      return ['alice','bob'].includes(token) ? Response.json({ token: { subject: token, principalType: 'user' } }) : new Response(null, { status: 401 })
    }
    return nativeFetch(url, init)
  })
  const config = ConfigSchema.parse({ server: { hostname: '127.0.0.1', port: 0 }, keyname: { enabled: true, apiUrl: 'https://identity.test' } })
  const db=openDatabase(':memory:'),projectAuthority=new ProjectAuthority(db,{origin:'https://tenancy.test',verifyKey:async token=>{const subject=token==='tnk_'+'a'.repeat(43)?'alice':token==='tnk_'+'b'.repeat(43)?'bob':undefined;return subject?{id:'key_'+subject,owner:{type:'self' as const,subject},name:'Test',service:'rue' as const,grants:['rue:hosts:enroll','rue:agents:execute'],createdAt:Date.now(),expiresAt:Date.now()+3600000,revokedAt:null}:undefined}})
  server = await listen({ config, ctx: { db, bus: new Bus(), config,projectAuthority } })
  const account = (path: string, data?: unknown, token = 'alice', method = data ? 'POST' : 'GET') => nativeFetch(server!.url + path, { method, headers: { authorization: `Bearer ${path==='/workers'&&method==='POST'&&['alice','bob'].includes(token)?'tnk_'+token[0]!.repeat(43):token}`, 'content-type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) })
  return { account, auth }
}
function socket(path = '/worker-client/socket', origin?: string) {
  const ws = new WebSocket(server!.url.replace('http:', 'ws:') + path, origin ? { origin } : {})
  clients.push(ws)
  return ws
}
function opened(ws: WebSocket) { return new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) }) }
function frame(ws: WebSocket) { return new Promise<any>((resolve, reject) => { ws.once('message', data => resolve(JSON.parse(data.toString()))); ws.once('error', reject) }) }

test('enrollment requires explicit consent, scopes account APIs and never lists secrets', async () => {
  const { account, auth } = await setup()
  expect((await account('/workers', { name: 'Mason', requestId: randomUUID() })).status).toBe(400)
  const input = { expectedOwnerSubject: 'alice', name: 'Mason', requestId: randomUUID(), acknowledgeHostControl: true }
  expect((await account('/workers', input, 'bob')).status).toBe(409)
  const response = await account('/workers', input), grant = await response.json()
  expect(response.status).toBe(201); expect(response.headers.get('cache-control')).toContain('no-store')
  expect((await (await account('/workers', input)).json()).secret).toBeUndefined()
  expect((await (await account('/workers', undefined, 'bob')).json()).workers).toEqual([])
  expect((await account(`/workers/${grant.worker.id}`, { action: 'drain', expectedRevision: 0 }, 'bob', 'PATCH')).status).toBe(404)
  const calls = auth.mock.calls.length
  expect((await account('/session', undefined, grant.secret)).status).toBe(401)
  expect(auth.mock.calls.length).toBe(calls)
  expect(JSON.stringify(await (await account('/workers')).json())).not.toContain(grant.secret)
})
test('real worker client maintains one connection, receives drain push, and fails closed on revocation', async () => {
  const { account } = await setup()
  const grant = await (await account('/workers', { expectedOwnerSubject: 'alice', name: 'Mason', requestId: randomUUID(), acknowledgeHostControl: true })).json()
  const abort = new AbortController(); aborts.push(abort)
  const observed = vi.fn(), factory = vi.fn(() => socket())
  const run = controlSession({ config: { id: grant.worker.id, origin: 'https://rue.test', secret: grant.secret, stateDir: '/unused', dockerSocket: '/unused' }, instance: randomUUID(), signal: abort.signal, health: () => health, observed, socket: factory }).catch(error => error)
  await vi.waitFor(() => expect(observed.mock.calls.at(-1)?.[0].worker.health?.dockerAvailable).toBe(true))
  await account(`/workers/${grant.worker.id}`, { action: 'drain', expectedRevision: 0 }, 'alice', 'PATCH')
  await vi.waitFor(() => expect(observed.mock.calls.at(-1)?.[0].worker.desired).toBe('draining'))
  expect(factory).toHaveBeenCalledTimes(1)
  await account(`/workers/${grant.worker.id}`, { action: 'revoke', expectedRevision: 1 }, 'alice', 'PATCH')
  expect(await run).toMatchObject({ code: 'worker_authority_rejected', fatal: true })
  await vi.waitFor(() => expect(server!.ctx.bus.listenerCount()).toBe(0))
})
test('worker socket rejects account credentials, unsupported frames and cross-protocol credentials', async () => {
  const { account } = await setup()
  const grant = await (await account('/workers', { expectedOwnerSubject: 'alice', name: 'Mason', requestId: randomUUID(), acknowledgeHostControl: true })).json()
  const bad = socket(); await opened(bad)
  const denial = frame(bad)
  bad.send(JSON.stringify({ type: 'authenticate', protocol: 1, id: grant.worker.id, token: 'alice', instance: randomUUID() }))
  expect((await denial).type).toBe('error')
  const ws = socket(); await opened(ws)
  let next = frame(ws)
  ws.send(JSON.stringify({ type: 'authenticate', protocol: 1, id: grant.worker.id, token: grant.secret, instance: randomUUID() }))
  expect((await next).type).toBe('ready')
  next = frame(ws); ws.send(JSON.stringify({ type: 'execute', command: 'arbitrary' }))
  expect((await next).type).toBe('error')
  const terminal = socket('/terminal-client/socket'); await opened(terminal)
  const closed = new Promise<number>(resolve => terminal.once('close', resolve))
  terminal.send(JSON.stringify({ type: 'authenticate', id: grant.worker.id, token: grant.secret, instance: randomUUID() }))
  expect(await closed).toBe(1008)
})
test('upgrade dispatcher rejects browser origins, unknown paths and query credentials', async () => {
  await setup()
  for (const [path, origin] of [['/worker-client/socket', 'https://browser.test'], ['/other', undefined], ['/worker-client/socket?token=no', undefined]]) {
    const ws = socket(path, origin)
    await expect(opened(ws)).rejects.toThrow('403')
  }
})
test('worker enrollment and socket are unavailable unless explicitly enabled', async () => {
  const { account } = await setup(false)
  expect((await account('/workers')).status).toBe(404)
  await expect(opened(socket())).rejects.toThrow('403')
})
