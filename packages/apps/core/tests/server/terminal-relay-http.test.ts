import { createHash, randomUUID } from 'node:crypto'
import { WebSocket as NodeSocket } from 'ws'
import { readFileSync, statSync, existsSync } from 'node:fs'
import { afterEach, expect, test, vi } from 'vitest'
import { ConfigSchema } from '../../src/config/index.js'
import { openDatabase, listMessages, listSessionParts } from '../../src/storage/index.js'
import { Bus } from '../../src/bus/index.js'
import { listen, type RueServer } from '../../src/server/listen.js'
import { Bridge, beginPairing, client } from '../../../../../extensions/rue/bridge.ts'

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
test('mirror receipts prove delivery without text and enforce credential scope and revocation', async () => {
  const { origin, grant, fetcher, account } = await setup()
  const request = client(origin, grant.token, fetcher), instance = randomUUID(), eventId = randomUUID()
  await request(`/connections/${grant.id}/relay/attach`, { instance, protocol: 2 })
  await request(`/connections/${grant.id}/relay/mirror`, { instance, eventId, role: 'assistant', text: 'Private final reply', snapshot: { version: 1, final: true } })
  const path = `/terminal-client/connections/${grant.id}/receipts`
  const response = await networkFetch(server!.url + path, { headers: { authorization: `Bearer ${grant.token}` } })
  expect(response.headers.get('cache-control')).toBe('no-store')
  const result = await response.json()
  expect(result.receipts).toEqual([{ eventId, messageId: expect.any(String), sha256: createHash('sha256').update('Private final reply').digest('hex'), version: 1, final: true }])
  expect(JSON.stringify(result)).not.toContain('Private final reply')
  expect((await account(path)).status).toBe(401)
  await expect(request(`/connections/term_${'a'.repeat(32)}/receipts`)).rejects.toMatchObject({ status: 401 })
  for (let i = 0; i < 130; i++) await request(`/connections/${grant.id}/relay/mirror`, { instance, eventId: randomUUID(), role: 'assistant', text: `item ${i}`, snapshot: { version: 1, final: true } })
  const bounded = await request(`/connections/${grant.id}/receipts`)
  expect(bounded.receipts).toHaveLength(128)
  expect(bounded.receipts[0].sha256).toBe(createHash('sha256').update('item 129').digest('hex'))
  await account(`/terminal/connections/${grant.id}`, undefined, 'alice', 'DELETE')
  await expect(request(`/connections/${grant.id}/receipts`)).rejects.toMatchObject({ status: 401 })
})

test('owner-scoped sync wakes pending uploads without creating or replaying a prompt',async()=>{
 const {db,origin,grant,fetcher,account}=await setup()
 const adapter={idle:()=>true,send:vi.fn(),cancel:vi.fn(),confirm:async()=>true,notify:vi.fn()}
 bridge=new Bridge({...grant,origin,outbox:[]},{save:vi.fn()},adapter,fetcher,()=>new WebSocket(server!.url.replace('http:','ws:')+'/terminal-client/socket'))
 await bridge.start();clearInterval(bridge.timer)
 bridge.state.outbox.push({kind:'mirror',eventId:randomUUID(),role:'assistant',text:'Already authorized pending update',snapshot:{version:1,final:true}})
 const path=`/terminal/computers/${grant.id}/sync`
 expect((await account(path,{expectedSessionId:grant.sessionId},'bob')).status).toBe(404)
 expect((await account(path,{expectedSessionId:'wrong-session'})).status).toBe(409)
 const response=await account(path,{expectedSessionId:grant.sessionId})
 expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store')
 expect(await response.json()).toMatchObject({sessionId:grant.sessionId,agentOnline:true})
 await vi.waitFor(()=>expect(listSessionParts(db,grant.sessionId).some(p=>p.payload.text==='Already authorized pending update')).toBe(true),{timeout:1500})
 expect(adapter.send).not.toHaveBeenCalled()
 expect(db.prepare('SELECT count(*) AS n FROM terminal_commands').get()).toEqual({n:0})
 const push=server!.ctx.bus.historySince(0).find(e=>e.type==='part.updated'&&(e.payload as any).upsert)
 expect((push!.payload as any).upsert.parts[0].payload.text).toBe('Already authorized pending update')
 expect((push!.payload as any).upsert.message.sessionId).toBe(grant.sessionId)
})
test('WebSocket pushes commands and streams output without periodic polls or reconnects', async () => {
  const { db, origin, grant, fetcher, account } = await setup()
  const http = vi.fn(fetcher), sockets = vi.fn((url: string) => {
    expect(url).toBe('wss://rue.test/terminal-client/socket')
    return new WebSocket(server!.url.replace('http:', 'ws:') + '/terminal-client/socket')
  })
  const adapter = { idle: () => true, send: vi.fn(), cancel: vi.fn(), confirm: async () => true, notify: vi.fn() }
  bridge = new Bridge({ ...grant, origin, outbox: [] }, { save: vi.fn() }, adapter, http, sockets)
  await bridge.start()
  expect(bridge.diagnostics().transport).toBe('websocket')
  const heartbeat = bridge.lastSuccess
  await new Promise(resolve => setTimeout(resolve, 1800))
  expect(bridge.lastSuccess).toBe(heartbeat)
  expect(sockets).toHaveBeenCalledTimes(1)
  clearInterval(bridge.timer) // Everything below must be driven by socket events.
  await account(`/terminal/computers/${grant.id}`, { expectedOwnerSubject: 'alice', name: 'Computer', remoteEnabled: true, expectedRevision: 0 }, 'alice', 'PATCH')
  await account(`/session/${grant.sessionId}/message`, { text: 'Immediate task', requestId: randomUUID() })
  await vi.waitFor(() => expect(adapter.send).toHaveBeenCalledOnce(), { timeout: 1000, interval: 10 })
  bridge.beginMessage({ role: 'assistant' }); bridge.message({ role: 'assistant', content: 'Immediate websocket reply' }, true)
  await vi.waitFor(() => expect(listSessionParts(db, grant.sessionId).some(part => part.payload.text === 'Immediate websocket reply')).toBe(true), { timeout: 1000, interval: 10 })
  const leaseOnly = await bridge.call('heartbeat', { instance: bridge.instance, protocol: 2 })
  expect(leaseOnly.commands[0]).toMatchObject({ status: 'running' })
  expect(leaseOnly.commands[0]).not.toHaveProperty('text')
  expect(leaseOnly.commands[0]).not.toHaveProperty('result')
  expect(http.mock.calls.filter(([url]) => url.includes('/relay/')).map(([url]) => url.split('/').at(-1))).toEqual(['attach'])
  await account(`/terminal/connections/${grant.id}`, undefined, 'alice', 'DELETE')
  await vi.waitFor(() => expect(bridge!.stopped).toBe(true), { timeout: 1000, interval: 10 })
  expect(adapter.cancel).toHaveBeenCalledOnce()
  expect(adapter.send).toHaveBeenCalledOnce()
})

test('socket loss reconnects the same valid instance without reattaching or replaying', async () => {
  const { origin, grant, fetcher } = await setup()
  const opened: WebSocket[] = [], http = vi.fn(fetcher)
  const factory = () => { const socket = new WebSocket(server!.url.replace('http:', 'ws:') + '/terminal-client/socket'); opened.push(socket); return socket }
  bridge = new Bridge({ ...grant, origin, outbox: [] }, { save: vi.fn() }, { idle: () => false, send: vi.fn(), cancel: vi.fn(), confirm: async () => false, notify: vi.fn() }, http, factory)
  await bridge.start(); clearInterval(bridge.timer)
  const instance = bridge.instance
  opened[0]!.close()
  await vi.waitFor(() => expect(opened).toHaveLength(2), { timeout: 5000 })
  await vi.waitFor(() => expect(bridge!.diagnostics().transport).toBe('websocket'))
  expect(bridge.instance).toBe(instance)
  expect(http.mock.calls.filter(([url]) => url.endsWith('/attach'))).toHaveLength(1)
})

test('socket authentication rejects account credentials and mismatched instances', async () => {
  const { origin, grant, fetcher } = await setup()
  bridge = new Bridge({ ...grant, origin, outbox: [] }, { save: vi.fn() }, { idle: () => false, send: vi.fn(), cancel: vi.fn(), confirm: async () => false, notify: vi.fn() }, fetcher)
  await bridge.start(); clearInterval(bridge.timer)
  for (const credentials of [{ token: 'alice', instance: bridge.instance }, { token: grant.token, instance: randomUUID() }]) {
    const socket = new WebSocket(server!.url.replace('http:', 'ws:') + '/terminal-client/socket')
    const closed = new Promise<number>(resolve => socket.addEventListener('close', event => resolve(event.code)))
    socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'authenticate', id: grant.id, ...credentials })))
    expect(await closed).toBe(1008)
  }
})

test('agent sockets reject browser origins and cannot call arbitrary routes', async () => {
  const { origin, grant, fetcher } = await setup()
  const socketUrl = server!.url.replace('http:', 'ws:') + '/terminal-client/socket'
  const browser = new NodeSocket(socketUrl, { headers: { origin: 'https://foreign.test' } })
  await expect(new Promise((resolve, reject) => { browser.on('open', () => { browser.terminate(); reject(Error('unexpected upgrade')) }); browser.on('error', error => resolve(error.message)) })).resolves.toContain('403')
  bridge = new Bridge({ ...grant, origin, outbox: [] }, { save: vi.fn() }, { idle: () => false, send: vi.fn(), cancel: vi.fn(), confirm: async () => false, notify: vi.fn() }, fetcher)
  await bridge.start(); clearInterval(bridge.timer)
  const baseline = server!.ctx.bus.listenerCount()
  const socket = new WebSocket(socketUrl)
  const closed = new Promise<number>(resolve => socket.addEventListener('close', event => resolve(event.code)))
  socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'authenticate', id: grant.id, token: grant.token, instance: bridge!.instance })))
  socket.addEventListener('message', event => { if (JSON.parse(String(event.data)).type === 'ready') socket.send(JSON.stringify({ type: 'request', id: '1', path: '../../session', body: { instance: bridge!.instance } })) })
  expect(await closed).toBe(1008)
  await vi.waitFor(() => expect(server!.ctx.bus.listenerCount()).toBe(baseline))
})

test('attachments retain order, stay account-scoped, deduplicate, and reach the approved Pi turn', async () => {
  const { db, origin, grant, fetcher, account } = await setup()
  const send = vi.fn(), confirm = vi.fn(async () => true)
  bridge = new Bridge({ ...grant, origin, outbox: [] }, { save: vi.fn() }, { idle: () => true, send, confirm, cancel: vi.fn(), notify: vi.fn() }, fetcher)
  await bridge.start(); clearInterval(bridge.timer)
  await account(`/terminal/computers/${grant.id}`, { expectedOwnerSubject: 'alice', name: 'Computer', remoteEnabled: true, expectedRevision: 0 }, 'alice', 'PATCH')
  const content = [{ type: 'text', text: 'Before ' }, { type: 'file', name: '../photo.png', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=' }, { type: 'text', text: ' after ' }, { type: 'file', name: 'notes.txt', mimeType: 'text/plain', data: Buffer.from('private notes').toString('base64') }]
  const body = { text: 'Attached files', content, requestId: randomUUID() }
  const endpoint = `/session/${grant.sessionId}/message`
  expect((await account(endpoint, body)).status).toBe(200)
  expect((await account(endpoint, body)).status).toBe(200)
  const changed = structuredClone(body); changed.content[3]!.data = Buffer.from('changed').toString('base64')
  expect((await account(endpoint, changed)).status).toBe(503)
  expect(listMessages(db, grant.sessionId)).toHaveLength(2)
  const response = await account(`/session/${grant.sessionId}/parts`), metadata = await response.json()
  expect(metadata.slice(0, 4).map((p: any) => p.type)).toEqual(['text', 'file', 'text', 'file'])
  expect(JSON.stringify(metadata)).not.toContain(content[1]!.data)
  const download = `/session/${grant.sessionId}/attachments/${metadata[3].id}`
  expect((await account(download, undefined, 'bob')).status).toBe(404)
  const file = await account(download)
  expect(file.headers.get('cache-control')).toBe('private, no-store')
  expect(await file.text()).toBe('private notes')
  const command = db.prepare('SELECT id FROM terminal_commands').get() as { id: string }
  await expect(bridge.call(`commands/${command.id}/input`, { instance: bridge.instance })).rejects.toMatchObject({ status: 409 })
  await bridge.tick(); await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
  expect(confirm).toHaveBeenCalledOnce()
  const delivered = send.mock.calls[0]![1]
  expect(delivered.map((p: any) => p.type)).toEqual(['text', 'image', 'text', 'text'])
  expect(delivered[1]).toMatchObject({ mimeType: 'image/png', data: content[1]!.data })
  expect(delivered[3].text).toContain('rue-attachments-')
  const localPath = JSON.parse(/available at ("[^"]+")/.exec(delivered[3].text)![1]!)
  expect(readFileSync(localPath, 'utf8')).toBe('private notes')
  expect(statSync(localPath).mode & 0o777).toBe(0o600)
  expect(JSON.stringify(bridge.state)).not.toContain(content[1]!.data)
  await account(`/terminal/connections/${grant.id}`, undefined, 'alice', 'DELETE')
  await expect(bridge.call(`commands/${command.id}/input`, { instance: bridge.instance })).rejects.toMatchObject({ status: 401 })
  bridge.stop(); expect(existsSync(localPath)).toBe(false)
})

test('invalid and oversized attachments fail before creating any messages', async () => {
  const { db, grant, account } = await setup()
  for (const content of [
    [{ type: 'file', name: 'bad.txt', mimeType: 'text/plain', data: 'not base64!' }],
    Array.from({ length: 9 }, () => ({ type: 'file', name: 'empty.txt', mimeType: 'text/plain', data: '' })),
    [{ type: 'file', name: 'large.txt', mimeType: 'text/plain', data: Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64') }],
  ]) {
    expect((await account(`/session/${grant.sessionId}/message`, { text: 'files', content, requestId: randomUUID() })).status).toBe(400)
  }
  expect(listMessages(db, grant.sessionId)).toHaveLength(0)
})

test('account-scoped queue exposes pending prompt details until running work completes', async () => {
  const { origin, grant, fetcher, account } = await setup()
  bridge = new Bridge({ ...grant, origin, outbox: [] }, { save: vi.fn() }, { idle: () => false, send: vi.fn(), cancel: vi.fn(), confirm: async () => false, notify: vi.fn() }, fetcher)
  await bridge.start(); clearInterval(bridge.timer)
  await account(`/terminal/computers/${grant.id}`, { expectedOwnerSubject: 'alice', name: 'Computer', remoteEnabled: true, expectedRevision: 0 }, 'alice', 'PATCH')
  for (const text of ['First queued prompt', 'Second queued prompt']) expect((await account(`/session/${grant.sessionId}/message`, { text, requestId: randomUUID() })).status).toBe(200)
  const path = `/terminal/computers/${grant.id}/queue`
  expect((await account(path, undefined, 'bob')).status).toBe(404)
  expect((await account(path, undefined, grant.token)).status).toBe(401)
  const response = await account(path)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  const queued = (await response.json()).messages
  expect(queued.map((m: any) => m.text)).toEqual(['First queued prompt', 'Second queued prompt'])
  expect(Object.keys(queued[0]).sort()).toEqual(['created_at','id','status','text','updated_at','user_message_id'])
  const transition = (id: string, action: string) => bridge!.call(`commands/${id}/${action}`, { instance: bridge!.instance })
  await transition(queued[0].id, 'claim')
  expect((await (await account(path)).json()).messages[0].status).toBe('claimed')
  await transition(queued[0].id, 'start')
  expect((await (await account(path)).json()).messages[0].status).toBe('running')
  await bridge.call(`commands/${queued[0].id}/output`, { instance: bridge.instance, version: 1, text: 'Done', status: 'completed' })
  expect((await (await account(path)).json()).messages.map((m: any) => m.text)).toEqual(['Second queued prompt'])
  await transition(queued[1].id, 'claim'); await transition(queued[1].id, 'reject')
  expect((await (await account(path)).json()).messages).toEqual([])
})

test.each(['claim', 'start'])('lost %s acknowledgement never dispatches or replays a remote prompt', async phase => {
  const { db, origin, grant, fetcher, account } = await setup()
  const adapter = { idle: () => true, send: vi.fn(), cancel: vi.fn(), confirm: async () => true, notify: vi.fn() }
  const dropping = async (url: string, init: RequestInit) => { const response = await fetcher(url, init); if (url.endsWith(`/${phase}`)) throw Error('lost acknowledgement'); return response }
  bridge = new Bridge({ ...grant, origin, outbox: [] }, { save: vi.fn() }, adapter, dropping)
  await bridge.start(); clearInterval(bridge.timer)
  await account(`/terminal/computers/${grant.id}`, { expectedOwnerSubject: 'alice', name: 'Computer', remoteEnabled: true, expectedRevision: 0 }, 'alice', 'PATCH')
  await account(`/session/${grant.sessionId}/message`, { text: 'Do not replay', requestId: randomUUID() })
  await bridge.tick(); await vi.waitFor(() => expect(bridge!.stopped).toBe(true))
  expect(adapter.send).not.toHaveBeenCalled()
  expect(db.prepare('SELECT status FROM terminal_commands').get()).toEqual({ status: phase === 'claim' ? 'claimed' : 'running' })
  bridge = new Bridge({ ...grant, origin, outbox: [] }, { save: vi.fn() }, adapter, fetcher)
  await bridge.start(); clearInterval(bridge.timer)
  expect(adapter.send).not.toHaveBeenCalled()
  expect(db.prepare('SELECT status FROM terminal_commands').get()).toEqual({ status: 'interrupted' })
})

test('relay diagnostics reject content and out-of-range values', async () => {
  const { origin, grant, fetcher } = await setup()
  bridge = new Bridge({ ...grant, origin, outbox: [] }, { save: vi.fn() }, { idle: () => false, send: vi.fn(), cancel: vi.fn(), confirm: async () => false, notify: vi.fn() }, fetcher)
  await bridge.start(); clearInterval(bridge.timer)
  const health = { uploadFailures: 0, retries: 0, lastUploadAt: null, pendingCount: 0, pendingBytes: 0, pollLatencyMs: 0 }
  await expect(bridge.call('poll', { instance: bridge.instance, protocol: 2, health: { ...health, prompt: 'PRIVATE' } })).rejects.toMatchObject({ status: 400 })
  await expect(bridge.call('poll', { instance: bridge.instance, protocol: 2, health: { ...health, pendingBytes: -1 } })).rejects.toMatchObject({ status: 400 })
})

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
  expect(listMessages(db, grant.sessionId)).toHaveLength(3) // user, hidden command shell, streamed reply
  expect(listSessionParts(db, grant.sessionId).filter(p => !p.payload.superseded).at(-1)?.payload.text).toBe('Hello from the local agent')
  await vi.waitFor(() => { expect(events).toContain('message.created'); expect(events).toContain('part.updated') })
  streamAbort.abort(); await readEvents
  expect(sent.join('\n')).not.toContain('DO_NOT_UPLOAD')
  expect(db.prepare('SELECT count(*) AS n FROM agent_settings').get()).toEqual({ n: 0 })
  expect((await account(`/session/${grant.sessionId}`, undefined, 'bob')).status).toBe(404)
  await account(`/terminal/connections/${grant.id}`, undefined, 'alice', 'DELETE')
  await bridge.tick(); expect(bridge.stopped).toBe(true)
  expect((await account('/agent/settings', undefined, grant.token)).status).toBe(401)
})
test('local commentary streams into one message; long replies retain their complete tail', async () => {
  const { db, origin, grant, fetcher } = await setup()
  const state = { ...grant, origin, outbox: [] }
  bridge = new Bridge(state, { save: vi.fn() }, { idle: () => false, send: vi.fn(), cancel: vi.fn(), notify: vi.fn() }, fetcher)
  await bridge.start(); clearInterval(bridge.timer)
  bridge.beginMessage({ role: 'assistant' })
  bridge.message({ role: 'assistant', content: 'Checking' }, true)
  await bridge.tick()
  expect(listSessionParts(db, grant.sessionId)[0]?.payload).toMatchObject({ text: 'Checking', remoteStatus: 'running' })
  bridge.message({ role: 'assistant', content: 'Checking files' }, true)
  bridge.message({ role: 'assistant', content: 'Checking files now.' })
  await bridge.tick()
  expect(listMessages(db, grant.sessionId)).toHaveLength(1)
  expect(listSessionParts(db, grant.sessionId)[0]?.payload).toMatchObject({ text: 'Checking files now.', remoteStatus: 'completed' })
  const long = 'A'.repeat(100000) + 'Final answer must not disappear.'
  bridge.beginMessage({ role: 'assistant' })
  bridge.message({ role: 'assistant', content: long })
  await bridge.tick()
  expect(listSessionParts(db, grant.sessionId).slice(1).map(p => p.payload.text).join('')).toBe(long)
  expect(state.outbox).toHaveLength(0)
})

test('opted-in tool text reaches the chat without uploading tool metadata or images', async () => {
  const { db, origin, grant, fetcher, sent } = await setup()
  const state = { ...grant, origin, outbox: [], shareToolOutput: true }
  bridge = new Bridge(state, { save: vi.fn() }, { idle: () => false, send: vi.fn(), cancel: vi.fn(), notify: vi.fn() }, fetcher)
  await bridge.start(); clearInterval(bridge.timer)
  bridge.message({ role: 'toolResult', toolName: 'bash', isError: false, content: [{ type: 'text', text: 'All tests passed' }, { type: 'image', data: 'DO_NOT_UPLOAD_IMAGE' }], details: { token: 'DO_NOT_UPLOAD_METADATA' } })
  await bridge.tick()
  expect(listMessages(db, grant.sessionId)).toHaveLength(1)
  expect(listSessionParts(db, grant.sessionId)[0]?.payload.text).toBe('Tool output: bash\n\n```text\nAll tests passed\n```')
  state.shareToolOutput = false
  bridge.message({ role: 'toolResult', toolName: 'read', content: 'DO_NOT_UPLOAD_DISABLED_TOOL' })
  await bridge.tick()
  expect(sent.join('\n')).not.toContain('DO_NOT_UPLOAD')
  expect(listMessages(db, grant.sessionId)).toHaveLength(1)
})

test('a newer final snapshot arriving during an upload survives a lost acknowledgement', async () => {
  const { db, origin, grant, fetcher } = await setup()
  let entered!: () => void, release!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const blocked = new Promise<void>(resolve => { release = resolve })
  let first = true
  const transport = async (url: string, init: RequestInit) => {
    const response = await fetcher(url, init)
    if (url.endsWith('/mirror') && first) { first = false; entered(); await blocked; throw Error('lost acknowledgement') }
    return response
  }
  const state = { ...grant, origin, outbox: [] }
  bridge = new Bridge(state, { save: vi.fn() }, { idle: () => false, send: vi.fn(), cancel: vi.fn(), notify: vi.fn() }, transport)
  await bridge.start(); clearInterval(bridge.timer)
  bridge.beginMessage({ role: 'assistant' })
  bridge.message({ role: 'assistant', content: 'First tokens' }, true)
  const upload = bridge.tick(); await started
  bridge.message({ role: 'assistant', content: 'Complete answer' })
  release(); await upload
  await vi.waitFor(async () => { await bridge!.tick(); expect(state.outbox).toHaveLength(0) }, { timeout: 3000 })
  expect(listMessages(db, grant.sessionId)).toHaveLength(1)
  expect(listSessionParts(db, grant.sessionId)[0]?.payload).toMatchObject({ text: 'Complete answer', remoteStatus: 'completed' })
  expect(state.outbox).toHaveLength(0)
  expect(bridge.stopped).toBe(false)
})

test('opted-in exposed thinking streams as separate ordered parts, never signatures or redacted content', async () => {
  const { db, origin, grant, fetcher, sent } = await setup()
  bridge = new Bridge({ ...grant, origin, outbox: [], shareThinking: true }, { save: vi.fn() }, { idle: () => false, send: vi.fn(), cancel: vi.fn(), confirm: async () => true, notify: vi.fn() }, fetcher)
  await bridge.start(); clearInterval(bridge.timer)
  bridge.beginMessage({ role: 'assistant' })
  bridge.message({ role: 'assistant', content: [{ type: 'thinking', thinking: 'Checking' }] }, true)
  await bridge.tick()
  const first = listSessionParts(db, grant.sessionId)[0]!
  expect(first.type).toBe('reasoning')
  expect(first.payload).toMatchObject({ text: 'Checking', mirrorFinal: false })
  const long = 'Exposed thinking line.\n'.repeat(5000) + 'THINKING_TAIL'
  const message = { role: 'assistant', content: [
    { type: 'thinking', thinking: 'Checking failure.', thinkingSignature: 'DO_NOT_UPLOAD_SIGNATURE' },
    { type: 'text', text: 'I will check the test.' },
    { type: 'thinking', thinking: long, thinkingSignature: 'DO_NOT_UPLOAD_OPAQUE_DATA' },
    { type: 'thinking', thinking: 'DO_NOT_UPLOAD_REDACTED', redacted: true },
    { type: 'text', text: 'Final answer.' },
  ] }
  bridge.message(message); bridge.settled(); await bridge.tick()
  const parts = listSessionParts(db, grant.sessionId)
  expect(parts.map(p => p.type)).toEqual(['reasoning', 'text', 'reasoning', 'reasoning', 'text'])
  expect(parts[0]!.id).toBe(first.id)
  expect(parts[0]!.payload).toMatchObject({ text: 'Checking failure.', mirrorFinal: true })
  expect(parts[1]!.payload.text).toBe('I will check the test.')
  expect(parts.slice(2, 4).map(p => p.payload.text).join('')).toBe(long)
  expect(parts[2]!.payload.reasoning).toMatchObject({ chunk: 0 })
  expect((parts[2]!.payload.reasoning as any).id).toBe((parts[3]!.payload.reasoning as any).id)
  expect(parts.at(-1)!.payload.text).toBe('Final answer.')
  expect(JSON.stringify(parts) + sent.join('\n')).not.toContain('DO_NOT_UPLOAD')
})

test('remote streaming preserves commentary → parallel tools → final order and tool chunk identity', async () => {
  const { db, origin, grant, fetcher, account } = await setup()
  const send = vi.fn()
  bridge = new Bridge({ ...grant, origin, outbox: [], shareToolOutput: true, shareThinking: true }, { save: vi.fn() }, { idle: () => true, send, cancel: vi.fn(), confirm: async () => true, notify: vi.fn() }, fetcher)
  await bridge.start(); clearInterval(bridge.timer)
  await account(`/terminal/computers/${grant.id}`, { expectedOwnerSubject: 'alice', name: 'Computer', remoteEnabled: true, expectedRevision: 0 }, 'alice', 'PATCH')
  await account(`/session/${grant.sessionId}/message`, { text: 'Review files', requestId: randomUUID() })
  await bridge.tick(); await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
  bridge.beginMessage({ role: 'assistant' }); bridge.message({ role: 'assistant', content: [{ type: 'thinking', thinking: 'Planning the checks.' }, { type: 'text', text: 'Checking' }] }, true); await bridge.tick()
  bridge.message({ role: 'assistant', content: [{ type: 'thinking', thinking: 'Planning the checks.' }, { type: 'text', text: 'Checking files.' }] })
  bridge.tool({ toolCallId: 'read-one', toolName: 'read', args: { path: 'one.txt' } }, 'start')
  bridge.tool({ toolCallId: 'bash-two', toolName: 'bash', args: { command: 'test' } }, 'start')
  await bridge.tick()
  const long = 'line\n'.repeat(25000) + 'TAIL_RETAINED'
  bridge.tool({ toolCallId: 'bash-two', toolName: 'bash', partialResult: { content: long } }, 'update')
  bridge.message({ role: 'toolResult', toolCallId: 'read-one', toolName: 'read', content: 'Read content' })
  bridge.message({ role: 'toolResult', toolCallId: 'bash-two', toolName: 'bash', content: long })
  bridge.message({ role: 'toolResult', toolCallId: 'bash-two', toolName: 'bash', content: long }) // duplicate canonical result
  bridge.beginMessage({ role: 'assistant' }); bridge.message({ role: 'assistant', content: 'Final' }, true)
  await bridge.tick()
  bridge.message({ role: 'assistant', content: 'Final answer.' }); bridge.settled(); await bridge.tick()
  const parts = listSessionParts(db, grant.sessionId).filter(p => !p.payload.superseded)
  expect(parts[1]!.type).toBe('reasoning')
  expect(parts[1]!.payload.text).toBe('Planning the checks.')
  expect(parts[2]!.payload.text).toBe('Checking files.')
  expect(parts.at(-1)!.payload.text).toBe('Final answer.')
  const tools = parts.filter(p => p.payload.tool)
  expect(tools).toHaveLength(3) // one read card, two transport chunks for one bash card
  expect(new Set(tools.map(p => (p.payload.tool as any).id)).size).toBe(2)
  const bash = tools.filter(p => (p.payload.tool as any).name === 'bash').sort((a, b) => (a.payload.tool as any).chunk - (b.payload.tool as any).chunk)
  expect(bash.map(p => p.payload.text).join('')).toContain(long)
  expect(tools.every(p => p.payload.mirrorFinal === true)).toBe(true)
  expect(bridge.stopped).toBe(false)
})

test('remote turns preserve commentary and final answers beyond the old aggregate limit', async () => {
  const { db, origin, grant, fetcher, account } = await setup()
  const send = vi.fn()
  bridge = new Bridge({ ...grant, origin, outbox: [] }, { save: vi.fn() }, { idle: () => true, send, cancel: vi.fn(), confirm: async () => true, notify: vi.fn() }, fetcher)
  await bridge.start(); clearInterval(bridge.timer)
  await account(`/terminal/computers/${grant.id}`, { expectedOwnerSubject: 'alice', name: 'Computer', remoteEnabled: true, expectedRevision: 0 }, 'alice', 'PATCH')
  await account(`/session/${grant.sessionId}/message`, { text: 'Long reply', requestId: randomUUID() })
  await bridge.tick(); await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
  const commentary = 'C'.repeat(100000)
  bridge.message({ role: 'assistant', content: commentary })
  bridge.message({ role: 'assistant', content: 'Final' }, true)
  await bridge.tick()
  bridge.message({ role: 'assistant', content: 'Final answer.' })
  bridge.settled(); await bridge.tick()
  const parts = listSessionParts(db, grant.sessionId).slice(1).filter(p => !p.payload.superseded)
  expect(parts.map(p => p.payload.text)).toEqual([commentary, 'Final answer.'])
  expect(parts.every(p => p.payload.remoteStatus === 'completed')).toBe(true)
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
  await vi.waitFor(async () => { await bridge!.tick(); expect(state.outbox).toHaveLength(0) }, { timeout: 3000 })
  expect(listMessages(db, grant.sessionId)).toHaveLength(1)
  await account(`/terminal/computers/${grant.id}`, { expectedOwnerSubject: 'alice', name: 'Computer', remoteEnabled: true, expectedRevision: 0 }, 'alice', 'PATCH')
  await account(`/session/${grant.sessionId}/message`, { text: 'Ambiguous run', requestId: randomUUID() })
  const snapshot = await bridge.call('poll', { instance: bridge.instance, protocol: 2 })
  const id = snapshot.commands[0].id
  await bridge.call(`commands/${id}/claim`, { instance: bridge.instance })
  await bridge.call(`commands/${id}/start`, { instance: bridge.instance })
  bridge.stop()
  bridge = new Bridge(state, { save: vi.fn() }, adapter, fetcher)
  await bridge.start(); clearInterval(bridge.timer)
  expect(adapter.send).not.toHaveBeenCalled()
  expect(db.prepare('SELECT status FROM terminal_commands WHERE id=?').get(id)).toEqual({ status: 'interrupted' })
})
