import {randomUUID} from 'node:crypto'
import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {afterEach,expect,test,vi} from 'vitest'
import {openDatabase} from '../../src/storage/db.js'
import {createWorker,connectWorker,heartbeatWorker,changeWorker} from '../../src/storage/workers.js'
import {createManagedAgent,managedGrant,reportManagedAgent,changeManagedAgent,managedAcceptingPrompts,managedSnapshot} from '../../src/storage/managed-agents.js'
import {attachComputer,pollComputer,enqueueTerminalPrompt,transitionCommand} from '../../src/storage/terminal-relay.js'
import {requestManagedCompaction,managedCompactions,assignManagedCompaction,claimManagedCompaction,acknowledgeManagedCompaction,COMPACT_CAPABILITY} from '../../src/storage/managed-compaction.js'
const databases:ReturnType<typeof openDatabase>[]=[],directories:string[]=[]
afterEach(()=>{databases.splice(0).forEach(db=>db.close());directories.splice(0).forEach(dir=>rmSync(dir,{recursive:true,force:true}));vi.unstubAllEnvs()})
function setup(durable=false){
 vi.stubEnv('RUE_SETTINGS_ENCRYPTION_KEY',Buffer.alloc(32,1).toString('base64'))
 const dir=durable?mkdtempSync(join(tmpdir(),'rue-compact-')):null;if(dir)directories.push(dir)
 const path=dir?join(dir,'state.sqlite'):':memory:',db=openDatabase(path);databases.push(db)
 const worker=createWorker(db,'owner','Mason',randomUUID(),1000),instance=randomUUID(),lease=connectWorker(db,worker.worker.id,worker.secret!,instance,1000)
 const auth={id:worker.worker.id,secret:worker.secret!,instance,generation:lease.generation}
 const health={version:'test',platform:'linux',architecture:'arm64',dockerAvailable:true,acceptingWork:true,freeMemoryBytes:1000000,cpus:2,capabilities:['managed-agents-v1',COMPACT_CAPABILITY]}
 heartbeatWorker(db,auth.id,auth.secret,instance,auth.generation,health,1001)
 const agent=createManagedAgent(db,'owner',{workerId:auth.id,requestId:randomUUID(),name:'Compact test',acknowledgeExecution:true,config:{provider:'openai',model:'test',permission:'read-only',mounts:[],shareToolOutput:false,shareThinking:false}},1002).agent
 const grant=managedGrant(db,auth,agent.id,1,1003)
 const runtime={id:grant.id,token:grant.token,instance:'runtime'};attachComputer(db,grant.token,grant.id,runtime.instance,1004,2)
 reportManagedAgent(db,auth,agent.id,{revision:1,boot:1,state:'running',error:null},1005)
 const request={requestId:randomUUID(),expectedRevision:1,acknowledgeModelUse:true as const}
 return {db,path,auth,health,agent,grant,runtime,request}
}
test('compaction requires consent, a capable live host and an owner-scoped revision',()=>{
 const {db,auth,health,agent,request}=setup()
 expect(()=>requestManagedCompaction(db,'other',agent.id,request,1100)).toThrow('managed_agent_not_found')
 expect(()=>requestManagedCompaction(db,'owner',agent.id,{...request,acknowledgeModelUse:false},1100)).toThrow()
 expect(()=>requestManagedCompaction(db,'owner',agent.id,{...request,expectedRevision:2},1100)).toThrow('managed_revision_conflict')
 heartbeatWorker(db,auth.id,auth.secret,auth.instance,auth.generation,{...health,capabilities:['managed-agents-v1']},1100)
 expect(()=>requestManagedCompaction(db,'owner',agent.id,request,1101)).toThrow('managed_compact_not_supported')
 expect(()=>requestManagedCompaction(db,'owner',agent.id,{...request,summary:'untrusted prompt'},1101)).toThrow()
})
test('manager assignment precedes the single-use runtime claim; acknowledgements never edit chat or lifecycle revisions',()=>{
 const {db,auth,agent,runtime,request}=setup()
 const sessions=db.prepare('SELECT * FROM sessions').all(),agents=db.prepare('SELECT * FROM managed_agents').all()
 const c=requestManagedCompaction(db,'owner',agent.id,request,1100)
 expect(requestManagedCompaction(db,'owner',agent.id,request,1101)).toEqual(c)
 expect(()=>requestManagedCompaction(db,'owner',agent.id,{...request,expectedRevision:2},1101)).toThrow('managed_request_conflict')
 expect(claimManagedCompaction(db,runtime,c.id,1102)).toMatchObject({execute:false,command:{status:'queued'}})
 expect(managedAcceptingPrompts(db,runtime.id,1102)).toBe(false)
 expect(()=>enqueueTerminalPrompt(db,'owner',agent.sessionId!,'later','do not run',1102)).toThrow('computer_not_ready')
 expect(assignManagedCompaction(db,auth,c.id,1103).status).toBe('assigned')
 const ticket=claimManagedCompaction(db,runtime,c.id,1104);expect(ticket.execute).toBe(true);if(!ticket.execute)throw Error('missing ticket')
 expect(claimManagedCompaction(db,runtime,c.id,1105)).toMatchObject({execute:false,command:{status:'running'}})
 expect(JSON.stringify(db.prepare('SELECT * FROM managed_compactions').all())).not.toContain(ticket.nonce)
 expect(JSON.stringify(managedCompactions(db,'owner',agent.id,1105))).not.toContain(ticket.nonce)
 expect(()=>acknowledgeManagedCompaction(db,runtime,c.id,'x'.repeat(43),'succeeded',1105)).toThrow('managed_compact_ack_fenced')
 const result=acknowledgeManagedCompaction(db,runtime,c.id,ticket.nonce,'succeeded',1106)
 expect(result.status).toBe('succeeded');expect(acknowledgeManagedCompaction(db,runtime,c.id,ticket.nonce,'succeeded',1107)).toEqual(result)
 expect(()=>acknowledgeManagedCompaction(db,runtime,c.id,ticket.nonce,'failed',1107)).toThrow('managed_compact_ack_fenced')
 expect(managedAcceptingPrompts(db,runtime.id,1107)).toBe(true)
 expect(db.prepare('SELECT * FROM sessions').all()).toEqual(sessions);expect(db.prepare('SELECT * FROM managed_agents').all()).toEqual(agents)
 expect(db.prepare('SELECT COUNT(*) AS n FROM messages').get()).toEqual({n:0})
 expect(db.prepare('SELECT COUNT(*) AS n FROM terminal_commands').get()).toEqual({n:0})
})
test.each(['queued','claimed','running'])('existing %s prompts cannot be overtaken or interrupted by compact',status=>{
 const {db,agent,grant,runtime,request}=setup(),prompt=enqueueTerminalPrompt(db,'owner',grant.sessionId,'first','first',1100)
 if(status!=='queued')transitionCommand(db,grant.token,grant.id,runtime.instance,prompt.id,'claim',1101)
 if(status==='running')transitionCommand(db,grant.token,grant.id,runtime.instance,prompt.id,'start',1102)
 expect(()=>requestManagedCompaction(db,'owner',agent.id,request,1103)).toThrow('managed_compact_agent_busy')
 expect(managedAcceptingPrompts(db,grant.id,1104)).toBe(true)
})
test('a persisted claim is not replayed by a different database handle or after a lost reply',()=>{
 const {db,path,auth,agent,runtime,request}=setup(true),c=requestManagedCompaction(db,'owner',agent.id,request,1100)
 assignManagedCompaction(db,auth,c.id,1101);const first=claimManagedCompaction(db,runtime,c.id,1102);expect(first.execute).toBe(true)
 const second=openDatabase(path);databases.push(second)
 const retry=claimManagedCompaction(second,runtime,c.id,1103);expect(retry).toMatchObject({execute:false,command:{status:'running'}});expect(retry).not.toHaveProperty('nonce')
 expect(requestManagedCompaction(second,'owner',agent.id,request,1104).status).toBe('running')
})
test('an expired running command stays uncertain, blocks prompts, rejects late success and requires runtime fencing',()=>{
 const {db,auth,health,agent,runtime,request}=setup(),c=requestManagedCompaction(db,'owner',agent.id,request,1100)
 assignManagedCompaction(db,auth,c.id,1101);const ticket=claimManagedCompaction(db,runtime,c.id,1102);if(!ticket.execute)throw Error('missing ticket')
 for(const now of [30000,60000,90000,120000]){heartbeatWorker(db,auth.id,auth.secret,auth.instance,auth.generation,health,now);pollComputer(db,runtime.token,runtime.id,runtime.instance,now,2)}
 expect(managedCompactions(db,'owner',agent.id,121103)[0].status).toBe('uncertain')
 expect(managedAcceptingPrompts(db,runtime.id,121104)).toBe(false)
 expect(()=>acknowledgeManagedCompaction(db,runtime,c.id,ticket.nonce,'succeeded',121104)).toThrow('managed_compact_ack_fenced')
 expect(()=>managedGrant(db,auth,agent.id,1,121104,2)).toThrow('managed_reload_pending')
 expect(()=>requestManagedCompaction(db,'owner',agent.id,{...request,requestId:randomUUID()},121104)).toThrow('managed_compact_pending_or_uncertain')
 changeManagedAgent(db,'owner',agent.id,{requestId:randomUUID(),expectedRevision:1,action:'stop'},121105)
 changeManagedAgent(db,'owner',agent.id,{requestId:randomUUID(),expectedRevision:2,action:'resume'},121106)
 const next=managedGrant(db,auth,agent.id,3,121107)
 attachComputer(db,next.token,next.id,'new-runtime',121108,2)
 expect(managedAcceptingPrompts(db,next.id,121109)).toBe(true)
 expect(()=>acknowledgeManagedCompaction(db,runtime,c.id,ticket.nonce,'succeeded',121109)).toThrow()
 expect(managedCompactions(db,'owner',agent.id,121109)[0].status).toBe('uncertain')
})
test('reload drains a running compaction without invalidating its acknowledgement',()=>{
 const {db,auth,agent,runtime,request}=setup(),c=requestManagedCompaction(db,'owner',agent.id,request,1100)
 assignManagedCompaction(db,auth,c.id,1101);const ticket=claimManagedCompaction(db,runtime,c.id,1102);if(!ticket.execute)throw Error('missing ticket')
 changeManagedAgent(db,'owner',agent.id,{requestId:randomUUID(),expectedRevision:1,action:'reload'},1103)
 expect(()=>managedGrant(db,auth,agent.id,2,1104)).toThrow('managed_reload_pending')
 expect(acknowledgeManagedCompaction(db,runtime,c.id,ticket.nonce,'succeeded',1105).status).toBe('succeeded')
 expect(managedGrant(db,auth,agent.id,2,1106).token).not.toBe(runtime.token)
})
test.each(['queued','assigned','running'])('host revocation fences %s compaction without replay or transcript deletion',status=>{
 const {db,auth,agent,runtime,request}=setup(),c=requestManagedCompaction(db,'owner',agent.id,request,1100)
 if(status!=='queued')assignManagedCompaction(db,auth,c.id,1101)
 if(status==='running')claimManagedCompaction(db,runtime,c.id,1102)
 changeWorker(db,'owner',auth.id,'revoke',0,1103)
 expect(managedCompactions(db,'owner',agent.id,1104)[0].status).toBe(status==='running'?'uncertain':'cancelled')
 expect(()=>claimManagedCompaction(db,runtime,c.id,1105)).toThrow()
 expect(requestManagedCompaction(db,'owner',agent.id,request,1105).status).toBe(status==='running'?'uncertain':'cancelled')
 expect(db.prepare('SELECT 1 FROM sessions WHERE id=?').get(agent.sessionId)).toBeTruthy()
})
test('queue expiry cancels without execution even while both leases remain live',()=>{
 const {db,auth,health,agent,runtime,request}=setup(),c=requestManagedCompaction(db,'owner',agent.id,request,1100)
 for(let now=30000;now<=300000;now+=30000){heartbeatWorker(db,auth.id,auth.secret,auth.instance,auth.generation,health,now);managedSnapshot(db,auth,now);pollComputer(db,runtime.token,runtime.id,runtime.instance,now,2)}
 expect(managedCompactions(db,'owner',agent.id,301100)[0].status).toBe('cancelled')
 expect(assignManagedCompaction(db,auth,c.id,301101).status).toBe('cancelled')
 expect(claimManagedCompaction(db,runtime,c.id,301102).execute).toBe(false)
 expect(managedAcceptingPrompts(db,runtime.id,301102)).toBe(true)
})
test('a runtime-instance takeover cannot reuse a claim in the same boot',()=>{
 const {db,auth,agent,runtime,request}=setup(),c=requestManagedCompaction(db,'owner',agent.id,request,1100)
 assignManagedCompaction(db,auth,c.id,1101);const ticket=claimManagedCompaction(db,runtime,c.id,1102);if(!ticket.execute)throw Error('missing ticket')
 const replacement={...runtime,instance:'replacement'};attachComputer(db,runtime.token,runtime.id,replacement.instance,1103,2)
 expect(claimManagedCompaction(db,replacement,c.id,1104)).toMatchObject({execute:false,command:{status:'uncertain'}})
 expect(()=>acknowledgeManagedCompaction(db,replacement,c.id,ticket.nonce,'succeeded',1105)).toThrow('managed_compact_ack_fenced')
 expect(managedAcceptingPrompts(db,runtime.id,1105)).toBe(false)
})
test('allocation limits do not erase tombstones or break idempotent retries',()=>{
 const {db,auth,agent,runtime,request}=setup();let first=request
 for(let n=0;n<24;n++){
  const input={...request,requestId:randomUUID()};if(n===0)first=input
  const c=requestManagedCompaction(db,'owner',agent.id,input,1100+n*10);assignManagedCompaction(db,auth,c.id,1101+n*10)
  const ticket=claimManagedCompaction(db,runtime,c.id,1102+n*10);if(!ticket.execute)throw Error('missing ticket')
  acknowledgeManagedCompaction(db,runtime,c.id,ticket.nonce,'failed',1103+n*10)
 }
 expect(()=>requestManagedCompaction(db,'owner',agent.id,request,1500)).toThrow('managed_compact_limit')
 expect(requestManagedCompaction(db,'owner',agent.id,first,1500).status).toBe('failed')
})
test('another manager or runtime cannot assign, claim or inspect this agent command',()=>{
 const {db,agent,runtime,request}=setup(),c=requestManagedCompaction(db,'owner',agent.id,request,1100)
 const w=createWorker(db,'owner','Other',randomUUID(),1101),instance=randomUUID(),lease=connectWorker(db,w.worker.id,w.secret!,instance,1101)
 expect(()=>assignManagedCompaction(db,{id:w.worker.id,secret:w.secret!,instance,generation:lease.generation},c.id,1102)).toThrow('managed_compact_not_found')
 expect(()=>claimManagedCompaction(db,{...runtime,instance:'wrong-instance'},c.id,1102)).toThrow('computer_instance_changed')
 expect(()=>managedCompactions(db,'other',agent.id,1102)).toThrow('managed_agent_not_found')
})
