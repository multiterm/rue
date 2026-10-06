import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,randomBytes,createECDH} from 'node:crypto'
import {Hono} from 'hono'
import type {Database} from 'better-sqlite3'
import {createPostgresDatabase,migratePostgresDatabase} from '@multiterm/rue-db/postgres'
import {createPostgresSessionServices} from '../../src/server/postgres-session-services.js'
import {notificationRoutes} from '../../src/server/routes/notifications.js'
import {dispatchPushBatch} from '../../src/server/web-push.js'
import type {ServerContext} from '../../src/server/context.js'
import {ConfigSchema} from '../../src/config/index.js'
import {Bus} from '../../src/bus/index.js'
const adminUrl=process.env.RUE_PG_TEST_ADMIN_URL

test('PostgreSQL notification HTTP and dispatcher never access SQLite',{skip:!adminUrl},async t=>{
 const admin=createPostgresDatabase({url:adminUrl,maxConnections:1}),name='rue_test_'+randomUUID().replaceAll('-','')
 let pool:ReturnType<typeof createPostgresDatabase>|undefined,created=false,sqliteAccess=0
 try{
  await admin.sql`CREATE DATABASE ${admin.sql(name)}`;created=true
  const url=new URL(adminUrl!);url.pathname='/'+name;pool=createPostgresDatabase({url:url.toString(),maxConnections:8});await migratePostgresDatabase(pool.db)
  const services=createPostgresSessionServices(pool.db,()=>Buffer.alloc(32,7)),store=services.notifications
  const ctx:ServerContext={db:new Proxy({} as Database,{get(){sqliteAccess++;throw Error('SQLite access forbidden')}}),sessions:services,config:ConfigSchema.parse({}),bus:new Bus(),pushTransport:{publicKey:'fixture-public-key',send:async()=>{}}}
  const app=new Hono();app.onError((_error,c)=>c.json({error:'internal_error'},500))
  app.use('*',async(c,next)=>{c.set('ctx',ctx);c.set('principal',{subject:c.req.header('x-fixture-owner')??'owner',principalType:c.req.header('x-fixture-machine')?'machine':'user',scopes:[]});return next()});app.route('/notifications',notificationRoutes())
  const request=(path:string,method='GET',body?:unknown,owner='owner',machine=false)=>app.request('/notifications'+path,{method,headers:{'content-type':'application/json','x-fixture-owner':owner,...machine?{'x-fixture-machine':'1'}:{}},body:body===undefined?undefined:JSON.stringify(body)})
  const curve=createECDH('prime256v1');curve.generateKeys()
  const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/fixture',keys:{p256dh:curve.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}}
  const session=randomUUID();await services.conversations.create('owner',{id:session})
  await t.test('account ownership, metadata secrecy, single-winner test rate limit and read-all',async()=>{
   const device=randomUUID()
   assert.equal((await request('/push','GET',undefined,'owner',true)).status,403)
   assert.equal((await request('/push/'+device,'PUT',{})).status,400)
   assert.equal((await request('/push/'+device,'PUT',subscription)).status,200)
   const metadata=await (await request('/push')).text();assert.equal(metadata.includes('endpoint'),false);assert.equal(metadata.includes('encrypted'),false)
   let sends=0;ctx.pushTransport!.send=async()=>{sends++}
   const results=await Promise.all(Array.from({length:6},()=>request('/push/'+device+'/test','POST')))
   assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===429).length,5);assert.equal(sends,1)
   assert.equal((await request('/push/'+device+'/test','POST',undefined,'other')).status,404)
   await services.notifyCompletion('owner',session,'fixture-one','task_completed')
   const {items}=await store.inbox('owner');assert.equal(items.length,1)
   assert.equal((await request('/'+items[0]!.id+'/read','POST',undefined,'other')).status,404)
   await request('/read-all','POST',undefined,'other');assert.equal((await store.inbox('owner')).unread,1)
   assert.equal((await request('/read-all','POST')).status,200);assert.equal((await store.inbox('owner')).unread,0)
   const payloads:unknown[]=[]
   assert.equal(await dispatchPushBatch(store,{publicKey:'fixture',send:async(_s,payload)=>{payloads.push(payload)}}),1)
   assert.deepEqual(Object.keys(payloads[0] as object).sort(),['id','kind','sessionId'])
   assert.equal(await dispatchPushBatch(store,ctx.pushTransport!),0)
   await request('/push/'+device,'DELETE')
  })
  await t.test('a late dead-endpoint result cannot remove a refreshed subscription',async()=>{
   const device=randomUUID(),now=Date.now()
   await store.subscriptions.save('owner',device,subscription,now)
   await services.notifyCompletion('owner',session,'fixture-refresh','task_completed')
   let sends=0
   const transport={publicKey:'fixture',send:async()=>{sends++;await store.subscriptions.save('owner',device,subscription,now+1);throw {statusCode:410}}}
   assert.equal(await dispatchPushBatch(store,transport),0);assert.equal(sends,1)
   assert.equal((await store.subscriptions.list('owner')).length,1)
   assert.equal(await dispatchPushBatch(store,{publicKey:'fixture',send:async()=>{}},now+61000),1)
   await store.subscriptions.remove('owner',device)
  })
  await t.test('reclaimed leases fence late endpoint deletion and expired deliveries are cleaned',async()=>{
   const now=Date.now(),device=randomUUID()
   await store.subscriptions.save('owner',device,subscription,now)
   await services.notifyCompletion('owner',session,'fixture-takeover','task_completed')
   const old=await store.deliveries.claimNext(Date.now());assert.ok(old)
   const next=await store.deliveries.claimNext(old.leaseUntil);assert.ok(next)
   assert.equal(await store.deliveries.discardSubscription(old,next.leaseUntil-1),false)
   assert.equal((await store.subscriptions.list('owner')).length,1)
   assert.equal(await store.deliveries.discardSubscription(next,next.leaseUntil-1),true)
   await store.subscriptions.save('owner',device,subscription,now)
   await services.notifyCompletion('owner',session,'fixture-expired','task_failed')
   assert.equal(await dispatchPushBatch(store,{publicKey:'fixture',send:async()=>{assert.fail('expired notification sent')}},now+86460000),0)
   const rows=await pool!.sql`SELECT state FROM push_deliveries`;assert.ok(rows.every(r=>r.state==='failed'))
   await store.subscriptions.remove('owner',device)
  })
  assert.equal(sqliteAccess,0)
 }finally{await pool?.close();if(created)await admin.sql`DROP DATABASE ${admin.sql(name)} WITH (FORCE)`;await admin.close()}
})
