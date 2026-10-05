import {createHash,randomBytes,randomUUID} from 'node:crypto'
import {and,asc,count,desc,eq,getTableColumns,sql} from 'drizzle-orm'
import type {RuePostgresDatabase} from './client.js'
import {lockPostgresOwner as ownerLock} from './owner-lock.js'
import {workers,workerAudit,projectBindings} from './schema.js'
import {clearPostgresProviderKeyGrants} from './provider-keys.js'
type Tx=Parameters<Parameters<RuePostgresDatabase['transaction']>[0]>[0]
type Worker=typeof workers.$inferSelect&{managedAgentCount:number}
export const WORKER_LEASE_MS=60_000
import {WorkerError as PostgresWorkerError} from '../worker-types.js'
export {PostgresWorkerError}
const fail=(status:400|401|404|409|429,code:string):never=>{throw new PostgresWorkerError(status,code)}
const hash=(secret:string)=>createHash('sha256').update(secret).digest('hex')
const secret=()=>`rue_worker_${randomBytes(32).toString('base64url')}`
const ownerRequired=(owner:string)=>{if(typeof owner!=='string'||!owner.length||owner.length>512)fail(400,'worker_owner_required')}
const uuid=(value:string)=>{if(typeof value!=='string'||value.length!==36||!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value))fail(400,'worker_id_invalid')}
const time=(now:number)=>{if(!Number.isSafeInteger(now)||now<0||now>Number.MAX_SAFE_INTEGER-WORKER_LEASE_MS)fail(400,'worker_time_invalid')}
const increment=(value:number)=>{if(!Number.isSafeInteger(value)||value<0||value>=Number.MAX_SAFE_INTEGER)fail(409,'worker_counter_exhausted');return value+1}
const projection={...getTableColumns(workers),managedAgentCount:sql<number>`(SELECT count(*)::int FROM managed_agents a WHERE a.worker_id=workers.id AND a.owner_subject=workers.owner_subject AND a.desired<>'destroyed')`}
async function row(db:Pick<RuePostgresDatabase,'select'>,id:string,lock=false){
 const query=db.select(projection).from(workers).where(eq(workers.id,id)).limit(1)
 const [value]=lock?await query.for('update'):await query;return value
}
async function audit(tx:Tx,w:Worker,action:string,now:number){await tx.insert(workerAudit).values({id:randomUUID(),workerId:w.id,revision:w.revision,action,createdAt:now})}
/** Owner mutations share this lock namespace with future project/provider stores.
 * Binding locks precede worker row locks; never make verification/network calls
 * while holding these transactions. Different owners do not share a lock. */
async function deadline(tx:Tx,bindingId:string|null,owner:string,now:number){
 if(!bindingId)return Infinity
 const [binding]=await tx.select().from(projectBindings).where(and(eq(projectBindings.id,bindingId),eq(projectBindings.ownerSubject,owner))).for('share')
 if(!binding||binding.revokedAt!==null||!binding.encryptedKey||binding.verifiedAt>now)return 0
 return Math.min(binding.authorizedUntil,binding.expiresAt,binding.verifiedAt+45000)
}
async function credential(tx:Tx,id:string,token:string,lock=false){
 if(typeof token!=='string'||token.length!==54||!/^rue_worker_[A-Za-z0-9_-]{43}$/.test(token))return fail(401,'invalid_worker_credential')
 const w=await row(tx,id,lock)
 if(!w||w.revokedAt!==null||w.tokenHash!==hash(token))return fail(401,'invalid_worker_credential')
 return w
}
function validate(w:Worker,instance:string,generation:number,now:number){
 if(w.instanceId!==instance||w.generation!==generation||!w.leaseExpiresAt||w.leaseExpiresAt<=now||w.lastSeenAt===null||now<w.lastSeenAt)fail(409,'worker_session_fenced')
}
/** parseHealth must be the API's strict worker-health validator, not a pass-through.
 * Raw storage rows/hashes stay internal; all account results use publicWorker. */
export function createPostgresWorkerRepository<H extends {acceptingWork:boolean;dockerAvailable:boolean}>(db:RuePostgresDatabase,parseHealth:(input:unknown)=>H){
 if(typeof parseHealth!=='function')throw Error('worker_health_validator_required')
 function publicWorker(w:Worker,now:number){return {id:w.id,...(w.projectBindingId?{keyAuthorityId:w.projectBindingId}:{}),ownerSubject:w.ownerSubject,name:w.name,managedAgentCount:w.managedAgentCount,desired:w.desired as 'active'|'draining',revision:w.revision,generation:w.generation,createdAt:w.createdAt,serverNow:now,lastSeenAt:w.lastSeenAt,leaseExpiresAt:w.leaseExpiresAt,status:w.revokedAt!==null?'revoked' as const:w.lastSeenAt===null?'unconfirmed' as const:(w.leaseExpiresAt??0)<=now||now<w.lastSeenAt?'offline' as const:'online' as const,health:w.health?parseHealth(JSON.parse(w.health)):null}}
 const lease=(w:Worker,now:number)=>({protocol:1 as const,runtimeReleaseVersion:1 as const,agentUpgradeVersion:1 as const,resourceHealthVersion:1 as const,generation:w.generation,serverNow:now,expiresAt:w.leaseExpiresAt!,worker:publicWorker(w,now)})
 async function withCredential<T>(id:string,token:string,now:number|undefined,run:(tx:Tx,w:Worker,until:number,acceptedAt:number)=>Promise<T>){
  uuid(id);time(now??Date.now())
  return db.transaction(async tx=>{
   const first=await credential(tx,id,token);await ownerLock(tx,first.ownerSubject)
   const checkedAt=now??Date.now(),until=await deadline(tx,first.projectBindingId,first.ownerSubject,checkedAt)
   const w=await credential(tx,id,token,true)
   const acceptedAt=now??Date.now();time(acceptedAt)
   if(acceptedAt<checkedAt)return fail(409,'worker_session_fenced')
   if(until<=acceptedAt)return fail(401,'worker_project_fenced')
   // Ownership and enrollment bindings are immutable through this repository.
   if(w.ownerSubject!==first.ownerSubject||w.projectBindingId!==first.projectBindingId)return fail(409,'worker_session_fenced')
   const result=await run(tx,w,until,acceptedAt),completedAt=now??Date.now()
   if(completedAt<acceptedAt)return fail(409,'worker_session_fenced')
   if(until<=completedAt)return fail(401,'worker_project_fenced')
   return result
  })
 }
 return {
  async list(owner:string,now=Date.now()){ownerRequired(owner);time(now);return (await db.select(projection).from(workers).where(eq(workers.ownerSubject,owner)).orderBy(desc(workers.createdAt),asc(workers.id))).map(w=>publicWorker(w,now))},
  async create(owner:string,name:string,requestId:string,suppliedNow?:number,bindingId?:string){
   ownerRequired(owner);uuid(requestId);time(suppliedNow??Date.now());if(bindingId!==undefined)uuid(bindingId)
   if(typeof name!=='string'||!name.trim()||name.length>60||/[\x00-\x1f\x7f]/.test(name))return fail(400,'worker_name_invalid')
   return db.transaction(async tx=>{
    await ownerLock(tx,owner)
    const until=await deadline(tx,bindingId??null,owner,suppliedNow??Date.now()),now=suppliedNow??Date.now()
    if(until<=now)return fail(401,'worker_project_fenced')
    const [existing]=await tx.select(projection).from(workers).where(and(eq(workers.ownerSubject,owner),eq(workers.enrollmentRequestId,requestId)))
    if(existing){if(existing.name!==name||(existing.projectBindingId??undefined)!==bindingId)return fail(409,'worker_request_conflict');return {worker:publicWorker(existing,now)}}
    const [total]=await tx.select({n:count()}).from(workers).where(eq(workers.ownerSubject,owner));if(total!.n>=100)return fail(429,'worker_limit')
    const token=secret(),id=randomUUID()
    await tx.insert(workers).values({id,ownerSubject:owner,name,tokenHash:hash(token),enrollmentRequestId:requestId,createdAt:now,projectBindingId:bindingId??null})
    const w=(await row(tx,id))!;await audit(tx,w,'enroll',now);return {worker:publicWorker(w,now),secret:token}
   })
  },
  async change(owner:string,id:string,action:'drain'|'activate'|'rotate'|'revoke',revision:number,now=Date.now()){
   ownerRequired(owner);uuid(id);time(now)
   if(!['drain','activate','rotate','revoke'].includes(action)||!Number.isSafeInteger(revision)||revision<0)return fail(400,'worker_change_invalid')
   return db.transaction(async tx=>{
    await ownerLock(tx,owner);const w=await row(tx,id,true)
    if(!w||w.ownerSubject!==owner)return fail(404,'worker_not_found')
    if(w.revision!==revision||w.revokedAt!==null)return fail(409,'worker_revision_conflict')
    const token=action==='rotate'?secret():undefined,nextRevision=increment(w.revision)
    if(action==='rotate'||action==='revoke')await tx.update(workers).set({tokenHash:token?hash(token):w.tokenHash,revokedAt:action==='revoke'?now:null,instanceId:null,leaseExpiresAt:null,health:null,generation:increment(w.generation),revision:nextRevision}).where(eq(workers.id,id))
    else await tx.update(workers).set({desired:action==='drain'?'draining':'active',revision:nextRevision}).where(eq(workers.id,id))
    if(action==='revoke')await clearPostgresProviderKeyGrants(tx,owner,{type:'worker',id},now)
    const next=(await row(tx,id))!;await audit(tx,next,action,now);return {worker:publicWorker(next,now),...(token?{secret:token}:{})}
   })
  },
  async projectBinding(id:string,token:string){uuid(id);return db.transaction(async tx=>(await credential(tx,id,token)).projectBindingId)},
  async connect(id:string,token:string,instance:string,now?:number){
   uuid(instance)
   return withCredential(id,token,now,async(tx,w,until,now)=>{
    const live=(w.leaseExpiresAt??0)>now&&w.lastSeenAt!==null&&now>=w.lastSeenAt
    if(live&&w.instanceId!==instance)return fail(409,'worker_already_connected')
    const generation=live&&w.instanceId===instance?w.generation:increment(w.generation)
    await tx.update(workers).set({instanceId:instance,generation,lastSeenAt:now,leaseExpiresAt:Math.min(now+WORKER_LEASE_MS,until),health:null}).where(eq(workers.id,id))
    return lease((await row(tx,id))!,now)
   })
  },
  /** Mutations must use this callback, not validate() followed by a separate transaction. */
  async withAuthority<T>(id:string,token:string,instance:string,generation:number,run:(tx:Tx,worker:ReturnType<typeof publicWorker>)=>Promise<T>,now?:number){
   uuid(instance);return withCredential(id,token,now,async(tx,w,_until,at)=>{validate(w,instance,generation,at);const result=await run(tx,publicWorker(w,at));validate(w,instance,generation,now??Date.now());return result})
  },
  async validate(id:string,token:string,instance:string,generation:number,now?:number){
   uuid(instance);return withCredential(id,token,now,async(_tx,w,_until,now)=>{validate(w,instance,generation,now);return publicWorker(w,now)})
  },
  async heartbeat(id:string,token:string,instance:string,generation:number,input:unknown,now?:number){
   uuid(instance);const health=parseHealth(input)
   return withCredential(id,token,now,async(tx,w,until,now)=>{
    validate(w,instance,generation,now)
    const safe={...health,acceptingWork:health.acceptingWork&&w.desired==='active'&&health.dockerAvailable}
    await tx.update(workers).set({lastSeenAt:now,leaseExpiresAt:Math.min(now+WORKER_LEASE_MS,until),health:JSON.stringify(safe)}).where(eq(workers.id,id))
    return lease((await row(tx,id))!,now)
   })
  },
 }
}
