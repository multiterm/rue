import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
import {createServer} from 'node:http'
import {once} from 'node:events'
import {createPostgresDatabase,migratePostgresDatabase} from '@multiterm/rue-db/postgres'
import {listen,type RueServer} from '../../src/server/listen.js'
import {openDatabase} from '../../src/storage/db.js'
import {ConfigSchema} from '../../src/config/index.js'
const adminUrl=process.env.RUE_PG_TEST_ADMIN_URL

test('PostgreSQL startup owns one backend, refuses SQLite and releases its coordinator',{skip:!adminUrl},async t=>{
 const env={...process.env},admin=createPostgresDatabase({url:adminUrl,maxConnections:1}),name='rue_test_'+randomUUID().replaceAll('-','')
 let pool:ReturnType<typeof createPostgresDatabase>|undefined,server:RueServer|undefined,created=false
 try{
  await admin.sql`CREATE DATABASE ${admin.sql(name)}`;created=true
  const url=new URL(adminUrl!);url.pathname='/'+name;pool=createPostgresDatabase({url:url.toString()});await migratePostgresDatabase(pool.db)
  process.env.RUE_STORAGE_BACKEND='postgres';process.env.RUE_DATABASE_URL=url.toString();process.env.RUE_SETTINGS_ENCRYPTION_KEY=Buffer.alloc(32,9).toString('base64')
  for(const key of ['RUE_PUSH_PUBLIC_KEY','RUE_PUSH_PRIVATE_KEY','RUE_PUSH_SUBJECT','RUE_TENANCY_ORIGIN','RUE_TENANCY_VERIFIER_FILE'])delete process.env[key]
  const config=ConfigSchema.parse({server:{hostname:'127.0.0.1',port:0},keyname:{enabled:false}})
  t.afterEach(async()=>{await server?.close();server=undefined})
  await t.test('invalid/mixed configuration never opens SQLite',async()=>{
   assert.throws(()=>openDatabase(':memory:'),/rue_sqlite_disabled/)
   await assert.rejects(listen({config,dbPath:':memory:'}),/rue_sqlite_path_forbidden/)
   process.env.RUE_SETTINGS_ENCRYPTION_KEY='invalid';await assert.rejects(listen({config}),/rue_original_encryption_key_required/)
   process.env.RUE_SETTINGS_ENCRYPTION_KEY=Buffer.alloc(32,9).toString('base64')
   process.env.RUE_STORAGE_BACKEND='sqlite';await assert.rejects(listen({config}),/rue_postgres_backend_selection_required/);process.env.RUE_STORAGE_BACKEND='postgres'
  })
  await t.test('real HTTP writes only PostgreSQL and duplicate coordinators fail closed',async()=>{
   server=await listen({config});assert.equal(server.ctx.storage?.engine,'postgres');assert.equal(server.ctx.db,undefined)
   const id=randomUUID(),response=await fetch(server.url+'/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,title:'PostgreSQL startup fixture'})})
   assert.equal(response.status,200);const saved=await response.json() as {id:string}
   assert.equal((await pool!.sql`SELECT count(*)::integer AS n FROM sessions WHERE id=${saved.id}`)[0]!.n,1)
   await assert.rejects(listen({config}),/rue_postgres_startup_failed/)
   assert.equal((await fetch(server.url+'/health')).status,200)
   await server.close();await server.close();assert.equal(server.ctx.storage?.available,false)
   server=await listen({config});assert.equal(server.ctx.storage?.available,true);await server.close()
  })
  await t.test('failed HTTP bind releases the PostgreSQL coordinator',async()=>{
   const occupied=createServer();occupied.listen(0,'127.0.0.1');await once(occupied,'listening');const address=occupied.address();assert.ok(address&&typeof address==='object')
   try{await assert.rejects(listen({config:ConfigSchema.parse({server:{hostname:'127.0.0.1',port:address.port}})}),{code:'EADDRINUSE'})}finally{await new Promise<void>(resolve=>occupied.close(()=>resolve()))}
   server=await listen({config});await server.close()
  })
  await t.test('loss of the coordinator closes the listener and pool rather than falling back',async()=>{
   server=await listen({config})
   const locks=await pool!.sql`SELECT pid FROM pg_locks WHERE locktype='advisory' AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`
   assert.equal(locks.length,1);await pool!.sql`SELECT pg_terminate_backend(${locks[0]!.pid})`
   for(let n=0;n<100&&server.ctx.storage?.available;n++)await delay(20)
   assert.equal(server.ctx.storage?.available,false);await server.close();assert.equal(server.ctx.db,undefined)
   server=await listen({config});await server.close()
  })
 }finally{
  await server?.close();for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env)
  await pool?.close();if(created)await admin.sql`DROP DATABASE ${admin.sql(name)} WITH (FORCE)`;await admin.close()
 }
})
