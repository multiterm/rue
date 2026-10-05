import {randomUUID} from 'node:crypto'
import {and,count,desc,eq,isNull,lt,or,sql} from 'drizzle-orm'
import type {RuePostgresDatabase} from './client.js'
import {notifications,sessions} from './schema.js'

export type NotificationKind='task_completed'|'task_failed'
export interface NotificationCursor {createdAt:number;id:string}
export interface NotificationItem {id:string;sessionId:string;kind:NotificationKind;createdAt:number;readAt:number|null}
export const PUSH_LEASE_MS=60_000
export const PUSH_MAX_AGE_MS=86_400_000
const ownerRequired=(owner:string)=>{if(typeof owner!=='string'||!owner.length||owner.length>512)throw Error('notification_owner_required')}
const timestamp=(now:number)=>{if(!Number.isSafeInteger(now)||now<0||now>Number.MAX_SAFE_INTEGER-PUSH_LEASE_MS)throw Error('notification_time_invalid')}

/** One atomic statement. Pass the task-completion transaction, NOT a separate connection,
 * when recording completion, so task state, notification and delivery fanout commit together. */
export async function recordPostgresTaskNotification(
 db:Pick<RuePostgresDatabase,'execute'>,owner:string,sessionId:string,eventKey:string,kind:NotificationKind,now=Date.now(),
):Promise<string|undefined>{
 ownerRequired(owner);timestamp(now)
 if(!eventKey||!sessionId||!['task_completed','task_failed'].includes(kind))throw Error('notification_event_invalid')
 const rows=await db.execute<{id:string}>(sql`
  WITH owned_session AS (
   SELECT id,owner_subject FROM sessions WHERE id=${sessionId} AND owner_subject=${owner} FOR SHARE
  ), inserted AS (
   INSERT INTO notifications(id,owner_subject,session_id,event_key,kind,created_at)
   SELECT ${randomUUID()},owner_subject,id,${eventKey},${kind},${now} FROM owned_session
   ON CONFLICT(event_key) DO NOTHING RETURNING id,owner_subject
  ), deliveries AS (
   INSERT INTO push_deliveries(notification_id,subscription_id,next_at)
   SELECT n.id,s.id,${now} FROM inserted n JOIN push_subscriptions s ON s.owner_subject=n.owner_subject
   WHERE s.expires_at>${now} RETURNING notification_id
  ) SELECT id FROM inserted`)
 return rows[0]?.id
}

/** Owner-facing metadata only. Never includes event keys, encrypted subscriptions or leases. */
export function createPostgresNotificationRepository(db:RuePostgresDatabase){
 return {
  async inbox(owner:string,input:{limit?:number;cursor?:NotificationCursor}={}){
   ownerRequired(owner)
   const limit=input.limit??100,cursor=input.cursor
   if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('notification_page_invalid')
   if(cursor){timestamp(cursor.createdAt);if(typeof cursor.id!=='string'||!cursor.id.length||cursor.id.length>128)throw Error('notification_cursor_invalid')}
   return db.transaction(async tx=>{
    const scope=eq(notifications.ownerSubject,owner),join=and(eq(sessions.id,notifications.sessionId),eq(sessions.ownerSubject,notifications.ownerSubject))
    const rows=await tx.select({id:notifications.id,sessionId:notifications.sessionId,kind:notifications.kind,createdAt:notifications.createdAt,readAt:notifications.readAt}).from(notifications).innerJoin(sessions,join)
     .where(and(scope,cursor?or(lt(notifications.createdAt,cursor.createdAt),and(eq(notifications.createdAt,cursor.createdAt),lt(notifications.id,cursor.id))):undefined))
     .orderBy(desc(notifications.createdAt),desc(notifications.id)).limit(limit+1)
    const [total]=await tx.select({unread:count()}).from(notifications).innerJoin(sessions,join).where(and(scope,isNull(notifications.readAt)))
    const items=rows.slice(0,limit) as NotificationItem[],last=items.at(-1)
    return {items,unread:total!.unread,nextCursor:rows.length>limit&&last?{createdAt:last.createdAt,id:last.id}:null}
   },{isolationLevel:'repeatable read',accessMode:'read only'})
  },
  async markRead(owner:string,id:string,now=Date.now()){
   ownerRequired(owner);timestamp(now)
   const rows=await db.execute(sql`UPDATE notifications n SET read_at=COALESCE(n.read_at,${now})
    FROM sessions s WHERE n.id=${id} AND n.owner_subject=${owner} AND s.id=n.session_id AND s.owner_subject=n.owner_subject RETURNING n.id`)
   return rows.length===1
  },
 }
}

/** Server-internal claim data. Ciphertext stays in the dispatcher, not browser/API responses. */
export type PushDeliveryClaim = {
 notificationId:string;subscriptionId:string;ownerSubject:string;encryptedSubscription:string
 sessionId:string;kind:NotificationKind;attempts:number;createdAt:number;leaseId:string;leaseUntil:number
}
/** Claim -> commit -> network send -> fenced acknowledgement. Delivery is at least once;
 * an expired send can have an uncertain outcome. Never send while holding a DB transaction. */
export function createPostgresPushDeliveryRepository(db:RuePostgresDatabase){
 return {
  async claimNext(now=Date.now()):Promise<PushDeliveryClaim|undefined>{
   timestamp(now)
   const rows=await db.execute<PushDeliveryClaim>(sql`
    WITH candidate AS (
     SELECT d.notification_id,d.subscription_id,s.owner_subject,s.encrypted_subscription,n.session_id,n.kind,n.created_at
     FROM push_deliveries d JOIN push_subscriptions s ON s.id=d.subscription_id
     JOIN notifications n ON n.id=d.notification_id AND n.owner_subject=s.owner_subject
     JOIN sessions chat ON chat.id=n.session_id AND chat.owner_subject=n.owner_subject
     WHERE s.expires_at>${now} AND n.created_at>${now-PUSH_MAX_AGE_MS}
      AND ((d.state='pending' AND d.next_at<=${now}) OR (d.state='sending' AND d.lease_until<=${now}))
     ORDER BY d.next_at,d.notification_id,d.subscription_id LIMIT 1 FOR UPDATE OF d SKIP LOCKED
    ), claimed AS (
     UPDATE push_deliveries d SET state='sending',attempts=d.attempts+1,lease_id=${randomUUID()},lease_until=${now+PUSH_LEASE_MS}
     FROM candidate c WHERE d.notification_id=c.notification_id AND d.subscription_id=c.subscription_id
     RETURNING d.notification_id,d.subscription_id,d.attempts,d.lease_id,d.lease_until
    ) SELECT d.notification_id AS "notificationId",d.subscription_id AS "subscriptionId",c.owner_subject AS "ownerSubject",
      c.encrypted_subscription AS "encryptedSubscription",c.session_id AS "sessionId",c.kind,
      d.attempts::float8 AS attempts,c.created_at::float8 AS "createdAt",d.lease_id AS "leaseId",d.lease_until::float8 AS "leaseUntil"
     FROM claimed d JOIN candidate c ON c.notification_id=d.notification_id AND c.subscription_id=d.subscription_id`)
   return rows[0]
  },
  async complete(claim:PushDeliveryClaim,outcome:{state:'sent'|'failed'|'pending';nextAt?:number},now=Date.now()){
   timestamp(now)
   if(!['sent','failed','pending'].includes(outcome.state))throw Error('push_delivery_outcome_invalid')
   if(outcome.state==='pending'&&(outcome.nextAt===undefined||outcome.nextAt<=now))throw Error('push_delivery_retry_time_invalid')
   const nextAt=outcome.nextAt??now;timestamp(nextAt)
   // Revalidate ownership and the encrypted subscription revision as well as the lease.
   // An old sender must not acknowledge a reclaimed lease or a refreshed subscription.
   const rows=await db.execute(sql`UPDATE push_deliveries d SET state=${outcome.state},next_at=${nextAt},lease_id=NULL,lease_until=NULL
    FROM push_subscriptions s,notifications n,sessions chat
    WHERE d.notification_id=${claim.notificationId} AND d.subscription_id=${claim.subscriptionId}
     AND d.state='sending' AND d.lease_id=${claim.leaseId} AND d.lease_until>${now}
     AND s.id=d.subscription_id AND s.owner_subject=${claim.ownerSubject} AND s.expires_at>${now}
     AND s.encrypted_subscription=${claim.encryptedSubscription}
     AND n.id=d.notification_id AND n.owner_subject=s.owner_subject AND chat.id=n.session_id AND chat.owner_subject=n.owner_subject
    RETURNING d.notification_id`)
   return rows.length===1
  },
 }
}
