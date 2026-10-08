import type {Database} from 'better-sqlite3'
import {randomUUID} from 'node:crypto'
import {createPostgresNotificationRepository,createPostgresPushSubscriptionRepository,createPostgresPushDeliveryRepository,type RuePostgresDatabase,type CredentialCodec,type NotificationItem,type PushDeliveryClaim} from '@multiterm/rue-db/postgres'
import {notificationInbox} from '../storage/notifications.js'
import {savePushSubscription,removePushSubscription,validatePushSubscription,type PushSubscription} from '../storage/push-subscriptions.js'
import {encryptionKey} from '../storage/agent-settings.js'
import {createCredentialCodec} from '../storage/credential-codec.js'

export interface NotificationServices {
 inbox(owner:string):Promise<{items:NotificationItem[];unread:number}>
 markRead:ReturnType<typeof createPostgresNotificationRepository>['markRead']
 markAllRead:ReturnType<typeof createPostgresNotificationRepository>['markAllRead']
 subscriptions:ReturnType<typeof createPostgresPushSubscriptionRepository>
 deliveries:ReturnType<typeof createPostgresPushDeliveryRepository>
 decode(owner:string,id:string,ciphertext:string):PushSubscription
}
const decoder=(codec:CredentialCodec)=>(owner:string,id:string,ciphertext:string)=>validatePushSubscription(JSON.parse(codec.decrypt([owner,'web-push',id],ciphertext)))
export function createPostgresNotificationServices(db:RuePostgresDatabase,codec:CredentialCodec):NotificationServices {
 return {...createPostgresNotificationRepository(db),subscriptions:createPostgresPushSubscriptionRepository(db,{validate:validatePushSubscription,codec}),deliveries:createPostgresPushDeliveryRepository(db),decode:decoder(codec)}
}
/** Temporary single-connection adapter. Network sends never run in a transaction. */
export function createSqliteNotificationServices(db:Database):NotificationServices {
 const authority=`d.notification_id=? AND d.subscription_id=? AND d.state='sending' AND d.lease_id=? AND d.lease_until>?
  AND s.id=d.subscription_id AND s.owner_subject=? AND s.encrypted_subscription=?
  AND n.id=d.notification_id AND n.owner_subject=s.owner_subject AND chat.id=n.session_id AND chat.owner_subject=n.owner_subject`
 const parameters=(c:PushDeliveryClaim,now:number)=>[c.notificationId,c.subscriptionId,c.leaseId,now,c.ownerSubject,c.encryptedSubscription]
 return {
  decode:decoder(createCredentialCodec(()=>encryptionKey(db))),
  async inbox(owner){return db.transaction(()=>notificationInbox(db,owner)).immediate()},
  async markRead(owner,id,now=Date.now()){return db.prepare(`UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND owner_subject=? AND EXISTS(SELECT 1 FROM sessions s WHERE s.id=notifications.session_id AND s.owner_subject=notifications.owner_subject)`).run(now,id,owner).changes>0},
  async markAllRead(owner,now=Date.now()){db.prepare(`UPDATE notifications SET read_at=? WHERE owner_subject=? AND read_at IS NULL AND EXISTS(SELECT 1 FROM sessions s WHERE s.id=notifications.session_id AND s.owner_subject=notifications.owner_subject)`).run(now,owner)},
  subscriptions:{
   async list(owner,now=Date.now()){return db.prepare('SELECT device_id AS deviceId,expires_at AS expiresAt FROM push_subscriptions WHERE owner_subject=? AND expires_at>? ORDER BY device_id').all(owner,now) as {deviceId:string;expiresAt:number}[]},
   async save(owner,id,input,now){return savePushSubscription(db,owner,id,input,now)},
   async remove(owner,id){removePushSubscription(db,owner,id)},
   async claimTest(owner,deviceId,at){return db.transaction(()=>{
    const now=at??Date.now(),row=db.prepare('SELECT id,encrypted_subscription AS encryptedSubscription,last_test_at AS lastTestAt FROM push_subscriptions WHERE owner_subject=? AND device_id=? AND expires_at>?').get(owner,deviceId,now) as {id:string;encryptedSubscription:string;lastTestAt:number|null}|undefined
    if(!row)return {status:'missing' as const}
    if(row.lastTestAt!==null&&row.lastTestAt>=now-30_000)return {status:'rate_limited' as const}
    db.prepare('UPDATE push_subscriptions SET last_test_at=? WHERE id=?').run(now,row.id)
    return {status:'ready' as const,id:row.id,encryptedSubscription:row.encryptedSubscription}
   }).immediate()},
  },
  deliveries:{
   async prune(now=Date.now()){db.transaction(()=>{
    db.prepare('DELETE FROM push_subscriptions WHERE expires_at<=?').run(now)
    db.prepare("UPDATE push_deliveries SET state='failed',lease_id=NULL,lease_until=NULL WHERE state IN ('pending','sending') AND notification_id IN (SELECT id FROM notifications WHERE created_at<=?)").run(now-86400000)
   }).immediate()},
   async claimNext(now=Date.now()){return db.transaction(()=>{
    const row=db.prepare(`SELECT d.notification_id AS notificationId,d.subscription_id AS subscriptionId,d.attempts,s.owner_subject AS ownerSubject,s.encrypted_subscription AS encryptedSubscription,n.session_id AS sessionId,n.kind,n.created_at AS createdAt FROM push_deliveries d
     JOIN push_subscriptions s ON s.id=d.subscription_id JOIN notifications n ON n.id=d.notification_id AND n.owner_subject=s.owner_subject JOIN sessions chat ON chat.id=n.session_id AND chat.owner_subject=n.owner_subject
     WHERE s.expires_at>? AND n.created_at>? AND ((d.state='pending' AND d.next_at<=?) OR (d.state='sending' AND d.lease_until<=?)) ORDER BY d.next_at,d.notification_id,d.subscription_id LIMIT 1`).get(now,now-86400000,now,now) as Omit<PushDeliveryClaim,'leaseId'|'leaseUntil'>|undefined
    if(!row)return undefined
    const leaseId=randomUUID(),leaseUntil=now+60000
    db.prepare("UPDATE push_deliveries SET state='sending',attempts=attempts+1,lease_id=?,lease_until=? WHERE notification_id=? AND subscription_id=?").run(leaseId,leaseUntil,row.notificationId,row.subscriptionId)
    return {...row,attempts:row.attempts+1,leaseId,leaseUntil}
   }).immediate()},
   async complete(claim,outcome,now=Date.now()){
    return db.prepare(`UPDATE push_deliveries AS d SET state=?,next_at=?,lease_id=NULL,lease_until=NULL FROM push_subscriptions s,notifications n,sessions chat WHERE ${authority} AND s.expires_at>?`).run(outcome.state,outcome.nextAt??now,...parameters(claim,now),now).changes>0
   },
   async discardSubscription(claim,now=Date.now()){
    return db.prepare(`DELETE FROM push_subscriptions WHERE id=? AND EXISTS(SELECT 1 FROM push_deliveries d,push_subscriptions s,notifications n,sessions chat WHERE ${authority})`).run(claim.subscriptionId,...parameters(claim,now)).changes>0
   },
  },
 }
}
