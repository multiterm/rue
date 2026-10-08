import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,randomBytes,createECDH,createCipheriv} from 'node:crypto'
import {createPostgresPushSubscriptionRepository} from '../src/postgres/push-subscriptions.js'
import {validatePushSubscription} from '../../../apps/core/src/storage/push-subscriptions.ts'
import {eq,sql} from 'drizzle-orm'
import {createPostgresDatabase} from '../src/postgres/client.js'
import {migratePostgresDatabase} from '../src/postgres/migrate.js'
import {sessions,notifications,pushSubscriptions,pushDeliveries} from '../src/postgres/schema.js'
import {createPostgresNotificationRepository,createPostgresPushDeliveryRepository,recordPostgresTaskNotification,PUSH_LEASE_MS,PUSH_MAX_AGE_MS} from '../src/postgres/notifications.js'
const adminUrl=process.env.RUE_PG_TEST_ADMIN_URL

test('PostgreSQL notifications and delivery leases',{skip:!adminUrl},async t=>{
 const admin=createPostgresDatabase({url:adminUrl,maxConnections:1}),name='rue_test_'+randomUUID().replaceAll('-','')
 let database:ReturnType<typeof createPostgresDatabase>|undefined,created=false
 try{
  await admin.sql`CREATE DATABASE ${admin.sql(name)}`;created=true
  const url=new URL(adminUrl!);url.pathname='/'+name;database=createPostgresDatabase({url:url.toString(),maxConnections:6})
  const db=database.db;await migratePostgresDatabase(db)
  const inbox=createPostgresNotificationRepository(db),queue=createPostgresPushDeliveryRepository(db),now=1790000000123
  await db.insert(sessions).values([{id:'a-chat',ownerSubject:'a',createdAt:now,updatedAt:now},{id:'b-chat',ownerSubject:'b',createdAt:now,updatedAt:now},{id:'unowned-chat',ownerSubject:'',createdAt:now,updatedAt:now}])
  await db.insert(pushSubscriptions).values([
   {id:'a-1',ownerSubject:'a',deviceId:'one',endpointHash:'hash-a-1',encryptedSubscription:'opaque-a-1'},
   {id:'a-2',ownerSubject:'a',deviceId:'two',endpointHash:'hash-a-2',encryptedSubscription:'opaque-a-2'},
   {id:'b-1',ownerSubject:'b',deviceId:'one',endpointHash:'hash-b-1',encryptedSubscription:'opaque-b-1'},
   {id:'a-expired',ownerSubject:'a',deviceId:'expired',endpointHash:'hash-expired',encryptedSubscription:'opaque-expired'},
  ].map(row=>({...row,createdAt:now,updatedAt:now,expiresAt:row.id==='a-expired'?now:now+2*PUSH_MAX_AGE_MS})))

  await t.test('concurrent event recording fans out once and task rollback includes notification/deliveries',async()=>{
   assert.equal(await recordPostgresTaskNotification(db,'b','a-chat','wrong-owner','task_completed',now),undefined)
   assert.equal(await recordPostgresTaskNotification(db,'a','unowned-chat','unowned','task_completed',now),undefined)
   const results=await Promise.all(Array.from({length:6},()=>recordPostgresTaskNotification(db,'a','a-chat','completed-event','task_completed',now)))
   assert.equal(results.filter(Boolean).length,1)
   const deliveryRows=await db.select().from(pushDeliveries)
   assert.deepEqual(deliveryRows.map(row=>row.subscriptionId).sort(),['a-1','a-2'])
   await assert.rejects(db.transaction(async tx=>{
    await recordPostgresTaskNotification(tx,'a','a-chat','rollback-event','task_failed',now)
    await tx.update(sessions).set({title:'Must roll back'}).where(eq(sessions.id,'a-chat'))
    throw Error('rollback-task')
   }),/rollback-task/)
   assert.equal((await db.select().from(notifications)).length,1)
   assert.equal((await db.select().from(pushDeliveries)).length,2)
   assert.equal((await db.select().from(sessions).where(eq(sessions.id,'a-chat')))[0]!.title,'')
  })

  await t.test('concurrent dispatchers claim different rows; retry and lease expiry fence old acknowledgements',async()=>{
   const claims=(await Promise.all(Array.from({length:6},()=>queue.claimNext(now)))).filter(claim=>claim!==undefined)
   assert.equal(claims.length,2);assert.equal(new Set(claims.map(c=>c.subscriptionId)).size,2)
   assert.equal(claims[0]!.attempts,1);assert.equal(claims[0]!.leaseUntil,now+PUSH_LEASE_MS)
   assert.equal(await queue.complete({...claims[0]!,ownerSubject:'b'},{state:'sent'},now+1),false)
   assert.equal(await queue.complete(claims[0]!,{state:'sent'},now+1),true)
   assert.equal(await queue.complete(claims[0]!,{state:'failed'},now+2),false)
   await assert.rejects(queue.complete(claims[1]!,{state:'pending',nextAt:now},now),/retry_time_invalid/)
   assert.equal(await queue.complete(claims[1]!,{state:'pending',nextAt:now+5000},now+1),true)
   assert.equal(await queue.claimNext(now+4999),undefined)
   const retry=(await queue.claimNext(now+5000))!;assert.equal(retry.attempts,2)
   assert.equal(await queue.complete(retry,{state:'sent'},retry.leaseUntil),false)
   const reclaimed=(await queue.claimNext(retry.leaseUntil))!;assert.equal(reclaimed.attempts,3);assert.notEqual(reclaimed.leaseId,retry.leaseId)
   assert.equal(await queue.complete(retry,{state:'sent'},retry.leaseUntil+1),false)
   assert.equal(await queue.complete(reclaimed,{state:'sent'},retry.leaseUntil+1),true)
   assert.equal(await queue.claimNext(retry.leaseUntil+2),undefined)
  })

  await t.test('a locked delivery is skipped instead of blocking an unrelated dispatcher',async()=>{
   await db.delete(notifications)
   const id=(await recordPostgresTaskNotification(db,'a','a-chat','locked-event','task_completed',now))!
   let locked!:()=>void,unlock!:()=>void
   const ready=new Promise<void>(resolve=>{locked=resolve}),release=new Promise<void>(resolve=>{unlock=resolve})
   const transaction=db.transaction(async tx=>{
    await tx.execute(sql`SELECT * FROM push_deliveries WHERE notification_id=${id} AND subscription_id='a-1' FOR UPDATE`)
    locked();await release
   })
   try{
    await Promise.race([ready,transaction])
    // Keep the test bounded even if SKIP LOCKED is accidentally removed.
    const deadline=AbortSignal.timeout(3000)
    const next=await Promise.race([queue.claimNext(now),new Promise<never>((_,reject)=>deadline.addEventListener('abort',()=>reject(Error('claim blocked on locked row')),{once:true}))])
    assert.equal(next?.subscriptionId,'a-2')
   }finally{unlock();await transaction}
   assert.equal((await queue.claimNext(now))?.subscriptionId,'a-1')
  })

  await t.test('refresh, expiry and cross-owner relationships are not delivery authority',async()=>{
   await db.delete(notifications)
   const id=(await recordPostgresTaskNotification(db,'a','a-chat','refresh-event','task_failed',now))!
   const claim=(await queue.claimNext(now))!
   await db.update(pushSubscriptions).set({encryptedSubscription:'updated-ciphertext'}).where(eq(pushSubscriptions.id,claim.subscriptionId))
   assert.equal(await queue.complete(claim,{state:'sent'},now+1),false)
   await db.delete(notifications)
   await db.insert(notifications).values({id:'mismatched',ownerSubject:'a',sessionId:'b-chat',eventKey:'mismatched',kind:'task_completed',createdAt:now})
   await db.insert(pushDeliveries).values({notificationId:'mismatched',subscriptionId:'a-1',nextAt:now})
   assert.equal(await queue.claimNext(now),undefined)
   assert.equal(await inbox.markRead('a','mismatched',now),false)
   assert.equal((await inbox.inbox('a')).items.length,0)
   await db.delete(notifications)
   await recordPostgresTaskNotification(db,'a','a-chat','too-old','task_completed',now)
   assert.equal(await queue.claimNext(now+PUSH_MAX_AGE_MS),undefined)
   await db.delete(notifications)
   await recordPostgresTaskNotification(db,'a','a-chat','expired-subscriptions','task_completed',now)
   await db.update(pushSubscriptions).set({expiresAt:now})
   assert.equal(await queue.claimNext(now),undefined)
   assert.ok(id)
  })

  await t.test('inbox pagination, full unread counts and idempotent reads remain owner-scoped',async()=>{
   await db.delete(notifications)
   await db.insert(notifications).values(Array.from({length:105},(_,i)=>({id:`n-${String(i).padStart(3,'0')}`,ownerSubject:'a',sessionId:'a-chat',eventKey:`event-${i}`,kind:'task_completed',createdAt:now})))
   await recordPostgresTaskNotification(db,'b','b-chat','b-event','task_failed',now)
   const first=await inbox.inbox('a');assert.equal(first.items.length,100);assert.equal(first.unread,105);assert.equal(first.items[0]!.id,'n-104')
   const second=await inbox.inbox('a',{cursor:first.nextCursor!});assert.equal(second.items.length,5);assert.equal(second.unread,105);assert.equal(second.nextCursor,null)
   assert.equal(new Set([...first.items,...second.items].map(row=>row.id)).size,105)
   assert.deepEqual(Object.keys(first.items[0]!).sort(),['createdAt','id','kind','readAt','sessionId'])
   assert.equal(await inbox.markRead('b','n-104',now+1),false)
   assert.equal(await inbox.markRead('a','n-104',now+1),true);assert.equal(await inbox.markRead('a','n-104',now+2),true)
   const updated=await inbox.inbox('a');assert.equal(updated.unread,104);assert.equal(updated.items[0]!.readAt,now+1)
   assert.equal((await inbox.inbox('b')).items.length,1)
   await assert.rejects(inbox.inbox(''),/owner_required/);await assert.rejects(inbox.inbox('a',{limit:101}),/page_invalid/)
   await assert.rejects(queue.claimNext(NaN),/time_invalid/)
   await assert.rejects(inbox.inbox('a',{cursor:{id:'n-1',createdAt:-1}}),/time_invalid/)
  })
  const key=randomBytes(32),curve=createECDH('prime256v1');curve.generateKeys()
  const subscription=()=>({endpoint:'https://fcm.googleapis.com/'+randomUUID(),keys:{p256dh:curve.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}})
  const subscriptions=createPostgresPushSubscriptionRepository(db,{validate:validatePushSubscription,codec:{encrypt(scope,value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(JSON.stringify(scope)));return Buffer.concat([iv,cipher.update(value),cipher.final(),cipher.getAuthTag()]).toString('base64')}}})
  await t.test('endpoint enrollment has one owner under concurrent claims and validates before storage',async()=>{
   const input=subscription(),claims=await Promise.allSettled(Array.from({length:6},()=>subscriptions.save(randomUUID(),'browser',input,now)))
   assert.equal(claims.filter(r=>r.status==='fulfilled').length,1)
   assert.ok(claims.filter(r=>r.status==='rejected').every(r=>(r as PromiseRejectedResult).reason.message==='push_subscription_conflict'))
   assert.throws(()=>subscriptions.save('x','browser',{...input,endpoint:'https://localhost/private'},now),/push_endpoint_invalid/)
   assert.throws(()=>subscriptions.save('x','browser',{...input,keys:{...input.keys,auth:'invalid'}},now),/push_keys_invalid/)
  })
  await t.test('refresh fences old delivery acknowledgements and replacement removes old deliveries',async()=>{
   const owner=randomUUID(),sessionId=randomUUID(),input=subscription()
   await db.insert(sessions).values({id:sessionId,ownerSubject:owner,createdAt:now,updatedAt:now})
   const first=await subscriptions.save(owner,'browser',input,now)
   await recordPostgresTaskNotification(db,owner,sessionId,randomUUID(),'task_completed',now)
   const claim=await queue.claimNext(now);assert.equal(claim!.subscriptionId,first.id)
   const refreshed=await subscriptions.save(owner,'browser',input,now+1);assert.equal(refreshed.id,first.id)
   assert.equal(await queue.complete(claim!,{state:'sent'},now+2),false)
   const replaced=await subscriptions.save(owner,'browser',subscription(),now+3);assert.notEqual(replaced.id,first.id)
   assert.equal((await db.select().from(pushDeliveries).where(eq(pushDeliveries.subscriptionId,first.id))).length,0)
   const [stored]=await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id,replaced.id))
   assert.equal(stored!.encryptedSubscription.includes(input.keys.auth),false)
   assert.deepEqual(Object.keys(replaced).sort(),['deviceId','expiresAt','id'])
   await subscriptions.remove('other-owner','browser');assert.equal((await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id,replaced.id))).length,1)
   await subscriptions.remove(owner,'browser');assert.equal((await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id,replaced.id))).length,0)
  })
  await t.test('subscription quota reserves a single final slot atomically',async()=>{
   const owner=randomUUID()
   await db.insert(pushSubscriptions).values(Array.from({length:19},(_,i)=>({id:randomUUID(),ownerSubject:owner,deviceId:String(i),endpointHash:randomUUID(),encryptedSubscription:'fixture',createdAt:now,updatedAt:now,expiresAt:now+1000})))
   const results=await Promise.allSettled(Array.from({length:5},()=>subscriptions.save(owner,randomUUID(),subscription(),now)))
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
   assert.equal((await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.ownerSubject,owner))).length,20)
  })
 }finally{await database?.close();if(created)await admin.sql`DROP DATABASE ${admin.sql(name)}`;await admin.close()}
})
