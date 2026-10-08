import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {createECDH,randomBytes,randomUUID} from 'node:crypto'
import type {Database} from 'better-sqlite3'
import {MIGRATIONS} from '../src/storage/schema.ts'
import {recordTaskNotification,notificationInbox,readNotification} from '../src/storage/notifications.ts'
import {savePushSubscription,removePushSubscription,validPushEndpoint} from '../src/storage/push-subscriptions.ts'
import {dispatchPushBatch,configuredPushTransport} from '../src/server/web-push.ts'
import {notificationRoutes} from '../src/server/routes/notifications.ts'
import {TurnOutcome} from '../../agent-runtime/src/turn-outcome.ts'
import {Hono} from 'hono'
import webpush from 'web-push'
function fixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const migration of MIGRATIONS)sqlite.exec(migration.sql)
 const db={name:':memory:',prepare:(sql:string)=>sqlite.prepare(sql),transaction:(fn:()=>unknown)=>({immediate:()=>{sqlite.exec('BEGIN IMMEDIATE');try{const value=fn();sqlite.exec('COMMIT');return value}catch(error){sqlite.exec('ROLLBACK');throw error}}})} as unknown as Database
 process.env.RUE_SETTINGS_ENCRYPTION_KEY=Buffer.alloc(32,1).toString('base64')
 db.prepare('INSERT INTO sessions(id,title,owner_subject,created_at,updated_at) VALUES(?,?,?,?,?)').run('ses_test','Test','owner',1,1)
 const curve=createECDH('prime256v1');curve.generateKeys()
 const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/fixture',keys:{p256dh:curve.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}}
 const device=randomUUID();return {db,sqlite,subscription,device}
}
test('subscription validation, encryption, ownership, revocation and inbox isolation',()=>{
 const f=fixture();try{
  for(const url of ['http://fcm.googleapis.com/x','https://127.0.0.1/x','https://fcm.googleapis.com.evil.test/x','https://user@fcm.googleapis.com/x','https://fcm.googleapis.com:8443/x'])assert.equal(validPushEndpoint(url),false)
  const saved=savePushSubscription(f.db,'owner',f.device,f.subscription,10)
  assert.throws(()=>savePushSubscription(f.db,'other',randomUUID(),f.subscription,10),/conflict/)
  assert.throws(()=>savePushSubscription(f.db,'owner',f.device,{...f.subscription,keys:{...f.subscription.keys,auth:'bad'}},10),/keys_invalid/)
  const row=f.db.prepare('SELECT encrypted_subscription FROM push_subscriptions WHERE id=?').get(saved.id) as any
  assert.equal(row.encrypted_subscription.includes('fcm.googleapis'),false)
  recordTaskNotification(f.db,'ses_test','task:1','task_completed',20);recordTaskNotification(f.db,'ses_test','task:1','task_completed',20)
  assert.equal(notificationInbox(f.db,'owner').items.length,1);assert.equal(notificationInbox(f.db,'other').items.length,0)
  const item=notificationInbox(f.db,'owner').items[0]!
  assert.equal(readNotification(f.db,'other',item.id),false);assert.equal(readNotification(f.db,'owner',item.id),true)
  assert.equal(notificationInbox(f.db,'owner').unread,0)
  removePushSubscription(f.db,'other',f.device);assert.equal((f.db.prepare('SELECT count(*) n FROM push_subscriptions').get() as any).n,1)
  removePushSubscription(f.db,'owner',f.device);assert.equal((f.db.prepare('SELECT count(*) n FROM push_deliveries').get() as any).n,0)
 }finally{f.sqlite.close()}
})
test('durable delivery retries, expiry, lease recovery, and dead endpoint removal',async()=>{
 const f=fixture();try{
  savePushSubscription(f.db,'owner',f.device,f.subscription,1000);recordTaskNotification(f.db,'ses_test','task:2','task_completed',1000)
  let calls=0;const transport={publicKey:'test',send:async(_s:unknown,payload:any)=>{calls++;assert.equal(payload.kind,'task_completed');assert.equal('text'in payload,false);if(calls===1)throw {statusCode:503}}}
  assert.equal(await dispatchPushBatch(f.db,transport,1000),0);assert.equal(calls,1)
  await dispatchPushBatch(f.db,transport,2000);assert.equal(calls,1)
  assert.equal(await dispatchPushBatch(f.db,transport,20000),1);assert.equal(calls,2)
  await dispatchPushBatch(f.db,transport,21000);assert.equal(calls,2)
  recordTaskNotification(f.db,'ses_test','task:3','task_failed',22000)
  f.db.prepare("UPDATE push_deliveries SET state='sending',lease_until=23000 WHERE state='pending'").run()
  await dispatchPushBatch(f.db,{publicKey:'test',send:async()=>{throw {statusCode:410}}},24000)
  assert.equal((f.db.prepare('SELECT count(*) n FROM push_subscriptions').get() as any).n,0)
  savePushSubscription(f.db,'owner',f.device,f.subscription,25000);recordTaskNotification(f.db,'ses_test','task:4','task_completed',25000)
  await dispatchPushBatch(f.db,transport,25000+86400001);assert.equal(calls,2)
 }finally{f.sqlite.close()}
})
test('inbox insertion and push outbox roll back together',()=>{
 const f=fixture();try{
  assert.throws(()=>f.db.transaction(()=>{recordTaskNotification(f.db,'ses_test','rollback','task_completed',1);throw Error('rollback')}).immediate())
  assert.equal(notificationInbox(f.db,'owner').items.length,0)
 }finally{f.sqlite.close()}
})
test('account routes reject non-users, isolate accounts, rate-limit tests, and expose no secrets',async()=>{
 const f=fixture();try{
  const transport={publicKey:'public-only',send:async()=>{}}
  const app=new Hono();app.use('*',async(c,next)=>{c.set('ctx',{db:f.db,pushTransport:transport} as any);c.set('principal',{subject:c.req.header('x-test-owner')??'owner',principalType:c.req.header('x-test-type')??'user',scopes:[]} as any);return next()});app.route('/notifications',notificationRoutes())
  const req=(path:string,method='GET',body?:unknown,owner='owner',type='user')=>app.request('/notifications'+path,{method,headers:{'content-type':'application/json','x-test-owner':owner,'x-test-type':type},body:body===undefined?undefined:JSON.stringify(body)})
  assert.equal((await req('/push','GET',undefined,'owner','machine')).status,403)
  assert.equal((await req('/push/'+f.device,'PUT',f.subscription)).status,200)
  const meta=await (await req('/push')).json() as any;assert.equal(meta.devices.length,1);assert.equal(JSON.stringify(meta).includes('endpoint'),false)
  assert.equal((await req('/push/'+f.device+'/test','POST')).status,200)
  assert.equal((await req('/push/'+f.device+'/test','POST')).status,429)
  assert.equal((await req('/push/'+f.device+'/test','POST',undefined,'other')).status,404)
  recordTaskNotification(f.db,'ses_test','http:1','task_completed')
  const item=notificationInbox(f.db,'owner').items[0]!
  assert.equal((await req('/'+item.id+'/read','POST',undefined,'other')).status,404)
  assert.equal((await req('/'+item.id+'/read','POST')).status,200)
 }finally{f.sqlite.close()}
})
test('VAPID and encrypted Web Push request construction use the real library',()=>{
 const f=fixture();try{
  const vapid=webpush.generateVAPIDKeys()
  assert.equal(configuredPushTransport(f.db,{}),undefined)
  assert.throws(()=>configuredPushTransport(f.db,{RUE_PUSH_PUBLIC_KEY:'invalid'}),/configuration_invalid/)
  assert.ok(configuredPushTransport(f.db,{RUE_PUSH_PUBLIC_KEY:vapid.publicKey,RUE_PUSH_PRIVATE_KEY:vapid.privateKey,RUE_PUSH_SUBJECT:'mailto:operator@example.test'}))
  const details=webpush.generateRequestDetails(f.subscription,JSON.stringify({id:randomUUID(),kind:'test'}),{vapidDetails:{...vapid,subject:'mailto:operator@example.test'},TTL:60})
  assert.equal(details.headers['Content-Encoding'],'aes128gcm');assert.match(String(details.headers.Authorization),/^vapid /);assert.ok(details.body?.length)
  assert.equal(details.body!.includes(Buffer.from('"kind":"test"')),false)
 }finally{f.sqlite.close()}
})
test('tool-only endings, empty errors and truncated replies are not successful final summaries',()=>{
 const outcome=new TurnOutcome();outcome.observe({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'Starting…'}],stopReason:'toolUse'}})
 outcome.observe({type:'tool_execution_end'});assert.match(outcome.diagnostic!,/without a final reply/)
 outcome.observe({type:'message_end',message:{role:'assistant',content:[],stopReason:'error'}});assert.match(outcome.diagnostic!,/interrupted/)
 outcome.observe({type:'message_end',message:{role:'assistant',content:'Done.',stopReason:'stop'}});assert.equal(outcome.diagnostic,undefined)
 outcome.observe({type:'message_end',message:{role:'assistant',content:'Partial',stopReason:'length'}});assert.match(outcome.diagnostic!,/interrupted/)
 outcome.observe({type:'message_end',message:{role:'assistant',content:[],stopReason:'error',errorMessage:'API key auth failed: Rue shared provider key unavailable. private-detail'}})
 // Provider failures are now forwarded once by the transcript bridge. Do not
 // manufacture a second generic diagnostic (or interpret its absence as success).
 assert.equal(outcome.errorReported,true);assert.equal(outcome.diagnostic,undefined)
})
