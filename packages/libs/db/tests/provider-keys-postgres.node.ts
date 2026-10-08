import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import type {Database} from 'better-sqlite3'
import {and,eq,sql} from 'drizzle-orm'
import {createPostgresDatabase} from '../src/postgres/client.ts'
import {migratePostgresDatabase} from '../src/postgres/migrate.ts'
import {createPostgresProviderKeyRepository,PostgresProviderKeyError} from '../src/postgres/provider-keys.ts'
import {createPostgresWorkerRepository} from '../src/postgres/workers.ts'
import {agentSettings,providerKeys,providerKeyAudit,providerKeyGrants,terminalConnections,sessions} from '../src/postgres/schema.ts'
import {AgentSettingsSchema,defaultAgentSettings,encryptCredential,decryptCredential} from '../../../apps/core/src/storage/agent-settings.ts'
import {workerHealthSchema} from '../../../apps/core/src/storage/workers.ts'
const adminUrl=process.env.RUE_PG_TEST_ADMIN_URL,keyContext={name:':memory:'} as Database
const code=(expected:string)=>(error:unknown)=>error instanceof PostgresProviderKeyError&&error.code===expected

test('PostgreSQL provider credentials and worker-grant fencing',{skip:!adminUrl},async t=>{
 const previous=process.env.RUE_SETTINGS_ENCRYPTION_KEY;process.env.RUE_SETTINGS_ENCRYPTION_KEY=Buffer.alloc(32,25).toString('base64')
 const admin=createPostgresDatabase({url:adminUrl,maxConnections:1}),name='rue_test_'+randomUUID().replaceAll('-','')
 let pool:ReturnType<typeof createPostgresDatabase>|undefined,created=false
 try{
  await admin.sql`CREATE DATABASE ${admin.sql(name)}`;created=true
  const url=new URL(adminUrl!);url.pathname='/'+name;pool=createPostgresDatabase({url:url.toString(),maxConnections:8});await migratePostgresDatabase(pool.db)
  const db=pool.db,codec={encrypt:(scope:string[],value:string)=>encryptCredential(keyContext,scope,value),decrypt:(scope:string[],value:string)=>decryptCredential(keyContext,scope,value)}
  const store=createPostgresProviderKeyRepository(db,{codec,keyStorageAvailable:()=>true,defaultAgentSettings,parseAgentSettings:input=>AgentSettingsSchema.parse(input),reportedProviders:()=>[]})
  const workerStore=createPostgresWorkerRepository(db,raw=>workerHealthSchema.parse(raw))
  await t.test('concurrent key CAS has one winner and metadata never exposes ciphertext/plaintext',async()=>{
   const outcomes=await Promise.allSettled([store.save('owner','anthropic',0,'secret-one','model-a'),store.save('owner','anthropic',0,'secret-two','model-b')])
   assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1)
   assert.ok(outcomes.some(r=>r.status==='rejected'&&code('provider_key_changed')(r.reason)))
   const report=await store.list('owner'),entry=report.keys.find(key=>key.provider==='anthropic')!
   assert.equal(entry.revision,1);assert.equal(entry.configured,true)
   assert.equal(JSON.stringify(report).includes('secret-'),false);assert.equal(JSON.stringify(report).includes('encrypted'),false)
   assert.equal((await store.list('other')).keys.find(key=>key.provider==='anthropic')!.configured,false)
   await assert.rejects(store.save('owner','openai-codex',0,'not-an-api-key'),code('provider_key_invalid'))
  })
  await t.test('legacy OpenAI key updates preserve settings and the original encryption scope',async()=>{
   const settings={...defaultAgentSettings,systemPrompt:'Keep this prompt'}
   await db.insert(agentSettings).values({ownerSubject:'legacy',settings:JSON.stringify(settings),revision:3})
   await store.save('legacy','openai',3,'legacy-secret')
   const [row]=await db.select().from(agentSettings).where(eq(agentSettings.ownerSubject,'legacy'))
   assert.deepEqual(JSON.parse(row!.settings),settings);assert.equal(row!.revision,4)
   assert.equal(codec.decrypt(['legacy','openai'],row!.encryptedKey!),'legacy-secret')
  })
  await t.test('owner-scoped grants, leased access, revocation and remove are atomic',async()=>{
   const enrollment=await workerStore.create('grant-owner','host',randomUUID()),target={type:'worker' as const,id:enrollment.worker.id},instance=randomUUID()
   const lease=await workerStore.connect(target.id,enrollment.secret!,instance)
   await store.save('grant-owner','anthropic',0,'grant-secret','selected-model')
   await store.save('other-owner','anthropic',0,'other-secret')
   await assert.rejects(store.grant('other-owner','anthropic',1,target,true),code('credential_target_unavailable'))
   await assert.rejects(workerStore.withAuthority(target.id,enrollment.secret!,instance,lease.generation,tx=>store.delegated(tx,'grant-owner','anthropic',target)),code('provider_key_not_granted'))
   await store.grant('grant-owner','anthropic',1,target,true)
   const access=await workerStore.withAuthority(target.id,enrollment.secret!,instance,lease.generation,tx=>store.delegated(tx,'grant-owner','anthropic',target))
   assert.equal(access.apiKey,'grant-secret')
   // A failed caller transaction must roll back the credential access audit too.
   const before=(await db.select().from(providerKeyAudit)).length
   await assert.rejects(workerStore.withAuthority(target.id,enrollment.secret!,instance,lease.generation,async tx=>{await store.delegated(tx,'grant-owner','anthropic',target);throw Error('abort')}),/abort/)
   assert.equal((await db.select().from(providerKeyAudit)).length,before)
   await workerStore.change('grant-owner',target.id,'revoke',0)
   assert.equal((await db.select().from(providerKeyGrants).where(eq(providerKeyGrants.ownerSubject,'grant-owner'))).length,0)
   const [stored]=await db.select().from(providerKeys).where(and(eq(providerKeys.ownerSubject,'grant-owner'),eq(providerKeys.provider,'anthropic')));assert.equal(stored!.revision,3)
   const removed=await store.save('grant-owner','anthropic',3,null)
   const entry=removed.keys.find(key=>key.provider==='anthropic')!;assert.equal(entry.configured,false);assert.equal(entry.model,null)
  })
  await t.test('terminal approvals require live activation and reject expiry',async()=>{
   await store.save('terminal-owner','google',0,'terminal-secret')
   await db.insert(sessions).values({id:'session',ownerSubject:'terminal-owner',createdAt:1,updatedAt:1})
   await db.insert(terminalConnections).values({id:'expired',ownerSubject:'terminal-owner',piSessionId:'pi',sessionId:'session',tokenHash:'hash',createdAt:1,expiresAt:1,activatedAt:1})
   await assert.rejects(store.grant('terminal-owner','google',1,{type:'terminal',id:'expired'},true),code('credential_target_unavailable'))
  })
 }finally{
  await pool?.close();if(created)await admin.sql`DROP DATABASE ${admin.sql(name)}`;await admin.close()
  if(previous===undefined)delete process.env.RUE_SETTINGS_ENCRYPTION_KEY;else process.env.RUE_SETTINGS_ENCRYPTION_KEY=previous
 }
})
