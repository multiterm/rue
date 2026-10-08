import {createHash,randomBytes,randomUUID} from 'node:crypto'
import {and,asc,desc,eq,gt,inArray,isNotNull,isNull,notInArray,sql} from 'drizzle-orm'
import type {RuePostgresDatabase} from './client.js'
import type {createPostgresMcpRepository} from './mcp.js'
import {WorkerError,type WorkerAuthority} from '../worker-types.js'
import type {CredentialCodec} from './projects.js'
import type {createPostgresWorkerRepository} from './workers.js'
import {postgresManagedBusy} from './managed-authority.js'
import {lockPostgresOwner} from './owner-lock.js'
import {clearPostgresProviderKeyGrants} from './provider-keys.js'
import {managedAgents as agents,managedOperations as operations,workers,projectBindings,sessions,terminalConnections as hosts,runtimeRollouts} from './schema.js'
type Tx=Parameters<Parameters<RuePostgresDatabase['transaction']>[0]>[0]
type Agent=typeof agents.$inferSelect
type Operation=typeof operations.$inferSelect
export interface ManagedConfiguration {provider:string;model:string;mcp?:string[];filesystem?:{directories:readonly unknown[]}}
export interface ManagedCreate<C extends ManagedConfiguration> {requestId:string;workerId:string;name:string;acknowledgeExecution:true;acknowledgeFilesystem?:true;config:C}
export interface ManagedChange<C extends ManagedConfiguration> {requestId:string;expectedRevision:number;action:'stop'|'resume'|'reload'|'destroy'|'purge'|'configure'|'upgrade';config?:C;acknowledgeExecution?:true;acknowledgeFilesystem?:true;acknowledgePurge?:true;image?:string;expectedImage?:string;piVersion?:string}
export interface ManagedReport {revision:number;boot:number;state:'starting'|'running'|'stopped'|'destroyed'|'purged'|'failed';error:'capacity_unavailable'|'mount_unavailable'|'runtime_unavailable'|'runtime_failed'|'ownership_conflict'|'authority_lost'|null}
const fail=(status:400|401|404|409|429,code:string):never=>{throw new WorkerError(status,code)}
const increment=(revision:number)=>{if(!Number.isSafeInteger(revision)||revision>=Number.MAX_SAFE_INTEGER)return fail(409,'managed_counter_exhausted');return revision+1}
const publicOperation=(o:Operation)=>({id:o.id,agentId:o.agentId,revision:o.revision,action:o.action,status:o.status,createdAt:o.createdAt,completedAt:o.completedAt})
/** Account lifecycle and leased worker operations. MCP revocation calls
 * changeInTransaction so stopping, grant fencing, profile detachment and secret
 * deletion share one transaction. External runtime work stays outside SQL. */
export function createPostgresManagedAgentRepository<C extends ManagedConfiguration,S extends {piVersion?:string|null}&Record<string,unknown>={piVersion?:string|null}&Record<string,unknown>>(db:RuePostgresDatabase,options:{
 parseCreate:(raw:unknown)=>ManagedCreate<C>
 parseChange:(raw:unknown)=>ManagedChange<C>
 parseReport:(raw:unknown)=>ManagedReport
 codec:CredentialCodec
 worker:Pick<ReturnType<typeof createPostgresWorkerRepository>,'withAuthority'>
 runtimeStatus:(health:string|null)=>S|null
 filesystemCapability:(config:C)=>'managed-filesystem-v1'|'managed-filesystem-v2'|undefined
 mcp:Pick<ReturnType<typeof createPostgresMcpRepository>,'resolveInTransaction'>
}){
 const publicAgent=(a:Agent)=>({runtimeImage:a.runtimeImage,previousRuntimeImage:a.previousRuntimeImage,runtimeUpdateState:a.runtimeUpdateState,runtimeUpdateVersion:a.runtimeUpdateVersion,id:a.id,workerId:a.workerId,sessionId:a.sessionId,connectionId:a.connectionId,name:a.name,desired:a.desired as 'running'|'stopped'|'destroyed',purgeRequested:a.purgeRequestedAt!==null,purgedAt:a.purgedAt,revision:a.revision,createdAt:a.createdAt,config:JSON.parse(a.config) as C,observed:a.observed,observedRevision:a.observedRevision,observedGeneration:a.observedGeneration,observedAt:a.observedAt,error:a.error})
 async function owned(tx:Pick<RuePostgresDatabase,'select'>,owner:string,id:string){const [a]=await tx.select().from(agents).where(and(eq(agents.id,id),eq(agents.ownerSubject,owner)));if(!a)return fail(404,'managed_agent_not_found');return a}
 async function worker(tx:Tx,owner:string,id:string){const [w]=await tx.select().from(workers).where(and(eq(workers.id,id),eq(workers.ownerSubject,owner),isNull(workers.revokedAt)));if(!w)return fail(404,'worker_not_found');return w}
 async function requireProject(tx:Tx,owner:string,bindingId:string|null,at?:number){
  if(!bindingId)return Infinity
  const [b]=await tx.select().from(projectBindings).where(and(eq(projectBindings.id,bindingId),eq(projectBindings.ownerSubject,owner))).for('share'),now=at??Date.now()
  if(!b||b.revokedAt!==null||!b.encryptedKey||b.verifiedAt>now||Math.min(b.authorizedUntil,b.expiresAt,b.verifiedAt+45000)<=now)return fail(401,'worker_project_fenced')
  return Math.min(b.authorizedUntil,b.expiresAt,b.verifiedAt+45000)
 }
 async function capabilities(tx:Tx,owner:string,workerId:string,config:C){
  const w=await worker(tx,owner,workerId),health=w.health?JSON.parse(w.health):null
  const provider=['openai','anthropic','google','openrouter'].includes(config.provider)?undefined:config.provider==='openai-codex'?'managed-codex-v1':'managed-dynamic-providers-v1'
  if(provider&&!health?.capabilities?.includes(provider))return fail(409,config.provider==='openai-codex'?'managed_codex_not_supported':'managed_provider_protocol_not_supported')
  const filesystem=options.filesystemCapability(config)
  if(filesystem&&!health?.capabilities?.includes(filesystem))return fail(409,'managed_filesystem_not_supported')
  if(config.mcp?.length){if(!health?.capabilities?.includes('managed-mcp-v1'))return fail(409,'managed_mcp_not_supported');await options.mcp.resolveInTransaction(tx,owner,config.mcp)}
 }
 async function retry(tx:Tx,owner:string,requestId:string,intent:string){
  const [o]=await tx.select().from(operations).where(and(eq(operations.ownerSubject,owner),eq(operations.requestId,requestId)))
  if(!o)return
  if(o.intent!==intent)return fail(409,'managed_request_conflict')
  return {agent:publicAgent(await owned(tx,owner,o.agentId)),operation:publicOperation(o)}
 }
 async function operation(tx:Tx,a:Agent,requestId:string,intent:string,action:string,now:number){
  await tx.update(operations).set({status:'superseded',completedAt:now}).where(and(eq(operations.agentId,a.id),eq(operations.status,'pending')))
  const [o]=await tx.insert(operations).values({id:randomUUID(),ownerSubject:a.ownerSubject,requestId,intent,agentId:a.id,revision:a.revision,action,createdAt:now}).returning()
  return {agent:publicAgent(a),operation:publicOperation(o!)}
 }
 async function changeInTransaction(tx:Tx,owner:string,id:string,raw:unknown,at?:number){
  const input=options.parseChange(raw),intent=JSON.stringify([id,input]);await lockPostgresOwner(tx,owner)
  const previous=await retry(tx,owner,input.requestId,intent);if(previous)return previous
  const a=await owned(tx,owner,id),now=at??Date.now()
  if(a.revision!==input.expectedRevision)return fail(409,'managed_revision_conflict')
  const revision=increment(a.revision)
  if(['updating','rolling_back'].includes(a.runtimeUpdateState??'')&&!['stop','destroy'].includes(input.action))return fail(409,'managed_upgrade_in_progress')
  if(input.action==='purge'){
   if(input.acknowledgePurge!==true||a.desired!=='destroyed'||a.purgeRequestedAt!==null)return fail(409,'managed_purge_requires_destroy_and_consent')
   await tx.update(agents).set({purgeRequestedAt:now,revision,observed:'pending',error:null}).where(eq(agents.id,id))
   return operation(tx,await owned(tx,owner,id),input.requestId,intent,'purge',now)
  }
  if(a.desired==='destroyed')return fail(409,'managed_revision_conflict')
  if(input.action==='reload'&&a.desired!=='running')return fail(409,'managed_reload_requires_running')
  if(['resume','reload','configure','upgrade'].includes(input.action)){const w=await worker(tx,owner,a.workerId);await requireProject(tx,owner,w.projectBindingId,at)}
  if(input.action==='upgrade'){
   if(a.desired!=='running')return fail(409,'managed_upgrade_requires_running')
   if(!a.sessionId||!a.connectionId)return fail(409,'managed_upgrade_connection_unavailable')
   const [host]=await tx.select({id:hosts.id}).from(hosts).where(and(eq(hosts.id,a.connectionId),eq(hosts.ownerSubject,owner),isNull(hosts.revokedAt)));if(!host)return fail(409,'managed_upgrade_connection_unavailable')
   const w=await worker(tx,owner,a.workerId),health=w.health?JSON.parse(w.health):null,current=a.runtimeImage??health?.runtimeImage
   if(w.desired!=='active'||!w.leaseExpiresAt||w.leaseExpiresAt<=(at??Date.now())||!health?.capabilities?.includes('managed-agent-upgrade-v1'))return fail(409,'managed_upgrade_not_supported')
   if(current!==input.expectedImage||input.image===current||!health.runtimeReleases?.some((r:{image:string;piVersion:string})=>r.image===input.image&&r.piVersion===input.piVersion))return fail(409,'managed_upgrade_candidate_changed')
   const [rollout]=await tx.select({id:runtimeRollouts.id}).from(runtimeRollouts).where(and(eq(runtimeRollouts.workerId,a.workerId),notInArray(runtimeRollouts.phase,['succeeded','failed']))).limit(1);if(rollout)return fail(409,'managed_host_rollout_active')
   await tx.update(agents).set({runtimeImage:input.image,previousRuntimeImage:current,runtimeUpdateState:'updating',runtimeUpdateVersion:input.piVersion,runtimeUpdateBootAt:null}).where(eq(agents.id,id))
  }
  if(input.action==='configure'){
   const config=input.config!;await capabilities(tx,owner,a.workerId,config)
   if(JSON.stringify(config.filesystem??null)!==JSON.stringify(JSON.parse(a.config).filesystem??null)&&input.acknowledgeFilesystem!==true)return fail(409,'managed_filesystem_consent_required')
   await tx.update(agents).set({config:JSON.stringify(config)}).where(eq(agents.id,id))
   if(a.sessionId)await tx.update(sessions).set({provider:config.provider,model:config.model,updatedAt:now}).where(and(eq(sessions.id,a.sessionId),eq(sessions.ownerSubject,owner)))
  }
  const desired=input.action==='stop'||input.action==='configure'?'stopped':input.action==='destroy'?'destroyed':'running'
  await tx.update(agents).set({desired,revision,observed:'pending',error:null}).where(eq(agents.id,id))
  if(!['reload','upgrade'].includes(input.action)){
   if(a.runtimeUpdateState==='updating')await tx.update(agents).set({runtimeImage:a.previousRuntimeImage,previousRuntimeImage:a.runtimeImage,runtimeUpdateState:'cancelled'}).where(eq(agents.id,id))
   else if(a.runtimeUpdateState==='rolling_back')await tx.update(agents).set({runtimeUpdateState:'cancelled'}).where(eq(agents.id,id))
   await tx.update(agents).set({grantRevision:null,grantGeneration:null,encryptedGrant:null}).where(eq(agents.id,id))
   if(a.connectionId)await tx.update(hosts).set({leaseExpiresAt:now}).where(and(eq(hosts.id,a.connectionId),eq(hosts.ownerSubject,owner)))
  }
  if(desired==='destroyed'&&a.connectionId){await tx.update(hosts).set({revokedAt:now,remoteEnabled:0}).where(and(eq(hosts.id,a.connectionId),eq(hosts.ownerSubject,owner)));await clearPostgresProviderKeyGrants(tx,owner,{type:'terminal',id:a.connectionId},now)}
  return operation(tx,await owned(tx,owner,id),input.requestId,intent,input.action,now)
 }
 async function runtimeStatus(tx:Tx,owner:string,id:string|null){
  if(!id)return null
  const [h]=await tx.select().from(hosts).where(and(eq(hosts.id,id),eq(hosts.ownerSubject,owner)));if(!h)return null
  try{const report=options.runtimeStatus(h.relayHealth);return report?{report,observedAt:h.lastSeenAt,leaseExpiresAt:h.leaseExpiresAt}:null}catch{return null}
 }
 return {
  changeInTransaction,
  snapshot(auth:WorkerAuthority,at?:number){return options.worker.withAuthority(auth.id,auth.secret,auth.instance,auth.generation,async(tx,w)=>{
   const now=at??Date.now(),expiresAt=Math.min(w.leaseExpiresAt!,await requireProject(tx,w.ownerSubject,w.keyAuthorityId??null,at))
   await tx.update(hosts).set({expiresAt:now+300000}).where(and(eq(hosts.ownerSubject,w.ownerSubject),isNull(hosts.revokedAt),inArray(hosts.id,tx.select({id:agents.connectionId}).from(agents).where(and(eq(agents.workerId,w.id),eq(agents.ownerSubject,w.ownerSubject),eq(agents.desired,'running'),eq(agents.grantGeneration,w.generation),isNotNull(agents.grantRevision))))))
   const rows=await tx.select().from(agents).where(and(eq(agents.workerId,w.id),eq(agents.ownerSubject,w.ownerSubject),isNull(agents.purgedAt))).orderBy(agents.createdAt,agents.id),result=[]
   for(const a of rows){const [connected]=a.connectionId?await tx.select({id:hosts.id}).from(hosts).where(and(eq(hosts.id,a.connectionId),eq(hosts.ownerSubject,w.ownerSubject),gt(hosts.leaseExpiresAt,now),isNull(hosts.revokedAt))):[];result.push({...publicAgent(a),runtimeStatus:await runtimeStatus(tx,w.ownerSubject,a.connectionId),connected:Boolean(connected),busy:await postgresManagedBusy(tx,a.connectionId,now),grantRevision:a.grantRevision,grantGeneration:a.grantGeneration,grantBoot:a.grantBoot})}
   return {generation:w.generation,serverNow:now,expiresAt,desired:w.desired,agents:result}
  },at)},
  async grant(auth:WorkerAuthority,id:string,revision:number,at?:number,boot=1){
   if(!Number.isSafeInteger(boot)||boot<1)return fail(409,'managed_boot_invalid')
   return options.worker.withAuthority(auth.id,auth.secret,auth.instance,auth.generation,async(tx,w)=>{
    const a=await owned(tx,w.ownerSubject,id),now=at??Date.now()
    if(a.workerId!==w.id)return fail(404,'managed_agent_not_found')
    if(a.desired!=='running'||a.revision!==revision||!a.sessionId||!a.connectionId||w.desired!=='active')return fail(409,'managed_grant_fenced')
    const stored=await worker(tx,w.ownerSubject,w.id),health=stored.health?JSON.parse(stored.health):null,expiresAt=Math.min(w.leaseExpiresAt!,await requireProject(tx,w.ownerSubject,stored.projectBindingId,at))
    if(a.runtimeImage&&!health?.capabilities?.includes('managed-agent-upgrade-v1'))return fail(409,'managed_upgrade_not_supported')
    await capabilities(tx,w.ownerSubject,w.id,JSON.parse(a.config))
    const [host]=await tx.select().from(hosts).where(and(eq(hosts.id,a.connectionId),eq(hosts.ownerSubject,w.ownerSubject),eq(hosts.sessionId,a.sessionId)));if(!host||host.revokedAt!==null)return fail(409,'managed_grant_revoked')
    const sameEpoch=a.grantRevision===revision&&a.grantGeneration===w.generation,previousBoot=sameEpoch?(a.grantBoot??1):0
    if(boot<previousBoot||boot>previousBoot+1)return fail(409,'managed_boot_fenced')
    const replacing=!sameEpoch||boot!==previousBoot
    if(a.grantRevision!==null&&replacing&&a.grantGeneration===w.generation&&await postgresManagedBusy(tx,a.connectionId,now))return fail(409,'managed_reload_pending')
    let token:string
    if(a.encryptedGrant&&!replacing)token=options.codec.decrypt([a.ownerSubject,'managed-agent',id],a.encryptedGrant)
    else{
     token=`rue_terminal_${randomBytes(32).toString('base64url')}`
     await tx.update(agents).set({grantRevision:revision,grantGeneration:w.generation,grantBoot:boot,encryptedGrant:options.codec.encrypt([a.ownerSubject,'managed-agent',id],token),...(['updating','rolling_back'].includes(a.runtimeUpdateState??'')?{runtimeUpdateBootAt:a.runtimeUpdateBootAt??now}:{})}).where(eq(agents.id,id))
     await tx.update(hosts).set({tokenHash:createHash('sha256').update(token).digest('hex'),instanceId:null,leaseExpiresAt:null}).where(eq(hosts.id,a.connectionId))
    }
    await tx.update(hosts).set({expiresAt:now+300000}).where(eq(hosts.id,a.connectionId))
    const mcp=await options.mcp.resolveInTransaction(tx,a.ownerSubject,(JSON.parse(a.config) as C).mcp)
    return {agent:publicAgent(a),...(mcp.length?{mcp}:{}),token,id:a.connectionId,sessionId:a.sessionId,piSessionId:a.id,ownerSubject:a.ownerSubject,generation:w.generation,boot,serverNow:now,expiresAt}
   },at)
  },
  report(auth:WorkerAuthority,id:string,raw:unknown,at?:number){
   const input={...options.parseReport(raw)}
   return options.worker.withAuthority(auth.id,auth.secret,auth.instance,auth.generation,async(tx,w)=>{
    const a=await owned(tx,w.ownerSubject,id),now=at??Date.now()
    if(a.workerId!==w.id)return fail(404,'managed_agent_not_found')
    if(a.revision!==input.revision)return fail(409,'managed_revision_conflict')
    if(['starting','running','failed'].includes(input.state)&&a.grantGeneration===w.generation&&a.grantRevision===a.revision&&input.boot!==(a.grantBoot??1))return fail(409,'managed_boot_fenced')
    const purge=input.state==='purged'
    if(purge&&(a.desired!=='destroyed'||a.purgeRequestedAt===null||input.error!==null))return fail(409,'managed_purge_not_authorized')
    let success=input.error===null&&(purge||(input.state===a.desired&&a.purgeRequestedAt===null))
    if(purge){if(a.sessionId)await tx.delete(sessions).where(and(eq(sessions.id,a.sessionId),eq(sessions.ownerSubject,a.ownerSubject)));await tx.update(agents).set({purgedAt:a.purgedAt??now}).where(eq(agents.id,id))}
    if((input.state==='running'&&(a.desired!=='running'||a.grantRevision!==a.revision||a.grantGeneration!==w.generation))||(input.state==='destroyed'&&a.desired!=='destroyed'))return fail(409,'managed_report_fenced')
    if(['updating','rolling_back'].includes(a.runtimeUpdateState??'')){
     const status=await runtimeStatus(tx,a.ownerSubject,a.connectionId),version=status?.observedAt&&status.leaseExpiresAt&&status.leaseExpiresAt>now&&a.runtimeUpdateBootAt&&status.observedAt>=a.runtimeUpdateBootAt?status.report.piVersion:undefined
     const [host]=a.connectionId&&a.runtimeUpdateBootAt?await tx.select({id:hosts.id}).from(hosts).where(and(eq(hosts.id,a.connectionId),eq(hosts.ownerSubject,a.ownerSubject),gt(hosts.leaseExpiresAt,now),sql`${hosts.lastSeenAt}>=${a.runtimeUpdateBootAt}`,isNull(hosts.revokedAt))):[]
     const verified=input.error===null&&input.state==='running'&&Boolean(host)&&(a.runtimeUpdateState==='rolling_back'||version===a.runtimeUpdateVersion)
     const failed=input.error!==null||input.state==='failed'||(input.state==='running'&&!verified&&(Boolean(version)||Boolean(a.runtimeUpdateBootAt&&now-a.runtimeUpdateBootAt>90000)))
     if(failed){
      await tx.update(operations).set({status:'superseded',completedAt:now}).where(and(eq(operations.agentId,id),eq(operations.action,'upgrade'),eq(operations.status,'pending')))
      if(a.runtimeUpdateState==='updating')await tx.update(agents).set({runtimeImage:a.previousRuntimeImage,previousRuntimeImage:a.runtimeImage,runtimeUpdateState:'rolling_back',runtimeUpdateBootAt:null,revision:increment(a.revision),observed:'pending',error:null}).where(eq(agents.id,id))
      else{await tx.update(agents).set({runtimeUpdateState:'failed',desired:'stopped',revision:increment(a.revision),grantRevision:null,grantGeneration:null,encryptedGrant:null,observed:'failed',error:'runtime_failed'}).where(eq(agents.id,id));if(a.connectionId)await tx.update(hosts).set({leaseExpiresAt:now}).where(eq(hosts.id,a.connectionId))}
      return publicAgent(await owned(tx,a.ownerSubject,id))
     }
     if(verified)await tx.update(agents).set({runtimeUpdateState:a.runtimeUpdateState==='updating'?'updated':'rolled_back',previousRuntimeImage:null}).where(eq(agents.id,id))
     else if(input.state==='running'){input.state='starting';success=false}
    }
    if(!['updating','rolling_back'].includes(a.runtimeUpdateState??'')&&['stopped','destroyed','purged'].includes(input.state))await tx.update(agents).set({previousRuntimeImage:null}).where(eq(agents.id,id))
    await tx.update(agents).set({observed:input.state,observedRevision:input.revision,observedGeneration:w.generation,observedAt:now,error:input.error}).where(eq(agents.id,id))
    if(success)await tx.update(operations).set({status:'succeeded',completedAt:now}).where(and(eq(operations.agentId,id),eq(operations.revision,input.revision),eq(operations.status,'pending')))
    return publicAgent(await owned(tx,a.ownerSubject,id))
   },at)
  },
  async get(owner:string,id:string){return publicAgent(await owned(db,owner,id))},
  async list(owner:string){return (await db.select().from(agents).where(eq(agents.ownerSubject,owner)).orderBy(asc(agents.createdAt),asc(agents.id))).map(publicAgent)},
  async operations(owner:string,id:string){await owned(db,owner,id);return (await db.select().from(operations).where(and(eq(operations.agentId,id),eq(operations.ownerSubject,owner))).orderBy(desc(operations.createdAt),desc(operations.ordinal)).limit(100)).map(publicOperation)},
  change(owner:string,id:string,raw:unknown,at?:number){return db.transaction(tx=>changeInTransaction(tx,owner,id,raw,at))},
  create(owner:string,raw:unknown,at?:number){
   const input=options.parseCreate(raw),intent=JSON.stringify(['create',input])
   return db.transaction(async tx=>{
    await lockPostgresOwner(tx,owner);const previous=await retry(tx,owner,input.requestId,intent);if(previous)return previous
    const w=await worker(tx,owner,input.workerId);await requireProject(tx,owner,w.projectBindingId,at);await capabilities(tx,owner,input.workerId,input.config)
    if(input.config.filesystem?.directories.length&&input.acknowledgeFilesystem!==true)return fail(409,'managed_filesystem_consent_required')
    const now=at??Date.now(),id=randomUUID(),sessionId=`ses_${randomUUID()}`,connectionId=`term_${randomBytes(24).toString('base64url')}`
    await tx.insert(sessions).values({id:sessionId,ownerSubject:owner,title:input.name,agent:'pi-terminal',provider:input.config.provider,model:input.config.model,meta:{terminalConnectionId:connectionId,managedAgentId:id,workerId:input.workerId},createdAt:now,updatedAt:now})
    await tx.insert(hosts).values({id:connectionId,ownerSubject:owner,sessionId,piSessionId:id,tokenHash:createHash('sha256').update(randomBytes(32)).digest('hex'),expiresAt:now,createdAt:now,name:input.name,activatedAt:now,remoteEnabled:1})
    const [a]=await tx.insert(agents).values({id,ownerSubject:owner,workerId:input.workerId,sessionId,connectionId,name:input.name,config:JSON.stringify(input.config),desired:'running',createdAt:now}).returning()
    return operation(tx,a!,input.requestId,intent,'create',now)
   })
  },
 }
}
