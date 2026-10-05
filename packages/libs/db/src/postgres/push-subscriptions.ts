import {createHash,randomUUID} from 'node:crypto'
import {and,count,eq,sql} from 'drizzle-orm'
import type {RuePostgresDatabase} from './client.js'
import type {CredentialCodec} from './projects.js'
import {lockPostgresOwner} from './owner-lock.js'
import {pushSubscriptions} from './schema.js'
export interface PushSubscription {endpoint:string;keys:{p256dh:string;auth:string}}
/** Validation must enforce the API's endpoint allowlist and actual P-256/auth key
 * validation. Encryption retains the original owner/web-push/subscription scope. */
export function createPostgresPushSubscriptionRepository(db:RuePostgresDatabase,options:{validate:(raw:unknown)=>PushSubscription;codec:Pick<CredentialCodec,'encrypt'>}){
 return {
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
