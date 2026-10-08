import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { afterEach, expect, test, vi } from 'vitest'
import { ConfigSchema } from '../../src/config/index.js'
import { openDatabase } from '../../src/storage/index.js'
import { Bus } from '../../src/bus/index.js'
import { listen, type RueServer } from '../../src/server/listen.js'
import { agentApiKey, saveAgentSettings, defaultAgentSettings } from '../../src/storage/agent-settings.js'
import { createWorker, connectWorker, changeWorker } from '../../src/storage/workers.js'
import { requestTerminalPairing, approveTerminalPairing, exchangeTerminalPairing, activateTerminalConnection, revokeTerminalConnection } from '../../src/storage/terminal-pairing.js'
import {saveProviderOAuth} from '../../src/storage/provider-oauth.js'
import { attachComputer } from '../../src/storage/terminal-relay.js'

let server: RueServer | undefined
const nativeFetch = globalThis.fetch
const value = 'provider-secret-never-in-metadata'
afterEach(async () => { await server?.close(); server?.ctx.db.close(); server = undefined; vi.restoreAllMocks(); vi.unstubAllEnvs() })
async function setup() {
  vi.stubEnv('RUE_MANAGED_WORKERS', 'true'); vi.stubEnv('RUE_TERMINAL_BRIDGE', 'true'); vi.stubEnv('RUE_SETTINGS_ENCRYPTION_KEY', randomBytes(32).toString('base64'))
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url) === 'https://identity.test/v1/token/verify') {
      const token = JSON.parse(String(init?.body)).token
      return ['alice','bob'].includes(token) ? Response.json({ token: { subject: token, principalType: 'user' } }) : new Response(null, { status: 401 })
    }
    return nativeFetch(url, init)
  })
  const config = ConfigSchema.parse({ server: { hostname: '127.0.0.1', port: 0 }, keyname: { enabled: true, apiUrl: 'https://identity.test' } })
  const db = openDatabase(':memory:')
  server = await listen({ config, ctx: { db, bus: new Bus(), config } })
  const request = (path: string, data?: unknown, token = 'alice', method = data ? 'PUT' : 'GET') => nativeFetch(server!.url + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) })
  const save = (provider = 'openai', expectedRevision = 0, apiKey: string | null = value) => request(`/provider-keys/${provider}`, { expectedOwnerSubject: 'alice', expectedRevision, apiKey })
  const grant = (provider: string, type: string, id: string, expectedRevision = 1, enabled = true) => request(`/provider-keys/${provider}/grants`, { expectedOwnerSubject: 'alice', expectedRevision, target: { type, id }, enabled, acknowledgeExposure: true })
  return { db, request, save, grant }
}
function terminal(db: ReturnType<typeof openDatabase>, owner = 'alice', session = randomUUID()) {
  const verifier = randomBytes(32).toString('base64url')
  const pending = requestTerminalPairing(db, createHash('sha256').update(verifier).digest('hex'), session)
  const { code } = approveTerminalPairing(db, pending.requestId, owner, 'Pi')
  const linked = exchangeTerminalPairing(db, pending.requestId, verifier, code)
  activateTerminalConnection(db, linked.token)
  const instance = randomUUID(); attachComputer(db, linked.token, linked.id, instance, Date.now(), 2)
  return { ...linked, instance }
}

const oauthCredential=(ttl=180000)=>({type:'oauth',access:`e30.${Buffer.from(JSON.stringify({exp:Math.floor((Date.now()+ttl)/1000),'https://api.openai.com/auth':{chatgpt_account_id:'synthetic-account'}})).toString('base64url')}.signature`,refresh:'private-refresh-never-delivered',expires:Date.now()+ttl,accountId:'synthetic-account'})
test('OAuth HTTP grants and access-only delivery are owner, consent, revision and lease fenced',async()=>{
 const {db,request}=await setup(),own=terminal(db),other=terminal(db,'bob'),credential=oauthCredential();saveProviderOAuth(db,'alice',0,credential)
 const grant={expectedOwnerSubject:'alice',expectedRevision:1,target:{type:'terminal',id:own.id},enabled:true,acknowledgeExposure:true}
 const path=`/terminal-client/connections/${own.id}/provider-keys/openai-codex`,read=(body:unknown={instance:own.instance})=>request(path,body,own.token,'POST')
 expect((await read()).status).toBe(403)
 expect((await request('/provider-oauth/openai-codex/grants',{...grant,acknowledgeExposure:false})).status).toBe(400)
 expect((await request('/provider-oauth/openai-codex/grants',grant,'bob')).status).toBe(409)
 expect((await request('/provider-oauth/openai-codex/grants',{...grant,target:{type:'worker',id:randomUUID()}})).status).toBe(400)
 expect((await request('/provider-oauth/openai-codex/grants',{...grant,target:{type:'terminal',id:other.id}})).status).toBe(404)
 const granted=await request('/provider-oauth/openai-codex/grants',grant);expect(granted.status).toBe(200);expect(await granted.json()).toMatchObject({runtimeSupported:true,revision:2})
 expect((await request('/provider-oauth/openai-codex/grants',grant)).status).toBe(409)
 expect(await(await read({instance:own.instance,availability:true})).json()).toEqual({provider:'openai-codex',granted:true})
 const access=await read();expect(access.headers.get('cache-control')).toContain('no-store');const result=await access.json();expect(result.accessToken).toBe(credential.access);expect(Object.keys(result).sort()).toEqual(['accessToken','credentialType','expiresAt','provider'])
 const host=createWorker(db,'alice','Host',randomUUID()),hostInstance=randomUUID(),lease=connectWorker(db,host.worker.id,host.secret!,hostInstance)
 expect((await request(`/worker-client/${host.worker.id}/provider-keys/openai-codex`,{instance:hostInstance,generation:lease.generation},host.secret!,'POST')).status).toBe(403)
 expect((await request(path,{instance:own.instance},'alice','POST')).status).toBe(401)
 expect((await read({instance:randomUUID()})).status).toBe(409)
 expect((await request('/provider-oauth/openai-codex/grants',{...grant,expectedRevision:2,enabled:false})).status).toBe(200)
 expect((await read()).status).toBe(403)
 for(const path of ['/provider-keys','/provider-oauth/openai-codex']){const metadata=await(await request(path)).text();expect(metadata).not.toContain(credential.access);expect(metadata).not.toContain(credential.refresh)}
})
test('HTTP OAuth rotation is single-flight and authority is rechecked after provider response',async()=>{
 const {db,request}=await setup(),own=terminal(db);saveProviderOAuth(db,'alice',0,oauthCredential(1000))
 await request('/provider-oauth/openai-codex/grants',{expectedOwnerSubject:'alice',expectedRevision:1,target:{type:'terminal',id:own.id},enabled:true,acknowledgeExposure:true})
 let release!:(r:Response)=>void;const pending=new Promise<Response>(resolve=>release=resolve),previous=vi.mocked(fetch).getMockImplementation()!,refresh=vi.fn(()=>pending)
 vi.mocked(fetch).mockImplementation((url,init)=>String(url)==='https://auth.openai.com/oauth/token'?refresh():previous(url,init))
 const path=`/terminal-client/connections/${own.id}/provider-keys/openai-codex`,a=request(path,{instance:own.instance},own.token,'POST'),b=request(path,{instance:own.instance},own.token,'POST')
 await vi.waitFor(()=>expect(refresh).toHaveBeenCalledTimes(1));await new Promise(resolve=>setTimeout(resolve,30))
 db.prepare('UPDATE terminal_connections SET lease_expires_at=? WHERE id=?').run(Date.now()-1,own.id)
 const next=oauthCredential();release(Response.json({access_token:next.access,refresh_token:'rotated-private-refresh',expires_in:180}))
 for(const response of await Promise.all([a,b])){expect([403,409]).toContain(response.status);expect(await response.text()).not.toContain(next.access)}
 expect(refresh).toHaveBeenCalledTimes(1)
})
test('provider vault preserves existing OpenAI keys and returns metadata only', async () => {
  const { db, request, save } = await setup()
  saveAgentSettings(db, 'alice', { ...defaultAgentSettings, expectedOwnerSubject: 'alice', expectedRevision: 0, apiKey: 'legacy-key' })
  const response = await request('/provider-keys'), initial = await response.json()
  expect(response.headers.get('cache-control')).toContain('no-store')
  expect(initial.keys.find((k: any) => k.provider === 'openai')).toMatchObject({ configured: true, revision: 1, grants: [] })
  expect(JSON.stringify(initial)).not.toContain('legacy-key')
  expect((await save('openai', 1)).status).toBe(200)
  expect(agentApiKey(db, 'alice')).toBe(value)
  expect(JSON.stringify(db.prepare('SELECT * FROM agent_settings').all())).not.toContain(value)
  for (const provider of ['anthropic','google','openrouter']) expect((await save(provider)).status).toBe(200)
  expect(JSON.stringify(db.prepare('SELECT * FROM provider_keys').all())).not.toContain(value)
  const metadata = await (await request('/provider-keys')).json()
  expect(metadata.keys.every((key: any) => key.configured)).toBe(true)
  expect(JSON.stringify(metadata)).not.toContain(value)
  expect((await (await request('/provider-keys', undefined, 'bob')).json()).keys.every((key: any) => !key.configured)).toBe(true)
})
test('catalog and model defaults are bounded, owner scoped and revision checked',async()=>{
 const {request,db}=await setup(),catalogResponse=await request('/provider-keys/catalog'),catalog=await catalogResponse.json()
 expect(catalogResponse.headers.get('cache-control')).toContain('no-store')
 expect(catalog.providers.map((p:any)=>p.id)).toEqual(['openai','anthropic','google','openrouter'])
 expect(catalog.providers.every((p:any)=>p.models.length>0&&p.models.every((m:any)=>m.id.length<=128&&typeof m.name==='string'))).toBe(true)
 for(const provider of ['openai','anthropic']){
  const models=catalog.providers.find((p:any)=>p.id===provider).models,model=models[0].id
  const input={expectedOwnerSubject:'alice',expectedRevision:0,apiKey:value,model}
  expect((await request(`/provider-keys/${provider}`,{...input,model:'not-in-the-catalog'})).status).toBe(400)
  expect((await request(`/provider-keys/${provider}`,input,'bob')).status).toBe(409)
  const saved=await (await request(`/provider-keys/${provider}`,input)).json()
  expect(saved.keys.find((k:any)=>k.provider===provider)).toMatchObject({configured:true,revision:1,model,grants:[]})
  expect(JSON.stringify(saved)).not.toContain(value)
  expect((await request(`/provider-keys/${provider}`,{...input,model:models[1].id})).status).toBe(409)
  expect(db.prepare('SELECT model FROM provider_model_preferences WHERE owner_subject=? AND provider=?').get('alice',provider)).toEqual({model})
  const other=await (await request('/provider-keys',undefined,'bob')).json();expect(other.keys.find((k:any)=>k.provider===provider).model).toBeNull()
  expect((await request(`/provider-keys/${provider}`,{expectedOwnerSubject:'alice',expectedRevision:1,apiKey:null})).status).toBe(200)
  expect(db.prepare('SELECT model FROM provider_model_preferences WHERE owner_subject=? AND provider=?').get('alice',provider)).toBeUndefined()
 }
})
test('consent, tenant scope and revisions prevent unintended credential delegation', async () => {
  const { db, request, save, grant } = await setup(); await save()
  const other = terminal(db, 'bob'), own = terminal(db)
  expect((await grant('openai', 'terminal', other.id)).status).toBe(404)
  expect((await request('/provider-keys/openai/grants', { expectedOwnerSubject: 'alice', expectedRevision: 1, target: { type: 'terminal', id: own.id }, enabled: true })).status).toBe(400)
  expect((await request('/provider-keys/openai', { expectedOwnerSubject: 'bob', expectedRevision: 1, apiKey: 'other' })).status).toBe(409)
  expect((await grant('openai', 'terminal', own.id)).status).toBe(200)
  expect((await save('openai', 1)).status).toBe(409)
  expect((await request('/provider-keys', undefined, own.token)).status).toBe(401)
  expect((await save('custom-provider')).status).toBe(200)
  expect((await save('bad%20provider')).status).toBe(400)
  expect((await save('openai-codex')).status).toBe(400)
  expect((await save('openai', 2, 'x'.repeat(9000))).status).toBe(413)
})
test('terminal delivery requires an explicit provider grant and current instance/lease', async () => {
  const { db, request, save, grant } = await setup(); await save()
  const own = terminal(db), other = terminal(db)
  const path = `/terminal-client/connections/${own.id}/provider-keys/openai`
  const read = (instance = own.instance, token = own.token) => request(path, { instance }, token, 'POST')
  expect((await read()).status).toBe(403)
  await grant('openai', 'terminal', own.id)
  const response = await read()
  expect(response.headers.get('cache-control')).toContain('no-store')
  expect(await response.json()).toEqual({ provider: 'openai', apiKey: value, credentialId: expect.stringMatching(/^key_[a-f0-9]{64}$/) })
  expect((await read(randomUUID())).status).toBe(409)
  expect((await read(own.instance, other.token)).status).toBe(401)
  expect((await read(own.instance, 'alice')).status).toBe(401)
  expect((await request(path, undefined, own.token)).status).not.toBe(200)
  db.prepare('UPDATE terminal_connections SET lease_expires_at=? WHERE id=?').run(Date.now() - 1, own.id)
  expect((await read()).status).toBe(409)
  expect(JSON.stringify(db.prepare('SELECT * FROM provider_key_audit').all())).not.toContain(value)
})
test('live machine availability checks return metadata without decrypting or auditing key access', async () => {
  const { db, request, save, grant } = await setup(); await save()
  const own = terminal(db), path = `/terminal-client/connections/${own.id}/provider-keys/openai`
  const check = (instance = own.instance, token = own.token) => request(path, { instance, availability: true }, token, 'POST')
  expect(await (await check()).json()).toEqual({ provider: 'openai', granted: false })
  await grant('openai', 'terminal', own.id)
  const response = await check()
  expect(response.headers.get('cache-control')).toContain('no-store')
  expect(await response.json()).toEqual({ provider: 'openai', granted: true })
  expect(db.prepare("SELECT * FROM provider_key_audit WHERE action='access'").all()).toEqual([])
  expect((await check(randomUUID())).status).toBe(409)
  expect((await check(own.instance, 'alice')).status).toBe(401)
  await grant('openai', 'terminal', own.id, 2, false)
  expect(await (await check()).json()).toEqual({ provider: 'openai', granted: false })
})
test('revocation and key removal deny subsequent reads and erase grants', async () => {
  const { db, request, save, grant } = await setup(); await save()
  const own = terminal(db), path = `/terminal-client/connections/${own.id}/provider-keys/openai`
  await grant('openai', 'terminal', own.id)
  await grant('openai', 'terminal', own.id, 2, false)
  expect((await request(path, { instance: own.instance }, own.token, 'POST')).status).toBe(403)
  await grant('openai', 'terminal', own.id, 3)
  await save('openai', 4, null)
  expect(db.prepare('SELECT * FROM provider_key_grants').all()).toEqual([])
  expect(agentApiKey(db, 'alice')).toBeUndefined()
  expect((await request(path, { instance: own.instance }, own.token, 'POST')).status).toBe(403)
  revokeTerminalConnection(db, 'alice', own.id)
  expect((await request(path, { instance: own.instance }, own.token, 'POST')).status).toBe(401)
})
test('re-pairing preserves history but cannot inherit an expired credential grant', async () => {
  const { db, request, save, grant } = await setup(); await save()
  const own = terminal(db); await grant('openai', 'terminal', own.id)
  db.prepare('UPDATE terminal_connections SET expires_at=? WHERE id=?').run(Date.now() - 1, own.id)
  const renewed = terminal(db, 'alice', own.piSessionId)
  expect(renewed.sessionId).toBe(own.sessionId); expect(renewed.id).toBe(own.id)
  expect(db.prepare('SELECT * FROM provider_key_grants').all()).toEqual([])
  expect((await request(`/terminal-client/connections/${own.id}/provider-keys/openai`, { instance: renewed.instance }, renewed.token, 'POST')).status).toBe(403)
  expect((await grant('openai', 'terminal', own.id, 2)).status).toBe(409)
  expect((await grant('openai', 'terminal', own.id, 3)).status).toBe(200)
  revokeTerminalConnection(db, 'alice', own.id)
  expect(db.prepare('SELECT * FROM provider_key_grants').all()).toEqual([])
})

test('worker delivery is fenced and cannot use another worker or account credential', async () => {
  const { db, request, save, grant } = await setup(); await save('anthropic')
  const own = createWorker(db, 'alice', 'Mason', randomUUID()), instance = randomUUID()
  const lease = connectWorker(db, own.worker.id, own.secret!, instance)
  const path = `/worker-client/${own.worker.id}/provider-keys/anthropic`, body = { instance, generation: lease.generation }
  expect((await request(path, body, own.secret!, 'POST')).status).toBe(403)
  await grant('anthropic', 'worker', own.worker.id)
  expect(await (await request(path, body, own.secret!, 'POST')).json()).toEqual({ provider: 'anthropic', apiKey: value, credentialId: expect.stringMatching(/^key_[a-f0-9]{64}$/) })
  expect((await request(path, { ...body, generation: lease.generation + 1 }, own.secret!, 'POST')).status).toBe(409)
  expect((await request(path, body, 'alice', 'POST')).status).toBe(401)
  changeWorker(db, 'alice', own.worker.id, 'revoke', 0)
  expect((await request(path, body, own.secret!, 'POST')).status).toBe(401)
  expect(db.prepare('SELECT * FROM provider_key_grants').all()).toEqual([])
})
test('ciphertext is bound to its owner/provider and fails closed without the encryption key', async () => {
  const { db, request, save, grant } = await setup(); await save('anthropic'); await save('google')
  const own = terminal(db); await grant('google', 'terminal', own.id)
  db.prepare("UPDATE provider_keys SET encrypted_key=(SELECT encrypted_key FROM provider_keys WHERE provider='anthropic' AND owner_subject='alice') WHERE provider='google'").run()
  const path = `/terminal-client/connections/${own.id}/provider-keys/google`
  const failed = await request(path, { instance: own.instance }, own.token, 'POST')
  expect(failed.status).toBe(503); expect(await failed.text()).not.toContain(value)
  vi.stubEnv('RUE_SETTINGS_ENCRYPTION_KEY', 'invalid')
  expect((await save('openai')).status).toBe(503)
  expect((await (await request('/provider-keys')).json()).keyStorageAvailable).toBe(false)
})
