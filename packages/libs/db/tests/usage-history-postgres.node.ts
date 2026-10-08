import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHmac,randomBytes,randomUUID} from 'node:crypto'
import {eq} from 'drizzle-orm'
import {createPostgresDatabase} from '../src/postgres/client.ts'
import {migratePostgresDatabase} from '../src/postgres/migrate.ts'
import {createPostgresUsageRepository} from '../src/postgres/agent-usage.ts'
import {createPostgresHistoryRepository} from '../src/postgres/history.ts'
import {appendPostgresMessage,appendPostgresPart} from '../src/postgres/conversation-writes.ts'
import {lockPostgresOwner} from '../src/postgres/owner-lock.ts'
import {sessions,messages,parts,preferences,usageCredentials,terminalConnections} from '../src/postgres/schema.ts'
import {usageEventSchema} from '../../../apps/core/src/storage/agent-usage.ts'
const adminUrl=process.env.RUE_PG_TEST_ADMIN_URL

test('PostgreSQL usage accounting and cloud history',{skip:!adminUrl},async t=>{
 const admin=createPostgresDatabase({url:adminUrl,maxConnections:1}),name='rue_test_'+randomUUID().replaceAll('-','')
 let pool:ReturnType<typeof createPostgresDatabase>|undefined,created=false
 try{
  await admin.sql`CREATE DATABASE ${admin.sql(name)}`;created=true
  const url=new URL(adminUrl!);url.pathname='/'+name;pool=createPostgresDatabase({url:url.toString(),maxConnections:8});await migratePostgresDatabase(pool.db)
  const db=pool.db,key=randomBytes(32),now=Date.UTC(2026,9,5,12)
  const usage=createPostgresUsageRepository(db,{parseEvent:raw=>usageEventSchema.parse(raw),encryptionKey:()=>key}),history=createPostgresHistoryRepository(db)
  async function fixture(){const owner=randomUUID(),id='ses_'+randomUUID();await db.insert(sessions).values({id,ownerSubject:owner,createdAt:now,updatedAt:now});return {owner,id}}
  const event=(time=now)=>({eventId:randomUUID(),provider:'openai',model:'model',credentialId:null as string|null,time,input:10,output:20,cacheRead:3,cacheWrite:4,costUsd:null as number|null})
  await t.test('credential IDs match the legacy HMAC algorithm without storing the key',async()=>{
   const f=await fixture(),apiKey='fixture-private-key',expected='key_'+createHmac('sha256',key).update(JSON.stringify([f.owner,'openai',apiKey])).digest('hex')
   const ids=await Promise.all(Array.from({length:5},()=>usage.credential(f.owner,'openai',apiKey,now)))
   assert.ok(ids.every(id=>id===expected));assert.equal((await db.select().from(usageCredentials).where(eq(usageCredentials.ownerSubject,f.owner))).length,1)
   assert.notEqual(await usage.credential('different-owner','openai',apiKey,now),expected)
   assert.notEqual(await usage.credential(f.owner,'anthropic',apiKey,now),expected)
   assert.equal(JSON.stringify(await db.select().from(usageCredentials)).includes(apiKey),false)
  })
  await t.test('events deduplicate under contention and reports preserve UTC/null-price/fractional-cost semantics',async()=>{
   const f=await fixture(),e=event(),outcomes=await Promise.all(Array.from({length:8},()=>usage.recordCloud(f.owner,f.id,e,now)))
   assert.equal(outcomes.filter(Boolean).length,1)
   await usage.recordCloud(f.owner,f.id,{...event(),costUsd:0.0000125},now)
   await usage.recordCloud(f.owner,f.id,event(now-86400000),now)
   const report=await usage.report(f.owner,f.id,2,now)
   assert.equal(report.rows.length,2);assert.equal(report.rows[0]!.costUsd,null)
   assert.equal(report.rows[1]!.time,Date.UTC(2026,9,5));assert.equal(report.rows[1]!.requests,2);assert.equal(report.rows[1]!.input,20)
   assert.equal(report.rows[1]!.costUsd,0.0000125);assert.equal(report.rows[1]!.unpricedRequests,1)
   assert.deepEqual((await usage.report('other-owner',f.id,2,now)).rows,[])
   await assert.rejects(usage.report(f.owner,f.id,0,now),/Invalid usage range/)
  })
  await t.test('owner, credential, provider, connection and future-time checks reject invalid attribution',async()=>{
   const f=await fixture(),other=await fixture(),credentialId=await usage.credential(other.owner,'openai','fixture',now)
   await assert.rejects(usage.recordCloud(other.owner,f.id,event(),now),/Invalid usage owner/)
   await assert.rejects(usage.recordCloud(f.owner,f.id,{...event(),credentialId},now),/Invalid usage credential/)
   const wrongProvider=await usage.credential(f.owner,'anthropic','fixture',now)
   await assert.rejects(usage.recordCloud(f.owner,f.id,{...event(),credentialId:wrongProvider},now),/Invalid usage credential/)
   await assert.rejects(usage.recordCloud(f.owner,f.id,event(now+300001),now),/Invalid usage time/)
   await assert.rejects(db.transaction(tx=>usage.recordInTransaction(tx,f.owner,f.id,'unbound-connection',event(),now)),/Invalid usage connection/)
   assert.deepEqual((await usage.report(f.owner,f.id,1,now)).rows,[])
  })
  await t.test('usage creation rolls back with the caller transaction',async()=>{
   const f=await fixture()
   await assert.rejects(db.transaction(async tx=>{const credentialId=await usage.credentialInTransaction(tx,f.owner,'openai','fixture',now);await usage.recordInTransaction(tx,f.owner,f.id,`cloud:${f.id}`,{...event(),credentialId},now);throw Error('rollback-fixture')}),/rollback-fixture/)
   assert.deepEqual((await usage.report(f.owner,f.id,1,now)).rows,[])
   assert.equal((await db.select().from(usageCredentials).where(eq(usageCredentials.ownerSubject,f.owner))).length,0)
  })
  await t.test('history clear has one CAS winner, cascades message data and retains session/usage',async()=>{
   const f=await fixture(),mid=randomUUID()
   await db.transaction(async tx=>{await appendPostgresMessage(tx,f.owner,{id:mid,sessionId:f.id,role:'assistant'});await appendPostgresPart(tx,f.owner,{id:randomUUID(),sessionId:f.id,messageId:mid,type:'text',payload:{text:'history'}});await tx.insert(preferences).values({messageId:mid,rating:1})})
   await usage.recordCloud(f.owner,f.id,event(),now)
   const outcomes=await Promise.allSettled(Array.from({length:5},()=>history.clear(f.owner,f.id,mid,now+1)))
   assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1)
   assert.equal((await db.select().from(messages).where(eq(messages.sessionId,f.id))).length,0)
   assert.equal((await db.select().from(parts).where(eq(parts.sessionId,f.id))).length,0)
   assert.equal((await db.select().from(preferences).where(eq(preferences.messageId,mid))).length,0)
   assert.equal((await usage.report(f.owner,f.id,1,now)).rows.length,1)
   assert.equal((await db.select().from(sessions).where(eq(sessions.id,f.id)))[0]!.updatedAt,now+1)
  })
  await t.test('a clear waiting behind a message write cannot erase unseen history',async()=>{
   const f=await fixture();let pending:Promise<unknown>|undefined
   await db.transaction(async tx=>{await lockPostgresOwner(tx,f.owner);pending=history.clear(f.owner,f.id,null,now);await appendPostgresMessage(tx,f.owner,{id:randomUUID(),sessionId:f.id,role:'user'})})
   await assert.rejects(pending!,/history_changed/)
   assert.equal((await db.select().from(messages).where(eq(messages.sessionId,f.id))).length,1)
  })
  await t.test('remote history and cross-owner clear are refused',async()=>{
   const f=await fixture()
   await assert.rejects(history.clear('other-owner',f.id,null,now),/session_not_found/)
   await db.insert(terminalConnections).values({id:'term_'+randomUUID(),ownerSubject:f.owner,sessionId:f.id,piSessionId:randomUUID(),tokenHash:randomUUID(),expiresAt:now,createdAt:now})
   await assert.rejects(history.clear(f.owner,f.id,null,now),/remote_history_reset_required/)
   const orphan=await fixture();await db.update(sessions).set({agent:'pi-terminal'}).where(eq(sessions.id,orphan.id))
   await assert.rejects(history.clear(orphan.owner,orphan.id,null,now),/remote_history_reset_required/)
  })
 }finally{await pool?.close();if(created)await admin.sql`DROP DATABASE ${admin.sql(name)}`;await admin.close()}
})
