import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {randomUUID,createHash} from 'node:crypto'
import type {Database} from 'better-sqlite3'
import {MIGRATIONS} from '../src/storage/schema.ts'
import {requestRuntimeRollout,pollRuntimeRollout,reportRuntimeRollout,runtimeRollout,runtimeRolloutHoldsHost,resolveRuntimeRollout} from '../src/storage/runtime-rollouts.ts'
import {Hono} from 'hono'
import {createApp} from '../src/server/app.ts'
import {ConfigSchema} from '../src/config/index.ts'
import {Bus} from '../src/bus/index.ts'
import {runtimeRolloutAccountRoutes,runtimeRolloutWorkerRoutes,runtimeRolloutTerminalRoutes} from '../src/server/routes/runtime-rollouts.ts'
import {executeRuntimeRollout} from '../../worker/src/runtime-rollout.ts'
const oldImage='sha256:'+'a'.repeat(64),newImage='sha256:'+'b'.repeat(64),now=1790000000000
function fixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const m of MIGRATIONS)sqlite.exec(m.sql)
 let depth=0
 const db={prepare:(sql:string)=>sqlite.prepare(sql),transaction:(fn:()=>unknown)=>{const run=()=>{const name='t'+depth++,nested=depth>1;sqlite.exec(nested?`SAVEPOINT ${name}`:'BEGIN IMMEDIATE');try{const result=fn();sqlite.exec(nested?`RELEASE ${name}`:'COMMIT');return result}catch(error){sqlite.exec(nested?`ROLLBACK TO ${name}`:'ROLLBACK');throw error}finally{depth--}};return Object.assign(run,{immediate:run})}} as unknown as Database
 const worker=randomUUID(),instance=randomUUID(),agent=randomUUID(),secret='rue_worker_'+'x'.repeat(43),terminalSecret='rue_terminal_'+'t'.repeat(43),connection='term_'+'a'.repeat(32),owner='owner'
 const health={capabilities:['managed-agents-v1','managed-runtime-rollout-v1'],runtimeImage:oldImage}
 db.prepare('INSERT INTO workers(id,owner_subject,name,token_hash,enrollment_request_id,created_at,instance_id,generation,lease_expires_at,last_seen_at,health) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(worker,owner,'Mason',createHash('sha256').update(secret).digest('hex'),randomUUID(),now,instance,1,now+60000,now,JSON.stringify(health))
 db.prepare('INSERT INTO sessions(id,title,owner_subject,created_at,updated_at) VALUES(?,?,?,?,?)').run('ses_test','Retain me',owner,now,now)
 db.prepare('INSERT INTO terminal_connections(id,owner_subject,session_id,pi_session_id,token_hash,expires_at,created_at,activated_at,lease_expires_at,last_seen_at,relay_health) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(connection,owner,'ses_test',agent,createHash('sha256').update(terminalSecret).digest('hex'),now+300000,now,now,now+60000,now,JSON.stringify({agentWorking:false,pendingCount:0}))
 db.prepare("INSERT INTO managed_agents(id,owner_subject,worker_id,session_id,connection_id,name,config,desired,revision,created_at,observed,observed_revision,grant_revision,grant_generation,grant_boot) VALUES(?,?,?,?,?,?,?,'running',1,?,'running',1,1,1,1)").run(agent,owner,worker,'ses_test',connection,'Agent',JSON.stringify({provider:'openai',model:'fixture',permission:'read-only',mounts:[],shareToolOutput:false,shareThinking:false}),now)
 const auth={id:worker,secret,instance,generation:1},input={requestId:randomUUID(),expectedWorkerRevision:0,expectedImage:oldImage,image:newImage,acknowledgeHostExecution:true}
 const stopped=()=>db.prepare("UPDATE managed_agents SET observed='stopped',observed_revision=revision WHERE id=?").run(agent)
 const healthy=(time=now,image=newImage)=>{db.prepare("UPDATE managed_agents SET observed='running',observed_revision=revision,observed_generation=1,grant_generation=1,grant_revision=revision WHERE id=?").run(agent);db.prepare('UPDATE workers SET health=? WHERE id=?').run(JSON.stringify({...health,runtimeImage:image}),worker);db.prepare('UPDATE terminal_connections SET lease_expires_at=?,last_seen_at=?,expires_at=? WHERE id=?').run(time+60000,time,time+300000,connection)}
 const renew=(time:number)=>db.prepare('UPDATE workers SET lease_expires_at=?,last_seen_at=? WHERE id=?').run(time+60000,time,worker)
 return {db,sqlite,owner,worker,agent,connection,terminalSecret,auth,input,stopped,healthy,renew}
}
test('durable rollout drains, preserves state, fences prompts, installs and verifies; duplicate requests do not repeat',()=>{
 const f=fixture();try{
  const job=requestRuntimeRollout(f.db,f.owner,f.worker,f.input,now)
  assert.equal(requestRuntimeRollout(f.db,f.owner,f.worker,f.input,now).id,job.id)
  assert.throws(()=>requestRuntimeRollout(f.db,f.owner,f.worker,{...f.input,image:'sha256:'+'c'.repeat(64)},now),/request_conflict/)
  assert.throws(()=>runtimeRollout(f.db,'other',job.id),/not_found/)
  reportRuntimeRollout(f.db,f.auth,job.id,{action:'ready',image:newImage},now)
  assert.equal(runtimeRolloutHoldsHost(f.db,f.worker),true)
  f.db.prepare('UPDATE terminal_connections SET relay_health=? WHERE id=?').run(JSON.stringify({agentWorking:true,pendingCount:0}),f.connection)
  assert.equal(pollRuntimeRollout(f.db,f.auth,now).job?.phase,'draining')
  f.db.prepare('UPDATE terminal_connections SET relay_health=? WHERE id=?').run(JSON.stringify({agentWorking:false,pendingCount:0}),f.connection)
  assert.equal(pollRuntimeRollout(f.db,f.auth,now).job?.phase,'stopping')
  assert.equal((f.db.prepare('SELECT desired FROM managed_agents WHERE id=?').get(f.agent) as any).desired,'stopped')
  f.stopped();assert.equal(pollRuntimeRollout(f.db,f.auth,now).job?.phase,'installing')
  reportRuntimeRollout(f.db,f.auth,job.id,{action:'installed',image:newImage},now)
  assert.equal(runtimeRolloutHoldsHost(f.db,f.worker),true)
  f.healthy();f.db.prepare('UPDATE managed_agents SET observed_generation=0 WHERE id=?').run(f.agent)
  assert.equal(pollRuntimeRollout(f.db,f.auth,now).job?.phase,'verifying')
  f.healthy();assert.equal(pollRuntimeRollout(f.db,f.auth,now).job?.phase,'succeeded');assert.equal(runtimeRolloutHoldsHost(f.db,f.worker),false)
  assert.equal((f.db.prepare('SELECT title FROM sessions WHERE id=?').get('ses_test') as any).title,'Retain me')
  assert.equal((f.db.prepare('SELECT token_hash FROM terminal_connections WHERE id=?').get(f.connection) as any).token_hash,createHash('sha256').update(f.terminalSecret).digest('hex'))
 }finally{f.sqlite.close()}
})
test('unhealthy candidates roll back before prompts are released',()=>{
 const f=fixture();try{
  const job=requestRuntimeRollout(f.db,f.owner,f.worker,f.input,now)
  reportRuntimeRollout(f.db,f.auth,job.id,{action:'ready',image:newImage},now);pollRuntimeRollout(f.db,f.auth,now);f.stopped();pollRuntimeRollout(f.db,f.auth,now)
  reportRuntimeRollout(f.db,f.auth,job.id,{action:'installed',image:newImage},now)
  const later=now+120001;f.renew(later)
  assert.equal(pollRuntimeRollout(f.db,f.auth,later).job?.phase,'rollback_stopping');f.stopped()
  assert.equal(pollRuntimeRollout(f.db,f.auth,later).job?.phase,'rollback_installing')
  reportRuntimeRollout(f.db,f.auth,job.id,{action:'installed',image:oldImage},later);f.healthy(later,oldImage)
  const result=pollRuntimeRollout(f.db,f.auth,later).job!
  assert.equal(result.phase,'failed');assert.equal(result.error,'candidate_unhealthy_rolled_back');assert.equal(runtimeRolloutHoldsHost(f.db,f.worker),false)
 }finally{f.sqlite.close()}
})
test('old managers, wrong leases and concurrent owner changes fail closed',()=>{
 const f=fixture();try{
  f.db.prepare('UPDATE workers SET health=? WHERE id=?').run(JSON.stringify({capabilities:['managed-agents-v1'],runtimeImage:oldImage}),f.worker)
  assert.throws(()=>requestRuntimeRollout(f.db,f.owner,f.worker,f.input,now),/manager_upgrade_required/)
  f.db.prepare('UPDATE workers SET health=? WHERE id=?').run(JSON.stringify({capabilities:['managed-runtime-rollout-v1'],runtimeImage:oldImage}),f.worker)
  const job=requestRuntimeRollout(f.db,f.owner,f.worker,f.input,now)
  assert.throws(()=>pollRuntimeRollout(f.db,{...f.auth,generation:2},now),/session_fenced/)
  reportRuntimeRollout(f.db,f.auth,job.id,{action:'ready',image:newImage},now)
  f.db.prepare('UPDATE managed_agents SET revision=revision+1 WHERE id=?').run(f.agent)
  assert.equal(pollRuntimeRollout(f.db,f.auth,now).job?.phase,'uncertain');assert.equal(runtimeRolloutHoldsHost(f.db,f.worker),true)
  assert.throws(()=>resolveRuntimeRollout(f.db,f.owner,job.id,now),/host_not_stopped/)
  f.db.prepare("UPDATE managed_agents SET desired='stopped',observed='stopped',observed_revision=revision WHERE id=?").run(f.agent)
  assert.equal(resolveRuntimeRollout(f.db,f.owner,job.id,now,now+1).phase,'failed');assert.equal(runtimeRolloutHoldsHost(f.db,f.worker),false)
  assert.equal((f.db.prepare('SELECT desired FROM workers WHERE id=?').get(f.worker) as any).desired,'draining')
 }finally{f.sqlite.close()}
})
test('HTTP control routes enforce owner isolation, input consent and worker transport credentials',async()=>{
 const f=fixture();try{
  const app=new Hono();app.use('*',async(c,next)=>{c.set('ctx',{db:f.db,bus:{publish:()=>{}}} as any);c.set('principal',{subject:c.req.header('x-test-owner')??f.owner,principalType:'user',scopes:[]} as any);return next()});app.route('/runtime-rollouts',runtimeRolloutAccountRoutes());app.route('/worker-client',runtimeRolloutWorkerRoutes());app.route('/terminal-client',runtimeRolloutTerminalRoutes())
  // Give this fixture a fresh lease for routes using their real wall clock.
  const time=Date.now();f.renew(time);f.healthy(time,oldImage)
  const metadata=await app.request(`/terminal-client/connections/${f.connection}/runtime-control`,{headers:{authorization:`Bearer ${f.terminalSecret}`}})
  assert.equal(metadata.status,200);assert.deepEqual(await metadata.json(),{managed:true,workerId:f.worker,workerRevision:0,managerVersion:null,runtimeImage:oldImage,rolloutSupported:true,canSubmit:false,approved:false,blockedBy:'approval_required',grantRevision:null,grantExpiresAt:null})
  assert.equal((await app.request('/terminal-client/connections/term_other/runtime-control',{headers:{authorization:`Bearer ${f.terminalSecret}`}})).status,401)
  const request=(path:string,body:unknown,headers:Record<string,string>={})=>app.request(path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)})
  assert.equal((await request(`/runtime-rollouts/hosts/${f.worker}`,{...f.input,acknowledgeHostExecution:false})).status,400)
  assert.equal((await request(`/runtime-rollouts/hosts/${f.worker}`,f.input,{'x-test-owner':'other'})).status,404)
  const accepted=await request(`/runtime-rollouts/hosts/${f.worker}`,f.input);assert.equal(accepted.status,202);const job=await accepted.json() as any
  assert.equal((await app.request(`/runtime-rollouts/${job.id}`,{headers:{'x-test-owner':'other'}})).status,404)
  assert.equal((await request(`/worker-client/${f.worker}/runtime-rollouts/poll`,{instance:f.auth.instance,generation:1},{authorization:'Bearer rue_terminal_wrong'})).status,401)
  assert.equal((await request(`/worker-client/${f.worker}/runtime-rollouts/poll`,{instance:f.auth.instance,generation:1},{authorization:`Bearer ${f.auth.secret}`})).status,200)
  assert.equal((await request(`/runtime-rollouts/${job.id}/cancel`,{})).status,200)
  assert.equal(runtimeRollout(f.db,f.owner,job.id).error,'cancelled')
 }finally{f.sqlite.close()}
})
test('full API mounts discovery before terminal catch-all without limiting existing relay bodies',async()=>{
 const f=fixture();try{
  const time=Date.now();f.renew(time);f.healthy(time,oldImage)
  const app=createApp({ctx:{db:f.db,config:ConfigSchema.parse({keyname:{enabled:true,apiUrl:'https://keyname.test',clientId:'fixture'}}),bus:new Bus()},terminalPairing:true,managedWorkers:true,managedAgents:true})
  const headers={authorization:`Bearer ${f.terminalSecret}`}
  assert.equal((await app.request(`/terminal-client/connections/${f.connection}/runtime-control`,{headers})).status,200)
  assert.equal((await app.request(`/terminal-client/connections/${f.connection}/authority`,{headers})).status,200)
  const invalid=await app.request(`/terminal-client/connections/${f.connection}/relay/heartbeat`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({extra:'x'.repeat(16000)})})
  assert.equal(invalid.status,400)
  const unknown=await app.request(`/terminal-client/connections/${f.connection}/unknown`,{headers});assert.equal(unknown.status,404);assert.deepEqual(await unknown.json(),{error:'terminal_route_not_found'})
 }finally{f.sqlite.close()}
})
test('worker executor never installs before preflight/drain and chooses the previous image for rollback',async()=>{
 const base:any={id:randomUUID(),workerId:randomUUID(),phase:'preflight',image:newImage,previousImage:oldImage}
 const policy={origin:'https://rue.test',id:base.workerId,image:oldImage,capacity:2,mothership:true,allowRuntimeRollouts:true}
 const calls:string[]=[],ports={check:()=>{},inspect:async(image:string)=>{calls.push('inspect:'+image)},install:async(image:string)=>{calls.push('install:'+image)},report:async(_id:string,r:any)=>{calls.push('report:'+r.action)}}
 await executeRuntimeRollout(base,policy,ports);assert.deepEqual(calls,['inspect:'+newImage,'report:ready']);calls.length=0
 await executeRuntimeRollout({...base,phase:'draining'},policy,ports);assert.deepEqual(calls,[])
 await executeRuntimeRollout({...base,phase:'rollback_installing'},{...policy,image:newImage},ports);assert.deepEqual(calls,['inspect:'+oldImage,'install:'+oldImage,'report:installed'])
 calls.length=0;await executeRuntimeRollout(base,{...policy,allowRuntimeRollouts:false},ports);assert.deepEqual(calls,[])
 await assert.rejects(executeRuntimeRollout(base,policy,{...ports,check:()=>{throw Error('worker_authority_lost')}}),/authority_lost/)
})
