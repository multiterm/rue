import { createHash, randomBytes } from 'node:crypto'
import { afterEach, expect, test, vi } from 'vitest'
import { createApp } from '../../src/server/index.js'
import { ConfigSchema } from '../../src/config/index.js'
import { openDatabase } from '../../src/storage/index.js'
import { Bus } from '../../src/bus/index.js'

const databases: ReturnType<typeof openDatabase>[] = []
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.unstubAllGlobals(); vi.restoreAllMocks() })
function fixture(enabled = true, keyname = true) {
  const db = openDatabase(':memory:'); databases.push(db)
  const verify = vi.fn(async (_url, init) => {
    const token = JSON.parse(init.body).token
    return token === 'alice' || token === 'bob' || token === 'machine'
      ? Response.json({ token: { subject: token, principalType: token === 'machine' ? 'machine' : 'user' } })
      : new Response(null, { status: 401 })
  })
  vi.stubGlobal('fetch', verify)
  const app = createApp({ terminalPairing: enabled, ctx: { db, bus: new Bus(), config: ConfigSchema.parse({ keyname: { enabled: keyname, apiUrl: 'https://keyname.test' } }) } })
  const request = (path: string, body?: unknown, token?: string, method = body === undefined ? 'GET' : 'POST') => app.request(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const verifier = randomBytes(32).toString('base64url')
  const start = () => request('/terminal-client/requests', { challenge: createHash('sha256').update(verifier).digest('hex'), piSessionId: 'local-session' })
  return { db, app, request, start, verifier, verify }
}
test('HTTP pairing requires browser identity, terminal proof, explicit owner confirmation, and single-use exchange', async () => {
  const { request, start, verifier, verify } = fixture()
  const created = await start()
  expect(created.status).toBe(201); expect(created.headers.get('cache-control')).toBe('no-store')
  expect(verify).not.toHaveBeenCalled()
  const { requestId } = await created.json()
  const path = `/terminal/requests/${requestId}/approve`
  const body = { expectedOwnerSubject: 'alice', botName: 'Work terminal' }
  expect((await request(path, body)).status).toBe(401)
  expect((await request(path, body, 'machine')).status).toBe(403)
  expect((await request(path, body, 'bob')).status).toBe(409)
  const approved = await request(path, body, 'alice')
  expect(approved.headers.get('cache-control')).toBe('no-store')
  const { code } = await approved.json()
  expect((await request(path, body, 'alice')).status).toBe(409)
  const exchange = { requestId, verifier, code }
  expect((await request('/terminal-client/exchange', { ...exchange, verifier: randomBytes(32).toString('base64url') })).status).toBe(400)
  const response = await request('/terminal-client/exchange', exchange)
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store')
  const grant = await response.json()
  const statusPath = `/terminal-client/connections/${grant.id}`
  expect((await request(statusPath, undefined, grant.token)).status).toBe(401)
  expect((await request('/terminal-client/activate', { confirmOwnerSubject: 'bob' }, grant.token)).status).toBe(401)
  expect((await request('/terminal-client/activate', { confirmOwnerSubject: 'alice' }, grant.token)).status).toBe(200)
  expect((await request(statusPath, undefined, grant.token)).status).toBe(200)
  expect((await request('/terminal-client/exchange', exchange)).status).toBe(400)
  const count = verify.mock.calls.length
  expect((await request('/agent/settings', undefined, grant.token)).status).toBe(401)
  expect(verify).toHaveBeenCalledTimes(count) // No bridge credential sent to an identity provider.
  expect(await (await request('/terminal/connections', undefined, 'bob')).json()).toEqual({ connections: [] })
  expect((await request(`/terminal/connections/${grant.id}`, undefined, 'bob', 'DELETE')).status).toBe(404)
  expect((await request(`/session/${grant.sessionId}/message`, { text: 'Do not execute in the cloud' }, 'alice')).status).toBe(503)
  expect((await request(`/terminal/connections/${grant.id}`, undefined, 'alice', 'DELETE')).status).toBe(200)
  expect((await request(statusPath, undefined, grant.token)).status).toBe(401)
})
test('a terminal can decline an inactive grant without revoking another connection', async () => {
  const { app, request, start, verifier } = fixture()
  const { requestId } = await (await start()).json()
  const { code } = await (await request(`/terminal/requests/${requestId}/approve`, { expectedOwnerSubject: 'alice', botName: 'Pi' }, 'alice')).json()
  const grant = await (await request('/terminal-client/exchange', { requestId, verifier, code })).json()
  const own = `/terminal-client/connections/${grant.id}`
  expect((await app.request('/terminal-client/activate', { method: 'POST', headers: { authorization: grant.token, 'content-type': 'application/json' }, body: JSON.stringify({ confirmOwnerSubject: 'alice' }) })).status).toBe(401)
  expect((await request(`/terminal-client/connections/term_${'x'.repeat(32)}`, undefined, grant.token, 'DELETE')).status).toBe(401)
  expect((await request(own, undefined, grant.token, 'DELETE')).status).toBe(200)
  expect((await request('/terminal-client/activate', { confirmOwnerSubject: 'alice' }, grant.token)).status).toBe(401)
})
test('malformed/oversized inputs are rejected without secret reflection; unknown client routes cannot fall through', async () => {
  const { app, request } = fixture()
  const secret = 'never-echo-this-secret'
  const bad = await request('/terminal-client/exchange', { verifier: secret })
  expect(bad.status).toBe(400); expect(await bad.text()).not.toContain(secret)
  expect((await request('/terminal-client/requests', { challenge: 'x'.repeat(5000) })).status).toBe(413)
  expect((await app.request('/terminal-client/requests', { method: 'POST', body: '{' })).status).toBe(400)
  expect((await request('/terminal-client/agent/settings', undefined, 'alice')).status).toBe(404)
})
test('public pairing budget is bounded without trusting spoofed forwarded addresses', async () => {
  const { start } = fixture()
  for (let i = 0; i < 60; i++) expect((await start()).status).toBe(201)
  const denied = await start()
  expect(denied.status).toBe(429); expect(denied.headers.get('retry-after')).toBe('60')
})
test('feature stays unavailable by default and without Keyname', async () => {
  expect((await fixture(false).start()).status).toBe(401)
  expect((await fixture(true, false).start()).status).toBe(404)
})
