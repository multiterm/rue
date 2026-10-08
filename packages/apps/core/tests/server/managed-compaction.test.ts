import {randomUUID} from 'node:crypto'
import {afterEach,expect,test,vi} from 'vitest'
import {openDatabase} from '../../src/storage/db.js'
import {ConfigSchema} from '../../src/config/index.js'
import {Bus} from '../../src/bus/index.js'
import {createApp} from '../../src/server/app.js'
import {createWorker,connectWorker,heartbeatWorker} from '../../src/storage/workers.js'
import {createManagedAgent,managedGrant,reportManagedAgent} from '../../src/storage/managed-agents.js'
import {attachComputer} from '../../src/storage/terminal-relay.js'
import {ManagedCompactor} from '../../../agent-runtime/src/compaction.js'
import {compactionClient} from '../../../agent-runtime/src/compaction-client.js'
const dbs:ReturnType<typeof openDatabase>[]=[]
afterEach(()=>{dbs.splice(0).forEach(db=>db.close());vi.restoreAllMocks();vi.unstubAllEnvs()})
function setup(){
 vi.stubEnv('RUE_SETTINGS_ENCRYPTION_KEY',Buffer.alloc(32,1).toString('base64'))
 vi.spyOn(globalThis,'fetch').mockImplementation(async url=>{expect(String(url)).toBe('https://identity.test/v1/token/verify');return Response.json({token:{subject:'owner',principalType:'user'}})})
 const db=openDatabase(':memory:');dbs.push(db);const now=Date.now(),w=createWorker(db,'owner','Mason',randomUUID(),now),instance=randomUUID(),lease=connectWorker(db,w.worker.id,w.secret!,instance,now)
 heartbeatWorker(db,w.worker.id,w.secret!,instance,lease.generation,{version:'test',platform:'linux',architecture:'arm64',dockerAvailable:true,acceptingWork:true,cpus:2,freeMemoryBytes:1000000,capabilities:['managed-agents-v1','managed-compact-v1']},now)
 const auth={id:w.worker.id,secret:w.secret!,instance,generation:lease.generation}
 const agent=createManagedAgent(db,'owner',{workerId:w.worker.id,name:'Test',requestId:randomUUID(),acknowledgeExecution:true,config:{provider:'openai',model:'test',permission:'read-only',mounts:[],shareToolOutput:false,shareThinking:false}},now).agent
 const grant=managedGrant(db,auth,agent.id,1,now),runtime=randomUUID();attachComputer(db,grant.token,grant.id,runtime,now,2);reportManagedAgent(db,auth,agent.id,{revision:1,state:'running',error:null},now)
 const app=createApp({ctx:{db,config:ConfigSchema.parse({keyname:{enabled:true,apiUrl:'https://identity.test'}}),bus:new Bus()},terminalPairing:true,managedWorkers:true,managedAgents:true})
 const post=(path:string,token:string,body:object)=>app.request('https://rue.test'+path,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)})
 return {db,agent,grant,runtime,app,post,auth}
}
test('account -> manager assignment -> runtime claim -> persisted result -> acknowledgement is wired without transcript mutation',async()=>{
 const {db,agent,grant,runtime,app,post,auth}=setup(),request={requestId:randomUUID(),expectedRevision:1,acknowledgeModelUse:true}
 const response=await post(`/managed-agents/${agent.id}/compactions`,'human',request);expect(response.status).toBe(202);expect(response.headers.get('cache-control')).toContain('no-store');const command=await response.json()
 const client=compactionClient('https://rue.test',grant.id,grant.token,runtime,(url,init)=>app.request(String(url),init))
 expect(await client.poll(AbortSignal.timeout(1000))).toEqual([])
 const authority={instance:auth.instance,generation:auth.generation}
 const list=await post(`/worker-client/${auth.id}/agents/compactions`,auth.secret,authority);expect((await list.json()).commands[0].id).toBe(command.id)
 expect((await post(`/worker-client/${auth.id}/agents/compactions/${command.id}/assign`,auth.secret,authority)).status).toBe(200)
 expect((await client.poll(AbortSignal.timeout(1000)))[0].id).toBe(command.id)
 let calls=0,persisted=false
 const executor=new ManagedCompactor({idle:()=>true,claim:client.claim,compact:async()=>{calls++;return {summary:'private summary'}},persist:async()=>{persisted=true},acknowledge:async(...args)=>{expect(persisted).toBe(true);await client.acknowledge(...args)},uncertain:()=>{throw Error('unexpected uncertainty')}})
 expect(await executor.execute(command.id)).toBe('succeeded');expect(await executor.execute(command.id)).toBe('seen');expect(calls).toBe(1)
 const retry=await post(`/managed-agents/${agent.id}/compactions`,'human',request);expect((await retry.json()).status).toBe('succeeded')
 expect(db.prepare('SELECT COUNT(*) AS n FROM messages').get()).toEqual({n:0});expect(JSON.stringify(db.prepare('SELECT * FROM managed_compactions').all())).not.toContain('private summary')
})
test('Pi status is allowlisted, owner scoped and available in the authenticated manager snapshot',async()=>{
 const {agent,grant,runtime,post,auth,app}=setup()
 const status={version:1,cwd:'/workspace',branch:'develop',state:'idle',provider:'openai-codex',model:'test-model',thinking:'medium',context:{tokens:161568,window:272000,percent:59.4},usage:{input:6500000,output:1400000,cacheRead:322000000,cacheWrite:0,costUsd:456.034},cacheHitPercent:98.7,subscription:true,autoCompaction:false}
 const health={status,agentWorking:false,uploadFailures:0,retries:0,lastUploadAt:null,pendingCount:0,pendingBytes:0,pollLatencyMs:1}
 expect((await post(`/terminal-client/connections/${grant.id}/relay/heartbeat`,grant.token,{instance:runtime,protocol:2,health})).status).toBe(200)
 const snapshot=await post(`/worker-client/${auth.id}/agents/snapshot`,auth.secret,{instance:auth.instance,generation:auth.generation})
 expect((await snapshot.json()).agents.find((a:any)=>a.id===agent.id).runtimeStatus.report).toEqual(status)
 const computers=await app.request('https://rue.test/terminal/computers',{headers:{authorization:'Bearer human'}})
 expect((await computers.json()).computers[0].health.status).toEqual(status)
 expect((await post(`/terminal-client/connections/${grant.id}/relay/heartbeat`,grant.token,{instance:runtime,protocol:2,health:{...health,status:{...status,apiKey:'forbidden'}}})).status).toBe(400)
})
test('machine credentials cannot create account commands and malformed runtime bodies fail closed',async()=>{
 const {agent,grant,runtime,post,auth}=setup()
 expect((await post(`/managed-agents/${agent.id}/compactions`,auth.secret,{requestId:randomUUID(),expectedRevision:1,acknowledgeModelUse:true})).status).toBe(401)
 expect((await post(`/terminal-client/${grant.id}/compactions/poll`,grant.token,{instance:runtime,unexpected:'secret'})).status).toBe(400)
 expect((await post(`/terminal-client/${grant.id}/compactions/poll`,'human',{instance:runtime})).status).toBe(401)
 expect((await post(`/terminal-client/${grant.id}/compactions/poll`,grant.token,{instance:runtime,padding:'x'.repeat(3000)})).status).toBe(413)
})
