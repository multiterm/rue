import {createHmac} from 'node:crypto'
import {and,eq,sql} from 'drizzle-orm'
import type {RuePostgresDatabase} from './client.js'
import {lockPostgresOwner} from './owner-lock.js'
import {sessions,terminalConnections,usageCredentials,agentUsageEvents} from './schema.js'
type Tx=Parameters<Parameters<RuePostgresDatabase['transaction']>[0]>[0]
export interface UsageEvent {eventId:string;provider:string;model:string;credentialId:string|null;time:number;input:number;output:number;cacheRead:number;cacheWrite:number;costUsd:number|null}
export function createPostgresUsageRepository(db:RuePostgresDatabase,options:{parseEvent:(raw:unknown)=>UsageEvent;encryptionKey:()=>Buffer|undefined}){
 async function credentialInTransaction(tx:Tx,owner:string,provider:string,apiKey:string,at?:number){
  const secret=options.encryptionKey();if(!secret)throw Error('Credential storage unavailable')
  const id='key_'+createHmac('sha256',secret).update(JSON.stringify([owner,provider,apiKey])).digest('hex')
  await tx.insert(usageCredentials).values({id,ownerSubject:owner,provider,createdAt:at??Date.now()}).onConflictDoNothing({target:usageCredentials.id})
  return id
 }
 /** Runtime callers must invoke this inside their live relay-authority transaction,
  * not authenticate on one connection and record later on another. */
 async function recordInTransaction(tx:Tx,owner:string,sessionId:string,connectionId:string,raw:unknown,at?:number){
  const event=options.parseEvent(raw);await lockPostgresOwner(tx,owner);const now=at??Date.now()
  const [session]=await tx.select({id:sessions.id}).from(sessions).where(and(eq(sessions.id,sessionId),eq(sessions.ownerSubject,owner))).for('share')
  if(!session)throw Error('Invalid usage owner')
  if(connectionId!==`cloud:${sessionId}`){const [host]=await tx.select({id:terminalConnections.id}).from(terminalConnections).where(and(eq(terminalConnections.id,connectionId),eq(terminalConnections.ownerSubject,owner),eq(terminalConnections.sessionId,sessionId)));if(!host)throw Error('Invalid usage connection')}
  if(event.time>now+300000)throw Error('Invalid usage time')
  if(event.credentialId){const [credential]=await tx.select({id:usageCredentials.id}).from(usageCredentials).where(and(eq(usageCredentials.id,event.credentialId),eq(usageCredentials.ownerSubject,owner),eq(usageCredentials.provider,event.provider)));if(!credential)throw Error('Invalid usage credential')}
  const [inserted]=await tx.insert(agentUsageEvents).values({ownerSubject:owner,sessionId,connectionId,eventId:event.eventId,provider:event.provider,model:event.model,credentialId:event.credentialId,time:event.time,inputTokens:event.input,outputTokens:event.output,cacheReadTokens:event.cacheRead,cacheWriteTokens:event.cacheWrite,costUsd:event.costUsd}).onConflictDoNothing({target:[agentUsageEvents.connectionId,agentUsageEvents.eventId]}).returning({id:agentUsageEvents.eventId})
  return Boolean(inserted)
 }
 return {
  credentialInTransaction,recordInTransaction,
  credential(owner:string,provider:string,apiKey:string,at?:number){return db.transaction(tx=>credentialInTransaction(tx,owner,provider,apiKey,at))},
  recordCloud(owner:string,sessionId:string,raw:unknown,at?:number){return db.transaction(tx=>recordInTransaction(tx,owner,sessionId,`cloud:${sessionId}`,raw,at))},
  async report(owner:string,sessionId:string,days:number,now=Date.now()){
   if(!Number.isSafeInteger(days)||days<1||days>366||!Number.isSafeInteger(now)||now<0)throw Error('Invalid usage range')
   const from=Math.floor(now/86400000)*86400000-(days-1)*86400000,to=now
   const raw=await db.execute<{time:string|number;provider:string;credentialId:string|null;requests:string|number;input:string|number;output:string|number;cacheRead:string|number;cacheWrite:string|number;costUsd:number|null;unpricedRequests:string|number}>(sql`
    SELECT (time/86400000)*86400000 AS time,provider,credential_id AS "credentialId",COUNT(*) AS requests,
    SUM(input_tokens) AS input,SUM(output_tokens) AS output,SUM(cache_read_tokens) AS "cacheRead",SUM(cache_write_tokens) AS "cacheWrite",
    SUM(cost_usd) AS "costUsd",SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS "unpricedRequests"
    FROM agent_usage_events WHERE owner_subject=${owner} AND session_id=${sessionId} AND time>=${from} AND time<=${to}
    GROUP BY 1,2,3 ORDER BY 1,2,3 NULLS FIRST`)
   const rows=raw.map(row=>({...row,time:Number(row.time),requests:Number(row.requests),input:Number(row.input),output:Number(row.output),cacheRead:Number(row.cacheRead),cacheWrite:Number(row.cacheWrite),unpricedRequests:Number(row.unpricedRequests)}))
   return {ownerSubject:owner,sessionId,from,to,timezone:'UTC' as const,basis:'runtime-estimate' as const,rows}
  },
 }
}
