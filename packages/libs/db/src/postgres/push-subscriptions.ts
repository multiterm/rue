import {createHash,randomUUID} from 'node:crypto'
import {and,asc,count,eq,gt,sql} from 'drizzle-orm'
import type {RuePostgresDatabase} from './client.js'
import type {CredentialCodec} from './projects.js'
import {lockPostgresOwner} from './owner-lock.js'
import {pushSubscriptions} from './schema.js'
export interface PushSubscription {endpoint:string;keys:{p256dh:string;auth:string}}
export type PushTestClaim={status:'ready';id:string;encryptedSubscription:string}|{status:'missing'|'rate_limited'}
/** Validation must enforce the API's endpoint allowlist and actual P-256/auth key
 * validation. Encryption retains the original owner/web-push/subscription scope. */
export function createPostgresPushSubscriptionRepository(db:RuePostgresDatabase,options:{validate:(raw:unknown)=>PushSubscription;codec:Pick<CredentialCodec,'encrypt'>}){
 return {
  async list(owner:string,now=Date.now()){
   if(!owner||owner.length>512)throw Error('push_owner_required')
   return db.select({deviceId:pushSubscriptions.deviceId,expiresAt:pushSubscriptions.expiresAt}).from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.ownerSubject,owner),gt(pushSubscriptions.expiresAt,now))).orderBy(asc(pushSubscriptions.deviceId))
  },
  async claimTest(owner:string,deviceId:string,at?:number):Promise<PushTestClaim>{
   return db.transaction(async tx=>{
    await lockPostgresOwner(tx,owner)
    const now=at??Date.now()
    const [row]=await tx.select().from(pushSubscriptions).where(and(eq(pushSubscriptions.ownerSubject,owner),eq(pushSubscriptions.deviceId,deviceId),gt(pushSubscriptions.expiresAt,now))).for('update')
    if(!row)return {status:'missing'}
    if(row.lastTestAt!==null&&row.lastTestAt>=now-30_000)return {status:'rate_limited'}
    await tx.update(pushSubscriptions).set({lastTestAt:now}).where(eq(pushSubscriptions.id,row.id))
    return {status:'ready',id:row.id,encryptedSubscription:row.encryptedSubscription}
   })
  },
  save(owner:string,deviceId:string,input:unknown,at?:number){
   const value=options.validate(input),hash=createHash('sha256').update(value.endpoint).digest('hex')
   return db.transaction(async tx=>{
    await lockPostgresOwner(tx,owner)
    // Different owners have different owner locks but must not share an endpoint.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'rue:push-endpoint:'+hash},0))`)
    const [bound]=await tx.select({owner:pushSubscriptions.ownerSubject,device:pushSubscriptions.deviceId}).from(pushSubscriptions).where(eq(pushSubscriptions.endpointHash,hash))
    if(bound&&(bound.owner!==owner||bound.device!==deviceId))throw Error('push_subscription_conflict')
    const [previous]=await tx.select({id:pushSubscriptions.id,hash:pushSubscriptions.endpointHash}).from(pushSubscriptions).where(and(eq(pushSubscriptions.ownerSubject,owner),eq(pushSubscriptions.deviceId,deviceId)))
    const [total]=await tx.select({n:count()}).from(pushSubscriptions).where(eq(pushSubscriptions.ownerSubject,owner))
    if(!previous&&total!.n>=20)throw Error('push_device_limit')
    if(previous&&previous.hash!==hash)await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.id,previous.id))
    const id=previous?.hash===hash?previous.id:randomUUID(),now=at??Date.now(),expiresAt=now+90*86400000
    const encryptedSubscription=options.codec.encrypt([owner,'web-push',id],JSON.stringify(value))
    await tx.insert(pushSubscriptions).values({id,ownerSubject:owner,deviceId,endpointHash:hash,encryptedSubscription,createdAt:now,updatedAt:now,expiresAt}).onConflictDoUpdate({target:[pushSubscriptions.ownerSubject,pushSubscriptions.deviceId],set:{encryptedSubscription,updatedAt:now,expiresAt}})
    return {id,deviceId,expiresAt}
   })
  },
  remove(owner:string,deviceId:string){return db.transaction(async tx=>{await lockPostgresOwner(tx,owner);await tx.delete(pushSubscriptions).where(and(eq(pushSubscriptions.ownerSubject,owner),eq(pushSubscriptions.deviceId,deviceId)))})},
 }
}
