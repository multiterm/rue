import {randomUUID} from 'node:crypto'
import {afterEach,expect,test,vi} from 'vitest'
import {openDatabase} from '../../src/storage/db.js'
import {connectWorker,createWorker,changeWorker} from '../../src/storage/workers.js'
import {createManagedAgent,changeManagedAgent,managedGrant,managedSnapshot,managedOperations,reportManagedAgent,managedAuthority} from '../../src/storage/managed-agents.js'
import {authenticateTerminalConnection} from '../../src/storage/terminal-pairing.js'
import {attachComputer,pollComputer,enqueueTerminalPrompt,transitionCommand} from '../../src/storage/terminal-relay.js'
const dbs:ReturnType<typeof openDatabase>[]=[]
afterEach(()=>{dbs.splice(0).forEach(db=>db.close());vi.unstubAllEnvs()})
function setup(){
 vi.stubEnv('RUE_SETTINGS_ENCRYPTION_KEY',Buffer.alloc(32,1).toString('base64'))
 const db=openDatabase(':memory:');dbs.push(db)
 const w=createWorker(db,'owner','Mason',randomUUID(),1000),instance=randomUUID()
 const lease=connectWorker(db,w.worker.id,w.secret!,instance,1000)
 const auth={id:w.worker.id,secret:w.secret!,instance,generation:lease.generation}
 const input={workerId:w.worker.id,requestId:randomUUID(),name:'Canary',acknowledgeExecution:true as const,config:{provider:'openai',model:'gpt-4.1-mini',permission:'read-only',mounts:[],shareToolOutput:false,shareThinking:false}}
 const created=createManagedAgent(db,'owner',input,1001)
 return {db,auth,input,created,id:created.agent.id}
}
test('filesystem grants require host capability, separate consent and exact owner/revision',()=>{
 const {db,auth,input,id}=setup(),config={...input.config,filesystem:{version:1,directories:[{path:'/Volumes/MOTHERSHIP',access:'write'}]}}
 const change={requestId:randomUUID(),expectedRevision:1,action:'configure',acknowledgeExecution:true,config}
 expect(()=>changeManagedAgent(db,'owner',id,change,1100)).toThrow('managed_filesystem_not_supported')
 db.prepare('UPDATE workers SET health=? WHERE id=?').run(JSON.stringify({capabilities:['managed-filesystem-v1']}),auth.id)
 expect(()=>changeManagedAgent(db,'owner',id,change,1100)).toThrow('managed_filesystem_consent_required')
 expect(()=>createManagedAgent(db,'owner',{...input,requestId:randomUUID(),config},1100)).toThrow('managed_filesystem_consent_required')
 expect(()=>changeManagedAgent(db,'other',id,{...change,acknowledgeFilesystem:true},1100)).toThrow('managed_agent_not_found')
 const accepted=changeManagedAgent(db,'owner',id,{...change,acknowledgeFilesystem:true},1100)
 expect(accepted.agent.desired).toBe('stopped');expect(accepted.agent.config.filesystem).toEqual(config.filesystem)
 expect(changeManagedAgent(db,'owner',id,{...change,acknowledgeFilesystem:true},1150)).toEqual(accepted)
 expect(()=>changeManagedAgent(db,'owner',id,{...change,requestId:randomUUID(),acknowledgeFilesystem:true},1200)).toThrow('managed_revision_conflict')
 changeManagedAgent(db,'owner',id,{requestId:randomUUID(),expectedRevision:2,action:'resume'},1300)
 expect(managedGrant(db,auth,id,3,1400).agent.config.filesystem).toEqual(config.filesystem)
 db.prepare('UPDATE workers SET health=? WHERE id=?').run(JSON.stringify({capabilities:[]}),auth.id)
 expect(()=>managedGrant(db,auth,id,3,1500)).toThrow('managed_filesystem_not_supported')
})
test('nonlegacy directories require the v2 capability and still require explicit consent',()=>{
 const {db,auth,input,id}=setup(),config={...input.config,filesystem:{version:1,directories:[{path:'/Users/calvin/.ssh',access:'read'}]}}
 const change={requestId:randomUUID(),expectedRevision:1,action:'configure',acknowledgeExecution:true,config}
 db.prepare('UPDATE workers SET health=? WHERE id=?').run(JSON.stringify({capabilities:['managed-filesystem-v1']}),auth.id)
 expect(()=>changeManagedAgent(db,'owner',id,{...change,acknowledgeFilesystem:true},1100)).toThrow('managed_filesystem_not_supported')
 db.prepare('UPDATE workers SET health=? WHERE id=?').run(JSON.stringify({capabilities:['managed-filesystem-v1','managed-filesystem-v2']}),auth.id)
 expect(()=>changeManagedAgent(db,'owner',id,change,1100)).toThrow('managed_filesystem_consent_required')
 const result=changeManagedAgent(db,'owner',id,{...change,acknowledgeFilesystem:true},1100)
 expect(result.agent.desired).toBe('stopped');expect(result.agent.config.filesystem).toEqual(config.filesystem)
})
test('filesystem configuration fences existing authority and rejects unsafe paths without changing state',()=>{
 const {db,auth,input,id}=setup(),grant=managedGrant(db,auth,id,1,1100)
 db.prepare('UPDATE workers SET health=? WHERE id=?').run(JSON.stringify({capabilities:['managed-filesystem-v1']}),auth.id)
 for(const path of ['/etc','/Volumes/MOTHERSHIP/../etc','/Volumes/MOTHERSHIP//a'])expect(()=>changeManagedAgent(db,'owner',id,{requestId:randomUUID(),expectedRevision:1,action:'configure',acknowledgeExecution:true,acknowledgeFilesystem:true,config:{...input.config,filesystem:{version:1,directories:[{path,access:'write'}]}}},1200)).toThrow()
 changeManagedAgent(db,'owner',id,{requestId:randomUUID(),expectedRevision:1,action:'configure',acknowledgeExecution:true,acknowledgeFilesystem:true,config:{...input.config,filesystem:{version:1,directories:[]}}},1300)
 expect(()=>authenticateTerminalConnection(db,grant.token,grant.id,1301)).toThrow()
 expect(managedSnapshot(db,auth,1400).agents[0]!.sessionId).toBe(grant.sessionId)
})
test('Codex configuration and bootstrap require host capability while accepting runtime-selected model IDs',()=>{
 const {db,auth,input,id}=setup(),config={...input.config,provider:'openai-codex',model:'gpt-5.4'},request={...input,requestId:randomUUID(),config}
 expect(()=>createManagedAgent(db,'owner',request,1002)).toThrow('managed_codex_not_supported')
 const configure={requestId:randomUUID(),expectedRevision:1,action:'configure',acknowledgeExecution:true,config}
 expect(()=>changeManagedAgent(db,'owner',id,configure,1002)).toThrow('managed_codex_not_supported')
 db.prepare('UPDATE workers SET health=? WHERE id=?').run(JSON.stringify({capabilities:['managed-codex-v1']}),auth.id)
 expect(()=>createManagedAgent(db,'owner',{...request,config:{...config,model:'invalid\u0000model'}},1002)).toThrow()
 const future=createManagedAgent(db,'owner',{...request,requestId:randomUUID(),config:{...config,model:'future-codex-model'}},1002)
 expect(managedGrant(db,auth,future.agent.id,1,1100).agent.config.model).toBe('future-codex-model')
 const created=createManagedAgent(db,'owner',request,1002);expect(managedGrant(db,auth,created.agent.id,1,1100).agent.config.provider).toBe('openai-codex')
 expect(changeManagedAgent(db,'owner',id,configure,1100).agent.desired).toBe('stopped')
 db.prepare('UPDATE workers SET health=? WHERE id=?').run(JSON.stringify({capabilities:[]}),auth.id)
 expect(()=>managedGrant(db,auth,created.agent.id,1,1200)).toThrow('managed_codex_not_supported')
})
test('managed creation is owner scoped, idempotent, explicitly acknowledged and secret-free',()=>{
 const {db,input,created}=setup()
 expect(createManagedAgent(db,'owner',input,1002)).toEqual(created)
 expect(()=>createManagedAgent(db,'other',input,1002)).toThrow('worker_not_found')
 expect(()=>createManagedAgent(db,'owner',{...input,name:'changed'},1002)).toThrow('managed_request_conflict')
 expect(()=>createManagedAgent(db,'owner',{...input,acknowledgeExecution:false},1002)).toThrow()
 expect(()=>createManagedAgent(db,'owner',{...input,config:{...input.config,mounts:['../../secret']}},1002)).toThrow()
 expect(JSON.stringify(created)).not.toContain('rue_terminal_')
 expect(db.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({n:1})
})
test('live worker grants are encrypted, stable on retry and bound to host generation',()=>{
 const {db,auth,id}=setup()
 const first=managedGrant(db,auth,id,1,1100)
 expect(managedGrant(db,auth,id,1,1200).token).toBe(first.token)
 expect(authenticateTerminalConnection(db,first.token,first.id,1200).expiresAt).toBe(61000)
 expect(JSON.stringify(db.prepare('SELECT * FROM managed_agents').all())).not.toContain(first.token)
 expect(()=>managedGrant(db,{...auth,generation:2},id,1,1200)).toThrow('worker_session_fenced')
 const w2=createWorker(db,'owner','Other host',randomUUID(),1200),i2=randomUUID();connectWorker(db,w2.worker.id,w2.secret!,i2,1200)
 expect(()=>managedGrant(db,{id:w2.worker.id,secret:w2.secret!,instance:i2,generation:1},id,1,1201)).toThrow('managed_agent_not_found')
 expect(()=>authenticateTerminalConnection(db,first.token,first.id,61000)).toThrow('invalid_terminal_credential')
})
test('managed relay leases cannot outlive supervisor authority or use legacy protocol',()=>{
 const {db,auth,id}=setup(), grant=managedGrant(db,auth,id,1,1100)
 expect(()=>attachComputer(db,grant.token,grant.id,'runtime',1200,1)).toThrow('relay_protocol_mismatch')
 expect(attachComputer(db,grant.token,grant.id,'runtime',1200,2).lease.expiresAt).toBe(61000)
 expect(pollComputer(db,grant.token,grant.id,'runtime',59000,2).lease.expiresAt).toBe(61000)
 expect(managedAuthority(db,grant.id,59000)).toBe(61000)
 expect(()=>managedAuthority(db,grant.id,61000)).toThrow('managed_authority_expired')
})
test('rapid stop/resume fences the previous runtime rather than reviving it',()=>{
 const {db,auth,id}=setup(), grant=managedGrant(db,auth,id,1,1100)
 const stop={requestId:randomUUID(),expectedRevision:1,action:'stop'}
 changeManagedAgent(db,'owner',id,stop,1200)
 expect(()=>authenticateTerminalConnection(db,grant.token,grant.id,1201)).toThrow()
 changeManagedAgent(db,'owner',id,{requestId:randomUUID(),expectedRevision:2,action:'resume'},1300)
 expect(()=>authenticateTerminalConnection(db,grant.token,grant.id,1301)).toThrow()
 expect(changeManagedAgent(db,'owner',id,stop,1400).operation.revision).toBe(2)
 const next=managedGrant(db,auth,id,3,1400)
 expect(next.token).not.toBe(grant.token)
 expect(next.sessionId).toBe(grant.sessionId)
 expect(next.piSessionId).toBe(grant.piSessionId)
})
test('reload drains accepted work, prevents new claims and never replays ambiguous work',()=>{
 const {db,auth,id}=setup(),g=managedGrant(db,auth,id,1,1100)
 attachComputer(db,g.token,g.id,'old',1200,2)
 const command=enqueueTerminalPrompt(db,'owner',g.sessionId,'one','hello',1300)
 transitionCommand(db,g.token,g.id,'old',command.id,'claim',1400)
 transitionCommand(db,g.token,g.id,'old',command.id,'start',1500)
 changeManagedAgent(db,'owner',id,{requestId:randomUUID(),expectedRevision:1,action:'reload'},1600)
 expect(pollComputer(db,g.token,g.id,'old',1700,2).commands[0].status).toBe('running')
 expect(()=>managedGrant(db,auth,id,2,1700)).toThrow('managed_reload_pending')
 expect(()=>enqueueTerminalPrompt(db,'owner',g.sessionId,'two','new',1700)).toThrow('computer_not_ready')
 // Worker loss does not make the previous command replayable after recovery.
 const instance=randomUUID(), fresh=connectWorker(db,auth.id,auth.secret,instance,62000)
 const a={...auth,instance,generation:fresh.generation}
 const next=managedGrant(db,a,id,2,62100)
 attachComputer(db,next.token,next.id,'new',62200,2)
 expect((db.prepare('SELECT status FROM terminal_commands WHERE id=?').get(command.id) as {status:string}).status).toBe('interrupted')
})
test('destroy is a durable tombstone, retains history and rejects late observations',()=>{
 const {db,auth,id,created}=setup()
 managedGrant(db,auth,id,1,1100)
 const result=changeManagedAgent(db,'owner',id,{requestId:randomUUID(),expectedRevision:1,action:'destroy'},1200)
 expect(result.agent.desired).toBe('destroyed')
 expect(db.prepare('SELECT 1 FROM sessions WHERE id=?').get(created.agent.sessionId)).toBeTruthy()
 expect(()=>managedGrant(db,auth,id,2,1300)).toThrow('managed_grant_fenced')
 expect(()=>changeManagedAgent(db,'owner',id,{requestId:randomUUID(),expectedRevision:2,action:'resume'},1300)).toThrow('managed_revision_conflict')
 expect(()=>reportManagedAgent(db,auth,id,{revision:1,state:'running',error:null},1300)).toThrow('managed_revision_conflict')
 reportManagedAgent(db,auth,id,{revision:2,state:'destroyed',error:null},1400)
 expect(managedOperations(db,'owner',id)[0].status).toBe('succeeded')
 expect(managedSnapshot(db,auth,1400).agents[0].desired).toBe('destroyed')
})
test('purge is separately consented, fenced and only removes cloud history after the worker acknowledges volume deletion',()=>{
 const {db,auth,id,created}=setup()
 expect(()=>changeManagedAgent(db,'owner',id,{requestId:randomUUID(),expectedRevision:1,action:'purge',acknowledgePurge:true},1200)).toThrow('managed_purge_requires_destroy_and_consent')
 changeManagedAgent(db,'owner',id,{requestId:randomUUID(),expectedRevision:1,action:'destroy'},1200)
 expect(()=>changeManagedAgent(db,'owner',id,{requestId:randomUUID(),expectedRevision:2,action:'purge'},1300)).toThrow('managed_purge_requires_destroy_and_consent')
 const input={requestId:randomUUID(),expectedRevision:2,action:'purge',acknowledgePurge:true}
 changeManagedAgent(db,'owner',id,input,1400)
 reportManagedAgent(db,auth,id,{revision:3,state:'destroyed',error:null},1500)
 expect(managedOperations(db,'owner',id)[0].status).toBe('pending')
 expect(db.prepare('SELECT 1 FROM sessions WHERE id=?').get(created.agent.sessionId)).toBeTruthy()
 const result=reportManagedAgent(db,auth,id,{revision:3,state:'purged',error:null},1600)
 expect(result.purgedAt).toBe(1600);expect(result.sessionId).toBeNull()
 expect(db.prepare('SELECT 1 FROM sessions WHERE id=?').get(created.agent.sessionId)).toBeUndefined()
 expect(managedOperations(db,'owner',id)[0].status).toBe('succeeded')
 expect(changeManagedAgent(db,'owner',id,input,1700).agent.purgedAt).toBe(1600)
 expect(managedSnapshot(db,auth,1700).agents).toEqual([])
})
test('host revocation and rotation fence every child grant',()=>{
 const {db,auth,id}=setup(),g=managedGrant(db,auth,id,1,1100)
 changeWorker(db,'owner',auth.id,'rotate',0,1200)
 expect(()=>authenticateTerminalConnection(db,g.token,g.id,1201)).toThrow()
 expect(()=>managedSnapshot(db,auth,1201)).toThrow('invalid_worker_credential')
})

test('same-revision boot retries are idempotent and older boots cannot revive credentials or report readiness',()=>{
 const {db,auth,id}=setup()
 const first=managedGrant(db,auth,id,1,1100,1)
 attachComputer(db,first.token,first.id,'old',1200,2)
 const second=managedGrant(db,auth,id,1,1300,2)
 expect(second.token).not.toBe(first.token)
 expect(managedGrant(db,auth,id,1,1400,2).token).toBe(second.token)
 expect(()=>managedGrant(db,auth,id,1,1400,1)).toThrow('managed_boot_fenced')
 expect(()=>managedGrant(db,auth,id,1,1400,4)).toThrow('managed_boot_fenced')
 expect(()=>authenticateTerminalConnection(db,first.token,first.id,1400)).toThrow()
 expect(()=>reportManagedAgent(db,auth,id,{revision:1,boot:1,state:'running',error:null},1400)).toThrow('managed_boot_fenced')
 attachComputer(db,second.token,second.id,'new',1500,2)
 reportManagedAgent(db,auth,id,{revision:1,boot:2,state:'running',error:null},1600)
 expect(managedSnapshot(db,auth,1600).agents[0].grantBoot).toBe(2)
})
test('a new boot cannot take over accepted work in the same revision',()=>{
 const {db,auth,id}=setup(),g=managedGrant(db,auth,id,1,1100,1)
 attachComputer(db,g.token,g.id,'old',1200,2)
 const command=enqueueTerminalPrompt(db,'owner',g.sessionId,'one','hello',1300)
 transitionCommand(db,g.token,g.id,'old',command.id,'claim',1400)
 transitionCommand(db,g.token,g.id,'old',command.id,'start',1500)
 expect(()=>managedGrant(db,auth,id,1,1600,2)).toThrow('managed_reload_pending')
 expect(managedGrant(db,auth,id,1,1700,1).token).toBe(g.token)
})
