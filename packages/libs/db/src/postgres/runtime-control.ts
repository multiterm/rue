import {randomUUID} from 'node:crypto'
import {and,desc,eq,isNull,notInArray} from 'drizzle-orm'
import type {RuePostgresDatabase} from './client.js'
import type {createPostgresTerminalRelayRepository} from './terminal-relay.js'
import type {createPostgresTerminalPairingRepository} from './terminal-pairing.js'
import type {createPostgresRolloutRepository,RolloutRequest} from './runtime-rollouts.js'
import {RuntimeControlError,type RuntimeControlAuthority,type RuntimeControlGrantInput} from '../runtime-control-types.js'
import {WorkerError} from '../worker-types.js'
import {TerminalPairingError,RelayError} from '../terminal-types.js'
import {lockPostgresOwner} from './owner-lock.js'
import {managedAgents as agents,workers,terminalConnections as hosts,runtimeControlGrants as grants,runtimeControlAudit as audits,runtimeControlRequests as requests,runtimeRollouts as jobs} from './schema.js'
type Tx=Parameters<Parameters<RuePostgresDatabase['transaction']>[0]>[0]
type Grant=typeof grants.$inferSelect
type Bound={agent:typeof agents.$inferSelect;worker:typeof workers.$inferSelect}
const fail=(status:403|404|409,code:string):never=>{throw new RuntimeControlError(status,code)}
/** Approval updates are account-only operations: the HTTP route must require a
 * human principal. Delegated methods instead revalidate the runtime's live socket
 * authority within the transaction that creates/reads its rollout. */
export function createPostgresRuntimeControlRepository(db:RuePostgresDatabase,options:{
 parseGrant:(raw:unknown)=>RuntimeControlGrantInput
 parseRollout:(raw:unknown)=>RolloutRequest
 relay:Pick<ReturnType<typeof createPostgresTerminalRelayRepository>,'withSocketAuthority'>
 terminal?:Pick<ReturnType<typeof createPostgresTerminalPairingRepository>,'withAuthority'>
 rollouts:Pick<ReturnType<typeof createPostgresRolloutRepository>,'requestInTransaction'|'cancelInTransaction'|'getInTransaction'>
}){
 async function owned(tx:Tx,owner:string,id:string){const [a]=await tx.select({agent:agents,worker:workers}).from(agents).innerJoin(workers,eq(workers.id,agents.workerId)).where(and(eq(agents.id,id),eq(agents.ownerSubject,owner),eq(workers.ownerSubject,owner)));if(!a)return fail(404,'managed_agent_not_found');return a}
 async function grant(tx:Tx,id:string):Promise<Grant|undefined>{const [g]=await tx.select().from(grants).where(eq(grants.agentId,id));return g}
 async function bindingValid(tx:Tx,{agent:a,worker:w}:Bound){
  if(!a.connectionId||!a.sessionId||a.desired==='destroyed'||a.purgedAt!==null||w.revokedAt!==null)return false
  const [host]=await tx.select({id:hosts.id}).from(hosts).where(and(eq(hosts.id,a.connectionId),eq(hosts.ownerSubject,a.ownerSubject),eq(hosts.sessionId,a.sessionId),isNull(hosts.revokedAt)));return Boolean(host)
 }
 async function active(tx:Tx,b:Bound,g:Grant|undefined,now:number){const a=b.agent;return Boolean(g&&g.enabled===1&&g.updatedAt<=now&&g.expiresAt>now&&g.ownerSubject===a.ownerSubject&&g.workerId===a.workerId&&g.connectionId===a.connectionId&&await bindingValid(tx,b))}
 function managerReady({worker:w}:Bound,now:number){
  if(w.revokedAt!==null||!w.leaseExpiresAt||w.leaseExpiresAt<=now||w.lastSeenAt===null||w.lastSeenAt>now)return false
  try{return Boolean(w.health&&JSON.parse(w.health).capabilities?.includes('managed-runtime-rollout-v1'))}catch{return false}
 }
 async function audit(tx:Tx,{agent:a}:Bound,revision:number,action:string,now:number,rolloutId:string|null=null,workerId=a.workerId){await tx.insert(audits).values({id:randomUUID(),ownerSubject:a.ownerSubject,agentId:a.id,workerId,grantRevision:revision,action,rolloutId,createdAt:now})}
 async function view(tx:Tx,owner:string,id:string,now:number){
  const b=await owned(tx,owner,id),a=b.agent,g=await grant(tx,id)
  return {ownerSubject:owner,agentId:id,agentRevision:a.revision,workerId:a.workerId,workerName:b.worker.name,connectionId:a.connectionId,revision:g?.revision??0,enabled:await active(tx,b,g,now),expiresAt:g?.expiresAt??null,updatedAt:g?.updatedAt??null,serverNow:now,managerReady:managerReady(b,now),audit:await tx.select({action:audits.action,createdAt:audits.createdAt,rolloutId:audits.rolloutId}).from(audits).where(and(eq(audits.ownerSubject,owner),eq(audits.agentId,id))).orderBy(desc(audits.createdAt),desc(audits.id)).limit(10)}
 }
 function withProof<T>(auth:RuntimeControlAuthority,at:number|undefined,run:(tx:Tx,host:typeof hosts.$inferSelect)=>Promise<T>){
  if(auth.instance!==undefined)return options.relay.withSocketAuthority(auth.token,auth.id,auth.instance,run,at)
  if(!options.terminal)return Promise.reject(new RuntimeControlError(403,'runtime_control_not_approved'))
  return options.terminal.withAuthority(auth.token,auth.id,run,at)
 }
 const unapproved=()=>({approved:false,canSubmit:false,blockedBy:'approval_required' as const,grantRevision:null,grantExpiresAt:null})
 async function delegationView(tx:Tx,b:Bound,g:Grant|undefined,now:number){
  if(!await active(tx,b,g,now))return unapproved()
  const [pending]=await tx.select({id:jobs.id}).from(jobs).where(and(eq(jobs.workerId,b.agent.workerId),notInArray(jobs.phase,['succeeded','failed']))).limit(1)
  const blockedBy=!managerReady(b,now)?'manager_unavailable' as const:b.worker.desired!=='active'?'host_draining' as const:pending?'rollout_in_progress' as const:null
  return {approved:true,canSubmit:blockedBy===null,blockedBy,grantRevision:g!.revision,grantExpiresAt:g!.expiresAt}
 }
 async function delegated<T>(auth:RuntimeControlAuthority,at:number|undefined,run:(tx:Tx,b:Bound,g:Grant,now:number)=>Promise<T>){
  return withProof(auth,at,async(tx,host)=>{
   const now=at??Date.now(),[row]=await tx.select({id:agents.id}).from(agents).where(and(eq(agents.connectionId,host.id),eq(agents.ownerSubject,host.ownerSubject)))
   if(!row)return fail(403,'runtime_control_not_approved')
   const b=await owned(tx,host.ownerSubject,row.id),a=b.agent,g=await grant(tx,a.id)
   if(host.piSessionId!==a.id||host.sessionId!==a.sessionId||!await active(tx,b,g,now))return fail(403,'runtime_control_not_approved')
   const result=await run(tx,b,g!,now),completedAt=at??Date.now()
   if(completedAt<now||completedAt>=g!.expiresAt)return fail(403,'runtime_control_not_approved')
   return result
  })
 }
 return {
  describe(auth:RuntimeControlAuthority,at?:number){return withProof(auth,at,async(tx,host)=>{
   const [row]=await tx.select({id:agents.id}).from(agents).where(and(eq(agents.connectionId,host.id),eq(agents.ownerSubject,host.ownerSubject)))
   if(!row)return {managed:false as const,canSubmit:false}
   const b=await owned(tx,host.ownerSubject,row.id),health=b.worker.health?JSON.parse(b.worker.health):null,now=at??Date.now()
   const consent=host.piSessionId===b.agent.id&&host.sessionId===b.agent.sessionId?await delegationView(tx,b,await grant(tx,row.id),now):unapproved()
   return {managed:true as const,workerId:b.worker.id,workerRevision:b.worker.revision,managerVersion:health?.version??null,runtimeImage:health?.runtimeImage??null,rolloutSupported:health?.capabilities?.includes('managed-runtime-rollout-v1')===true,...consent}
  })},
  get(owner:string,id:string,at?:number){return db.transaction(async tx=>{await lockPostgresOwner(tx,owner);return view(tx,owner,id,at??Date.now())})},
  update(owner:string,id:string,raw:unknown,at?:number){
   const input=options.parseGrant(raw)
   return db.transaction(async tx=>{
    await lockPostgresOwner(tx,owner);const now=at??Date.now(),b=await owned(tx,owner,id),a=b.agent,previous=await grant(tx,id)
    if(input.expectedOwnerSubject!==owner)return fail(409,'runtime_control_owner_changed')
    if(input.expectedRevision!==(previous?.revision??0))return fail(409,'runtime_control_revision_conflict')
    if(input.enabled){
     if(input.expectedAgentRevision!==a.revision||input.expectedWorkerId!==a.workerId||input.expectedConnectionId!==a.connectionId)return fail(409,'runtime_control_agent_changed')
     if(!await bindingValid(tx,b))return fail(409,'runtime_control_agent_unavailable')
     if(!managerReady(b,now))return fail(409,'runtime_rollout_manager_upgrade_required')
    }
    if(!previous&&!input.enabled)return view(tx,owner,id,now)
    const revision=(previous?.revision??0)+1,expiresAt=input.enabled?now+input.expiresInSeconds*1000:previous!.expiresAt
    if(!Number.isSafeInteger(revision)||!Number.isSafeInteger(expiresAt))return fail(409,'runtime_control_revision_conflict')
    const value={agentId:id,ownerSubject:owner,workerId:input.enabled?a.workerId:previous!.workerId,connectionId:input.enabled?a.connectionId!:previous!.connectionId,revision,enabled:input.enabled?1:0,expiresAt,updatedAt:now}
    await tx.insert(grants).values(value).onConflictDoUpdate({target:grants.agentId,set:value})
    await audit(tx,b,revision,input.enabled?'approved':'revoked',now,null,value.workerId)
    if(!input.enabled){
     const pending=await tx.select({id:jobs.id}).from(jobs).innerJoin(requests,eq(requests.rolloutId,jobs.id)).where(and(eq(requests.agentId,id),eq(jobs.ownerSubject,owner),eq(jobs.phase,'preflight')))
     for(const row of pending){await options.rollouts.cancelInTransaction(tx,owner,row.id,now);await audit(tx,b,revision,'pending_cancelled',now,row.id)}
    }
    return view(tx,owner,id,now)
   })
  },
  async delegation(auth:RuntimeControlAuthority,at?:number){
   try{return await delegated(auth,at,delegationView)}catch(error){if(!(error instanceof RuntimeControlError)&&!(error instanceof WorkerError)&&!(error instanceof TerminalPairingError)&&!(error instanceof RelayError))throw error;return unapproved()}
  },
  requestRollout(auth:RuntimeControlAuthority,raw:unknown,at?:number){return delegated(auth,at,async(tx,b,g,now)=>{
   const a=b.agent,input=options.parseRollout(raw)
   const [existing]=await tx.select({id:jobs.id,agentId:requests.agentId}).from(jobs).leftJoin(requests,eq(requests.rolloutId,jobs.id)).where(and(eq(jobs.ownerSubject,a.ownerSubject),eq(jobs.requestId,input.requestId)))
   if(existing&&existing.agentId!==a.id)return fail(409,'runtime_control_request_conflict')
   const job=await options.rollouts.requestInTransaction(tx,a.ownerSubject,a.workerId,input,now)
   if(!existing){
    await tx.insert(requests).values({rolloutId:job.id,agentId:a.id,grantRevision:g.revision,createdAt:now})
    await audit(tx,b,g.revision,'rollout_requested',now,job.id)
   }
   return job
  })},
  rollout(auth:RuntimeControlAuthority,id:string,at?:number){return delegated(auth,at,async(tx,b)=>{
   const [link]=await tx.select({id:requests.rolloutId}).from(requests).where(and(eq(requests.rolloutId,id),eq(requests.agentId,b.agent.id)))
   if(!link)return fail(404,'runtime_rollout_not_found')
   const job=await options.rollouts.getInTransaction(tx,b.agent.ownerSubject,id)
   if(job.workerId!==b.agent.workerId)return fail(404,'runtime_rollout_not_found')
   return job
  })},
 }
}
