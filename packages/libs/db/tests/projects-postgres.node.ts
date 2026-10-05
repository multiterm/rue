import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {eq,sql} from 'drizzle-orm'
import type {Database} from 'better-sqlite3'
import {createPostgresDatabase} from '../src/postgres/client.ts'
import {migratePostgresDatabase} from '../src/postgres/migrate.ts'
import {createPostgresProjectRepository} from '../src/postgres/projects.ts'
import {createPostgresWorkerRepository} from '../src/postgres/workers.ts'
import {projectBindings,workers} from '../src/postgres/schema.ts'
import {ProjectError,type ProjectClaims} from '../src/project-authority-repository.ts'
import {encryptCredential,decryptCredential} from '../../../apps/core/src/storage/agent-settings.ts'
import {workerHealthSchema} from '../../../apps/core/src/storage/workers.ts'
import {ProjectAuthority} from '../../../apps/core/src/server/project-authority.ts'
const adminUrl=process.env.RUE_PG_TEST_ADMIN_URL
const origin='https://tenancy.test',token='tnk_'+'a'.repeat(43)
const keyContext={name:':memory:'} as Database
const claims=(owner:string,expiresAt:number):ProjectClaims=>({id:'key-'+owner,owner:{type:'self',subject:owner},organizationId:'self',projectId:owner,service:'rue',scopes:['rue:hosts:enroll','rue:agents:execute'],expiresAt})
const fenced=(error:unknown)=>error instanceof ProjectError&&error.code==='project_binding_fenced'

test('PostgreSQL project authority and async server integration',{skip:!adminUrl},async t=>{
 const old=process.env.RUE_SETTINGS_ENCRYPTION_KEY;process.env.RUE_SETTINGS_ENCRYPTION_KEY=Buffer.alloc(32,13).toString('base64')
 const admin=createPostgresDatabase({url:adminUrl,maxConnections:1}),name='rue_test_'+randomUUID().replaceAll('-','')
 let pool:ReturnType<typeof createPostgresDatabase>|undefined,created=false
 try{
  await admin.sql`CREATE DATABASE ${admin.sql(name)}`;created=true
  const url=new URL(adminUrl!);url.pathname='/'+name;pool=createPostgresDatabase({url:url.toString(),maxConnections:8});await migratePostgresDatabase(pool.db)
  const db=pool.db,store=createPostgresProjectRepository(db,{encrypt:(scope,value)=>encryptCredential(keyContext,scope,value),decrypt:(scope,value)=>decryptCredential(keyContext,scope,value)}),workerStore=createPostgresWorkerRepository(db,raw=>workerHealthSchema.parse(raw)),now=1790000000000
  await t.test('concurrent create is idempotent and preserves issuer/owner/key bindings',async()=>{
   const id=randomUUID(),proof=claims('owner',now+60000)
   const result=await Promise.all(Array.from({length:8},()=>store.create('owner',id,origin,token,proof,now,now)))
   assert.ok(result.every(r=>r.id===id&&r.revision===1))
   assert.equal((await store.credential(id,origin)).token,token)
   await assert.rejects(store.credential(id,'https://wrong.test'),fenced)
   await assert.rejects(store.create('other',id,origin,token,claims('other',now+60000),now,now),e=>e instanceof ProjectError&&e.status===404)
   await assert.rejects(store.create('owner',id,origin,token,{...proof,projectId:'different'},now,now),e=>e instanceof ProjectError&&e.status===409)
   await assert.rejects(store.create('owner',randomUUID(),origin,token,{...proof,scopes:['rue:hosts:enroll']},now,now),e=>e instanceof ProjectError&&e.status===401)
  })
  await t.test('owner quota has a single final slot under concurrent enrollment',async()=>{
   await db.insert(projectBindings).values(Array.from({length:255},()=>({id:randomUUID(),ownerSubject:'quota',tenancyOrigin:origin,organizationId:'self',projectId:'quota',keyId:'fixture',keyHash:'fixture',encryptedKey:null,scopes:'[]',expiresAt:0,createdAt:now,verifiedAt:0,authorizedUntil:0})))
   const results=await Promise.allSettled(Array.from({length:6},()=>store.create('quota',randomUUID(),origin,token,claims('quota',now+60000),now,now)))
   assert.equal(results.filter(result=>result.status==='fulfilled').length,1)
   assert.equal(results.filter(result=>result.status==='rejected'&&result.reason instanceof ProjectError&&result.reason.code==='project_binding_limit').length,5)
  })
  await t.test('newer positive proofs win; negative authority revokes even an older request',async()=>{
   const id=randomUUID(),proof=claims('proofs',now+600000)
   await store.create('proofs',id,origin,token,proof,now,now)
   const enrollment=await workerStore.create('proofs','host',randomUUID(),now,id),instance=randomUUID(),lease=await workerStore.connect(enrollment.worker.id,enrollment.secret!,instance,now)
   await store.updateProof(id,1,proof,now+100,now+110)
   await store.updateProof(id,1,{...proof,expiresAt:now+1000},now+50,now+120)
   const [saved]=await db.select().from(projectBindings).where(eq(projectBindings.id,id));assert.equal(saved!.verifiedAt,now+100);assert.equal(saved!.expiresAt,proof.expiresAt)
   assert.equal(await store.updateProof(id,1,undefined,now+10,now+130),false)
   const [worker]=await db.select().from(workers).where(eq(workers.id,enrollment.worker.id));assert.equal(worker!.leaseExpiresAt,null);assert.ok(worker!.generation>lease.generation)
   await assert.rejects(store.credential(id,origin),fenced)
   await assert.rejects(store.updateProof(id,1,proof,now+140,now+150),fenced)
  })
  await t.test('boot fencing invalidates outstanding proofs and lease generations',async()=>{
   const id=randomUUID(),proof=claims('boot',now+600000)
   await store.create('boot',id,origin,token,proof,now,now)
   const enrollment=await workerStore.create('boot','host',randomUUID(),now,id)
   await workerStore.connect(enrollment.worker.id,enrollment.secret!,randomUUID(),now)
   await store.fenceOnBoot()
   await assert.rejects(store.updateProof(id,1,proof,now+1,now+2),fenced)
   assert.equal((await store.credential(id,origin)).revision,2)
   await assert.rejects(workerStore.connect(enrollment.worker.id,enrollment.secret!,randomUUID(),now+2))
   assert.equal(await store.updateProof(id,2,proof,now+3,now+4),true)
   await workerStore.connect(enrollment.worker.id,enrollment.secret!,randomUUID(),now+5)
  })
  await t.test('server authority awaits repositories, deduplicates refreshes and makes no verifier call for other owners',async()=>{
   const id=randomUUID(),at=Date.now(),proof=claims('service-owner',at+600000)
   await store.create('service-owner',id,origin,token,proof,at)
   let calls=0,release!:()=>void
   const gate=new Promise<void>(resolve=>{release=resolve})
   const authority=new ProjectAuthority(store,{origin,async verifyKey(value){assert.equal(value,token);calls++;await gate;return {id:proof.id,owner:proof.owner,service:'rue',grants:proof.scopes,name:'fixture',createdAt:at,expiresAt:proof.expiresAt,revokedAt:null}}})
   await assert.rejects(authority.owned(id,'other'),e=>e instanceof ProjectError&&e.status===404);assert.equal(calls,0)
   const refreshes=[authority.refresh(id),authority.refresh(id)]
   try{
    for(let i=0;i<100&&calls===0;i++)await new Promise(resolve=>setTimeout(resolve,5))
    assert.equal(calls,1)
    // No transaction/owner lock is held while waiting for the remote verifier.
    await db.transaction(async tx=>{await tx.execute(sql`SET LOCAL lock_timeout='1s'`);await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'rue:owner:service-owner'},0))`)})
   }finally{release();await Promise.all(refreshes)}
  })
 }finally{
  await pool?.close();if(created)await admin.sql`DROP DATABASE ${admin.sql(name)}`;await admin.close()
  if(old===undefined)delete process.env.RUE_SETTINGS_ENCRYPTION_KEY;else process.env.RUE_SETTINGS_ENCRYPTION_KEY=old
 }
})
