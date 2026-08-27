import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp } from '../../src/server/index.js'
import { Bus } from '../../src/bus/index.js'
import { ConfigSchema } from '../../src/config/index.js'
import { openDatabase } from '../../src/storage/index.js'
import type { ServerContext } from '../../src/server/index.js'

function makeCtx(passwordProtected = false): ServerContext {
  const config = ConfigSchema.parse(
    passwordProtected ? { server: { hostname: '127.0.0.1', port: 0, password: 'secret' } } : {},
  )
  return { db: openDatabase(':memory:'), config, bus: new Bus() }
}

describe('server: routes', () => {
  let ctx: ServerContext
  beforeEach(() => {
    ctx = makeCtx()
  })
  afterEach(() => {
    ctx.db.close()
  })

  it('GET /health returns 200', async () => {
    const app = createApp({ ctx })
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; version: string }
    expect(body.ok).toBe(true)
    expect(body.version).toBe('0.0.0')
  })

  it('GET /doc returns an OpenAPI document', async () => {
    const app = createApp({ ctx })
    const res = await app.request('/doc')
    expect(res.status).toBe(200)
    const spec = (await res.json()) as {
      openapi: string
      paths: Record<string, unknown>
    }
    expect(spec.openapi).toBe('3.0.0')
    expect(spec.paths['/health']).toBeTruthy()
    expect(spec.paths['/session']).toBeTruthy()
    expect(spec.paths['/session/{id}']).toBeTruthy()
  })

  it('sessions CRUD round-trip', async () => {
    const app = createApp({ ctx })

    const created = await app
      .request('/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'first', provider: 'anthropic' }),
      })
      .then((r) => r.json() as Promise<{ id: string; title: string; provider: string }>)
    expect(created.title).toBe('first')
    expect(created.provider).toBe('anthropic')

    const list = await app.request('/session').then((r) => r.json() as Promise<unknown[]>)
    expect(list).toHaveLength(1)

    const detail = await app
      .request(`/session/${created.id}`)
      .then((r) => r.json() as Promise<{ id: string }>)
    expect(detail.id).toBe(created.id)

    const patched = await app
      .request(`/session/${created.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'renamed' }),
      })
      .then((r) => r.json() as Promise<{ title: string }>)
    expect(patched.title).toBe('renamed')

    const deleted = await app
      .request(`/session/${created.id}`, { method: 'DELETE' })
      .then((r) => r.json() as Promise<{ deleted: boolean }>)
    expect(deleted.deleted).toBe(true)

    const after = await app.request(`/session/${created.id}`)
    expect(after.status).toBe(404)
  })

  it('publishes bus events on session lifecycle', async () => {
    const events: Array<{ type: string; payload: unknown }> = []
    ctx.bus.subscribe((e) => events.push({ type: e.type, payload: e.payload }))

    const app = createApp({ ctx })
    const created = await app
      .request('/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 't' }),
      })
      .then((r) => r.json() as Promise<{ id: string }>)
    await app.request(`/session/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'u' }),
    })
    await app.request(`/session/${created.id}`, { method: 'DELETE' })

    expect(events.map((e) => e.type)).toEqual([
      'session.created',
      'session.updated',
      'session.deleted',
    ])
  })
})

describe('server: Keyname auth', () => {
  it('requires and verifies bearer tokens when enabled', async () => {
    const ctx = makeCtx()
    ctx.config.keyname.enabled = true
    const app = createApp({ ctx })
    expect((await app.request('/session')).status).toBe(401)

    const verify = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ token: { subject: 'user_1', principalType: 'user' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const authenticated = await app.request('/session', {
      headers: { authorization: 'Bearer keyname-token' },
    })
    expect(authenticated.status).toBe(200)
    expect(verify).toHaveBeenCalledWith(
      'https://api.keyname.dev/v1/token/verify',
      expect.objectContaining({ method: 'POST' }),
    )
    verify.mockRestore()
    ctx.db.close()
  })

  it('isolates sessions by verified Keyname subject', async () => {
    const ctx = makeCtx()
    ctx.config.keyname.enabled = true
    const app = createApp({ ctx })
    const verify = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const token = (JSON.parse(String(init?.body)) as { token: string }).token
      return new Response(JSON.stringify({ token: { subject: token, principalType: 'user' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const created = await app.request('/session', {
      method: 'POST',
      headers: { authorization: 'Bearer user_a', 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'private' }),
    })
    expect(created.status).toBe(200)
    expect(await app.request('/session', { headers: { authorization: 'Bearer user_a' } }).then((r) => r.json())).toHaveLength(1)
    expect(await app.request('/session', { headers: { authorization: 'Bearer user_b' } }).then((r) => r.json())).toHaveLength(0)
    verify.mockRestore()
    ctx.db.close()
  })
})

describe('server: basic auth', () => {
  it('rejects unauthenticated requests when password set, but allows /doc and /health', async () => {
    const ctx = makeCtx(true)
    const app = createApp({ ctx })

    const unauth = await app.request('/session')
    expect(unauth.status).toBe(401)
    expect(unauth.headers.get('www-authenticate')).toMatch(/^Basic/i)

    const docOk = await app.request('/doc')
    expect(docOk.status).toBe(200)
    const healthOk = await app.request('/health')
    expect(healthOk.status).toBe(200)

    const authHeader = 'Basic ' + Buffer.from(':secret').toString('base64')
    const authed = await app.request('/session', { headers: { authorization: authHeader } })
    expect(authed.status).toBe(200)
    ctx.db.close()
  })
})
