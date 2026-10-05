import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHash,randomBytes,randomUUID} from 'node:crypto'
import {eq} from 'drizzle-orm'
import {createPostgresDatabase} from '../src/postgres/client.ts'
import {migratePostgresDatabase} from '../src/postgres/migrate.ts'
import {createPostgresWorkerRepository} from '../src/postgres/workers.ts'
import {createPostgresTerminalPairingRepository} from '../src/postgres/terminal-pairing.ts'
import {createPostgresTerminalRelayRepository} from '../src/postgres/terminal-relay.ts'
import {createPostgresRolloutRepository} from '../src/postgres/runtime-rollouts.ts'
import {createPostgresRuntimeControlRepository} from '../src/postgres/runtime-control.ts'
import {managedAgents,terminalConnections,terminalCommands,runtimeRollouts,runtimeControlGrants,runtimeControlAudit,runtimeControlRequests,workers} from '../src/postgres/schema.ts'
import {workerHealthSchema} from '../../../apps/core/src/storage/workers.ts'
import {runtimeControlGrantInput} from '../../../apps/core/src/storage/runtime-control.ts'
import {rolloutRequestSchema,rolloutReportSchema} from '../../../apps/core/src/storage/runtime-rollouts.ts'
import {validateContent} from '../../../apps/core/src/storage/attachments.ts'
const adminUrl=process.env.RUE_PG_TEST_ADMIN_URL,oldImage='sha256:'+'a'.repeat(64),newImage='sha256:'+'b'.repeat(64)
const health={version:'1.0.0',platform:'linux',architecture:'arm64',dockerAvailable:true,acceptingWork:true,freeMemoryBytes:1000,cpus:2,runtimeImage:oldImage,capabilities:['host-health-v1','managed-runtime-rollout-v1']}

test('PostgreSQL runtime rollouts and delegated host control',{skip:!adminUrl},async t=>{
 const admin=createPostgresDatabase({url:adminUrl,maxConnections:1}),name='rue_test_'+randomUUID().replaceAll('-','')
 let pool:ReturnType<typeof createPostgresDatabase>|undefined,created=false
 try{
  await admin.sql`CREATE DATABASE ${admin.sql(name)}`;created=true
  const url=new URL(adminUrl!);url.pathname='/'+name;pool=createPostgresDatabase({url:url.toString(),maxConnections:8});await migratePostgresDatabase(pool.db)
  const db=pool.db,now=Date.now(),worker=createPostgresWorkerRepository(db,raw=>workerHealthSchema.parse(raw)),pairing=createPostgresTerminalPairingRepository(db)
  const relay=createPostgresTerminalRelayRepository(db,{validateContent,mergeHealth:(_p,h)=>h,catalogHash:()=>undefined,summaryHealth:()=>null,catalog:()=>({piVersion:null,catalog:null,catalogHash:null})})
  const rollouts=createPostgresRolloutRepository(db,{worker,parseRequest:raw=>rolloutRequestSchema.parse(raw),parseReport:raw=>rolloutReportSchema.parse(raw)})
  const control=createPostgresRuntimeControlRepository(db,{relay,rollouts,parseGrant:raw=>runtimeControlGrantInput.parse(raw),parseRollout:raw=>rolloutRequestSchema.parse(raw)})
  async function fixture(){
   const owner=randomUUID(),agentId=randomUUID(),enrolled=await worker.create(owner,'Host',randomUUID(),now),instance=randomUUID()
   const lease=await worker.connect(enrolled.worker.id,enrolled.secret!,instance,now)
   const auth={id:enrolled.worker.id,secret:enrolled.secret!,instance,generation:lease.generation}
   await worker.heartbeat(auth.id,auth.secret,instance,auth.generation,health,now)
   const verifier=randomBytes(32).toString('base64url'),pending=await pairing.request(createHash('sha256').update(verifier).digest('hex'),agentId,now)
   const approved=await pairing.approve(pending.requestId,owner,'Bot',now),grant=await pairing.exchange(pending.requestId,verifier,approved.code,now)
   await pairing.activate(grant.token,now)
   const [host]=await db.select().from(terminalConnections).where(eq(terminalConnections.id,grant.id));await relay.configure(owner,grant.id,'Bot',true,host!.settingsRevision)
   await db.insert(managedAgents).values({id:agentId,ownerSubject:owner,workerId:auth.id,connectionId:grant.id,sessionId:grant.sessionId,name:'Bot',config:'{}',desired:'running',revision:1,grantRevision:1,grantGeneration:auth.generation,grantBoot:1,encryptedGrant:'fixture-only',observed:'running',observedRevision:1,observedGeneration:auth.generation,createdAt:now})
   const runtime={id:grant.id,token:grant.token,instance:randomUUID()};await relay.attach(runtime.token,runtime.id,runtime.instance,now,2)
   const approval={enabled:true,expectedOwnerSubject:owner,expectedRevision:0,expectedAgentRevision:1,expectedWorkerId:auth.id,expectedConnectionId:grant.id,expiresInSeconds:3600,acknowledgeHostControl:true}
   const input={requestId:randomUUID(),expectedWorkerRevision:enrolled.worker.revision,expectedImage:oldImage,image:newImage,acknowledgeHostExecution:true}
   return {owner,agentId,auth,runtime,approval,input,sessionId:grant.sessionId}
  }
  async function observed(f:Awaited<ReturnType<typeof fixture>>,running:boolean,image=newImage){
   const [a]=await db.select().from(managedAgents).where(eq(managedAgents.id,f.agentId))
   await db.update(managedAgents).set({observed:running?'running':'stopped',observedRevision:a!.revision,observedGeneration:f.auth.generation,...(running?{grantRevision:a!.revision,grantGeneration:f.auth.generation,grantBoot:1}:{})}).where(eq(managedAgents.id,f.agentId))
   if(running){await db.update(terminalConnections).set({leaseExpiresAt:now+60000,lastSeenAt:now}).where(eq(terminalConnections.id,f.runtime.id));await worker.heartbeat(f.auth.id,f.auth.secret,f.auth.instance,f.auth.generation,{...health,runtimeImage:image},now)}
  }
  await t.test('concurrent requests deduplicate and only one distinct rollout occupies a host',async()=>{
   const f=await fixture(),rows=await Promise.all(Array.from({length:5},()=>rollouts.request(f.owner,f.auth.id,f.input,now)))
   assert.equal(new Set(rows.map(row=>row.id)).size,1)
   await assert.rejects(rollouts.request(f.owner,f.auth.id,{...f.input,image:'sha256:'+'c'.repeat(64)},now),/rollout_request_conflict/)
   await assert.rejects(rollouts.request(f.owner,f.auth.id,{...f.input,requestId:randomUUID()},now),/runtime_rollout_active/)
   assert.deepEqual(await rollouts.list('other-owner',f.auth.id),[])
   await assert.rejects(rollouts.get('other-owner',rows[0]!.id),/runtime_rollout_not_found/)
  })
  await t.test('successful rollout stops and fences runtimes, preserves queue intent, then verifies the candidate',async()=>{
   const f=await fixture(),queued=await relay.enqueue(f.owner,f.sessionId,randomUUID(),'keep this intent',now),job=await rollouts.request(f.owner,f.auth.id,f.input,now)
   assert.equal(await rollouts.holdsHost(f.auth.id),false)
   assert.equal((await rollouts.report(f.auth,job.id,{action:'ready',image:newImage},now)).phase,'draining')
   assert.equal(await rollouts.holdsHost(f.auth.id),true)
   assert.equal((await rollouts.poll(f.auth,now)).job!.phase,'stopping')
   const [a]=await db.select().from(managedAgents).where(eq(managedAgents.id,f.agentId));assert.equal(a!.desired,'stopped');assert.equal(a!.revision,2);assert.equal(a!.encryptedGrant,null);assert.equal(a!.grantRevision,null)
   assert.equal((await db.select().from(terminalCommands).where(eq(terminalCommands.id,queued.id)))[0]!.status,'queued')
   await observed(f,false);assert.equal((await rollouts.poll(f.auth,now)).job!.phase,'installing')
   await assert.rejects(rollouts.report(f.auth,job.id,{action:'installed',image:oldImage},now),/runtime_image_conflict/)
   assert.equal((await rollouts.report(f.auth,job.id,{action:'installed',image:newImage},now)).phase,'verifying')
   await observed(f,true)
   assert.equal((await rollouts.poll(f.auth,now)).job!.phase,'succeeded')
   assert.equal(await rollouts.holdsHost(f.auth.id),false)
   assert.equal((await db.select().from(workers).where(eq(workers.id,f.auth.id)))[0]!.desired,'active')
  })
  await t.test('an unhealthy candidate rolls back and verifies the previous image',async()=>{
   const f=await fixture(),job=await rollouts.request(f.owner,f.auth.id,f.input,now)
   await rollouts.report(f.auth,job.id,{action:'ready',image:newImage},now);await rollouts.poll(f.auth,now);await observed(f,false);await rollouts.poll(f.auth,now)
   await rollouts.report(f.auth,job.id,{action:'installed',image:newImage},now)
   await db.update(runtimeRollouts).set({phaseAt:now-120001}).where(eq(runtimeRollouts.id,job.id))
   assert.equal((await rollouts.poll(f.auth,now)).job!.phase,'rollback_stopping')
   await observed(f,false);assert.equal((await rollouts.poll(f.auth,now)).job!.phase,'rollback_installing')
   assert.equal((await rollouts.report(f.auth,job.id,{action:'installed',image:oldImage},now)).phase,'rollback_verifying')
   await observed(f,true,oldImage)
   const result=(await rollouts.poll(f.auth,now)).job!
   assert.equal(result.phase,'failed');assert.equal(result.error,'candidate_unhealthy_rolled_back')
  })
  await t.test('configuration races become uncertain and resolution requires a confirmed stopped host',async()=>{
   const f=await fixture(),job=await rollouts.request(f.owner,f.auth.id,f.input,now)
   await rollouts.report(f.auth,job.id,{action:'ready',image:newImage},now)
   await db.update(managedAgents).set({revision:2}).where(eq(managedAgents.id,f.agentId))
   const uncertain=(await rollouts.poll(f.auth,now)).job!;assert.equal(uncertain.phase,'uncertain')
   await assert.rejects(rollouts.resolve(f.owner,job.id,uncertain.updatedAt,now),/runtime_rollout_host_not_stopped/)
   await db.update(managedAgents).set({desired:'stopped',observed:'stopped',observedRevision:2}).where(eq(managedAgents.id,f.agentId))
   const resolved=await rollouts.resolve(f.owner,job.id,uncertain.updatedAt,now);assert.equal(resolved.error,'operator_resolved')
   assert.equal((await db.select().from(workers).where(eq(workers.id,f.auth.id)))[0]!.desired,'draining')
  })
  await t.test('approval CAS is single-winner and revoked preflight is cancelled atomically',async()=>{
   const f=await fixture();assert.equal((await control.delegation(f.runtime,now)).approved,false)
   const attempts=await Promise.allSettled(Array.from({length:5},()=>control.update(f.owner,f.agentId,f.approval,now)))
   assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1)
   assert.equal((await control.delegation(f.runtime,now)).canSubmit,true)
   const jobs=await Promise.all(Array.from({length:5},()=>control.requestRollout(f.runtime,f.input,now)));assert.equal(new Set(jobs.map(j=>j.id)).size,1)
   assert.equal((await control.rollout(f.runtime,jobs[0]!.id,now)).id,jobs[0]!.id)
   assert.equal((await db.select().from(runtimeControlRequests).where(eq(runtimeControlRequests.agentId,f.agentId))).length,1)
   const revoked=await control.update(f.owner,f.agentId,{enabled:false,expectedOwnerSubject:f.owner,expectedRevision:1},now+1)
   assert.equal(revoked.enabled,false);assert.equal(revoked.revision,2)
   assert.equal((await rollouts.get(f.owner,jobs[0]!.id)).error,'cancelled')
   assert.equal((await db.select().from(runtimeControlAudit).where(eq(runtimeControlAudit.agentId,f.agentId))).length,4)
   await assert.rejects(control.requestRollout(f.runtime,{...f.input,requestId:randomUUID()},now+1),/runtime_control_not_approved/)
  })
  await t.test('a delegated caller cannot adopt a human request, even at the same timestamp',async()=>{
   const f=await fixture();await control.update(f.owner,f.agentId,f.approval,now)
   const job=await rollouts.request(f.owner,f.auth.id,f.input,now)
   await assert.rejects(control.requestRollout(f.runtime,f.input,now),/runtime_control_request_conflict/)
   await assert.rejects(control.rollout(f.runtime,job.id,now),/runtime_rollout_not_found/)
   assert.equal((await db.select().from(runtimeControlRequests).where(eq(runtimeControlRequests.rolloutId,job.id))).length,0)
  })
  await t.test('expired delegation prevents a manager from beginning preflight',async()=>{
   const f=await fixture();await control.update(f.owner,f.agentId,f.approval,now)
   const job=await control.requestRollout(f.runtime,f.input,now)
   await db.update(runtimeControlGrants).set({expiresAt:now+1}).where(eq(runtimeControlGrants.agentId,f.agentId))
   const rejected=await rollouts.report(f.auth,job.id,{action:'ready',image:newImage},now+2)
   assert.equal(rejected.phase,'failed');assert.equal(rejected.error,'runtime_control_not_approved')
   assert.equal((await db.select().from(workers).where(eq(workers.id,f.auth.id)))[0]!.desired,'active')
  })
  await t.test('owner, binding and lease checks precede delegated changes',async()=>{
   const f=await fixture(),other=await fixture()
   await assert.rejects(control.get(other.owner,f.agentId,now),/managed_agent_not_found/)
   await assert.rejects(control.update(f.owner,f.agentId,{...f.approval,expectedConnectionId:other.runtime.id},now),/runtime_control_agent_changed/)
   await control.update(f.owner,f.agentId,f.approval,now)
   await assert.rejects(control.requestRollout({...f.runtime,instance:randomUUID()},f.input,now),/computer_instance_changed/)
   await worker.change(f.owner,f.auth.id,'revoke',f.input.expectedWorkerRevision,now+1)
   await assert.rejects(control.requestRollout(f.runtime,f.input,now+1),/invalid_terminal_credential/)
   assert.equal((await rollouts.list(f.owner,f.auth.id)).length,0)
  })
 }finally{await pool?.close();if(created)await admin.sql`DROP DATABASE ${admin.sql(name)}`;await admin.close()}
})
