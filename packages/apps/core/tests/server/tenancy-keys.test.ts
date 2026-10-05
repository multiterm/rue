import {randomUUID} from 'node:crypto'
import {afterEach,expect,test,vi} from 'vitest'
import {WebSocket} from 'ws'
import {ConfigSchema} from '../../src/config/index.js'
import {openDatabase} from '../../src/storage/db.js'
import {Bus} from '../../src/bus/index.js'
import {listen,type RueServer} from '../../src/server/listen.js'
import {ProjectAuthority} from '../../src/server/project-authority.js'
import {tenancyVerifier} from '../../src/server/tenancy-verifier.js'
import {keyPermissionsFor} from '../../src/server/tenancy-key-api.js'
const nativeFetch=globalThis.fetch;let server:RueServer|undefined;const sockets:WebSocket[]=[]
afterEach(async()=>{sockets.splice(0).forEach(ws=>ws.terminate());await server?.close();server?.ctx.db.close();server=undefined;vi.restoreAllMocks();vi.unstubAllEnvs()})
async function setup(agentControl=false){
 vi.stubEnv('RUE_MANAGED_WORKERS','true');vi.stubEnv('RUE_MANAGED_AGENTS','true');vi.stubEnv('RUE_SETTINGS_ENCRYPTION_KEY',Buffer.alloc(32,9).toString('base64'))
 const token='tnk_'+'s'.repeat(43),readToken='tnk_'+'r'.repeat(43),projectToken='tnk_'+'p'.repeat(43);let revoked=false,unavailable=false,identityCalls=0
 const grants=['rue:hosts:read','rue:hosts:enroll','rue:agents:execute',...(agentControl?['rue:agents:read','rue:agents:write']:[])],base={name:'Test',service:'rue',grants,createdAt:Date.now(),expiresAt:Date.now()+3600000,revokedAt:null}
 vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{
  if(String(url)==='https://identity.test/v1/token/verify'){identityCalls++;return Response.json({token:{subject:'usr_owner',principalType:'user'}})}
  if(String(url)==='https://tenancy.test/v1/service/rue/keys/verify'){
   expect(init?.redirect).toBe('error');expect(init?.cache).toBe('no-store');expect((init?.headers as any)['x-tenancy-service']).toBe('rue');if(unavailable)return new Response(null,{status:503})
   const t=JSON.parse(String(init?.body)).token
   const key=t===projectToken?{...base,id:'key_project',owner:{type:'project',organizationId:'org_one',projectId:'project_one'}}:t===readToken?{...base,id:'key_read',owner:{type:'self',subject:'usr_owner'},grants:['rue:hosts:read']}:t===token&&!revoked?{...base,id:'key_self',owner:{type:'self',subject:'usr_owner'}}:undefined
   return key?Response.json({key}):Response.json({error:'TENANCY_API_KEY_INVALID'},{status:401})
  }throw Error('Unexpected external request')
 })
 const db=openDatabase(':memory:'),config=ConfigSchema.parse({server:{hostname:'127.0.0.1',port:0},keyname:{enabled:true,apiUrl:'https://identity.test'}})
 server=await listen({config,ctx:{db,bus:new Bus(),config,projectAuthority:new ProjectAuthority(db,tenancyVerifier('https://tenancy.test','v'.repeat(40)))}})
 const api=(path:string,bearer=token,body?:unknown,method=body?'POST':'GET')=>nativeFetch(server!.url+path,{method,headers:{authorization:`Bearer ${bearer}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})
 return {api,token,readToken,projectToken,identityCalls:()=>identityCalls,revoke:()=>{revoked=true},outage:(v:boolean)=>{unavailable=v}}
}
test('opaque grants do not imply wildcard, human, provider or unlisted route authority',()=>{for(const path of ['/trpc/auth.login','/provider-keys','/api-keys','/project-bindings','/session'])expect(keyPermissionsFor('GET',path)).toBeUndefined();expect(keyPermissionsFor('POST','/workers')).toEqual(['rue:hosts:enroll','rue:agents:execute'])})
test('same Tenancy key authorizes enrollment and API access with owner isolation and safe retries',async()=>{
 const f=await setup(),input={name:'Mason test',requestId:randomUUID(),acknowledgeHostControl:true}
 expect((await f.api('/workers',f.readToken,input)).status).toBe(403)
 const enrolled=await f.api('/workers',f.token,input);expect(enrolled.status).toBe(201);const result=await enrolled.json();expect(result.worker.ownerSubject).toBe('usr_owner');expect(result.secret).toMatch(/^rue_worker_/)
 expect((await (await f.api('/workers',f.token,input)).json()).secret).toBeUndefined()
 expect((await (await f.api('/workers',f.readToken)).json()).workers).toHaveLength(1)
 const project=await (await f.api('/workers',f.projectToken,{...input,requestId:randomUUID()})).json();expect(project.worker.ownerSubject).toBe('tenancy:project:org_one:project_one')
 expect((await (await f.api('/workers',f.projectToken)).json()).workers.map((w:any)=>w.id)).toEqual([project.worker.id])
 expect((await (await f.api('/workers',f.token)).json()).workers.map((w:any)=>w.id)).toEqual([result.worker.id])
 expect((await f.api('/api-keys',f.token)).status).toBe(401);expect((await f.api('/workers','tnk_'+'x'.repeat(43))).status).toBe(401);expect(f.identityCalls()).toBe(0)
 const rows=server!.ctx.db.prepare('SELECT * FROM project_bindings').all();expect(JSON.stringify(rows)).not.toContain(f.token)
 f.outage(true);expect((await f.api('/workers')).status).toBe(503);f.outage(false);f.revoke();expect((await f.api('/workers')).status).toBe(401)
})
test('machine agent creation is owner scoped, idempotent, revocable and never a human login',async()=>{
 const f=await setup(true),worker=await (await f.api('/workers',f.token,{name:'Agent host',requestId:randomUUID(),acknowledgeHostControl:true})).json()
 const input={workerId:worker.worker.id,requestId:randomUUID(),name:'CLI agent',acknowledgeExecution:true,config:{provider:'openai',model:'test-model',permission:'read-only',mounts:[],shareToolOutput:false,shareThinking:false}}
 expect((await f.api('/managed-agents',f.readToken,input)).status).toBe(403)
 expect((await f.api('/managed-agents',f.projectToken,input)).status).toBe(404)
 const created=await f.api('/managed-agents',f.token,input);expect(created.status).toBe(201)
 const first=await created.json(),retry=await (await f.api('/managed-agents',f.token,input)).json()
 expect(retry.agent.id).toBe(first.agent.id);expect(retry.operation.id).toBe(first.operation.id)
 expect((await (await f.api('/managed-agents',f.token)).json()).agents).toHaveLength(1)
 expect((await (await f.api('/managed-agents',f.projectToken)).json()).agents).toEqual([])
 expect((await f.api(`/managed-agents/${first.agent.id}`,f.projectToken,{action:'stop',expectedRevision:1,requestId:randomUUID()},'PATCH')).status).toBe(404)
 expect(f.identityCalls()).toBe(0)
 f.revoke();expect((await f.api('/managed-agents',f.token,input)).status).toBe(401)
 expect(server!.ctx.db.prepare('SELECT count(*) AS n FROM managed_agents').get()).toEqual({n:1})
})
function next(ws:WebSocket){return new Promise<any>((resolve,reject)=>{ws.once('message',data=>resolve(JSON.parse(data.toString())));ws.once('error',reject)})}
test('revoking the enrolling Tenancy key fences the real worker socket',async()=>{
 const f=await setup(),result=await (await f.api('/workers',f.token,{name:'Socket host',requestId:randomUUID(),acknowledgeHostControl:true})).json()
 const ws=new WebSocket(server!.url.replace('http:','ws:')+'/worker-client/socket');sockets.push(ws);await new Promise<void>((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)})
 let reply=next(ws);ws.send(JSON.stringify({type:'authenticate',protocol:1,id:result.worker.id,token:result.secret,instance:randomUUID()}));const ready=await reply;expect(ready.type).toBe('ready');expect(ready.lease.expiresAt-ready.lease.serverNow).toBeLessThanOrEqual(45000)
 f.revoke();reply=next(ws);ws.send(JSON.stringify({type:'heartbeat',requestId:randomUUID(),generation:ready.lease.generation,health:{version:'0.2.0',platform:'linux',architecture:'arm64',dockerAvailable:true,acceptingWork:false,freeMemoryBytes:1000,cpus:2,capabilities:['host-health-v1']}}));expect((await reply).type).toBe('error')
 expect(server!.ctx.db.prepare('SELECT lease_expires_at FROM workers WHERE id=?').get(result.worker.id)).toEqual({lease_expires_at:null});expect(server!.ctx.db.prepare('SELECT encrypted_key FROM project_bindings WHERE id=?').get(result.worker.keyAuthorityId)).toEqual({encrypted_key:null})
})
