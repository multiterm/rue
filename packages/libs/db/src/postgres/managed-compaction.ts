import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto'
import {and,count,desc,eq,inArray,isNull,sql} from 'drizzle-orm'
import type {RuePostgresDatabase} from './client.js'
import type {createPostgresWorkerRepository} from './workers.js'
import type {createPostgresTerminalRelayRepository} from './terminal-relay.js'
import {WorkerError,type WorkerAuthority} from '../worker-types.js'
import {lockPostgresOwner} from './owner-lock.js'
import {ManagedAuthorityExpired,postgresManagedAuthority,postgresManagedBusy,postgresCompactionHoldsRuntime} from './managed-authority.js'
import {managedAgents as agents,managedCompactions as compactions,workers,terminalConnections as hosts,terminalCommands} from './schema.js'
type Tx=Parameters<Parameters<RuePostgresDatabase['transaction']>[0]>[0]
type Agent=typeof agents.$inferSelect
type Command=typeof compactions.$inferSelect
export interface CompactRuntimeAuthority {id:string;token:string;instance:string}
export interface CompactRequest {requestId:string;expectedRevision:number;acknowledgeModelUse:true}
export const COMPACT_QUEUE_MS=300000,COMPACT_RUN_MS=120000,COMPACT_CAPABILITY='managed-compact-v1'
const digest=(value:string)=>createHash('sha256').update(value).digest()
const fail=(status:400|401|404|409|429,code:string):never=>{throw new WorkerError(status,code)}
const publicCommand=(c:Command)=>({id:c.id,agentId:c.agentId,kind:'compact' as const,revision:c.revision,status:c.status,createdAt:c.createdAt,expiresAt:c.expiresAt,startedAt:c.startedAt,completedAt:c.completedAt})
const capable=(health:string|null)=>{if(!health||!JSON.parse(health).capabilities?.includes(COMPACT_CAPABILITY))fail(409,'managed_compact_not_supported')}
/** External execution never runs inside these transactions. A committed claim is
 * single-use: loss of its nonce/reply becomes uncertain, never permission to retry. */
export function createPostgresCompactionRepository(db:RuePostgresDatabase,options:{
 parseRequest:(raw:unknown)=>CompactRequest
 worker:Pick<ReturnType<typeof createPostgresWorkerRepository>,'withAuthority'>
 relay:Pick<ReturnType<typeof createPostgresTerminalRelayRepository>,'withSocketAuthority'>
}){
 async function owned(tx:Tx,owner:string,id:string){const [a]=await tx.select().from(agents).where(and(eq(agents.id,id),eq(agents.ownerSubject,owner)));if(!a)return fail(404,'managed_agent_not_found');return a}
 async function command(tx:Tx,id:string){const [c]=await tx.select().from(compactions).where(eq(compactions.id,id));if(!c)return fail(404,'managed_compact_not_found');return c}
 async function connected(tx:Tx,a:Agent,now:number){
  if(!a.connectionId)return false
  const [h]=await tx.select().from(hosts).where(eq(hosts.id,a.connectionId))
  return Boolean(h&&h.ownerSubject===a.ownerSubject&&h.revokedAt===null&&h.remoteEnabled===1&&h.activatedAt!==null&&h.instanceId!==null&&h.relayProtocol===2&&(h.leaseExpiresAt??0)>now&&h.expiresAt>now&&h.lastSeenAt!==null&&h.lastSeenAt<=now)
 }
 async function epoch(tx:Tx,c:Command,a:Agent,now:number){
  if(a.desired!=='running'||!a.connectionId||a.grantRevision!==c.revision||a.grantGeneration!==c.generation||a.grantBoot!==c.boot)return false
  try{await postgresManagedAuthority(tx,a.connectionId,a.ownerSubject,now)}catch(error){if(error instanceof ManagedAuthorityExpired)return false;throw error}
  if(!await connected(tx,a,now))return false
  if(c.runtimeInstance){const [host]=await tx.select({id:hosts.id}).from(hosts).where(and(eq(hosts.id,a.connectionId),eq(hosts.instanceId,c.runtimeInstance)));if(!host)return false}
  return true
 }
 async function reconcile(tx:Tx,a:Agent,now:number){
  const rows=await tx.select().from(compactions).where(and(eq(compactions.agentId,a.id),inArray(compactions.status,['queued','assigned','running'])))
  for(const c of rows)if(now<c.createdAt||now>=c.expiresAt||!await epoch(tx,c,a,now)||(c.status!=='running'&&a.revision!==c.revision))await tx.update(compactions).set({status:c.status==='running'?'uncertain':'cancelled',completedAt:now}).where(eq(compactions.id,c.id))
 }
 async function promptBusy(tx:Tx,connectionId:string,statuses:string[]){const [row]=await tx.select({id:terminalCommands.id}).from(terminalCommands).where(and(eq(terminalCommands.connectionId,connectionId),inArray(terminalCommands.status,statuses))).limit(1);return Boolean(row)}
 async function runtime<T>(auth:CompactRuntimeAuthority,id:string,at:number|undefined,run:(tx:Tx,a:Agent,c:Command,now:number)=>Promise<T>){
  return options.relay.withSocketAuthority(auth.token,auth.id,auth.instance,async(tx,host)=>{
   const now=at??Date.now(),c=await command(tx,id),a=await owned(tx,host.ownerSubject,c.agentId)
   if(a.connectionId!==auth.id)return fail(404,'managed_compact_not_found')
   await reconcile(tx,a,now);return run(tx,a,await command(tx,id),now)
  },at)
 }
 return {
  request(owner:string,id:string,raw:unknown,at?:number){
   const input=options.parseRequest(raw)
   return db.transaction(async tx=>{
    await lockPostgresOwner(tx,owner);const now=at??Date.now(),a=await owned(tx,owner,id);await reconcile(tx,a,now)
    const [prior]=await tx.select().from(compactions).where(and(eq(compactions.ownerSubject,owner),eq(compactions.requestId,input.requestId)))
    if(prior){if(prior.agentId!==id||prior.revision!==input.expectedRevision)return fail(409,'managed_request_conflict');return publicCommand(prior)}
    const [w]=await tx.select().from(workers).where(and(eq(workers.id,a.workerId),eq(workers.ownerSubject,owner),isNull(workers.revokedAt)))
    if(!w)return fail(409,'managed_compact_not_ready');capable(w.health)
    if(a.revision!==input.expectedRevision)return fail(409,'managed_revision_conflict')
    if(w.desired!=='active'||a.desired!=='running'||a.grantRevision!==a.revision||!a.grantGeneration||!a.grantBoot||!a.connectionId||!await connected(tx,a,now)||a.observed!=='running'||a.observedRevision!==a.revision||a.observedGeneration!==a.grantGeneration)return fail(409,'managed_compact_not_ready')
    await postgresManagedAuthority(tx,a.connectionId,owner,now)
    if(await postgresCompactionHoldsRuntime(tx,a.connectionId))return fail(409,'managed_compact_pending_or_uncertain')
    if(await postgresManagedBusy(tx,a.connectionId,now)||await promptBusy(tx,a.connectionId,['queued','claimed','running']))return fail(409,'managed_compact_agent_busy')
    const [totals]=await tx.select({total:count(),recent:sql<number>`COUNT(*) FILTER(WHERE ${compactions.createdAt}>${now-86400000})`.mapWith(Number)}).from(compactions).where(eq(compactions.agentId,id))
    if(totals!.total>=1000||totals!.recent>=24)return fail(429,'managed_compact_limit')
    const [c]=await tx.insert(compactions).values({id:randomUUID(),ownerSubject:owner,requestId:input.requestId,agentId:id,revision:a.revision,generation:a.grantGeneration,boot:a.grantBoot,status:'queued',createdAt:now,expiresAt:now+COMPACT_QUEUE_MS}).returning()
    return publicCommand(c!)
   })
  },
  list(owner:string,id:string,at?:number){return db.transaction(async tx=>{await lockPostgresOwner(tx,owner);const a=await owned(tx,owner,id);await reconcile(tx,a,at??Date.now());return (await tx.select().from(compactions).where(eq(compactions.agentId,id)).orderBy(desc(compactions.createdAt),desc(compactions.ordinal)).limit(100)).map(publicCommand)})},
  assign(auth:WorkerAuthority,id:string,at?:number){return options.worker.withAuthority(auth.id,auth.secret,auth.instance,auth.generation,async(tx,w)=>{
   const now=at??Date.now(),c=await command(tx,id),a=await owned(tx,w.ownerSubject,c.agentId)
   if(a.workerId!==w.id)return fail(404,'managed_compact_not_found')
   await reconcile(tx,a,now);const current=await command(tx,id);if(current.status!=='queued')return publicCommand(current)
   const [stored]=await tx.select({health:workers.health}).from(workers).where(eq(workers.id,w.id));capable(stored!.health)
   if(w.desired!=='active'||!await epoch(tx,current,a,now))return fail(409,'managed_compact_not_ready')
   if(await postgresManagedBusy(tx,a.connectionId,now))return fail(409,'managed_compact_agent_busy')
   const [updated]=await tx.update(compactions).set({status:'assigned'}).where(and(eq(compactions.id,id),eq(compactions.status,'queued'))).returning();return publicCommand(updated!)
  },at)},
  claim(auth:CompactRuntimeAuthority,id:string,at?:number){return runtime(auth,id,at,async(tx,a,c,now)=>{
   if(c.status!=='assigned')return {execute:false as const,command:publicCommand(c)}
   const [w]=await tx.select({desired:workers.desired}).from(workers).where(eq(workers.id,a.workerId))
   if(w?.desired!=='active'||!await epoch(tx,c,a,now))return fail(409,'managed_compact_not_ready')
   if(await promptBusy(tx,a.connectionId!,['claimed','running']))return fail(409,'managed_compact_agent_busy')
   const nonce=randomBytes(32).toString('base64url'),deadline=now+COMPACT_RUN_MS
   const [updated]=await tx.update(compactions).set({status:'running',runtimeInstance:auth.instance,nonceHash:digest(nonce).toString('hex'),startedAt:now,expiresAt:deadline}).where(and(eq(compactions.id,id),eq(compactions.status,'assigned'))).returning()
   return {execute:true as const,command:publicCommand(updated!),nonce,serverNow:now,deadline}
  })},
  workerCommands(auth:WorkerAuthority,at?:number){return options.worker.withAuthority(auth.id,auth.secret,auth.instance,auth.generation,async(tx,w)=>{
   const now=at??Date.now(),rows=await tx.select().from(agents).where(and(eq(agents.workerId,w.id),eq(agents.ownerSubject,w.ownerSubject),isNull(agents.purgedAt))),result=[]
   for(const a of rows){await reconcile(tx,a,now);for(const c of await tx.select().from(compactions).where(and(eq(compactions.agentId,a.id),eq(compactions.status,'queued'))))result.push({...publicCommand(c),generation:c.generation,boot:c.boot})}
   return result
  },at)},
  runtimeCommands(auth:CompactRuntimeAuthority,at?:number){return options.relay.withSocketAuthority(auth.token,auth.id,auth.instance,async(tx,host)=>{
   const [a]=await tx.select().from(agents).where(and(eq(agents.connectionId,auth.id),eq(agents.ownerSubject,host.ownerSubject)))
   if(!a)return fail(404,'managed_agent_not_found');await reconcile(tx,a,at??Date.now())
   return (await tx.select().from(compactions).where(and(eq(compactions.agentId,a.id),eq(compactions.status,'assigned')))).map(publicCommand)
  },at)},
  acknowledge(auth:CompactRuntimeAuthority,id:string,nonce:string,outcome:'succeeded'|'failed',at?:number){
   if(!/^[A-Za-z0-9_-]{43}$/.test(nonce)||!['succeeded','failed'].includes(outcome))return Promise.reject(new WorkerError(409,'managed_compact_ack_invalid'))
   return runtime(auth,id,at,async(tx,a,c,now)=>{
    if(!await epoch(tx,c,a,now)||c.runtimeInstance!==auth.instance||!c.nonceHash||!/^[a-f0-9]{64}$/.test(c.nonceHash)||!timingSafeEqual(digest(nonce),Buffer.from(c.nonceHash,'hex')))return fail(409,'managed_compact_ack_fenced')
    if(c.status===outcome)return publicCommand(c)
    if(c.status!=='running')return fail(409,'managed_compact_ack_fenced')
    const [updated]=await tx.update(compactions).set({status:outcome,completedAt:now}).where(eq(compactions.id,id)).returning();return publicCommand(updated!)
   })
  },
 }
}
