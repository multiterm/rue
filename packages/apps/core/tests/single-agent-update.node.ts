import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {randomUUID,createHash} from 'node:crypto'
import type {Database} from 'better-sqlite3'
import {Hono} from 'hono'
import {MIGRATIONS} from '../src/storage/schema.ts'
import {changeManagedAgent,managedGrant,managedSnapshot,managedAcceptingPrompts,reportManagedAgent} from '../src/storage/managed-agents.ts'
import {attachComputer,pollComputer,remoteComputers,computerCatalog} from '../src/storage/terminal-relay.ts'
import {requestRuntimeRollout} from '../src/storage/runtime-rollouts.ts'
import {managedAgentAccountRoutes} from '../src/server/routes/managed-agents.ts'
import {agentStatus} from '../../../../extensions/rue/status.ts'
import {runtimeInfo} from '../../../../extensions/rue/runtime-info.ts'
const oldImage='sha256:'+'a'.repeat(64),newImage='sha256:'+'b'.repeat(64)
process.env.RUE_SETTINGS_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64')
function fixture(){
 const now=Date.now(),sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const m of MIGRATIONS)sqlite.exec(m.sql)
 let depth=0
 const db={name:':memory:',prepare:(sql:string)=>sqlite.prepare(sql),transaction:(fn:()=>unknown)=>{const run=()=>{const name='t'+depth++,nested=depth>1;sqlite.exec(nested?`SAVEPOINT ${name}`:'BEGIN IMMEDIATE');try{const result=fn();sqlite.exec(nested?`RELEASE ${name}`:'COMMIT');return result}catch(error){sqlite.exec(nested?`ROLLBACK TO ${name}`:'ROLLBACK');throw error}finally{depth--}};return Object.assign(run,{immediate:run})}} as unknown as Database
 const worker=randomUUID(),instance=randomUUID(),secret='rue_worker_'+'x'.repeat(43),owner='owner'
 const health={capabilities:['managed-agents-v1','managed-agent-upgrade-v1','managed-runtime-rollout-v1'],runtimeImage:oldImage,runtimeReleases:[{image:oldImage,piVersion:'0.85.1',createdAt:1},{image:newImage,piVersion:'0.87.1',createdAt:2}]}
 db.prepare('INSERT INTO workers(id,owner_subject,name,token_hash,enrollment_request_id,created_at,instance_id,generation,lease_expires_at,last_seen_at,health) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(worker,owner,'Manager',createHash('sha256').update(secret).digest('hex'),randomUUID(),now,instance,1,now+300000,now,JSON.stringify(health))
 const agents=Array.from({length:2},(_,index)=>{const id=randomUUID(),sessionId='ses_'+randomUUID(),connectionId='term_'+String(index).repeat(32)
  db.prepare('INSERT INTO sessions(id,title,owner_subject,created_at,updated_at) VALUES(?,?,?,?,?)').run(sessionId,'Retain me',owner,now,now)
  db.prepare('INSERT INTO terminal_connections(id,owner_subject,session_id,pi_session_id,token_hash,expires_at,created_at,activated_at,lease_expires_at,last_seen_at,relay_health) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(connectionId,owner,sessionId,id,createHash('sha256').update('fixture'+index).digest('hex'),now+300000,now,now,now+60000,now,JSON.stringify({agentWorking:false,pendingCount:0}))
  db.prepare("INSERT INTO managed_agents(id,owner_subject,worker_id,session_id,connection_id,name,config,desired,revision,created_at,observed,observed_revision,grant_revision,grant_generation,grant_boot) VALUES(?,?,?,?,?,?,?,'running',1,?,'running',1,1,1,1)").run(id,owner,worker,sessionId,connectionId,'Agent',JSON.stringify({provider:'openai',model:'fixture',permission:'read-only',mounts:[],shareToolOutput:false,shareThinking:false}),now)
  return {id,sessionId,connectionId}
 })
 const agent=agents[0]!,other=agents[1]!,auth={id:worker,secret,instance,generation:1}
 const input={requestId:randomUUID(),expectedRevision:1,expectedImage:oldImage,image:newImage,piVersion:'0.87.1',action:'upgrade',acknowledgeExecution:true}
 const row=(id=agent.id)=>db.prepare('SELECT * FROM managed_agents WHERE id=?').get(id) as any
 const report=(revision:number,state:'running'|'failed',error:null|'runtime_failed'=null,time=now+5)=>reportManagedAgent(db,auth,agent.id,{revision,boot:1,state,error},time)
 const version=(value='0.87.1',time=now+4)=>{const status=agentStatus({cwd:'/workspace',branch:null,idle:true,thinking:'off',entries:[],runtime:runtimeInfo(value,[],[])});db.prepare('UPDATE terminal_connections SET last_seen_at=?,lease_expires_at=?,relay_health=? WHERE id=?').run(time,time+60000,JSON.stringify({agentWorking:false,pendingCount:0,status}),agent.connectionId)}
 return {sqlite,db,now,worker,owner,health,agent,other,auth,input,row,report,version}
}
test('single-agent update drains work, pins only its image, retains queue/identity/configuration, and verifies the reported version',()=>{
 const f=fixture();try{
  const other=f.row(f.other.id),before=f.row()
  for(const status of ['claimed','pending','failed'])f.db.prepare('INSERT INTO terminal_commands(id,connection_id,request_id,text,user_message_id,assistant_message_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(status,f.agent.connectionId,status,'retain','user','assistant',status,f.now,f.now)
  const result=changeManagedAgent(f.db,f.owner,f.agent.id,f.input,f.now)
  assert.equal(result.agent.runtimeImage,newImage);assert.equal(result.agent.previousRuntimeImage,oldImage);assert.equal(result.agent.revision,2)
  assert.equal(managedAcceptingPrompts(f.db,f.agent.connectionId,f.now),false)
  assert.equal(managedAcceptingPrompts(f.db,f.other.connectionId,f.now),true)
  assert.throws(()=>managedGrant(f.db,f.auth,f.agent.id,2,f.now+1),/managed_reload_pending/)
  assert.equal(changeManagedAgent(f.db,f.owner,f.agent.id,f.input,f.now).operation.id,result.operation.id)
  assert.throws(()=>changeManagedAgent(f.db,f.owner,f.agent.id,{...f.input,image:oldImage},f.now),/request_conflict/)
  f.db.prepare("UPDATE terminal_commands SET status='done' WHERE id='claimed'").run()
  managedGrant(f.db,f.auth,f.agent.id,2,f.now+2)
  assert.equal(managedAcceptingPrompts(f.db,f.agent.connectionId,f.now+2),false)
  assert.equal(f.report(2,'running').runtimeUpdateState,'updating','connection alone does not prove the new Pi version')
  f.version();assert.equal(f.report(2,'running').runtimeUpdateState,'updated')
  assert.equal(managedAcceptingPrompts(f.db,f.agent.connectionId,f.now+5),true)
  assert.equal(f.row().session_id,before.session_id);assert.equal(f.row().connection_id,before.connection_id);assert.equal(f.row().config,before.config)
  assert.deepEqual(f.row(f.other.id),other)
  assert.deepEqual(f.db.prepare("SELECT status FROM terminal_commands WHERE id IN ('pending','failed') ORDER BY id").all().map((r:any)=>r.status),['failed','pending'])
  assert.equal(managedSnapshot(f.db,f.auth,f.now+6).agents.find(a=>a.id===f.agent.id)?.runtimeStatus?.report.catalog,undefined)
  assert.throws(()=>requestRuntimeRollout(f.db,f.owner,f.worker,{requestId:randomUUID(),expectedWorkerRevision:0,expectedImage:oldImage,image:newImage,acknowledgeHostExecution:true},f.now),/individual_images/)
 }finally{f.sqlite.close()}
})
test('failed update rolls back once; a failed rollback stops only this agent, without replay',()=>{
 const f=fixture();try{
  const other=f.row(f.other.id)
  changeManagedAgent(f.db,f.owner,f.agent.id,f.input,f.now);managedGrant(f.db,f.auth,f.agent.id,2,f.now+1)
  const rollback=f.report(2,'failed','runtime_failed');assert.equal(rollback.runtimeUpdateState,'rolling_back');assert.equal(rollback.revision,3);assert.equal(rollback.runtimeImage,oldImage)
  assert.equal(managedAcceptingPrompts(f.db,f.agent.connectionId,f.now+5),false)
  managedGrant(f.db,f.auth,f.agent.id,3,f.now+6)
  const stopped=f.report(3,'failed','runtime_failed',f.now+7);assert.equal(stopped.runtimeUpdateState,'failed');assert.equal(stopped.desired,'stopped');assert.equal(stopped.revision,4)
  assert.throws(()=>managedGrant(f.db,f.auth,f.agent.id,4,f.now+8),/fenced/)
  assert.deepEqual(f.row(f.other.id),other)
  assert.equal(changeManagedAgent(f.db,f.owner,f.agent.id,f.input,f.now+8).agent.runtimeUpdateState,'failed','same request never retries a failed update')
 }finally{f.sqlite.close()}
})
test('successful rollback restores service, and stop during rollback cannot select the failed image again',()=>{
 for(const stop of [false,true]){const f=fixture();try{
  changeManagedAgent(f.db,f.owner,f.agent.id,f.input,f.now);managedGrant(f.db,f.auth,f.agent.id,2,f.now+1);f.report(2,'failed','runtime_failed')
  if(stop){const result=changeManagedAgent(f.db,f.owner,f.agent.id,{requestId:randomUUID(),expectedRevision:3,action:'stop'},f.now+6);assert.equal(result.agent.runtimeImage,oldImage);assert.equal(result.agent.runtimeUpdateState,'cancelled');assert.equal(result.agent.desired,'stopped')}
  else {managedGrant(f.db,f.auth,f.agent.id,3,f.now+6);assert.equal(f.report(3,'running',null,f.now+7).runtimeUpdateState,'rolling_back');f.version('0.85.1',f.now+8);assert.equal(f.report(3,'running',null,f.now+9).runtimeUpdateState,'rolled_back');assert.equal(managedAcceptingPrompts(f.db,f.agent.connectionId,f.now+9),true)}
 }finally{f.sqlite.close()}}
})
test('wrong or missing Pi version triggers bounded rollback rather than releasing prompts',()=>{
 for(const missing of [false,true]){const f=fixture();try{
  changeManagedAgent(f.db,f.owner,f.agent.id,f.input,f.now);managedGrant(f.db,f.auth,f.agent.id,2,f.now+1)
  if(!missing)f.version('0.85.1',f.now+2)
  assert.equal(f.report(2,'running',null,missing?f.now+90002:f.now+3).runtimeUpdateState,'rolling_back')
  assert.equal(managedAcceptingPrompts(f.db,f.agent.connectionId,f.now+90003),false)
 }finally{f.sqlite.close()}}
})
test('stop cancels an update, retains the old image and prevents configuration races',()=>{
 const f=fixture();try{
  changeManagedAgent(f.db,f.owner,f.agent.id,f.input,f.now)
  assert.throws(()=>changeManagedAgent(f.db,f.owner,f.agent.id,{requestId:randomUUID(),expectedRevision:2,action:'reload'},f.now+1),/upgrade_in_progress/)
  const stopped=changeManagedAgent(f.db,f.owner,f.agent.id,{requestId:randomUUID(),expectedRevision:2,action:'stop'},f.now+2).agent
  assert.equal(stopped.runtimeImage,oldImage);assert.equal(stopped.previousRuntimeImage,newImage);assert.equal(stopped.runtimeUpdateState,'cancelled');assert.equal(stopped.desired,'stopped')
  reportManagedAgent(f.db,f.auth,f.agent.id,{revision:3,boot:1,state:'stopped',error:null},f.now+3)
  assert.equal(f.row().previous_runtime_image,null)
 }finally{f.sqlite.close()}
})
test('owner, revision, immutable inventory, manager capability and stopped-state fences reject unsafe updates',()=>{
 const f=fixture();try{
  assert.throws(()=>changeManagedAgent(f.db,'other',f.agent.id,f.input,f.now),/not_found/)
  assert.throws(()=>changeManagedAgent(f.db,f.owner,f.agent.id,{...f.input,expectedRevision:9},f.now),/revision_conflict/)
  assert.throws(()=>changeManagedAgent(f.db,f.owner,f.agent.id,{...f.input,image:'sha256:'+'c'.repeat(64)},f.now),/candidate_changed/)
  assert.throws(()=>changeManagedAgent(f.db,f.owner,f.agent.id,{...f.input,expectedImage:newImage},f.now),/candidate_changed/)
  assert.throws(()=>changeManagedAgent(f.db,f.owner,f.agent.id,{...f.input,acknowledgeExecution:undefined},f.now))
  f.db.prepare('UPDATE workers SET health=? WHERE id=?').run(JSON.stringify({...f.health,capabilities:['managed-agents-v1']}),f.worker)
  assert.throws(()=>changeManagedAgent(f.db,f.owner,f.agent.id,f.input,f.now),/not_supported/)
  assert.equal(f.row().revision,1)
  f.db.prepare("UPDATE managed_agents SET desired='stopped' WHERE id=?").run(f.agent.id)
  assert.throws(()=>changeManagedAgent(f.db,f.owner,f.agent.id,f.input,f.now),/requires_running/)
 }finally{f.sqlite.close()}
})
test('catalog upload/acknowledgment survives summary heartbeats, stays out of lists and is owner/revocation bound',()=>{
 const f=fixture();try{
  const grant=managedGrant(f.db,f.auth,f.agent.id,1,f.now+1),instance=randomUUID()
  attachComputer(f.db,grant.token,f.agent.connectionId,instance,f.now+2,2)
  const full=agentStatus({cwd:'/workspace',branch:null,idle:true,thinking:'off',entries:[],runtime:runtimeInfo('0.87.1',[],[])})
  const health={uploadFailures:0,retries:0,lastUploadAt:null,pendingCount:0,pendingBytes:0,pollLatencyMs:0,status:full}
  const first=pollComputer(f.db,grant.token,f.agent.connectionId,instance,f.now+3,2,health)
  assert.equal(first.lease.agentCatalogHash,full.catalogHash)
  const {catalog,...summary}=full
  assert.equal(pollComputer(f.db,grant.token,f.agent.connectionId,instance,f.now+4,2,{...health,status:summary}).lease.agentCatalogHash,full.catalogHash)
  assert.deepEqual(computerCatalog(f.db,f.owner,f.agent.connectionId)?.catalog,catalog)
  assert.equal(remoteComputers(f.db,f.owner,f.now+5).find(c=>c.id===f.agent.connectionId)?.health?.status?.catalog,undefined)
  assert.equal(computerCatalog(f.db,'other',f.agent.connectionId),undefined)
  assert.equal(attachComputer(f.db,grant.token,f.agent.connectionId,instance,f.now+6,2).lease.agentCatalogHash,undefined)
  assert.equal(pollComputer(f.db,grant.token,f.agent.connectionId,instance,f.now+7,2,{...health,status:summary}).lease.agentCatalogHash,undefined)
  f.db.prepare('UPDATE terminal_connections SET revoked_at=0 WHERE id=?').run(f.agent.connectionId)
  assert.equal(computerCatalog(f.db,f.owner,f.agent.connectionId),undefined)
 }finally{f.sqlite.close()}
})
test('the HTTP upgrade action requires human approval; agents cannot self-approve with a machine principal',async()=>{
 const f=fixture();try{
  const app=new Hono();app.use('*',async(c,next)=>{c.set('ctx',{db:f.db,bus:{publish:()=>{}}} as any);c.set('principal',{subject:f.owner,principalType:'machine',scopes:['agents:write']} as any);return next()});app.route('/managed-agents',managedAgentAccountRoutes())
  const response=await app.request('/managed-agents/'+f.agent.id,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(f.input)})
  assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:'human_approval_required'});assert.equal(f.row().revision,1)
 }finally{f.sqlite.close()}
})
