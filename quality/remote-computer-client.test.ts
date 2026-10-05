import { expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync, statSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { httpsOrigin, textOnly, sharedMessage, privateStore, client, Bridge } from '../extensions/rue/bridge.ts'

test('remote transport requires HTTPS, never follows credential redirects, and never serializes non-text agent data', async () => {
  for (const bad of ['http://localhost:4097', 'https://user:secret@api.test', 'https://api.test/path', 'https://api.test?key=x']) expect(() => httpsOrigin(bad)).toThrow()
  const fetcher = vi.fn(async () => Response.json({ ok: true }))
  await client('https://api.test', 'bridge-token', fetcher)('/requests', { safe: true })
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error', headers: { authorization: 'Bearer bridge-token' } })
  expect(textOnly({ role: 'assistant', content: [{ type: 'text', text: 'Hello' }, { type: 'thinking', thinking: 'secret' }, { type: 'toolCall', arguments: { secret: true } }], apiKey: 'private' })).toBe('Hello')
  expect(textOnly({ role: 'toolResult', content: 'secret' })).toBe('')
  expect(textOnly({ role: 'system', content: 'secret' })).toBe('')
})
test('assistant failures and interruptions retain their outcome in final mirrored snapshots',()=>{
 const state={origin:'https://api.test',token:'fixture',id:'conn',piSessionId:'session',outbox:[] as any[]}
 const bridge=new Bridge(state,{save:vi.fn()},{idle:()=>true,send:vi.fn(),cancel:vi.fn(),confirm:async()=>false,notify:vi.fn()})
 bridge.message({role:'assistant',content:'Safe failure',stopReason:'error'})
 bridge.message({role:'assistant',content:[{type:'text',text:'Interrupted reply'}],stopReason:'aborted'})
 expect(state.outbox.map(item=>item.snapshot)).toEqual([expect.objectContaining({final:true,outcome:'failed'}),expect.objectContaining({final:true,outcome:'interrupted'})])
})
test('thinking defaults private; enabling mid-message does not backfill private blocks, and hiding closes shared blocks', () => {
  const state = { origin: 'https://api.test', token: 'fixture', id: 'conn', piSessionId: 'session', outbox: [] as any[], shareThinking: false }
  const b = new Bridge(state, { save: vi.fn() }, { idle: () => true, send: vi.fn(), cancel: vi.fn(), confirm: async () => false, notify: vi.fn() })
  b.beginMessage({ role: 'assistant' })
  b.message({ role: 'assistant', content: [{ type: 'thinking', thinking: 'PRIVATE_BEFORE_ENABLE' }] }, true)
  expect(state.outbox).toHaveLength(0)
  state.shareThinking = true
  const content = [{ type: 'thinking', thinking: 'PRIVATE_BEFORE_ENABLE' }, { type: 'text', text: 'Commentary' }, { type: 'thinking', thinking: 'Shared exposed thinking' }]
  b.message({ role: 'assistant', content }, true)
  expect(state.outbox.map(entry => entry.text)).toEqual(['Commentary', 'Shared exposed thinking'])
  state.shareThinking = false; b.finishThinking()
  expect(state.outbox[1].snapshot).toMatchObject({ final: true, reasoning: { chunk: 0 } })
  b.message({ role: 'assistant', content: [...content.slice(0, 2), { type: 'thinking', thinking: 'PRIVATE_AFTER_DISABLE' }] })
  expect(JSON.stringify(state.outbox)).not.toContain('PRIVATE_')
})

test('tool text requires explicit sharing and excludes images, metadata, and reasoning', () => {
  const message = { role: 'toolResult', toolName: 'bash', isError: true, content: [{ type: 'text', text: 'failure\n```\noutput' }, { type: 'image', data: 'PRIVATE_IMAGE' }], details: { secret: 'PRIVATE_DETAILS' } }
  expect(sharedMessage(message)).toBeUndefined()
  const shared = sharedMessage(message, true)
  expect(shared).toEqual({ role: 'assistant', content: 'Tool output: bash (error)\n\n````text\nfailure\n```\noutput\n````' })
  expect(JSON.stringify(shared)).not.toContain('PRIVATE')
  const state = { origin: 'https://api.test', token: 'fixture', id: 'conn', outbox: [], shareToolOutput: true }
  const b = new Bridge(state, { save: vi.fn() }, { notify: vi.fn() })
  b.message(message)
  expect(state.outbox).toHaveLength(1)
  expect(state.outbox[0]).toMatchObject({ role: 'assistant', text: shared!.content })
  expect(textOnly({ role: 'assistant', content: [{ type: 'thinking', thinking: 'PRIVATE_THINKING' }] })).toBe('')
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
