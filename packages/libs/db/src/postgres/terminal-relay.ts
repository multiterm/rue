import {createHash,randomUUID} from 'node:crypto'
import {and,asc,count,desc,eq,inArray,sql} from 'drizzle-orm'
import type {RuePostgresDatabase} from './client.js'
import {RelayError} from '../terminal-types.js'
import {terminalConnections as hosts,terminalCommands as commands,terminalMirrors as mirrors,managedAgents,workers,messages,parts,sessions,notifications} from './schema.js'
import {authenticatePostgresTerminal} from './terminal-pairing.js'
import {postgresManagedAcceptingPrompts} from './managed-authority.js'
import {lockPostgresOwner} from './owner-lock.js'
import {appendPostgresMessage,appendPostgresPart,appendPostgresContent,checkPostgresAttachmentBudget,replacePostgresPart,type MessageContent} from './conversation-writes.js'
import {recordPostgresTaskNotification} from './notifications.js'
type Tx=Parameters<Parameters<RuePostgresDatabase['transaction']>[0]>[0]
type Host=typeof hosts.$inferSelect
type Command=typeof commands.$inferSelect
export const RELAY_LEASE_MS=60000,APPROVAL_TIMEOUT_MS=300000,LEGACY_RUN_TIMEOUT_MS=600000,MAX_REMOTE_RUN_MS=86400000
const active=['queued','claimed','running']
const fail=(code:string):never=>{throw new RelayError(code)}
const expired=(host:Host,now:number)=>host.relayProtocol===2?!host.leaseExpiresAt||now>=host.leaseExpiresAt||now<(host.lastSeenAt??0):now-(host.lastSeenAt??0)>30000
const connection=(host:Host)=>({id:host.id,ownerSubject:host.ownerSubject,sessionId:host.sessionId,piSessionId:host.piSessionId,expiresAt:host.expiresAt,activatedAt:host.activatedAt,revokedAt:host.revokedAt})
const commandView=(row:Command)=>({id:row.id,connection_id:row.connectionId,request_id:row.requestId,text:row.text,user_message_id:row.userMessageId,assistant_message_id:row.assistantMessageId,status:row.status,instance_id:row.instanceId,version:row.version,result:row.result,created_at:row.createdAt,updated_at:row.updatedAt,claimed_at:row.claimedAt,started_at:row.startedAt,lease_expires_at:row.leaseExpiresAt,queue_position:row.queuePosition,queue_restored_at:row.queueRestoredAt})
const recoverableView=(row:Command)=>({id:row.id,text:row.text,user_message_id:row.userMessageId,created_at:row.createdAt,updated_at:row.updatedAt})
const queueView=(row:Command)=>({...recoverableView(row),status:row.status})
const queueOrder=[sql`COALESCE(${commands.queuePosition},${commands.ordinal})`,asc(commands.ordinal)]
export async function validatePostgresRelay(tx:Tx,token:string,id:string,instance:string,at?:number,socketOnly=true){
 const state=await authenticatePostgresTerminal(tx,token,id,at)
 if(state.row.instanceId!==instance)return fail('computer_instance_changed')
 if(state.row.relayProtocol===2&&expired(state.row,state.now))return fail('computer_lease_expired')
 if(socketOnly&&state.row.relayProtocol!==2)return fail('relay_protocol_mismatch')
 return state
}
export interface RelayOptions {
 validateContent(content:MessageContent[]|undefined):MessageContent[]|undefined
 mergeHealth(previous:string|null,input:Record<string,unknown>):Record<string,unknown>
 catalogHash(health:string|null):string|undefined
 summaryHealth(health:string|null):unknown
 catalog(health:string|null):{piVersion:string|null;catalog:unknown;catalogHash:string|null}
}
export interface MirrorSnapshot {version:number;final:boolean;outcome?:'failed'|'interrupted';reasoning?:{id:string;chunk:number};tool?:{id:string;name:string;status:string;chunk:number}}
export function createPostgresTerminalRelayRepository(db:RuePostgresDatabase,options:RelayOptions){
 const lease=(host:Host,now:number)=>({protocol:host.relayProtocol,agentStatusVersion:1,agentCatalogVersion:1,agentCatalogHash:options.catalogHash(host.relayHealth),serverNow:now,expiresAt:host.leaseExpiresAt,durationMs:RELAY_LEASE_MS})
 async function owned(tx:Tx,owner:string,id:string){await lockPostgresOwner(tx,owner);const [host]=await tx.select().from(hosts).where(and(eq(hosts.id,id),eq(hosts.ownerSubject,owner))).for('update');return host}
 async function command(tx:Tx,id:string,connectionId:string){const [row]=await tx.select().from(commands).where(and(eq(commands.id,id),eq(commands.connectionId,connectionId)));return row}
 async function nextPosition(tx:Tx,id:string){const [row]=await tx.select({position:sql`COALESCE(MAX(COALESCE(${commands.queuePosition},${commands.ordinal})),0)+1`}).from(commands).where(eq(commands.connectionId,id));const value=Number(row!.position);if(!Number.isSafeInteger(value))return fail('queue_counter_exhausted');return value}
 async function message(tx:Tx,host:Host,role:'user'|'assistant',text:string,origin:string,now:number,content?:MessageContent[]){
  const id=`msg_${randomUUID()}`;await appendPostgresMessage(tx,host.ownerSubject,{id,sessionId:host.sessionId,role,agent:'pi-terminal',meta:{origin},time:now})
  if(content)await appendPostgresContent(tx,host.ownerSubject,host.sessionId,id,content)
  else await appendPostgresPart(tx,host.ownerSubject,{id:`txt_${id}`,sessionId:host.sessionId,messageId:id,type:'text',payload:{text}})
  return id
 }
 async function part(tx:Tx,host:Host,id:string){const [row]=await tx.select().from(parts).where(and(eq(parts.id,id),eq(parts.sessionId,host.sessionId)));return row}
 async function inputParts(tx:Tx,host:Host,id:string){return (await tx.select().from(parts).where(and(eq(parts.messageId,id),eq(parts.sessionId,host.sessionId))).orderBy(asc(parts.seq))).map(row=>({type:row.type,...row.payload}))}
 async function finish(tx:Tx,host:Host,row:Command,status:string,now:number){
  await tx.update(commands).set({status,updatedAt:now}).where(eq(commands.id,row.id))
  await replacePostgresPart(tx,host.ownerSubject,`txt_${row.assistantMessageId}`,{text:row.result||`[Remote run ${status}]`,remoteStatus:status})
  await recordPostgresTaskNotification(tx,host.ownerSubject,host.sessionId,`terminal:${row.id}`,'task_failed',now)
 }
 async function reconcile(tx:Tx,host:Host,now:number){
  const [managed]=await tx.select({desired:managedAgents.desired,purgedAt:managedAgents.purgedAt,workerRevoked:workers.revokedAt}).from(managedAgents).innerJoin(workers,eq(workers.id,managedAgents.workerId)).where(eq(managedAgents.connectionId,host.id))
  const revoked=Boolean(managed&&(managed.workerRevoked!==null||managed.desired==='destroyed'||managed.purgedAt!==null))
  const rows=await tx.select().from(commands).where(and(eq(commands.connectionId,host.id),inArray(commands.status,active)))
  for(const row of rows){
   if(host.revokedAt!==null||revoked||!host.remoteEnabled||(row.status!=='queued'&&host.expiresAt<=now))await finish(tx,host,row,'cancelled',now)
   else if(row.status==='queued')continue
   else if(row.status==='claimed'&&now-(row.claimedAt??row.createdAt)>=APPROVAL_TIMEOUT_MS)await finish(tx,host,row,'expired',now)
   else if(row.instanceId!==host.instanceId||expired(host,now)||(host.relayProtocol===2?!row.leaseExpiresAt||now>=row.leaseExpiresAt||(row.status==='running'&&now-(row.startedAt??row.createdAt)>=MAX_REMOTE_RUN_MS):now-(row.startedAt??row.claimedAt??row.createdAt)>=LEGACY_RUN_TIMEOUT_MS))await finish(tx,host,row,'interrupted',now)
  }
 }
 const recoverable=(host:Host)=>sql`${commands.connectionId}=${host.id} AND ${commands.status}='expired' AND ${commands.claimedAt} IS NULL AND ${commands.startedAt} IS NULL AND ${commands.instanceId} IS NULL AND ${commands.leaseExpiresAt} IS NULL AND ${commands.version}=0 AND ${commands.result}=''
 AND EXISTS(SELECT 1 FROM messages u WHERE u.id=${commands.userMessageId} AND u.session_id=${host.sessionId} AND u.role='user' AND EXISTS(SELECT 1 FROM parts p WHERE p.message_id=u.id AND p.session_id=u.session_id))
 AND EXISTS(SELECT 1 FROM messages a JOIN parts p ON p.message_id=a.id AND p.session_id=a.session_id AND p.id='txt_'||a.id WHERE a.id=${commands.assistantMessageId} AND a.session_id=${host.sessionId} AND a.role='assistant')`
 return {
  list(owner:string,at?:number){return db.transaction(async tx=>{
   await lockPostgresOwner(tx,owner)
   const rows=await tx.select().from(hosts).where(eq(hosts.ownerSubject,owner)).orderBy(desc(hosts.createdAt)),now=at??Date.now(),result=[]
   for(const host of rows){
    await reconcile(tx,host,now)
    const [managed]=await tx.select({id:managedAgents.id}).from(managedAgents).where(and(eq(managedAgents.connectionId,host.id),eq(managedAgents.ownerSubject,owner)))
    const recent=await tx.select().from(commands).where(eq(commands.connectionId,host.id)).orderBy(desc(commands.createdAt),desc(commands.ordinal)).limit(10)
    const runs=recent.map(row=>({id:row.id,status:row.status,userMessageId:row.userMessageId,created_at:row.createdAt,updated_at:row.updatedAt,expiredBeforeDispatch:row.status==='expired'&&row.claimedAt===null&&row.startedAt===null&&row.instanceId===null&&row.leaseExpiresAt===null&&row.version===0&&row.result===''}))
    result.push({id:host.id,managedAgentId:managed?.id,sessionId:host.sessionId,ownerSubject:owner,name:host.name||'Paired computer',revision:host.settingsRevision,remoteEnabled:Boolean(host.remoteEnabled),serverNow:now,lastSeenAt:host.lastSeenAt,expiresAt:host.expiresAt,relayProtocol:host.relayProtocol,leaseExpiresAt:host.leaseExpiresAt,health:options.summaryHealth(host.relayHealth),status:host.revokedAt!==null?'revoked':host.expiresAt<=now?'expired':host.activatedAt===null?'unconfirmed':expired(host,now)?'offline':'online',runs})
   }
   return result
  })},
  async configure(owner:string,id:string,name:string,enabled:boolean,expected:number){return db.transaction(async tx=>{
   const host=await owned(tx,owner,id)
   if(!host||host.settingsRevision!==expected||host.revokedAt!==null||!Number.isSafeInteger(expected)||expected>=Number.MAX_SAFE_INTEGER)return fail('computer_settings_conflict')
   const [next]=await tx.update(hosts).set({name,remoteEnabled:Number(enabled),settingsRevision:expected+1}).where(eq(hosts.id,id)).returning();await reconcile(tx,next!,Date.now())
  })},
  async attach(token:string,id:string,instance:string,at?:number,protocol=1){return db.transaction(async tx=>{
   const {row:host,now}=await authenticatePostgresTerminal(tx,token,id,at)
   const [managed]=await tx.select({id:managedAgents.id}).from(managedAgents).where(eq(managedAgents.connectionId,id))
   if(![1,2].includes(protocol)||(protocol!==2&&managed)||(host.instanceId===instance&&host.relayProtocol!==protocol))return fail('relay_protocol_mismatch')
   await reconcile(tx,host,now)
   if(host.instanceId!==instance)for(const row of await tx.select().from(commands).where(and(eq(commands.connectionId,id),inArray(commands.status,['claimed','running']))))await finish(tx,host,row,'interrupted',now)
   const [next]=await tx.update(hosts).set({instanceId:instance,lastSeenAt:now,relayProtocol:protocol,leaseExpiresAt:protocol===2?Math.min(now+RELAY_LEASE_MS,host.expiresAt):null,relayHealth:null}).where(eq(hosts.id,id)).returning()
   return {...connection(host),lease:lease(next!,now)}
  })},
  validateSocket(token:string,id:string,instance:string,at?:number){return db.transaction(async tx=>connection((await validatePostgresRelay(tx,token,id,instance,at)).row))},
  async withSocketAuthority<T>(token:string,id:string,instance:string,run:(tx:Tx,host:Host)=>Promise<T>,at?:number){return db.transaction(async tx=>{const state=await validatePostgresRelay(tx,token,id,instance,at);const result=await run(tx,state.row);const now=at??Date.now();if(now<state.now||now>=state.row.expiresAt||expired(state.row,now))return fail('computer_lease_expired');return result})},
  poll(token:string,id:string,instance:string,at?:number,protocol=1,health?:Record<string,unknown>){return db.transaction(async tx=>{
   const {row:host,now}=await validatePostgresRelay(tx,token,id,instance,at,false)
   if(host.relayProtocol!==protocol)return fail('relay_protocol_mismatch')
   await reconcile(tx,host,now)
   const expiresAt=Math.min(now+RELAY_LEASE_MS,host.expiresAt)
   const [next]=await tx.update(hosts).set({lastSeenAt:now,leaseExpiresAt:protocol===2?expiresAt:null,relayHealth:health?JSON.stringify(options.mergeHealth(host.relayHealth,health)):null}).where(eq(hosts.id,id)).returning()
   if(protocol===2)await tx.update(commands).set({leaseExpiresAt:sql`LEAST(${expiresAt},CASE WHEN ${commands.status}='running' THEN COALESCE(${commands.startedAt},${commands.createdAt})+${MAX_REMOTE_RUN_MS} ELSE COALESCE(${commands.claimedAt},${commands.createdAt})+${APPROVAL_TIMEOUT_MS} END)`}).where(and(eq(commands.connectionId,id),eq(commands.instanceId,instance),inArray(commands.status,['claimed','running'])))
   const accepting=await postgresManagedAcceptingPrompts(tx,id,host.ownerSubject,now),rows=await tx.select().from(commands).where(and(eq(commands.connectionId,id),inArray(commands.status,active))).orderBy(sql`CASE WHEN ${commands.status}='queued' THEN 1 ELSE 0 END`,...queueOrder).limit(10)
   const pending=[]
   for(const row of rows){if(row.status==='queued'&&!accepting)continue;const [file]=await tx.select({id:parts.id}).from(parts).where(and(eq(parts.messageId,row.userMessageId),eq(parts.sessionId,host.sessionId),eq(parts.type,'file'))).limit(1);pending.push({...commandView(row),hasAttachments:Boolean(file)})}
   return {connection:connection(host),lease:lease(next!,now),remoteEnabled:Boolean(next!.remoteEnabled),commands:pending}
  })},
  enqueue(owner:string,sessionId:string,requestId:string,text:string,at?:number,input?:MessageContent[]){
   const content=options.validateContent(input)
   return db.transaction(async tx=>{
    await lockPostgresOwner(tx,owner)
    const [host]=await tx.select().from(hosts).where(and(eq(hosts.sessionId,sessionId),eq(hosts.ownerSubject,owner))).for('update');const now=at??Date.now()
    if(!host)return fail('terminal_transport_unavailable')
    await reconcile(tx,host,now)
    const [existing]=await tx.select().from(commands).where(and(eq(commands.connectionId,host.id),eq(commands.requestId,requestId)))
    if(existing){if(existing.text!==text||JSON.stringify(await inputParts(tx,host,existing.userMessageId))!==JSON.stringify(content??[{type:'text',text}]))return fail('request_id_conflict');return commandView(existing)}
    if(!await postgresManagedAcceptingPrompts(tx,host.id,owner,now))return fail('computer_not_ready')
    await checkPostgresAttachmentBudget(tx,owner,content)
    if(host.revokedAt!==null||host.expiresAt<=now||host.activatedAt===null||!host.remoteEnabled||!host.instanceId||expired(host,now))return fail('computer_not_ready')
    const [total]=await tx.select({n:count()}).from(commands).where(and(eq(commands.connectionId,host.id),inArray(commands.status,active)));if(total!.n>=10)return fail('computer_queue_full')
    const id=randomUUID(),user=await message(tx,host,'user',text,'dashboard',now,content),assistant=await message(tx,host,'assistant','[Waiting for computer]','computer',now)
    await replacePostgresPart(tx,owner,`txt_${assistant}`,{text:'[Waiting for computer]',remoteStatus:'queued'})
    const [row]=await tx.insert(commands).values({id,connectionId:host.id,requestId,text,userMessageId:user,assistantMessageId:assistant,status:'queued',createdAt:now,updatedAt:now,queuePosition:await nextPosition(tx,host.id)}).returning();return commandView(row!)
   })
  },
  transition(token:string,id:string,instance:string,commandId:string,action:'claim'|'start'|'reject',at?:number){return db.transaction(async tx=>{
   const {row:host,now}=await validatePostgresRelay(tx,token,id,instance,at,false);await reconcile(tx,host,now)
   const row=await command(tx,commandId,id);if(!row||!host.remoteEnabled)return fail('command_unavailable')
   const next=action==='claim'?'claimed':action==='start'?'running':'rejected'
   if(row.instanceId===instance&&row.status===next)return commandView(row)
   if(action!=='reject'&&!await postgresManagedAcceptingPrompts(tx,id,host.ownerSubject,now))return fail('command_unavailable')
   if(action==='claim'){
    const [busy]=await tx.select({id:commands.id}).from(commands).where(and(eq(commands.connectionId,id),inArray(commands.status,['claimed','running']))).limit(1)
    if(row.status!=='queued'||busy)return fail('computer_busy')
    const [first]=await tx.select({id:commands.id}).from(commands).where(and(eq(commands.connectionId,id),eq(commands.status,'queued'))).orderBy(...queueOrder).limit(1)
    if(first?.id!==row.id)return fail('command_out_of_order')
   }else if(row.status!=='claimed'||row.instanceId!==instance)return fail('command_unavailable')
   const [updated]=await tx.update(commands).set({status:next,instanceId:instance,updatedAt:now,...(action==='claim'?{claimedAt:now,leaseExpiresAt:host.leaseExpiresAt}:{}),...(action==='start'?{startedAt:now,leaseExpiresAt:host.leaseExpiresAt}:{})}).where(eq(commands.id,row.id)).returning()
   if(next==='rejected')await finish(tx,host,updated!,next,now)
   else await replacePostgresPart(tx,host.ownerSubject,`txt_${row.assistantMessageId}`,{text:next==='running'?'[Working on computer]':'[Awaiting local approval]',remoteStatus:next})
   return commandView(updated!)
  })},
  input(token:string,id:string,instance:string,commandId:string,at?:number){return db.transaction(async tx=>{
   const {row:host,now}=await validatePostgresRelay(tx,token,id,instance,at,false);await reconcile(tx,host,now);const row=await command(tx,commandId,id)
   if(!row||row.instanceId!==instance||row.status!=='running'||!host.remoteEnabled)return fail('command_unavailable')
   return inputParts(tx,host,row.userMessageId)
  })},
  publish(token:string,id:string,instance:string,commandId:string,version:number,text:string,status:'running'|'completed'|'failed',at?:number,transcript=false){return db.transaction(async tx=>{
   const {row:host,now}=await validatePostgresRelay(tx,token,id,instance,at,false);await reconcile(tx,host,now);const row=await command(tx,commandId,id)
   if(!row||row.instanceId!==instance)return fail('command_unavailable')
   if(row.version===version&&row.result===text&&row.status===status)return commandView(row)
   if(row.status!=='running'||!Number.isSafeInteger(version)||version<=row.version||!host.remoteEnabled)return fail('command_revision_conflict')
   const [updated]=await tx.update(commands).set({version,result:text,status,updatedAt:now}).where(eq(commands.id,row.id)).returning()
   await replacePostgresPart(tx,host.ownerSubject,`txt_${row.assistantMessageId}`,{text:text||(status==='failed'?'[Remote run failed]':'…'),remoteStatus:status,...(transcript?{superseded:status!=='failed'}:{})})
   await tx.update(sessions).set({updatedAt:now}).where(and(eq(sessions.id,host.sessionId),eq(sessions.ownerSubject,host.ownerSubject)))
   if(status!=='running')await recordPostgresTaskNotification(tx,host.ownerSubject,host.sessionId,`terminal:${row.id}`,status==='completed'?'task_completed':'task_failed',now)
   return commandView(updated!)
  })},
  receipts(token:string,id:string,at?:number){return db.transaction(async tx=>{
   const {row:host}=await authenticatePostgresTerminal(tx,token,id,at)
   const rows=await tx.select({eventId:mirrors.eventId,messageId:mirrors.messageId,text:mirrors.text,payload:parts.payload}).from(mirrors).innerJoin(messages,and(eq(messages.id,mirrors.messageId),eq(messages.sessionId,host.sessionId))).innerJoin(parts,and(eq(parts.id,sql`'txt_'||${mirrors.messageId}`),eq(parts.sessionId,host.sessionId))).where(eq(mirrors.connectionId,id)).orderBy(desc(messages.seq)).limit(128)
   return {receipts:rows.map(row=>({eventId:row.eventId,messageId:row.messageId,sha256:createHash('sha256').update(row.text).digest('hex'),version:row.payload.mirrorVersion??null,final:row.payload.mirrorFinal===true}))}
  })},
  mirror(token:string,id:string,instance:string,eventId:string,role:'user'|'assistant',text:string,at?:number,snapshot?:MirrorSnapshot){return db.transaction(async tx=>{
   const {row:host,now}=await validatePostgresRelay(tx,token,id,instance,at,false)
   if(snapshot?.outcome&&(!snapshot.final||role!=='assistant')||snapshot?.reasoning&&(role!=='assistant'||snapshot.tool))return fail('mirror_conflict')
   const [existing]=await tx.select().from(mirrors).where(and(eq(mirrors.connectionId,id),eq(mirrors.eventId,eventId)))
   const payload={text,...(snapshot?{mirrorVersion:snapshot.version,mirrorFinal:snapshot.final,remoteStatus:snapshot.outcome??(snapshot.final?'completed':'running'),...(snapshot.outcome?{mirrorOutcome:snapshot.outcome}:{}),...(snapshot.tool?{tool:snapshot.tool}:{}),...(snapshot.reasoning?{reasoning:snapshot.reasoning}:{})}:{})}
   if(existing){
    if(existing.role!==role)return fail('mirror_conflict')
    const previous=(await part(tx,host,`txt_${existing.messageId}`))?.payload
    if(JSON.stringify(previous?.reasoning)!==JSON.stringify(snapshot?.reasoning))return fail('mirror_conflict')
    if(snapshot&&typeof previous?.mirrorVersion==='number'){
     if(snapshot.version<previous.mirrorVersion)return {sessionId:host.sessionId,messageId:existing.messageId}
     if(snapshot.version===previous.mirrorVersion){if(existing.text!==text||previous.mirrorFinal!==snapshot.final||previous.mirrorOutcome!==snapshot.outcome||JSON.stringify(previous.tool)!==JSON.stringify(snapshot.tool))return fail('mirror_conflict')}
     else{if(previous.mirrorFinal)return fail('mirror_conflict');await replacePostgresPart(tx,host.ownerSubject,`txt_${existing.messageId}`,payload);await tx.update(mirrors).set({text}).where(and(eq(mirrors.connectionId,id),eq(mirrors.eventId,eventId)));await tx.update(sessions).set({updatedAt:now}).where(eq(sessions.id,host.sessionId))}
    }else if(snapshot||previous?.mirrorVersion!==undefined||existing.text!==text)return fail('mirror_conflict')
    return {sessionId:host.sessionId,messageId:existing.messageId}
   }
   const mid=await message(tx,host,role,text,'computer',now)
   if(snapshot)await replacePostgresPart(tx,host.ownerSubject,`txt_${mid}`,payload)
   if(snapshot?.reasoning)await tx.update(parts).set({type:'reasoning'}).where(eq(parts.id,`txt_${mid}`))
   await tx.insert(mirrors).values({connectionId:id,eventId,messageId:mid,role,text});return {sessionId:host.sessionId,messageId:mid}
  })},
  async reconcileSession(owner:string,sessionId:string,at?:number){return db.transaction(async tx=>{await lockPostgresOwner(tx,owner);const [host]=await tx.select().from(hosts).where(and(eq(hosts.sessionId,sessionId),eq(hosts.ownerSubject,owner))).for('update');if(host)await reconcile(tx,host,at??Date.now())})},
  queue(owner:string,id:string,at?:number){return db.transaction(async tx=>{const host=await owned(tx,owner,id);if(!host)return;await reconcile(tx,host,at??Date.now());return (await tx.select().from(commands).where(and(eq(commands.connectionId,id),inArray(commands.status,active))).orderBy(...queueOrder)).map(queueView)})},
  catalog(owner:string,id:string){return db.transaction(async tx=>{const host=await owned(tx,owner,id);if(!host||host.revokedAt!==null)return;return {ownerSubject:owner,connectionId:id,sessionId:host.sessionId,...options.catalog(host.relayHealth),observedAt:host.lastSeenAt}})},
  recoverableCount(owner:string,id:string){return db.transaction(async tx=>{const host=await owned(tx,owner,id);if(!host)return;const [total]=await tx.select({n:count()}).from(commands).where(recoverable(host));return total!.n})},
  recoverableMessages(owner:string,id:string){return db.transaction(async tx=>{const host=await owned(tx,owner,id);if(!host)return;return (await tx.select().from(commands).where(recoverable(host)).orderBy(desc(commands.createdAt),desc(commands.ordinal)).limit(20)).map(recoverableView)})},
  restoreQueue(owner:string,id:string,commandId:string,expectedSession:string,at?:number){return db.transaction(async tx=>{
   const host=await owned(tx,owner,id),now=at??Date.now();if(!host)return
   if(host.sessionId!==expectedSession)return fail('queue_session_changed')
   const row=await command(tx,commandId,id);if(!row)return
   if(row.queueRestoredAt!==null&&row.status!=='expired')return {id:row.id,status:row.status,restored:true,changed:false}
   const [eligible]=await tx.select({id:commands.id}).from(commands).where(and(eq(commands.id,commandId),recoverable(host)));if(!eligible)return fail('queue_request_not_recoverable')
   const [managed]=await tx.select({owner:managedAgents.ownerSubject,desired:managedAgents.desired,purgedAt:managedAgents.purgedAt,workerOwner:workers.ownerSubject,workerRevoked:workers.revokedAt}).from(managedAgents).leftJoin(workers,eq(workers.id,managedAgents.workerId)).where(eq(managedAgents.connectionId,id))
   if(managed&&(managed.owner!==owner||managed.workerOwner!==owner||managed.workerRevoked!==null||managed.desired==='destroyed'||managed.purgedAt!==null))return fail('computer_not_ready')
   if(host.revokedAt!==null||!host.remoteEnabled||host.activatedAt===null||(host.expiresAt<=now&&!managed))return fail('computer_not_ready')
   await reconcile(tx,host,now)
   const [total]=await tx.select({n:count()}).from(commands).where(and(eq(commands.connectionId,id),inArray(commands.status,active)));if(total!.n>=10)return fail('computer_queue_full')
   await tx.update(commands).set({status:'queued',queuePosition:await nextPosition(tx,id),queueRestoredAt:now,updatedAt:now}).where(eq(commands.id,commandId))
   await replacePostgresPart(tx,owner,`txt_${row.assistantMessageId}`,{text:'[Waiting for computer]',remoteStatus:'queued',queueRestoredAt:now})
   await tx.update(sessions).set({updatedAt:now}).where(eq(sessions.id,host.sessionId))
   await tx.delete(notifications).where(and(eq(notifications.ownerSubject,owner),eq(notifications.eventKey,`terminal:${row.id}`)))
   return {id:row.id,status:'queued',restored:true,changed:true}
  })},
 }
}
