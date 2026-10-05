import webpush from 'web-push'
import type {Database} from 'better-sqlite3'
import {randomUUID,createECDH} from 'node:crypto'
import {decryptCredential,encryptionKey} from '../storage/agent-settings.js'
import {validatePushSubscription,type PushSubscription} from '../storage/push-subscriptions.js'
export interface PushPayload {id:string;sessionId?:string;kind:'task_completed'|'task_failed'|'test'}
export interface PushTransport {publicKey:string;send(subscription:PushSubscription,payload:PushPayload):Promise<void>}
export function configuredPushTransport(db:Database,env:NodeJS.ProcessEnv=process.env):PushTransport|undefined{
 const publicKey=env.RUE_PUSH_PUBLIC_KEY,privateKey=env.RUE_PUSH_PRIVATE_KEY,subject=env.RUE_PUSH_SUBJECT
 if(!publicKey&&!privateKey&&!subject)return
 if(!publicKey||!privateKey||!subject||!encryptionKey(db))throw Error('push_configuration_invalid')
 // Validate at startup, not after accepting subscriptions.
 try{
  webpush.setVapidDetails(subject,publicKey,privateKey)
  const pair=createECDH('prime256v1');pair.setPrivateKey(Buffer.from(privateKey,'base64url'))
  if(pair.getPublicKey().toString('base64url')!==publicKey)throw Error('mismatch')
 }catch{throw Error('push_configuration_invalid')}
 return {publicKey,send:async(subscription,payload)=>{
  validatePushSubscription(subscription)
  await webpush.sendNotification(subscription,JSON.stringify(payload),{vapidDetails:{subject,publicKey,privateKey},TTL:86400,urgency:'normal',timeout:10000})
 }}
}
interface Delivery {notification_id:string;subscription_id:string;owner_subject:string;encrypted_subscription:string;session_id:string;kind:PushPayload['kind'];attempts:number;created_at:number}
/** A lease makes delivery crash-recoverable across restarts. Delivery is at least once. */
export async function dispatchPushBatch(db:Database,transport:PushTransport,now=Date.now()){
 db.prepare('DELETE FROM push_subscriptions WHERE expires_at<=?').run(now)
 db.prepare("UPDATE push_deliveries SET state='failed' WHERE state IN ('pending','sending') AND notification_id IN (SELECT id FROM notifications WHERE created_at<?)").run(now-86400000)
 let sent=0
 const started=performance.now(),clock=()=>now+Math.floor(performance.now()-started)
 for(let i=0;i<10;i++){
  const lease=randomUUID(),claimedAt=clock()
  const item=db.transaction(()=>{
   const row=db.prepare(`SELECT d.notification_id,d.subscription_id,d.attempts,s.owner_subject,s.encrypted_subscription,n.session_id,n.kind,n.created_at FROM push_deliveries d
    JOIN push_subscriptions s ON s.id=d.subscription_id JOIN notifications n ON n.id=d.notification_id AND n.owner_subject=s.owner_subject
    JOIN sessions chat ON chat.id=n.session_id AND chat.owner_subject=n.owner_subject
    WHERE s.expires_at>? AND n.created_at>? AND ((d.state='pending' AND d.next_at<=?) OR (d.state='sending' AND d.lease_until<=?)) ORDER BY d.next_at LIMIT 1`).get(claimedAt,claimedAt-86400000,claimedAt,claimedAt) as Delivery|undefined
   if(!row)return
   db.prepare("UPDATE push_deliveries SET state='sending',attempts=attempts+1,lease_id=?,lease_until=? WHERE notification_id=? AND subscription_id=?").run(lease,claimedAt+60000,row.notification_id,row.subscription_id)
   return row
  }).immediate()
  if(!item)break
  let state='sent',next=now
  try{
   const subscription=validatePushSubscription(JSON.parse(decryptCredential(db,[item.owner_subject,'web-push',item.subscription_id],item.encrypted_subscription)))
   await transport.send(subscription,{id:item.notification_id,sessionId:item.session_id,kind:item.kind});sent++
  }catch(error){
   const status=(error as {statusCode?:number}).statusCode
   if(status===404||status===410){db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(item.subscription_id);continue}
   const retry=(!status||status===429||status>=500)&&item.attempts<7
   state=retry?'pending':'failed'
   const retryAfter=Number((error as {headers?:Record<string,string>}).headers?.['retry-after'])
   next=clock()+Math.max(Math.min(3600000,15000*2**item.attempts),Number.isFinite(retryAfter)&&retryAfter>0?Math.min(3600000,retryAfter*1000):0)
  }
  db.prepare('UPDATE push_deliveries SET state=?,next_at=?,lease_id=NULL,lease_until=NULL WHERE notification_id=? AND subscription_id=? AND lease_id=?').run(state,next,item.notification_id,item.subscription_id,lease)
 }
 return sent
}
export function startPushDispatcher(db:Database,transport:PushTransport){
 let stopped=false,running:Promise<void>|undefined
 const tick=()=>{if(stopped||running)return;running=dispatchPushBatch(db,transport).then(()=>{},()=>{console.error('push_dispatch_failed')}).finally(()=>{running=undefined})}
 const timer=setInterval(tick,5000);timer.unref();tick()
 return async()=>{stopped=true;clearInterval(timer);await running}
}
