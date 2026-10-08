import webpush from 'web-push'
import type {Database} from 'better-sqlite3'
import {createECDH} from 'node:crypto'
import {encryptionKey} from '../storage/agent-settings.js'
import {validatePushSubscription,type PushSubscription} from '../storage/push-subscriptions.js'
import {createSqliteNotificationServices,type NotificationServices} from './notification-services.js'
export interface PushPayload {id:string;sessionId?:string;kind:'task_completed'|'task_failed'|'test'}
export interface PushTransport {publicKey:string;send(subscription:PushSubscription,payload:PushPayload):Promise<void>}
export function configuredPushTransport(source:Database|(()=>Buffer|undefined),env:NodeJS.ProcessEnv=process.env):PushTransport|undefined{
 const publicKey=env.RUE_PUSH_PUBLIC_KEY,privateKey=env.RUE_PUSH_PRIVATE_KEY,subject=env.RUE_PUSH_SUBJECT
 if(!publicKey&&!privateKey&&!subject)return
 if(!publicKey||!privateKey||!subject||!(typeof source==='function'?source():encryptionKey(source)))throw Error('push_configuration_invalid')
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
const services=(source:Database|NotificationServices):NotificationServices=>'deliveries' in source?source:createSqliteNotificationServices(source)
/** Claim -> commit -> send -> fenced acknowledgement. No network I/O under a DB
 * transaction. A late failure cannot remove refreshed credentials or a new lease. */
export async function dispatchPushBatch(source:Database|NotificationServices,transport:PushTransport,now=Date.now()){
 const store=services(source)
 await store.deliveries.prune(now)
 let sent=0
 const started=performance.now(),clock=()=>now+Math.floor(performance.now()-started)
 for(let i=0;i<10;i++){
  const item=await store.deliveries.claimNext(clock())
  if(!item)break
  let state:'sent'|'failed'|'pending'='sent',next=clock()
  try{
   const subscription=store.decode(item.ownerSubject,item.subscriptionId,item.encryptedSubscription)
   await transport.send(subscription,{id:item.notificationId,sessionId:item.sessionId,kind:item.kind});sent++
  }catch(error){
   const status=(error as {statusCode?:number}|null)?.statusCode
   if(status===404||status===410){await store.deliveries.discardSubscription(item,clock());continue}
   const retry=(!status||status===429||status>=500)&&item.attempts<8
   state=retry?'pending':'failed'
   const retryAfter=Number((error as {headers?:Record<string,string>}|null)?.headers?.['retry-after'])
   next=clock()+Math.max(Math.min(3600000,15000*2**(item.attempts-1)),Number.isFinite(retryAfter)&&retryAfter>0?Math.min(3600000,retryAfter*1000):0)
  }
  await store.deliveries.complete(item,{state,nextAt:next},clock())
 }
 return sent
}
export function startPushDispatcher(source:Database|NotificationServices,transport:PushTransport){
 const store=services(source)
 let stopped=false,running:Promise<void>|undefined
 const tick=()=>{if(stopped||running)return;running=dispatchPushBatch(store,transport).then(()=>{},()=>{console.error('push_dispatch_failed')}).finally(()=>{running=undefined})}
 const timer=setInterval(tick,5000);timer.unref();tick()
 return async()=>{stopped=true;clearInterval(timer);await running}
}
