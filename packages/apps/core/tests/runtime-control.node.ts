import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {randomUUID,createHash} from 'node:crypto'
import {Hono} from 'hono'
import {createApp} from '../src/server/app.ts'
import {ConfigSchema} from '../src/config/index.ts'
import {Bus} from '../src/bus/index.ts'
import type {Database} from 'better-sqlite3'
import {MIGRATIONS} from '../src/storage/schema.ts'
import {authenticateTerminalConnection} from '../src/storage/terminal-pairing.ts'
import {runtimeControlGrant,updateRuntimeControlGrant,runtimeControlDelegation,requestDelegatedRuntimeRollout,delegatedRuntimeRollout} from '../src/storage/runtime-control.ts'
import {runtimeRolloutAccountRoutes,runtimeRolloutTerminalRoutes} from '../src/server/routes/runtime-rollouts.ts'
import {reportRuntimeRollout} from '../src/storage/runtime-rollouts.ts'
import {keyPermissionsFor} from '../src/server/tenancy-key-api.ts'
const oldImage='sha256:'+'a'.repeat(64),newImage='sha256:'+'b'.repeat(64)
function fixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const m of MIGRATIONS)sqlite.exec(m.sql)
 let depth=0
 const db={prepare:(sql:string)=>sqlite.prepare(sql),transaction:(fn:()=>unknown)=>{const run=()=>{const name='s'+depth++,nested=depth>1;sqlite.exec(nested?`SAVEPOINT ${name}`:'BEGIN IMMEDIATE');try{const result=fn();sqlite.exec(nested?`RELEASE ${name}`:'COMMIT');return result}catch(error){sqlite.exec(nested?`ROLLBACK TO ${name}`:'ROLLBACK');throw error}finally{depth--}};return Object.assign(run,{immediate:run})}} as unknown as Database
 const now=Date.now(),owner='owner',workerId=randomUUID(),workerSecret='rue_worker_'+'w'.repeat(43),instance=randomUUID()
 db.prepare('INSERT INTO workers(id,owner_subject,name,token_hash,enrollment_request_id,created_at,instance_id,generation,last_seen_at,lease_expires_at,health) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(workerId,owner,'Mason',createHash('sha256').update(workerSecret).digest('hex'),randomUUID(),now,instance,1,now,now+60000,JSON.stringify({runtimeImage:oldImage,capabilities:['managed-runtime-rollout-v1']}))
 function addAgent(suffix:string){const id=randomUUID(),connectionId='term_'+suffix.repeat(32),token='rue_terminal_'+suffix.repeat(43),sessionId='ses_'+suffix
  db.prepare('INSERT INTO sessions(id,owner_subject,created_at,updated_at) VALUES(?,?,?,?)').run(sessionId,owner,now,now)
  db.prepare('INSERT INTO terminal_connections(id,owner_subject,session_id,pi_session_id,token_hash,expires_at,created_at,activated_at,last_seen_at,lease_expires_at,relay_health) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(connectionId,owner,sessionId,id,createHash('sha256').update(token).digest('hex'),now+300000,now,now,now,now+60000,JSON.stringify({agentWorking:false,pendingCount:0}))
  db.prepare("INSERT INTO managed_agents(id,owner_subject,worker_id,session_id,connection_id,name,config,desired,revision,created_at,observed,observed_revision,grant_revision,grant_generation,grant_boot) VALUES(?,?,?,?,?,?,?,'running',1,?,'running',1,1,1,1)").run(id,owner,workerId,sessionId,connectionId,'Agent '+suffix,'{}',now)
  return {id,connectionId,token,connection:(time=now)=>authenticateTerminalConnection(db,token,connectionId,time)}
 }
 const a=addAgent('a'),b=addAgent('b')
 const input=(id:string)=>{const g=runtimeControlGrant(db,owner,id,now);return {expectedOwnerSubject:owner,expectedRevision:g.revision,enabled:true as const,expectedAgentRevision:g.agentRevision,expectedWorkerId:g.workerId,expectedConnectionId:g.connectionId!,expiresInSeconds:3600 as const,acknowledgeHostControl:true as const}}
 const rollout=()=>({requestId:randomUUID(),expectedWorkerRevision:0,expectedImage:oldImage,image:newImage,acknowledgeHostExecution:true as const})
 return {db,sqlite,now,owner,workerId,a,b,input,rollout,auth:{id:workerId,secret:workerSecret,instance,generation:1}}
}
test('approval is off by default, owner-bound, explicit, expiring and audited',()=>{
 const f=fixture();try{
  assert.equal(runtimeControlDelegation(f.db,f.a.connection(),f.now).canSubmit,false)
  assert.throws(()=>requestDelegatedRuntimeRollout(f.db,f.a.connection,f.rollout(),f.now),/not_approved/)
  assert.throws(()=>updateRuntimeControlGrant(f.db,'other',f.a.id,f.input(f.a.id),f.now),/not_found/)
  assert.throws(()=>updateRuntimeControlGrant(f.db,f.owner,f.a.id,{...f.input(f.a.id),acknowledgeHostControl:false},f.now))
  assert.throws(()=>updateRuntimeControlGrant(f.db,f.owner,f.a.id,{...f.input(f.a.id),expectedWorkerId:randomUUID()},f.now),/agent_changed/)
  const grant=updateRuntimeControlGrant(f.db,f.owner,f.a.id,f.input(f.a.id),f.now)
  assert.equal(grant.enabled,true);assert.equal(grant.revision,1);assert.equal(grant.expiresAt,f.now+3600000)
  assert.equal(grant.audit[0]?.action,'approved');assert.equal(JSON.stringify(grant).includes(f.a.token),false)
  assert.equal(runtimeControlDelegation(f.db,f.a.connection(),f.now).canSubmit,true)
  assert.equal(runtimeControlDelegation(f.db,f.b.connection(),f.now).canSubmit,false)
  assert.throws(()=>updateRuntimeControlGrant(f.db,f.owner,f.a.id,{...f.input(f.a.id),expectedRevision:0},f.now),/revision_conflict/)
  const future=f.now+3600001;f.db.prepare('UPDATE workers SET last_seen_at=?,lease_expires_at=?').run(future,future+60000)
  f.db.prepare('UPDATE terminal_connections SET last_seen_at=?,lease_expires_at=?,expires_at=?').run(future,future+60000,future+300000)
  assert.equal(runtimeControlDelegation(f.db,f.a.connection(future),future).canSubmit,false)
 }finally{f.sqlite.close()}
})
test('delegated submissions derive the host from the agent, deduplicate, and hide other agents’ jobs',()=>{
 const f=fixture();try{
  updateRuntimeControlGrant(f.db,f.owner,f.a.id,f.input(f.a.id),f.now);updateRuntimeControlGrant(f.db,f.owner,f.b.id,f.input(f.b.id),f.now)
  const input=f.rollout(),job=requestDelegatedRuntimeRollout(f.db,f.a.connection,input,f.now)
  assert.equal(job.workerId,f.workerId);assert.equal(requestDelegatedRuntimeRollout(f.db,f.a.connection,input,f.now).id,job.id)
  assert.equal(delegatedRuntimeRollout(f.db,f.a.connection(),job.id,f.now).id,job.id)
  assert.throws(()=>delegatedRuntimeRollout(f.db,f.b.connection(),job.id,f.now),/not_found/)
  assert.throws(()=>requestDelegatedRuntimeRollout(f.db,f.b.connection,input,f.now),/request_conflict/)
  assert.throws(()=>requestDelegatedRuntimeRollout(f.db,f.a.connection,{...input,workerId:randomUUID()},f.now))
  assert.equal((f.db.prepare('SELECT count(*) AS n FROM runtime_control_requests').get() as any).n,1)
 }finally{f.sqlite.close()}
})
test('transport identity is revalidated inside the submission transaction after credential rotation',()=>{
 const f=fixture();try{
  updateRuntimeControlGrant(f.db,f.owner,f.a.id,f.input(f.a.id),f.now)
  f.a.connection()
  const rotated='rue_terminal_'+'c'.repeat(43)
  f.db.prepare('UPDATE terminal_connections SET token_hash=? WHERE id=?').run(createHash('sha256').update(rotated).digest('hex'),f.a.connectionId)
  assert.throws(()=>requestDelegatedRuntimeRollout(f.db,f.a.connection,f.rollout(),f.now),/invalid_terminal_credential/)
  assert.equal((f.db.prepare('SELECT count(*) AS n FROM runtime_rollouts').get() as any).n,0)
  const current=(time:number)=>authenticateTerminalConnection(f.db,rotated,f.a.connectionId,time)
  assert.equal(requestDelegatedRuntimeRollout(f.db,current,f.rollout(),f.now).workerId,f.workerId)
 }finally{f.sqlite.close()}
})
test('revocation blocks new control and cancels preflight jobs, but never interrupts an accepted draining rollout',()=>{
 for(const started of [false,true]){const f=fixture();try{
  updateRuntimeControlGrant(f.db,f.owner,f.a.id,f.input(f.a.id),f.now)
  const job=requestDelegatedRuntimeRollout(f.db,f.a.connection,f.rollout(),f.now)
  if(started)reportRuntimeRollout(f.db,f.auth,job.id,{action:'ready',image:newImage},f.now)
  const result=updateRuntimeControlGrant(f.db,f.owner,f.a.id,{expectedOwnerSubject:f.owner,expectedRevision:1,enabled:false},f.now+1)
  assert.equal(result.enabled,false);assert.equal(result.revision,2)
  assert.equal((f.db.prepare('SELECT phase FROM runtime_rollouts WHERE id=?').get(job.id) as any).phase,started?'draining':'failed')
  assert.throws(()=>requestDelegatedRuntimeRollout(f.db,f.a.connection,f.rollout(),f.now+2),/not_approved/)
 }finally{f.sqlite.close()}}
})
test('expiration is rechecked before the manager may begin draining an accepted preflight job',()=>{
 const f=fixture();try{
  updateRuntimeControlGrant(f.db,f.owner,f.a.id,f.input(f.a.id),f.now)
  f.db.prepare('UPDATE runtime_control_grants SET expires_at=? WHERE agent_id=?').run(f.now+2,f.a.id)
  const job=requestDelegatedRuntimeRollout(f.db,f.a.connection,f.rollout(),f.now+1)
  const result=reportRuntimeRollout(f.db,f.auth,job.id,{action:'ready',image:newImage},f.now+3)
  assert.equal(result.phase,'failed');assert.equal(result.error,'runtime_control_not_approved')
  assert.equal((f.db.prepare('SELECT desired FROM workers WHERE id=?').get(f.workerId) as any).desired,'active')
 }finally{f.sqlite.close()}
})
test('reloads preserve a binding but changing host/connection or destroying the agent does not transfer approval',()=>{
 const f=fixture();try{
  updateRuntimeControlGrant(f.db,f.owner,f.a.id,f.input(f.a.id),f.now)
  f.db.prepare('UPDATE managed_agents SET revision=2,grant_revision=2 WHERE id=?').run(f.a.id)
  assert.equal(runtimeControlDelegation(f.db,f.a.connection(),f.now).canSubmit,true)
  const otherWorker=randomUUID();f.db.prepare('INSERT INTO workers(id,owner_subject,name,token_hash,enrollment_request_id,created_at,generation,last_seen_at,lease_expires_at,health) VALUES(?,?,?,?,?,?,?,?,?,?)').run(otherWorker,f.owner,'Other host','other-unique-hash',randomUUID(),f.now,1,f.now,f.now+60000,JSON.stringify({capabilities:['managed-runtime-rollout-v1']}))
  f.db.prepare('UPDATE managed_agents SET worker_id=? WHERE id=?').run(otherWorker,f.a.id)
  assert.equal(runtimeControlDelegation(f.db,f.a.connection(),f.now).canSubmit,false)
  f.db.prepare('UPDATE managed_agents SET worker_id=? WHERE id=?').run(f.workerId,f.a.id)
  f.db.prepare('UPDATE runtime_control_grants SET connection_id=? WHERE agent_id=?').run(f.b.connectionId,f.a.id)
  assert.equal(runtimeControlDelegation(f.db,f.a.connection(),f.now).canSubmit,false)
  f.db.prepare('UPDATE runtime_control_grants SET connection_id=? WHERE agent_id=?').run(f.a.connectionId,f.a.id)
  f.db.prepare("UPDATE managed_agents SET desired='destroyed' WHERE id=?").run(f.a.id)
  assert.throws(()=>f.a.connection(),/invalid_terminal_credential/)
  assert.equal(runtimeControlGrant(f.db,f.owner,f.a.id,f.now).enabled,false)
 }finally{f.sqlite.close()}
})
test('HTTP approval requires a human and relay requests cannot approve themselves or name another connection',async()=>{
 const f=fixture();try{
  const app=new Hono();app.use('*',async(c,next)=>{c.set('ctx',{db:f.db,bus:{publish:()=>{}}} as any);c.set('principal',{subject:f.owner,principalType:c.req.header('x-test-principal')??'user',scopes:[]} as any);return next()});app.route('/runtime-rollouts',runtimeRolloutAccountRoutes());app.route('/terminal-client',runtimeRolloutTerminalRoutes())
  const path=`/runtime-rollouts/agents/${f.a.id}/grant`,body=JSON.stringify(f.input(f.a.id))
  assert.equal((await app.request(path,{method:'PUT',headers:{'content-type':'application/json','x-test-principal':'machine'},body})).status,403)
  assert.equal(keyPermissionsFor('PUT',path),undefined)
  assert.equal((await app.request(path,{method:'PUT',headers:{'content-type':'application/json'},body})).status,200)
  const headers={authorization:`Bearer ${f.a.token}`,'content-type':'application/json'}
  const full=createApp({ctx:{db:f.db,config:ConfigSchema.parse({keyname:{enabled:true,apiUrl:'https://keyname.test',clientId:'fixture'}}),bus:new Bus()},terminalPairing:true,managedWorkers:true,managedAgents:true})
  assert.equal((await full.request(path,{method:'PUT',headers,body})).status,401)
  assert.equal((await full.request(path,{method:'PUT',headers:{...headers,authorization:'Bearer tnk_fixture'},body})).status,401)
  assert.equal((await full.request(`/terminal-client/connections/${f.a.connectionId}/runtime-control/grant`,{method:'PUT',headers,body})).status,404)
  const status=await app.request(`/terminal-client/connections/${f.a.connectionId}/runtime-control`,{headers});assert.equal(status.status,200);assert.equal((await status.json() as any).canSubmit,true)
  assert.equal((await app.request(`/terminal-client/connections/${f.b.connectionId}/runtime-control`,{headers})).status,401)
  assert.equal((await app.request(`/terminal-client/connections/${f.a.connectionId}/runtime-control/rollouts`,{method:'POST',headers,body:JSON.stringify(f.rollout())})).status,202)
 }finally{f.sqlite.close()}
})
