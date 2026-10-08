import { afterEach, expect, test, vi } from 'vitest'
import {agentStatus} from '../extensions/rue/status.ts'
import { Bridge, client } from '../extensions/rue/bridge.ts'

const bridges: Bridge[] = []
afterEach(() => { bridges.splice(0).forEach(b => b.stop()); vi.useRealTimers() })
function fixture(intercept?: (url: string, init: RequestInit) => Response | Promise<Response> | undefined) {
  vi.useFakeTimers()
  const adapter = { idle: () => false, send: vi.fn(), cancel: vi.fn(), confirm: async () => true, notify: vi.fn() }
  const store = { save: vi.fn() }
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    const override = intercept?.(url, init)
    if (override) return override
    return Response.json({ lease: { protocol: 2, expiresAt: Date.now() + 60000, serverNow: Date.now() }, remoteEnabled: true, commands: b.running ? [{ id: b.running, status: 'running' }] : [] })
  })
  const b = new Bridge({ id: 'conn', token: 'private-token', origin: 'https://api.test', piSessionId: 'session', outbox: [] }, store, adapter, fetcher)
  bridges.push(b)
  return { b, adapter, fetcher, store }
}

test.each([false,true])('status reporting requires consent and server capability (%s)',async supported=>{
 const {b,adapter,fetcher}=fixture(()=>Response.json({lease:{protocol:2,expiresAt:Date.now()+60000,serverNow:Date.now(),...(supported?{agentStatusVersion:1}:{})},remoteEnabled:false,commands:[]}))
 const status=vi.fn(()=>agentStatus({cwd:'/private-directory',branch:null,idle:true,thinking:'off',entries:[]}));Object.assign(adapter,{status});b.state.shareStatus=true
 await b.start();await b.tick()
 const polls=fetcher.mock.calls.filter(([url])=>/\/(poll|heartbeat)$/.test(url));expect(polls.length).toBeGreaterThan(0)
 for(const [,init] of polls)expect(JSON.parse(String(init.body)).health.status?.cwd).toBe(supported?'/private-directory':undefined)
 if(!supported)expect(status).not.toHaveBeenCalled()
})
test('slow uploads cannot starve heartbeats; revocation cancels only the owned turn', async () => {
  let release!: (response: Response) => void, revoked = false
  const pending = new Promise<Response>(resolve => { release = resolve })
  const { b, adapter, fetcher } = fixture(url => url.endsWith('/mirror') ? pending : revoked && url.endsWith('/poll') ? new Response(null, { status: 401 }) : undefined)
  await b.start()
  b.message({ role: 'user', content: 'PRIVATE_TRANSCRIPT' })
  b.running = 'owned'
  const upload = b.flush()
  await vi.advanceTimersByTimeAsync(45000)
  expect(b.stopped).toBe(false)
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/poll')).length).toBeGreaterThan(20)
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/mirror'))).toHaveLength(1)
  expect(JSON.stringify(b.diagnostics())).not.toContain('PRIVATE_TRANSCRIPT')
  expect(JSON.stringify(b.diagnostics())).not.toContain('private-token')
  revoked = true
  await vi.advanceTimersByTimeAsync(1500)
  expect(b.stopped).toBe(true); expect(adapter.cancel).toHaveBeenCalledOnce()
  release(Response.json({ accepted: true })); await upload
  expect(b.state.outbox).toHaveLength(1)
})

test('upload retries back off independently from control and preserve the outbox', async () => {
  let fail = true
  const { b, fetcher } = fixture(url => fail && url.endsWith('/mirror') ? new Response(null, { status: 503, headers: { 'retry-after': '3' } }) : undefined)
  await b.start(); b.message({ role: 'user', content: 'retry me' }); await b.flush()
  expect(b.diagnostics()).toMatchObject({ state: 'retrying', uploadFailures: 1, pendingCount: 1 })
  await b.tick(); await b.flush()
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/mirror'))).toHaveLength(1)
  fail = false
  await vi.advanceTimersByTimeAsync(3100)
  expect(b.diagnostics()).toMatchObject({ state: 'connected', uploadFailures: 0, pendingCount: 0, retries: 1 })
})

test('watchdog expires authority even while a control request hangs', async () => {
  let hang = false
  const { b, adapter } = fixture((url, init) => hang && url.endsWith('/poll') ? new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(Error('aborted')), { once: true })) : undefined)
  await b.start(); b.running = 'owned'; hang = true
  await vi.advanceTimersByTimeAsync(60000)
  expect(b.stopped).toBe(true); expect(adapter.cancel).toHaveBeenCalledOnce()
  expect(b.diagnostics().reason).toContain('lease expired')
})

test.each([120000, -10000])('sleep or wall-clock jump fails closed without cancelling unrelated local work (%d)', async delta => {
  const { b, adapter } = fixture()
  await b.start(); vi.setSystemTime(Date.now() + delta); b.watchdog()
  expect(b.stopped).toBe(true); expect(adapter.cancel).not.toHaveBeenCalled()
})

test('uploads use bounded ordered batches; failed acknowledgement persistence keeps the entry', async () => {
  const seen: string[] = []
  const { b, store } = fixture((url, init) => { if (url.endsWith('/mirror')) seen.push(JSON.parse(String(init.body)).text); return undefined })
  await b.start()
  for (let i = 0; i < 20; i++) b.message({ role: 'user', content: `message ${i}` })
  await b.flush(); expect(seen).toHaveLength(8); expect(b.state.outbox).toHaveLength(12)
  await b.flush(); expect(seen).toHaveLength(16)
  store.save.mockImplementationOnce(() => { throw Error('disk full') })
  await b.flush(); expect(b.stopped).toBe(true); expect(b.state.outbox).toHaveLength(4)
  expect(seen).toEqual(Array.from({ length: 17 }, (_, i) => `message ${i}`))
})

test('protocol mismatch and unknown conflicts fail closed', async () => {
  const { b } = fixture(url => url.endsWith('/attach') ? Response.json({}) : undefined)
  await b.start(); expect(b.stopped).toBe(true); expect(b.diagnostics().reason).toContain('protocol mismatch')
  const second = fixture(url => url.endsWith('/poll') ? new Response(null, { status: 409 }) : undefined)
  await second.b.start(); expect(second.b.stopped).toBe(true)
})

test('local work starting during attachment download is never cancelled as a remote turn', async () => {
  let release!: (response: Response) => void, began!: () => void
  const pending = new Promise<Response>(r => { release = r }), started = new Promise<void>(r => { began = r })
  const { b, adapter } = fixture(url => { if (url.endsWith('/input')) { began(); return pending } return undefined })
  await b.start()
  let idle = true; adapter.idle = () => idle
  const dispatch = b.dispatch({ id: 'remote', text: 'file prompt', hasAttachments: true })
  await started; idle = false; release(Response.json({ content: [] })); await dispatch
  expect(b.stopped).toBe(true)
  expect(adapter.cancel).not.toHaveBeenCalled(); expect(adapter.send).not.toHaveBeenCalled()
  expect(b.running).toBeUndefined()
})

test('heartbeat reports agent activity even for locally initiated Pi tasks without exposing task text', async () => {
  const { b, adapter, fetcher } = fixture()
  await b.start()
  expect(JSON.parse(String(fetcher.mock.calls.find(([url]) => url.endsWith('/poll'))![1].body)).health.agentWorking).toBe(true)
  expect(b.running).toBeUndefined() // local activity, not a Rue-dispatched command
  adapter.idle = () => true
  await b.heartbeat()
  expect(JSON.parse(String(fetcher.mock.calls.filter(([url]) => url.endsWith('/poll')).at(-1)![1].body)).health.agentWorking).toBe(false)
})

test('retry-after is bounded and error payloads are never exposed', async () => {
  const request = client('https://api.test', 'private', async () => new Response('PRIVATE_SERVER_PAYLOAD', { status: 429, headers: { 'retry-after': '3600' } }))
  await expect(request('/safe')).rejects.toMatchObject({ status: 429, retryAfterMs: 15000, message: 'Rue connection request failed' })
})
