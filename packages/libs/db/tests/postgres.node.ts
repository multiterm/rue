import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {eq} from 'drizzle-orm'
import {createPostgresDatabase} from '../src/postgres/client.js'
import {migratePostgresDatabase} from '../src/postgres/migrate.js'
import {createPostgresSessionRepository} from '../src/postgres/sessions.js'
import {sessions,messages,parts,postgresSchema,agentSettings,notebooks,agentUsageEvents} from '../src/postgres/schema.js'
import {getTableConfig} from 'drizzle-orm/pg-core'
import {appRouter} from '../../trpc/src/index.js'
const adminUrl=process.env.RUE_PG_TEST_ADMIN_URL

test('PostgreSQL migrations, typed repository, owner-scoped tRPC and data integrity',{skip:!adminUrl},async()=>{
 const admin=createPostgresDatabase({url:adminUrl,maxConnections:1}),name=`rue_test_${randomUUID().replaceAll('-','')}`
 let database:ReturnType<typeof createPostgresDatabase>|undefined,created=false
 try{
  await admin.sql`CREATE DATABASE ${admin.sql(name)}`;created=true
  const url=new URL(adminUrl!);url.pathname='/'+name;database=createPostgresDatabase({url:url.toString(),maxConnections:2})
  await migratePostgresDatabase(database.db);await migratePostgresDatabase(database.db)
  const columns=await database.sql`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'`
  assert.deepEqual([...new Set(columns.map(row=>row.table_name))].sort(),Object.values(postgresSchema).map(table=>getTableConfig(table).name).sort())
  for(const table of Object.values(postgresSchema)){
   const config=getTableConfig(table)
   assert.deepEqual(columns.filter(row=>row.table_name===config.name).map(row=>row.column_name).sort(),config.columns.map(column=>column.name).sort(),config.name)
  }
  const ciphertext='opaque:v1:encrypted+/bytes=='
  await database.db.insert(agentSettings).values({ownerSubject:'owner_a',settings:'{"preserved": true}',encryptedKey:ciphertext,revision:1})
  assert.equal((await database.db.select().from(agentSettings))[0]!.encryptedKey,ciphertext)
  const [notebook]=await database.db.insert(notebooks).values({name:'Notebook',path:'/workspace/notebook',updatedAt:1790000000123}).returning()
  assert.ok(notebook!.id>0)
  const owner='owner_a',other='owner_b',now=1790000000123
  await database.db.insert(sessions).values([
   ...Array.from({length:105},(_,i)=>({id:`ses_${String(i).padStart(3,'0')}`,title:`Bot ${i}`,ownerSubject:owner,createdAt:now,updatedAt:now,scopes:['/workspace'],meta:{pinned:i===0,description:'Unicode ✓'}})),
   {id:'other',ownerSubject:other,createdAt:now,updatedAt:now},
  ])
  await database.db.insert(agentUsageEvents).values({ownerSubject:owner,sessionId:'ses_000',connectionId:'connection',eventId:'event',provider:'test',model:'test',time:now,inputTokens:1,outputTokens:2,cacheReadTokens:0,cacheWriteTokens:0,costUsd:0.000123})
  assert.equal((await database.db.select().from(agentUsageEvents))[0]!.costUsd,0.000123)
  const repository=createPostgresSessionRepository(database.db)
  const caller=appRouter.createCaller({sessions:repository,principalSubject:owner})
  const first=await caller.sessionsPage({limit:100});assert.equal(first.items.length,100);assert.ok(first.nextCursor)
  const second=await caller.sessionsPage({limit:100,cursor:first.nextCursor!});assert.equal(second.items.length,5);assert.equal(second.nextCursor,null)
  assert.equal(new Set([...first.items,...second.items].map(row=>row.id)).size,105)
  assert.equal(first.items[0]!.id,'ses_104');assert.equal(first.items[0]!.createdAt,now);assert.deepEqual(first.items[0]!.scopes,['/workspace'])
  assert.equal((await caller.session({id:'ses_000'})).meta.description,'Unicode ✓')
  await assert.rejects(caller.session({id:'other'}),error=>(error as {code?:string}).code==='NOT_FOUND')
  await assert.rejects(caller.sessionsPage({limit:101}),error=>(error as {code?:string}).code==='BAD_REQUEST')
  await assert.rejects(appRouter.createCaller({sessions:repository,principalSubject:''}).sessions(),error=>(error as {code?:string}).code==='UNAUTHORIZED')
  await assert.rejects(database.db.transaction(async tx=>{await tx.insert(sessions).values({id:'rolled-back',ownerSubject:owner,createdAt:now,updatedAt:now});throw Error('rollback')}))
  assert.equal(await repository.get(owner,'rolled-back'),undefined)
  await database.db.insert(messages).values({id:'message',sessionId:'ses_000',role:'user',time:now,seq:0})
  const preservedText='Preserved transcript'+String.fromCharCode(0,0xd800)
  await database.db.insert(parts).values({id:'part',sessionId:'ses_000',messageId:'message',type:'text',seq:0,payload:{text:preservedText}})
  assert.deepEqual((await database.db.select().from(parts))[0]!.payload,{text:preservedText})
  await database.db.delete(sessions).where(eq(sessions.id,'ses_000'))
  assert.equal((await database.db.select().from(messages)).length,0);assert.equal((await database.db.select().from(parts)).length,0)
  assert.equal((await database.db.select().from(agentUsageEvents)).length,0)
  await assert.rejects(database.sql`INSERT INTO messages(id,session_id,role,time,seq) VALUES('invalid','ses_001','invalid',${now},0)`)
 }finally{await database?.close();if(created)await admin.sql`DROP DATABASE ${admin.sql(name)}`;await admin.close()}
})
test('PostgreSQL configuration rejects missing/malformed connection options without exposing credentials',()=>{
 assert.throws(()=>createPostgresDatabase({url:'sqlite:secret'}),/Expected a PostgreSQL/)
 assert.throws(()=>createPostgresDatabase({url:'bad-secret'}),/Invalid PostgreSQL/)
 assert.throws(()=>createPostgresDatabase({url:'postgres://test@localhost/test',maxConnections:0}),/pool size/)
})
