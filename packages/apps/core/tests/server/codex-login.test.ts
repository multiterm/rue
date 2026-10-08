import {randomBytes,randomUUID} from 'node:crypto'
import {afterEach,beforeEach,expect,test,vi} from 'vitest'
import {createApp} from '../../src/server/app.js'
import {ConfigSchema} from '../../src/config/index.js'
import {openDatabase} from '../../src/storage/db.js'
import {Bus} from '../../src/bus/index.js'
import {providerOAuthMetadata} from '../../src/storage/provider-oauth.js'
let db:ReturnType<typeof openDatabase>,app:ReturnType<typeof createApp>,ctx:Parameters<typeof createApp>[0]['ctx'],now:number,starts:number,polls:number,exchanges:number
let exchange:()=>Promise<Response>
const access=()=>Buffer.from('{}').toString('base64url')+'.'+Buffer.from(JSON.stringify({exp:Math.floor(now/1000)+3600,'https://api.openai.com/auth':{chatgpt_account_id:'account_one'}})).toString('base64url')+'.synthetic'
beforeEach(()=>{
 now=Date.now();vi.spyOn(Date,'now').mockImplementation(()=>now);vi.stubEnv('RUE_SETTINGS_ENCRYPTION_KEY',randomBytes(32).toString('base64'));db=openDatabase(':memory:');starts=0;polls=0;exchanges=0
 ctx={db,config:ConfigSchema.parse({keyname:{enabled:true,apiUrl:'https://identity.test'}}),bus:new Bus()};app=createApp({ctx})
 exchange=async()=>Response.json({access_token:access(),refresh_token:'private-refresh-token',expires_in:3600})
 vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{
  if(String(url)==='https://identity.test/v1/token/verify'){const token=JSON.parse(String(init?.body)).token;return Response.json({token:{subject:token,principalType:'user'}})}
  expect(init?.redirect).toBe('error');expect(String(url).startsWith('https://auth.openai.com/')).toBe(true)
  if(String(url).endsWith('/usercode')){starts++;return Response.json({device_auth_id:'private-device-id',user_code:'CODE-1234',interval:5})}
  if(String(url).endsWith('/deviceauth/token')){polls++;return Response.json({authorization_code:'private-authorization-code',code_verifier:'v'.repeat(43)})}
  exchanges++;return exchange()
 })
})
afterEach(()=>{db.close();vi.restoreAllMocks();vi.unstubAllEnvs()})
const call=(path:string,body?:unknown,owner='alice',method=body?'POST':'GET')=>app.request('https://rue.test/provider-oauth/openai-codex'+path,{method,headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})
const start=(id=randomUUID(),owner='alice',expectedRevision=0)=>call('/start',{requestId:id,expectedOwnerSubject:owner,expectedRevision,acknowledgeStorage:true},owner)
const action=(id:string,verb:string,owner='alice')=>call(`/flows/${id}/${verb}`,{expectedOwnerSubject:owner,...(verb==='confirm'?{acknowledgeAccount:true}:{})},owner)
function safe(data:unknown){const text=JSON.stringify(data);for(const secret of [access(),'private-refresh-token','private-device-id','private-authorization-code','v'.repeat(43)])expect(text).not.toContain(secret)}
test('OAuth login is owner-scoped, idempotent, rate-limited between polls and saved only after account confirmation',async()=>{
 const id=randomUUID(),started=await start(id);expect(started.headers.get('cache-control')).toContain('no-store')
 const first=await started.json();expect(first).toMatchObject({status:'pending',userCode:'CODE-1234',verificationUri:'https://auth.openai.com/codex/device'});safe(first)
 expect((await start(id)).status).toBe(200);expect(starts).toBe(1)
 expect((await call(`/flows/${id}`,undefined,'bob')).status).toBe(404)
 expect((await action(id,'confirm','bob')).status).toBe(404)
 expect((await action(id,'confirm')).status).toBe(409)
 expect((await action(id,'poll')).status).toBe(200);expect(polls).toBe(0)
 now+=5001;const review=await (await action(id,'poll')).json();expect(review).toMatchObject({status:'review',accountId:'account_one'});safe(review);expect(polls).toBe(1);expect(exchanges).toBe(1)
 expect(providerOAuthMetadata(db,'alice').configured).toBe(false)
 expect((await call(`/flows/${id}/confirm`,{expectedOwnerSubject:'alice'})).status).toBe(400)
 const saved=await (await action(id,'confirm')).json();expect(saved.status).toBe('complete');safe(saved)
 expect(providerOAuthMetadata(db,'alice')).toMatchObject({configured:true,revision:1,grants:[]})
 await action(id,'confirm');expect(providerOAuthMetadata(db,'alice').revision).toBe(1)
 safe(await (await call('')).json());safe(db.prepare('SELECT * FROM oauth_login_intents').all())
 await call('',{expectedOwnerSubject:'alice',expectedRevision:1},'alice','DELETE');await action(id,'confirm');expect(providerOAuthMetadata(db,'alice')).toMatchObject({configured:false,revision:2})
})
test('consent, owner and revision checks precede contacting OpenAI',async()=>{
 expect((await call('/start',{requestId:randomUUID(),expectedOwnerSubject:'alice',expectedRevision:0})).status).toBe(400)
 expect((await call('/start',{requestId:randomUUID(),expectedOwnerSubject:'bob',expectedRevision:0,acknowledgeStorage:true})).status).toBe(409)
 expect((await start(randomUUID(),'alice',3)).status).toBe(409);expect(starts).toBe(0)
})
test('cancellation before start and process restart fence pending login intents',async()=>{
 const cancelled=randomUUID();await action(cancelled,'cancel');expect((await (await start(cancelled)).json()).status).toBe('cancelled');expect(starts).toBe(0)
 const id=randomUUID();await start(id);app=createApp({ctx});expect((await (await start(id)).json()).status).toBe('failed');expect(starts).toBe(1)
})
test('uncertain exchanges are sanitized and never retried',async()=>{
 exchange=async()=>{throw Error('private-provider-error')};const id=randomUUID();await start(id);now+=5001
 const failed=await (await action(id,'poll')).json();expect(failed.status).toBe('failed');safe(failed)
 await action(id,'poll');await start(id);expect(exchanges).toBe(1);expect(providerOAuthMetadata(db,'alice').configured).toBe(false)
})
test('cancelling during exchange discards a late credential',async()=>{
 let finish!:(r:Response)=>void;exchange=()=>new Promise(resolve=>{finish=resolve})
 const id=randomUUID();await start(id);now+=5001;const result=action(id,'poll')
 await vi.waitFor(()=>expect(exchanges).toBe(1));await action(id,'cancel');finish(Response.json({access_token:access(),refresh_token:'private-refresh-token',expires_in:3600}))
 expect((await (await result).json()).status).toBe('cancelled');expect(providerOAuthMetadata(db,'alice').configured).toBe(false)
})
test('login intents expire and start/cancel allocations are bounded per owner',async()=>{
 const id=randomUUID();await start(id);now+=15*60000+1;expect((await (await action(id,'poll')).json()).status).toBe('expired');expect(polls).toBe(0)
 for(let n=0;n<4;n++)await action(randomUUID(),'cancel')
 expect((await start()).status).toBe(409);expect((await action(randomUUID(),'cancel')).status).toBe(409)
})
