import {createHash,randomUUID,createECDH} from 'node:crypto'
import type {Database} from 'better-sqlite3'
import {z} from 'zod'
import {encryptCredential} from './agent-settings.js'
export const pushSubscriptionSchema=z.object({endpoint:z.string().max(2048),keys:z.object({p256dh:z.string().max(128),auth:z.string().max(32)}).strict()}).strict()
export type PushSubscription=z.infer<typeof pushSubscriptionSchema>
/** Do not turn user-provided subscriptions into an arbitrary outbound HTTP proxy. */
export function validPushEndpoint(endpoint:string){
 try{const url=new URL(endpoint);return url.protocol==='https:'&&!url.username&&!url.password&&!url.hash&&(!url.port||url.port==='443')&&['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(url.hostname)}catch{return false}
}
export function validatePushSubscription(input:unknown):PushSubscription{
 const value=pushSubscriptionSchema.parse(input)
 if(!validPushEndpoint(value.endpoint))throw Error('push_endpoint_invalid')
 for(const [key,length] of [['p256dh',65],['auth',16]] as const){const text=value.keys[key];if(!/^[A-Za-z0-9_-]+$/.test(text)||Buffer.from(text,'base64url').length!==length||Buffer.from(text,'base64url').toString('base64url')!==text)throw Error('push_keys_invalid')}
 try{const curve=createECDH('prime256v1');curve.generateKeys();curve.computeSecret(Buffer.from(value.keys.p256dh,'base64url'))}catch{throw Error('push_keys_invalid')}
 return value
}
export function savePushSubscription(db:Database,owner:string,deviceId:string,input:unknown,now=Date.now()){
 const value=validatePushSubscription(input),hash=createHash('sha256').update(value.endpoint).digest('hex')
 return db.transaction(()=>{
  const bound=db.prepare('SELECT owner_subject,device_id FROM push_subscriptions WHERE endpoint_hash=?').get(hash) as {owner_subject:string;device_id:string}|undefined
  if(bound&&(bound.owner_subject!==owner||bound.device_id!==deviceId))throw Error('push_subscription_conflict')
  const previous=db.prepare('SELECT id,endpoint_hash FROM push_subscriptions WHERE owner_subject=? AND device_id=?').get(owner,deviceId) as {id:string;endpoint_hash:string}|undefined
  if(!previous&&(db.prepare('SELECT count(*) AS n FROM push_subscriptions WHERE owner_subject=?').get(owner) as {n:number}).n>=20)throw Error('push_device_limit')
  // Replacing a browser subscription cancels its old pending deliveries.
  if(previous&&previous.endpoint_hash!==hash)db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(previous.id)
  const id=previous?.endpoint_hash===hash?previous.id:randomUUID()
  const encrypted=encryptCredential(db,[owner,'web-push',id],JSON.stringify(value))
  db.prepare(`INSERT INTO push_subscriptions(id,owner_subject,device_id,endpoint_hash,encrypted_subscription,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(owner_subject,device_id) DO UPDATE SET encrypted_subscription=excluded.encrypted_subscription,updated_at=excluded.updated_at,expires_at=excluded.expires_at`).run(id,owner,deviceId,hash,encrypted,now,now,now+90*86400000)
  return {id,deviceId,expiresAt:now+90*86400000}
 }).immediate()
}
export function removePushSubscription(db:Database,owner:string,deviceId:string){db.prepare('DELETE FROM push_subscriptions WHERE owner_subject=? AND device_id=?').run(owner,deviceId)}
