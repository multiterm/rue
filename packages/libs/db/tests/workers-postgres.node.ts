import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {eq,sql} from 'drizzle-orm'
import {createPostgresDatabase} from '../src/postgres/client.ts'
import {migratePostgresDatabase} from '../src/postgres/migrate.ts'
import {createPostgresWorkerRepository,PostgresWorkerError,WORKER_LEASE_MS} from '../src/postgres/workers.ts'
import {workers,projectBindings,providerKeys,providerKeyGrants,providerKeyAudit} from '../src/postgres/schema.ts'
import {workerHealthSchema} from '../../../apps/core/src/storage/workers.ts'
const adminUrl=process.env.RUE_PG_TEST_ADMIN_URL
const health={version:'1.0.0',platform:'linux',architecture:'arm64',dockerAvailable:true,acceptingWork:true,freeMemoryBytes:1000,cpus:2,capabilities:['host-health-v1']}
const code=(expected:string)=>(error:unknown)=>error instanceof PostgresWorkerError&&error.code===expected

test('PostgreSQL worker authority',{skip:!adminUrl},async t=>{
 const admin=createPostgresDatabase({url:adminUrl,maxConnections:1}),name='rue_test_'+randomUUID().replaceAll('-','')
 let pool:ReturnType<typeof createPostgresDatabase>|undefined,created=false
 try{
  await admin.sql`CREATE DATABASE ${admin.sql(name)}`;created=true
  const url=new URL(adminUrl!);url.pathname='/'+name;pool=createPostgresDatabase({url:url.toString(),maxConnections:8});await migratePostgresDatabase(pool.db)
  const db=pool.db,store=createPostgresWorkerRepository(db,raw=>workerHealthSchema.parse(raw)),now=1790000000123
  await t.test('concurrent enrollment returns exactly one secret, scopes owners and counts destroyed agents consistently',async()=>{
   const request=randomUUID(),results=await Promise.all(Array.from({length:8},()=>store.create('owner','Mason',request,now)))
   assert.equal(new Set(results.map(r=>r.worker.id)).size,1);assert.equal(results.filter(r=>r.secret).length,1)
   const worker=results[0]!.worker
   assert.equal(worker.managedAgentCount,0);assert.equal(JSON.stringify(worker).includes('tokenHash'),false);assert.equal(JSON.stringify(worker).includes('instanceId'),false)
   assert.equal((await store.list('other',now)).length,0)
   await db.execute(sql`INSERT INTO managed_agents(id,owner_subject,worker_id,name,config,desired,created_at) VALUES(${randomUUID()},'owner',${worker.id},'live','{}','running',${now}),(${randomUUID()},'owner',${worker.id},'removed','{}','destroyed',${now})`)
   assert.equal((await store.list('owner',now))[0]!.managedAgentCount,1)
   assert.equal((await store.create('owner','Mason',request,now)).worker.managedAgentCount,1)
   await assert.rejects(store.create('owner','Different',request,now),code('worker_request_conflict'))
   await assert.rejects(store.change('other',worker.id,'drain',worker.revision,now),code('worker_not_found'))
  })
  await t.test('quota remains atomic under concurrent enrollments',async()=>{
   await db.insert(workers).values(Array.from({length:99},(_,i)=>({id:randomUUID(),ownerSubject:'quota',name:'host',tokenHash:'unique-'+i,enrollmentRequestId:randomUUID(),createdAt:now})))
   const attempts=await Promise.allSettled(Array.from({length:5},()=>store.create('quota','last',randomUUID(),now)))
   assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1)
   assert.equal(attempts.filter(r=>r.status==='rejected'&&code('worker_limit')(r.reason)).length,4)
  })
  await t.test('single-winner connects, stale generations, drain masking and immediate rotation/revocation',async()=>{
   const enrolled=await store.create('leases','host',randomUUID(),now),id=enrolled.worker.id,token=enrolled.secret!,instances=[randomUUID(),randomUUID()]
   const attempts=await Promise.allSettled(instances.map(instance=>store.connect(id,token,instance,now)))
   const winner=attempts.findIndex(r=>r.status==='fulfilled'),instance=instances[winner]!,lease=(attempts[winner] as PromiseFulfilledResult<any>).value
   assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal(lease.expiresAt,now+WORKER_LEASE_MS)
   assert.equal((await store.connect(id,token,instance,now+1)).generation,lease.generation)
   await assert.rejects(store.heartbeat(id,token,instance,lease.generation+1,health,now+2),code('worker_session_fenced'))
   await assert.rejects(store.heartbeat(id,token,instance,lease.generation,{...health,unexpectedSecret:'must reject'},now+2))
   const changes=await Promise.allSettled([store.change('leases',id,'drain',0,now+2),store.change('leases',id,'activate',0,now+2)])
   assert.equal(changes.filter(r=>r.status==='fulfilled').length,1)
   let current=(await store.list('leases',now+3))[0]!
   if(current.desired!=='draining')current=(await store.change('leases',id,'drain',current.revision,now+3)).worker
   assert.equal((await store.heartbeat(id,token,instance,lease.generation,health,now+4)).worker.health!.acceptingWork,false)
   const rotated=await store.change('leases',id,'rotate',current.revision,now+5)
   await assert.rejects(store.heartbeat(id,token,instance,lease.generation,health,now+6),code('invalid_worker_credential'))
   const renewed=await store.connect(id,rotated.secret!,randomUUID(),now+6);assert.ok(renewed.generation>lease.generation)
   await db.insert(providerKeys).values({ownerSubject:'leases',provider:'anthropic',encryptedKey:'opaque-persistent-credential',revision:1})
   await db.insert(providerKeyGrants).values({ownerSubject:'leases',provider:'anthropic',targetType:'worker',targetId:id})
   await store.change('leases',id,'revoke',rotated.worker.revision,now+7)
   await assert.rejects(store.connect(id,rotated.secret!,randomUUID(),now+8),code('invalid_worker_credential'))
   assert.equal((await db.select().from(providerKeyGrants)).length,0)
   assert.equal((await db.select().from(providerKeys))[0]!.encryptedKey,'opaque-persistent-credential')
   assert.equal((await db.select().from(providerKeys))[0]!.revision,2)
   assert.equal((await db.select().from(providerKeyAudit))[0]!.action,'target_reset')
  })
  await t.test('project proof bounds leases, prevents cross-owner enrollment and fences expired authority',async()=>{
   const binding=randomUUID()
   await db.insert(projectBindings).values({id:binding,ownerSubject:'project-owner',tenancyOrigin:'https://tenancy.test',organizationId:'org',projectId:'project',keyId:'key',keyHash:'opaque-hash',encryptedKey:'opaque-key',scopes:'[]',expiresAt:now+3600000,createdAt:now,verifiedAt:now,authorizedUntil:now+45000})
   await assert.rejects(store.create('other','host',randomUUID(),now,binding),code('worker_project_fenced'))
   const enrolled=await store.create('project-owner','host',randomUUID(),now,binding),instance=randomUUID(),lease=await store.connect(enrolled.worker.id,enrolled.secret!,instance,now)
   assert.equal(lease.expiresAt,now+45000)
   await assert.rejects(store.heartbeat(enrolled.worker.id,enrolled.secret!,instance,lease.generation,health,now+45000),code('worker_project_fenced'))
   let mutated=false
   await assert.rejects(store.withAuthority(enrolled.worker.id,enrolled.secret!,instance,lease.generation,async()=>{mutated=true},now+45000),code('worker_project_fenced'));assert.equal(mutated,false)
   await store.withAuthority(enrolled.worker.id,enrolled.secret!,instance,lease.generation,async(tx,w)=>{assert.equal(w.ownerSubject,'project-owner');await tx.execute(sql`SELECT 1`)},now+1)
   await db.update(projectBindings).set({authorizedUntil:0}).where(eq(projectBindings.id,binding))
   await assert.rejects(store.validate(enrolled.worker.id,enrolled.secret!,instance,lease.generation,now+2),code('worker_project_fenced'))
  })
  await t.test('lease admission rechecks time after waiting for a row lock',async()=>{
   const started=Date.now(),until=started+1500,binding=randomUUID()
   await db.insert(projectBindings).values({id:binding,ownerSubject:'clock',tenancyOrigin:'https://tenancy.test',organizationId:'org',projectId:'project',keyId:'clock-key',keyHash:'clock-hash',encryptedKey:'opaque-key',scopes:'[]',expiresAt:until,createdAt:started,verifiedAt:started,authorizedUntil:until})
   const enrolled=await store.create('clock','host',randomUUID(),started,binding)
   let locked!:()=>void,unlock!:()=>void
   const ready=new Promise<void>(resolve=>{locked=resolve}),release=new Promise<void>(resolve=>{unlock=resolve})
   const hold=db.transaction(async tx=>{await tx.execute(sql`SELECT id FROM workers WHERE id=${enrolled.worker.id} FOR UPDATE`);locked();await release})
   let connect:Promise<unknown>|undefined
   try{
    await Promise.race([ready,hold]);connect=store.connect(enrolled.worker.id,enrolled.secret!,randomUUID());void connect.catch(()=>{})
    let waiting=false
    for(let i=0;i<100;i++){
     const [row]=await db.execute<{n:number}>(sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%for update%'`)
     if(row!.n>0){waiting=true;break}await new Promise(resolve=>setTimeout(resolve,5))
    }
    assert.equal(waiting,true)
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,until-Date.now()+25)))
   }finally{unlock();await hold}
   await assert.rejects(connect!,code('worker_project_fenced'))
   assert.equal((await db.select().from(workers).where(eq(workers.id,enrolled.worker.id)))[0]!.leaseExpiresAt,null)
  })
 }finally{await pool?.close();if(created)await admin.sql`DROP DATABASE ${admin.sql(name)}`;await admin.close()}
})
