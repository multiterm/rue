import { expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync, statSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { httpsOrigin, textOnly, privateStore, client, Bridge } from '../extensions/rue/bridge.mjs'

test('remote transport requires HTTPS, never follows credential redirects, and never serializes non-text agent data', async () => {
  for (const bad of ['http://localhost:4097', 'https://user:secret@api.test', 'https://api.test/path', 'https://api.test?key=x']) expect(() => httpsOrigin(bad)).toThrow()
  const fetcher = vi.fn(async () => Response.json({ ok: true }))
  await client('https://api.test', 'bridge-token', fetcher)('/requests', { safe: true })
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error', headers: { authorization: 'Bearer bridge-token' } })
  expect(textOnly({ role: 'assistant', content: [{ type: 'text', text: 'Hello' }, { type: 'thinking', thinking: 'secret' }, { type: 'toolCall', arguments: { secret: true } }], apiKey: 'private' })).toBe('Hello')
  expect(textOnly({ role: 'toolResult', content: 'secret' })).toBe('')
  expect(textOnly({ role: 'system', content: 'secret' })).toBe('')
})
test('private credentials and outbox bind to both origin and session; simultaneous owners are rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'rue-link-test-'))
  try {
    const store = privateStore('https://api.test', 'session-one', root)
    const release = store.acquire()
    expect(() => store.acquire()).toThrow()
    store.save({ origin: 'https://api.test', piSessionId: 'session-one', token: 'fixture-bridge-token', outbox: [] })
    expect(store.load()?.token).toBe('fixture-bridge-token')
    expect(privateStore('https://api.test', 'session-two', root).load()).toBeUndefined()
    expect(privateStore('https://other.test', 'session-one', root).load()).toBeUndefined()
    expect(() => store.save({ origin: 'https://other.test', piSessionId: 'session-one' })).toThrow()
    const file = readdirSync(root).find(f => f.endsWith('.json'))!
    expect(statSync(join(root, file)).mode & 0o777).toBe(0o600)
    expect(readFileSync(join(root, file), 'utf8')).not.toContain('OPENAI')
    release(); const releaseAgain = store.acquire(); releaseAgain()
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('revocation while awaiting local approval never dispatches; stopping a remote run cancels only that run', async () => {
  let confirm!: (value: boolean) => void
  const adapter = { idle: () => true, send: vi.fn(), cancel: vi.fn(), notify: vi.fn(), confirm: () => new Promise<boolean>(resolve => { confirm = resolve }) }
  const b = new Bridge({ origin: 'https://api.test', token: 'fixture', id: 'conn', outbox: [] }, { save: vi.fn() }, adapter, async () => Response.json({}))
  const pending = b.dispatch({ id: 'run', text: '/dangerous-command' })
  await vi.waitFor(() => expect(confirm).toBeTypeOf('function'))
  b.stop(); confirm(true); await pending
  expect(adapter.send).not.toHaveBeenCalled(); expect(adapter.cancel).not.toHaveBeenCalled()
  const active = new Bridge({ origin: 'https://api.test', token: 'fixture', id: 'conn', outbox: [] }, { save: vi.fn() }, adapter)
  active.running = 'own-remote-run'; active.stop(); active.stop()
  expect(adapter.cancel).toHaveBeenCalledTimes(1)
})
