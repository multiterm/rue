import {randomUUID} from 'node:crypto'
import {afterEach,expect,test,vi} from 'vitest'
import {createApp} from '../../src/server/app.js'
import {openDatabase} from '../../src/storage/db.js'
import {ConfigSchema} from '../../src/config/index.js'
import {Bus} from '../../src/bus/index.js'
import {connectWorker,createWorker} from '../../src/storage/workers.js'
const databases:ReturnType<typeof openDatabase>[]=[]
afterEach(()=>{databases.splice(0).forEach(db=>db.close());vi.restoreAllMocks();vi.unstubAllEnvs()})
function setup(enabled=true){
 vi.stubEnv('RUE_SETTINGS_ENCRYPTION_KEY',Buffer.alloc(32,2).toString('base64'))
 const verify=vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{
  const token=JSON.parse(String(init?.body)).token
  return ['owner','other'].includes(token)?Response.json({token:{subject:token,principalType:'user'}}):new Response(null,{status:401})
 })
 const db=openDatabase(':memory:');databases.push(db)
 const config=ConfigSchema.parse({keyname:{enabled:true,apiUrl:'https://identity.test'}})
 const bus=new Bus()
 const app=createApp({ctx:{db,bus,config},terminalPairing:true,managedWorkers:true,managedAgents:enabled})
 const request=(path:string,token='owner',body?:unknown,method=body?'POST':'GET')=>app.request(path,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})
 return {db,request,verify,bus}
}
test('managed namespaces require explicit feature enablement and separate owner/worker proofs',async()=>{
 const {db,request,verify,bus}=setup()
 const w=createWorker(db,'owner','Mason',randomUUID())
 const input={workerId:w.worker.id,requestId:randomUUID(),name:'Agent',acknowledgeExecution:true,config:{provider:'openai',model:'gpt-4.1-mini',permission:'read-only',mounts:[],shareToolOutput:false,shareThinking:false}}
 expect((await request('/managed-agents','other',input)).status).toBe(404)
 const created=await request('/managed-agents','owner',input);expect(created.status).toBe(201)
 const a=(await created.json()).agent
 const updates=bus.historySince(0).filter(event=>event.type==='managed-agent.updated'||event.type==='worker.control.changed')
 expect(updates.length).toBeGreaterThan(0)
 for(const event of updates)expect(event.payload).toMatchObject({ownerSubject:'owner'})
 expect((await (await request('/managed-agents','other')).json()).agents).toEqual([])
 expect((await request(`/managed-agents/${a.id}`,'other',{requestId:randomUUID(),expectedRevision:1,action:'stop'},'PATCH')).status).toBe(404)
 const calls=verify.mock.calls.length
 expect((await request('/managed-agents',w.secret)).status).toBe(401)
 expect(verify.mock.calls.length).toBe(calls)
 const instance=randomUUID(),lease=connectWorker(db,w.worker.id,w.secret,instance),authority={instance,generation:lease.generation}
 expect((await request(`/worker-client/${w.worker.id}/agents/snapshot`,'owner',authority)).status).toBe(401)
 const response=await request(`/worker-client/${w.worker.id}/agents/${a.id}/grant`,w.secret,{...authority,revision:1})
 expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store')
 const grant=await response.json();expect(grant.token).toMatch(/^rue_terminal_/)
 const snapshot=await (await request(`/worker-client/${w.worker.id}/agents/snapshot`,w.secret,authority)).json()
 expect(JSON.stringify(snapshot)).not.toContain(grant.token)
 const guard=await request(`/terminal-client/connections/${grant.id}/authority`,grant.token)
 expect(guard.status).toBe(200);expect((await guard.json()).expiresAt).toBe(lease.expiresAt)
 expect((await request(`/worker-client/${w.worker.id}/agents/snapshot`,grant.token,authority)).status).toBe(401)
 expect((await (await request('/workers')).json()).workers[0].managedAgentCount).toBe(1)
})
test('an enrollment-only server does not expose managed execution endpoints',async()=>{
 const {request}=setup(false)
 expect((await request('/managed-agents')).status).toBe(404)
})

test('MCP HTTP metadata is private, owner-bound, secret-free and rejects machine namespace confusion',async()=>{
 const {request,db,verify,bus}=setup(),id=randomUUID()
 const input={expectedOwnerSubject:'owner',name:'Tools',command:'node',args:['server.mjs'],environment:{EXAMPLE:'synthetic-http-secret'},acknowledgeTools:true}
 expect((await request('/mcp/'+id,'other',input,'PUT')).status).toBe(409)
 const created=await request('/mcp/'+id,'owner',input,'PUT')
 expect(created.status).toBe(201);expect(created.headers.get('cache-control')).toContain('no-store')
 expect(JSON.stringify(await created.json())).not.toContain(input.environment.EXAMPLE)
 const listed=await (await request('/mcp')).json()
 expect(listed.ownerSubject).toBe('owner');expect(listed.profiles[0].environmentNames).toEqual(['EXAMPLE'])
 expect(JSON.stringify(listed)).not.toContain(input.environment.EXAMPLE)
 expect((await (await request('/mcp','other')).json()).profiles).toEqual([])
 const calls=verify.mock.calls.length
 expect((await request('/mcp','rue_worker_'+'a'.repeat(43))).status).toBe(401)
 expect(verify.mock.calls.length).toBe(calls)
 expect((await request('/mcp/'+id,'other',{expectedRevision:1},'DELETE')).status).toBe(404)
 expect((await request('/mcp/'+id,'owner',{expectedRevision:1},'DELETE')).status).toBe(200)
 expect(db.prepare('SELECT encrypted_env FROM mcp_profiles WHERE id=?').get(id)).toEqual({encrypted_env:null})
 for(const event of bus.historySince(0).filter(e=>e.type==='mcp.updated'))expect(event.payload).toEqual({ownerSubject:'owner'})
 expect((await setup(false).request('/mcp')).status).toBe(404)
})
