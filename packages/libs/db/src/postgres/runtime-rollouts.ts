import {randomUUID} from 'node:crypto'
import {and,count,desc,eq,gt,isNull,notInArray,sql} from 'drizzle-orm'
import type {RuePostgresDatabase} from './client.js'
import type {createPostgresWorkerRepository} from './workers.js'
import {WorkerError,type WorkerAuthority} from '../worker-types.js'
import {lockPostgresOwner} from './owner-lock.js'
import {postgresManagedBusy} from './managed-authority.js'
import {runtimeRollouts as jobs,managedAgents as agents,workers,workerAudit,terminalConnections as hosts,runtimeControlRequests,runtimeControlGrants} from './schema.js'
type Tx=Parameters<Parameters<RuePostgresDatabase['transaction']>[0]>[0]
type Job=typeof jobs.$inferSelect
type Agent=typeof agents.$inferSelect
export type RolloutPhase='preflight'|'draining'|'stopping'|'installing'|'verifying'|'rollback_stopping'|'rollback_installing'|'rollback_verifying'|'succeeded'|'failed'|'uncertain'
export interface RolloutRequest {requestId:string;expectedWorkerRevision:number;expectedImage:string;image:string;acknowledgeHostExecution:true}
export interface RolloutReport {action:'ready'|'installed'|'rejected';image?:string}
type AgentFence={id:string;revision:number;desired:string;resume?:boolean}
const terminal=new Set(['succeeded','failed'])
const fail=(status:400|401|404|409|429,code:string):never=>{throw new WorkerError(status,code)}
const publicJob=(row:Job)=>({id:row.id,workerId:row.workerId,requestId:row.requestId,phase:row.phase as RolloutPhase,image:row.image,previousImage:row.previousImage,createdAt:row.createdAt,updatedAt:row.updatedAt,expiresAt:row.expiresAt,error:row.error})
/** SQL-only state machine. Image inspection/install and process stop/start remain
 * manager operations outside transactions, bounded by worker authority. */
export function createPostgresRolloutRepository(db:RuePostgresDatabase,options:{parseRequest:(raw:unknown)=>RolloutRequest;parseReport:(raw:unknown)=>RolloutReport;worker:Pick<ReturnType<typeof createPostgresWorkerRepository>,'withAuthority'>}){
 async function get(tx:Pick<RuePostgresDatabase,'select'>,owner:string,id:string){const [row]=await tx.select().from(jobs).where(and(eq(jobs.id,id),eq(jobs.ownerSubject,owner)));if(!row)return fail(404,'runtime_rollout_not_found');return row}
 async function inventory(tx:Tx,workerId:string){return tx.select().from(agents).where(and(eq(agents.workerId,workerId),isNull(agents.purgedAt))).orderBy(agents.id)}
 async function phase(tx:Tx,row:Job,next:RolloutPhase,now:number,error:string|null=null){const update={phase:next,updatedAt:now,phaseAt:now,error};await tx.update(jobs).set(update).where(eq(jobs.id,row.id));Object.assign(row,update)}
 async function audit(tx:Tx,row:Job,action:string,now:number){await tx.insert(workerAudit).values({id:randomUUID(),workerId:row.workerId,action:`runtime-rollout:${action}`,revision:row.workerRevision,createdAt:now})}
 async function workerDesired(tx:Tx,row:Job,desired:'active'|'draining',now:number){
  if(!Number.isSafeInteger(row.workerRevision)||row.workerRevision>=Number.MAX_SAFE_INTEGER)return fail(409,'worker_counter_exhausted')
  const [updated]=await tx.update(workers).set({desired,revision:row.workerRevision+1}).where(and(eq(workers.id,row.workerId),eq(workers.ownerSubject,row.ownerSubject),eq(workers.revision,row.workerRevision))).returning({id:workers.id})
  if(!updated)return fail(409,'worker_revision_conflict')
  row.workerRevision++;await tx.update(jobs).set({workerRevision:row.workerRevision}).where(eq(jobs.id,row.id));await audit(tx,row,desired,now)
 }
 async function delegatedPreflightAllowed(tx:Tx,row:Job,now:number){
  const [link]=await tx.select().from(runtimeControlRequests).where(eq(runtimeControlRequests.rolloutId,row.id));if(!link)return true
  const [allowed]=await tx.select({id:runtimeControlGrants.agentId}).from(runtimeControlGrants).innerJoin(agents,eq(agents.id,runtimeControlGrants.agentId)).innerJoin(hosts,eq(hosts.id,agents.connectionId)).where(and(eq(runtimeControlGrants.agentId,link.agentId),eq(runtimeControlGrants.ownerSubject,row.ownerSubject),eq(runtimeControlGrants.workerId,row.workerId),eq(runtimeControlGrants.enabled,1),gt(runtimeControlGrants.expiresAt,now),sql`${runtimeControlGrants.updatedAt}<=${now}`,eq(agents.ownerSubject,runtimeControlGrants.ownerSubject),eq(agents.workerId,runtimeControlGrants.workerId),eq(agents.connectionId,runtimeControlGrants.connectionId),sql`${agents.desired}<>'destroyed'`,isNull(agents.purgedAt),eq(hosts.ownerSubject,runtimeControlGrants.ownerSubject),eq(hosts.sessionId,agents.sessionId),isNull(hosts.revokedAt)))
  return Boolean(allowed)
 }
 async function fences(tx:Tx,row:Job){const saved=JSON.parse(row.agents) as AgentFence[],current=await inventory(tx,row.workerId);return current.length===saved.length&&saved.every(item=>current.some(a=>a.ownerSubject===row.ownerSubject&&a.id===item.id&&a.revision===item.revision&&a.desired===item.desired))}
 async function transitionAgents(tx:Tx,row:Job,running:boolean,now:number){
  const saved=JSON.parse(row.agents) as AgentFence[]
  for(const item of saved){
   if(!item.resume)continue
   if(!Number.isSafeInteger(item.revision)||item.revision>=Number.MAX_SAFE_INTEGER)return fail(409,'managed_counter_exhausted')
   const next={desired:running?'running':'stopped',revision:item.revision+1,observed:'pending',error:null,grantRevision:null,grantGeneration:null,encryptedGrant:null}
   const [a]=await tx.update(agents).set(next).where(and(eq(agents.id,item.id),eq(agents.workerId,row.workerId),eq(agents.ownerSubject,row.ownerSubject),eq(agents.revision,item.revision),eq(agents.desired,item.desired))).returning({connectionId:agents.connectionId})
   if(!a)return fail(409,'managed_revision_conflict')
   item.revision=next.revision;item.desired=next.desired
   if(a.connectionId)await tx.update(hosts).set({leaseExpiresAt:now}).where(and(eq(hosts.id,a.connectionId),eq(hosts.ownerSubject,row.ownerSubject)))
  }
  row.agents=JSON.stringify(saved);await tx.update(jobs).set({agents:row.agents}).where(eq(jobs.id,row.id))
 }
 async function recentlyConnected(tx:Tx,a:Agent,now:number){if(!a.connectionId)return false;const [host]=await tx.select({id:hosts.id}).from(hosts).where(and(eq(hosts.id,a.connectionId),eq(hosts.ownerSubject,a.ownerSubject),gt(hosts.leaseExpiresAt,now),gt(hosts.lastSeenAt,now-15000),sql`${hosts.lastSeenAt}<=${now}`,isNull(hosts.revokedAt)));return Boolean(host)}
 async function requestInTransaction(tx:Tx,owner:string,workerId:string,raw:unknown,at?:number){
  const input=options.parseRequest(raw),intent=JSON.stringify([workerId,input]);await lockPostgresOwner(tx,owner);const now=at??Date.now()
  const [previous]=await tx.select().from(jobs).where(and(eq(jobs.ownerSubject,owner),eq(jobs.requestId,input.requestId)))
  if(previous){if(previous.intent!==intent)return fail(409,'rollout_request_conflict');return publicJob(previous)}
  const [worker]=await tx.select().from(workers).where(and(eq(workers.id,workerId),eq(workers.ownerSubject,owner),isNull(workers.revokedAt))).for('update')
  if(!worker)return fail(404,'worker_not_found')
  const current=await inventory(tx,workerId)
  if(current.some(a=>a.ownerSubject!==owner))return fail(409,'rollout_owner_changed')
  if(current.some(a=>a.runtimeImage!==null))return fail(409,'runtime_rollout_has_individual_images')
  if(worker.revision!==input.expectedWorkerRevision||worker.desired!=='active')return fail(409,'worker_revision_conflict')
  const health=worker.health?JSON.parse(worker.health):null
  if(worker.lastSeenAt===null||now<worker.lastSeenAt||!worker.leaseExpiresAt||worker.leaseExpiresAt<=now||!health?.capabilities?.includes('managed-runtime-rollout-v1'))return fail(409,'runtime_rollout_manager_upgrade_required')
  if(health.runtimeImage!==input.expectedImage||input.image===input.expectedImage)return fail(409,'runtime_image_conflict')
  const [pending]=await tx.select({id:jobs.id}).from(jobs).where(and(eq(jobs.workerId,workerId),notInArray(jobs.phase,['succeeded','failed']))).limit(1);if(pending)return fail(409,'runtime_rollout_active')
  const [recent]=await tx.select({n:count()}).from(jobs).where(and(eq(jobs.ownerSubject,owner),gt(jobs.createdAt,now-86400000)));if(recent!.n>=24)return fail(429,'runtime_rollout_rate_limited')
  const snapshot=current.map(a=>({id:a.id,revision:a.revision,desired:a.desired,resume:a.desired==='running'}));if(snapshot.length>64)return fail(409,'runtime_rollout_inventory_too_large')
  const [row]=await tx.insert(jobs).values({id:randomUUID(),ownerSubject:owner,workerId,requestId:input.requestId,intent,phase:'preflight',image:input.image,previousImage:input.expectedImage,workerRevision:worker.revision,agents:JSON.stringify(snapshot),createdAt:now,updatedAt:now,expiresAt:now+1800000,phaseAt:now}).returning()
  await audit(tx,row!,'requested',now);return publicJob(row!)
 }
 async function cancelInTransaction(tx:Tx,owner:string,id:string,at?:number){
  await lockPostgresOwner(tx,owner);const row=await get(tx,owner,id),now=at??Date.now()
  if(row.phase==='failed'&&row.error==='cancelled')return publicJob(row)
  if(row.phase!=='preflight')return fail(409,'runtime_rollout_already_started')
  await phase(tx,row,'failed',now,'cancelled');await audit(tx,row,'cancelled',now);return publicJob(row)
 }
 return {
  requestInTransaction,cancelInTransaction,
  async getInTransaction(tx:Tx,owner:string,id:string){return publicJob(await get(tx,owner,id))},
  request(owner:string,workerId:string,raw:unknown,at?:number){return db.transaction(tx=>requestInTransaction(tx,owner,workerId,raw,at))},
  cancel(owner:string,id:string,at?:number){return db.transaction(tx=>cancelInTransaction(tx,owner,id,at))},
  async get(owner:string,id:string){return publicJob(await get(db,owner,id))},
  async list(owner:string,workerId:string){return (await db.select().from(jobs).where(and(eq(jobs.ownerSubject,owner),eq(jobs.workerId,workerId))).orderBy(desc(jobs.createdAt),desc(jobs.id)).limit(50)).map(publicJob)},
  async holdsHost(workerId:string){const [row]=await db.select({id:jobs.id}).from(jobs).where(and(eq(jobs.workerId,workerId),notInArray(jobs.phase,['preflight','succeeded','failed']))).limit(1);return Boolean(row)},
  poll(auth:WorkerAuthority,at?:number){return options.worker.withAuthority(auth.id,auth.secret,auth.instance,auth.generation,async(tx,w)=>{
   const now=at??Date.now(),[row]=await tx.select().from(jobs).where(and(eq(jobs.workerId,w.id),notInArray(jobs.phase,['succeeded','failed']))).orderBy(jobs.createdAt).limit(1)
   if(!row)return {job:null}
   if(row.ownerSubject!==w.ownerSubject)return fail(401,'rollout_owner_changed')
   if(row.phase==='preflight'&&!await delegatedPreflightAllowed(tx,row,now)){await phase(tx,row,'failed',now,'runtime_control_not_approved');await audit(tx,row,'approval_lapsed',now);return {job:publicJob(row)}}
   if(row.phase!=='uncertain'&&(w.revision!==row.workerRevision||!await fences(tx,row))){await phase(tx,row,row.phase==='preflight'?'failed':'uncertain',now,'concurrent_configuration_change');await audit(tx,row,row.phase,now)}
   if(!terminal.has(row.phase)&&row.phase!=='uncertain'&&now>=row.expiresAt){await phase(tx,row,row.phase==='preflight'?'failed':'uncertain',now,'rollout_expired');await audit(tx,row,row.phase,now)}
   const current=await inventory(tx,row.workerId),saved=JSON.parse(row.agents) as AgentFence[]
   const stopped=()=>current.every(a=>['stopped','destroyed'].includes(a.desired)&&a.observed===a.desired&&a.observedRevision===a.revision)
   const healthy=async()=>{
    const expected=row.phase==='rollback_verifying'?row.previousImage:row.image,[stored]=await tx.select({health:workers.health}).from(workers).where(eq(workers.id,w.id))
    if(!stored?.health||JSON.parse(stored.health).runtimeImage!==expected)return false
    for(const item of saved.filter(a=>a.resume)){const a=current.find(a=>a.id===item.id);if(!a||a.observed!=='running'||a.observedRevision!==a.revision||a.observedGeneration!==w.generation||a.grantGeneration!==w.generation||a.grantRevision!==a.revision||!await recentlyConnected(tx,a,now))return false}
    return true
   }
   if(row.phase==='draining'){
    let idle=true;for(const a of current)if(a.desired==='running'&&(!await recentlyConnected(tx,a,now)||await postgresManagedBusy(tx,a.connectionId,now))){idle=false;break}
    if(idle){await transitionAgents(tx,row,false,now);await phase(tx,row,'stopping',now)}
   }else if(row.phase==='stopping'&&stopped())await phase(tx,row,'installing',now)
   else if(row.phase==='verifying'){
    if(await healthy()){await phase(tx,row,'succeeded',now);await audit(tx,row,'succeeded',now)}
    else if(now-row.phaseAt>120000){await workerDesired(tx,row,'draining',now);await transitionAgents(tx,row,false,now);await phase(tx,row,'rollback_stopping',now,'candidate_unhealthy')}
   }else if(row.phase==='rollback_stopping'&&stopped())await phase(tx,row,'rollback_installing',now)
   else if(row.phase==='rollback_verifying'){
    if(await healthy()){await phase(tx,row,'failed',now,'candidate_unhealthy_rolled_back');await audit(tx,row,'rolled_back',now)}
    else if(now-row.phaseAt>120000){await phase(tx,row,'uncertain',now,'rollback_unconfirmed');await audit(tx,row,'uncertain',now)}
   }
   return {job:publicJob(row)}
  },at)},
  resolve(owner:string,id:string,expectedUpdatedAt:number,at?:number){return db.transaction(async tx=>{
   await lockPostgresOwner(tx,owner);const row=await get(tx,owner,id),now=at??Date.now()
   if(row.phase==='failed'&&row.error==='operator_resolved')return publicJob(row)
   if(row.phase!=='uncertain'||row.updatedAt!==expectedUpdatedAt)return fail(409,'runtime_rollout_revision_conflict')
   const [worker]=await tx.select({desired:workers.desired}).from(workers).where(and(eq(workers.id,row.workerId),eq(workers.ownerSubject,owner)))
   if(worker?.desired!=='draining'||(await inventory(tx,row.workerId)).some(a=>!['stopped','destroyed'].includes(a.desired)||a.observed!==a.desired||a.observedRevision!==a.revision))return fail(409,'runtime_rollout_host_not_stopped')
   await phase(tx,row,'failed',now,'operator_resolved');await audit(tx,row,'operator_resolved',now);return publicJob(row)
  })},
  report(auth:WorkerAuthority,id:string,raw:unknown,at?:number){
   const input=options.parseReport(raw)
   return options.worker.withAuthority(auth.id,auth.secret,auth.instance,auth.generation,async(tx,w)=>{
    const row=await get(tx,w.ownerSubject,id),now=at??Date.now();if(row.workerId!==w.id)return fail(404,'runtime_rollout_not_found')
    if(terminal.has(row.phase)||row.phase==='uncertain')return publicJob(row)
    if(row.phase==='preflight'&&!await delegatedPreflightAllowed(tx,row,now)){await phase(tx,row,'failed',now,'runtime_control_not_approved');await audit(tx,row,'approval_lapsed',now);return publicJob(row)}
    if(w.revision!==row.workerRevision||!await fences(tx,row)){await phase(tx,row,row.phase==='preflight'?'failed':'uncertain',now,'concurrent_configuration_change');return publicJob(row)}
    if(now>=row.expiresAt){await phase(tx,row,row.phase==='preflight'?'failed':'uncertain',now,'rollout_expired');return publicJob(row)}
    if(input.action==='rejected'){await phase(tx,row,row.phase==='preflight'?'failed':'uncertain',now,'runtime_image_unavailable');await audit(tx,row,row.phase,now)}
    else if(input.action==='ready'){
     if(row.phase!=='preflight')return publicJob(row)
     if(input.image!==row.image)return fail(409,'runtime_image_conflict')
     await workerDesired(tx,row,'draining',now);await phase(tx,row,'draining',now);await audit(tx,row,'draining',now)
    }else{
     const rollback=row.phase==='rollback_installing',expected=rollback?row.previousImage:row.image
     if(!['installing','rollback_installing'].includes(row.phase))return publicJob(row)
     if(input.image!==expected)return fail(409,'runtime_image_conflict')
     await transitionAgents(tx,row,true,now);await workerDesired(tx,row,'active',now);await phase(tx,row,rollback?'rollback_verifying':'verifying',now);await audit(tx,row,row.phase,now)
    }
    return publicJob(row)
   },at)
  },
 }
}
