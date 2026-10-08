import { expect, test, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { InMemoryCredentialStore, InMemoryModelsStore } from '@earendil-works/pi-ai'
import { brokerCredential, providerWithBroker, type CredentialSource } from '../extensions/rue/provider-keys.ts'

const source = (patch: Partial<CredentialSource> = {}): CredentialSource => ({
  kind: 'terminal', origin: 'https://rue.test', id: 'term_one', token: 'private-machine-token', instance: 'instance-one',
  signal: new AbortController().signal, current: () => true, ...patch,
})
const signal = () => new AbortController().signal

test('real Pi SDK uses literal borrowed keys without persisting them or freezing models.json', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rue-key-sdk-')), modelsPath = join(dir, 'models.json'), marker = join(dir, 'must-not-exist')
  const key = `!touch ${marker} $NOT_AN_ENV_VAR`
  vi.stubEnv('OPENAI_API_KEY', '')
  const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('Unexpected external request'))
  try {
    const credentials = new InMemoryCredentialStore()
    const pristine = await ModelRuntime.create({ modelsPath: null, credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), allowModelNetwork: false })
    const runtime = await ModelRuntime.create({ modelsPath, credentials, modelsStore: new InMemoryModelsStore(), allowModelNetwork: false })
    const read = vi.fn(async (mode: string) => mode === 'key' ? { granted: true, apiKey: key } : { granted: true })
    runtime.registerNativeProvider(providerWithBroker(pristine.getProvider('openai')!, read))
    await runtime.getAvailable('openai')
    expect(read.mock.calls.every(([mode]) => mode === 'availability')).toBe(true)
    expect((await runtime.getAuth('openai'))?.auth.apiKey).toBe(key)
    expect(await credentials.list()).toEqual([])
    writeFileSync(modelsPath, JSON.stringify({ providers: { openai: { apiKey: 'local-config-key' } } }))
    await runtime.refresh({ allowNetwork: false })
    expect((await runtime.getAuth('openai'))?.auth.apiKey).toBe('local-config-key')
    writeFileSync(modelsPath, '{}'); await runtime.refresh({ allowNetwork: false })
    expect((await runtime.getAuth('openai'))?.auth.apiKey).toBe(key)
    await runtime.setRuntimeApiKey('openai', 'local-runtime-key')
    expect((await runtime.getAuth('openai'))?.auth.apiKey).toBe('local-runtime-key')
    await runtime.removeRuntimeApiKey('openai')
    runtime.unregisterProvider('openai')
    expect(await runtime.getAuth('openai')).toBeUndefined()
    expect(await credentials.list()).toEqual([])
    expect(existsSync(marker)).toBe(false)
    expect(network).not.toHaveBeenCalled()
  } finally { network.mockRestore(); vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }) }
})

test('native Codex uses access-only OAuth auth, never persists credentials, and preserves local OAuth precedence',async()=>{
 const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('Unexpected network'))
 try{
  const credentials=new InMemoryCredentialStore(),runtime=await ModelRuntime.create({modelsPath:null,credentials,modelsStore:new InMemoryModelsStore(),allowModelNetwork:false})
  const read=vi.fn(async(mode:string)=>mode==='availability'?{granted:true}:{granted:true,accessToken:'synthetic-access-only',expiresAt:Date.now()+180000})
  runtime.registerNativeProvider(providerWithBroker(runtime.getProvider('openai-codex')!,read));await runtime.refresh({allowNetwork:false})
  expect((await runtime.getAvailable('openai-codex')).length).toBeGreaterThan(0);expect(runtime.isUsingSubscription('openai-codex')).toBe(true)
  expect((await runtime.getAuth('openai-codex'))?.auth.apiKey).toBe('synthetic-access-only');expect(await credentials.list()).toEqual([])
  read.mockClear();await credentials.modify('openai-codex',async()=>({type:'oauth',access:'existing-local-oauth',refresh:'existing-local-refresh',expires:Date.now()+3600000,accountId:'synthetic-account'}))
  expect((await runtime.getAuth('openai-codex'))?.auth.apiKey).toBe('existing-local-oauth');expect(read).not.toHaveBeenCalled();expect(network).not.toHaveBeenCalled()
 }finally{network.mockRestore()}
})
test('native Codex requests use the access bearer, fixed SSE, no redirects and no uncertain replay',async()=>{
 const access=`e30.${Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'synthetic-account'}})).toString('base64url')}.signature`
 const runtime=await ModelRuntime.create({modelsPath:null,credentials:new InMemoryCredentialStore(),modelsStore:new InMemoryModelsStore(),allowModelNetwork:false})
 runtime.registerNativeProvider(providerWithBroker(runtime.getProvider('openai-codex')!,async()=>({granted:true,accessToken:access,expiresAt:Date.now()+180000})))
 const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${access}`);expect(init?.redirect).toBe('error');return new Response('event: response.completed\ndata: '+JSON.stringify({type:'response.completed',response:{id:'synthetic-response',status:'completed',output:[],usage:{input_tokens:12,output_tokens:2,total_tokens:14}}})+'\n\n',{headers:{'content-type':'text/event-stream'}})})
 const model=runtime.getModel('openai-codex','gpt-5.4')!,context={messages:[{role:'user' as const,content:'Synthetic test',timestamp:0}]}
 const result=await runtime.streamSimple(model,context,{fetch:fetcher,transport:'auto',maxRetries:3}).result();expect(result.stopReason,result.errorMessage).toBe('stop');expect(fetcher).toHaveBeenCalledTimes(1);expect(result.usage.output).toBe(2)
 const failed=vi.fn(async()=>{throw Error('synthetic-network-loss')});const failure=await runtime.streamSimple(model,context,{fetch:failed,transport:'auto',maxRetries:3}).result();expect(failure.stopReason).toBe('error');expect(failed).toHaveBeenCalledTimes(1);expect(JSON.stringify(failure)).not.toContain(access)
})
test('OAuth broker rejects refresh-bearing, expired, malformed and host-wide delivery and does not cache access tokens',async()=>{
 const response={provider:'openai-codex',credentialType:'oauth',accessToken:'e30.e30.signature',expiresAt:Date.now()+180000}
 const fetcher=vi.fn(async()=>Response.json(response))
 for(let n=0;n<2;n++)expect(await brokerCredential(source(),'openai-codex','key',signal(),fetcher)).toEqual({granted:true,accessToken:response.accessToken,expiresAt:response.expiresAt})
 expect(fetcher).toHaveBeenCalledTimes(2)
 expect(await brokerCredential(source({kind:'worker',generation:1}),'openai-codex','key',signal(),fetcher)).toBeUndefined();expect(fetcher).toHaveBeenCalledTimes(2)
 for(const patch of [{refresh:'forbidden'},{expiresAt:Date.now()-1},{accessToken:'!not-a-token'},{credentialType:'api_key'}])expect(await brokerCredential(source(),'openai-codex','key',signal(),async()=>Response.json({...response,...patch}))).toBeUndefined()
 let live=true;expect(await brokerCredential(source({current:()=>live}),'openai-codex','key',signal(),async()=>{live=false;return Response.json(response)})).toBeUndefined()
})
test('broker reads are origin-bound, bounded, uncached and include live instance authority', async () => {
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ provider: 'openai', apiKey: '!not-a-command $NOT_AN_ENV_VAR' }))
  for (let i = 0; i < 2; i++) expect(await brokerCredential(source(), 'openai', 'key', signal(), fetcher)).toEqual({ granted: true, apiKey: '!not-a-command $NOT_AN_ENV_VAR' })
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(fetcher.mock.calls[0]).toMatchObject(['https://rue.test/terminal-client/connections/term_one/provider-keys/openai', {
    redirect: 'error', cache: 'no-store', body: JSON.stringify({ instance: 'instance-one' }),
  }])
  expect(await brokerCredential(source({ origin: 'https://rue.test/other' }), 'openai', 'key', signal(), fetcher)).toBeUndefined()
  expect(fetcher).toHaveBeenCalledTimes(2)
})
test('availability never requests or returns key material, and worker reads require a generation', async () => {
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ provider: 'openai', granted: true, apiKey: 'must-not-escape-metadata' }))
  expect(await brokerCredential(source(), 'openai', 'availability', signal(), fetcher)).toEqual({ granted: true })
  expect(JSON.parse(fetcher.mock.calls[0][1].body as string)).toEqual({ instance: 'instance-one', availability: true })
  expect(await brokerCredential(source({ kind: 'worker' }), 'openai', 'key', signal(), fetcher)).toBeUndefined()
  await brokerCredential(source({ kind: 'worker', generation: 2 }), 'openai', 'availability', signal(), fetcher)
  expect(fetcher.mock.calls[1][0]).toContain('/worker-client/term_one/provider-keys/openai')
  expect(JSON.parse(fetcher.mock.calls[1][1].body as string).generation).toBe(2)
})
test('revocation, stopped links and late responses cannot yield credentials', async () => {
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response('do-not-log-me', { status: 403 }))
  expect(await brokerCredential(source(), 'openai', 'key', signal(), fetcher)).toBeUndefined()
  await brokerCredential(source({ current: () => false }), 'openai', 'key', signal(), fetcher)
  expect(fetcher).toHaveBeenCalledTimes(1)
  let live = true
  const late = async () => { live = false; return Response.json({ provider: 'openai', apiKey: 'late-secret' }) }
  expect(await brokerCredential(source({ current: () => live }), 'openai', 'key', signal(), late)).toBeUndefined()
})
test('malformed, oversized and failed responses never expose response bodies or machine secrets', async () => {
  for (const response of [new Response('upstream-private-error', { status: 503 }), new Response('x'.repeat(40000)), new Response('invalid-private-json')]) {
    await expect(brokerCredential(source(), 'openai', 'key', signal(), async () => response)).rejects.toThrow(/^Rue shared provider key unavailable\./)
  }
  expect(await brokerCredential(source(), 'openai', 'key', signal(), async () => Response.json({ provider: 'anthropic', apiKey: 'wrong-audience' }))).toBeUndefined()
  for (const apiKey of ['secret\n', 'secret\u0000', '雪'])
    expect(await brokerCredential(source(), 'openai', 'key', signal(), async () => Response.json({ provider: 'openai', apiKey }))).toBeUndefined()
})
test('native auth passes broker keys literally and leaves local auth, OAuth and provider methods intact', async () => {
  const oauth = {}, local = vi.fn(async () => undefined as any)
  const base: any = Object.freeze({ id: 'openai', name: 'OpenAI', auth: { apiKey: { name: 'Key', resolve: local }, oauth },
    getModels() { expect(this).toBe(base); return [] }, stream() {}, streamSimple() {},
  })
  const read = vi.fn(async (mode: string) => mode === 'key' ? { granted: true, apiKey: '!literal $DOLLAR' } : { granted: true })
  const wrapped = providerWithBroker(base, read)
  const input = { ctx: { env: async () => undefined, fileExists: async () => false }, signal: signal() }
  expect(await wrapped.auth.apiKey!.check!(input)).toEqual({ type: 'api_key', source: 'Rue grant' })
  expect(read.mock.calls[0][0]).toBe('availability')
  expect(await wrapped.auth.apiKey!.resolve(input)).toEqual({ auth: { apiKey: '!literal $DOLLAR' }, source: 'Rue grant' })
  expect(wrapped.auth.oauth).toBe(oauth); expect(wrapped.getModels()).toEqual([])
  local.mockResolvedValue({ auth: { apiKey: 'local-key' }, source: 'local' }); read.mockClear()
  expect(await wrapped.auth.apiKey!.resolve(input)).toEqual({ auth: { apiKey: 'local-key' }, source: 'local' })
  expect(read).not.toHaveBeenCalled()
})
