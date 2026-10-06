import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes,randomUUID,createCipheriv,createDecipheriv} from 'node:crypto'
import {eq} from 'drizzle-orm'
import {createPostgresDatabase} from '../src/postgres/client.js'
import {migratePostgresDatabase} from '../src/postgres/migrate.js'
import {createPostgresAgentSettingsRepository} from '../src/postgres/agent-settings.js'
import {createPostgresProviderKeyRepository} from '../src/postgres/provider-keys.js'
import {AgentSettingsError} from '../src/credential-errors.js'
import {agentSettings,providerKeyGrants} from '../src/postgres/schema.js'
import {AgentSettingsSchema,defaultAgentSettings} from '../../../apps/core/src/storage/agent-settings.js'
const adminUrl=process.env.RUE_PG_TEST_ADMIN_URL

test('PostgreSQL agent settings preserve original credential scope and concurrent revisions',{skip:!adminUrl},async t=>{
 const admin=createPostgresDatabase({url:adminUrl,maxConnections:1}),name='rue_test_'+randomUUID().replaceAll('-','')
 let pool:ReturnType<typeof createPostgresDatabase>|undefined,created=false
 try{
  await admin.sql`CREATE DATABASE ${admin.sql(name)}`;created=true
  const url=new URL(adminUrl!);url.pathname='/'+name;pool=createPostgresDatabase({url:url.toString(),maxConnections:8});await migratePostgresDatabase(pool.db)
  const db=pool.db,key=randomBytes(32);let available=true
  const codec={
   encrypt(scope:string[],secret:string){if(!available)throw new AgentSettingsError('agent_key_storage_unavailable');const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(JSON.stringify(scope)));const data=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),data].map(b=>b.toString('base64')).join('.')},
   decrypt(scope:string[],value:string){if(!available)throw new AgentSettingsError('agent_key_storage_unavailable');const [iv,tag,data]=value.split('.').map(v=>Buffer.from(v,'base64'));const cipher=createDecipheriv('aes-256-gcm',key,iv!);cipher.setAAD(Buffer.from(JSON.stringify(scope)));cipher.setAuthTag(tag!);return Buffer.concat([cipher.update(data!),cipher.final()]).toString('utf8')},
  }
  const store=createPostgresAgentSettingsRepository(db,{codec,keyStorageAvailable:()=>available,defaults:defaultAgentSettings,parse:raw=>AgentSettingsSchema.parse(raw)})
  const provider=createPostgresProviderKeyRepository(db,{codec,keyStorageAvailable:()=>available,defaultAgentSettings,parseAgentSettings:raw=>AgentSettingsSchema.parse(raw),reportedProviders:()=>[]})
  const input=(owner:string,revision=0)=>({...defaultAgentSettings,expectedOwnerSubject:owner,expectedRevision:revision})
  await t.test('defaults and saved metadata never expose encrypted or plaintext keys',async()=>{
   const owner=randomUUID();assert.deepEqual(await store.get(owner),{...defaultAgentSettings,revision:0,apiKeyConfigured:false,keyStorageAvailable:true})
   const saved=await store.save(owner,{...input(owner),apiKey:'fixture-private-key'})
   assert.equal(saved.revision,1);assert.equal(saved.apiKeyConfigured,true);assert.equal(JSON.stringify(saved).includes('fixture-private-key'),false)
   assert.equal(await store.apiKey(owner),'fixture-private-key');assert.equal(await store.apiKey('other'),undefined)
   const [row]=await db.select().from(agentSettings).where(eq(agentSettings.ownerSubject,owner))
   assert.equal(codec.decrypt([owner,'openai'],row!.encryptedKey!),'fixture-private-key')
   assert.throws(()=>codec.decrypt(['other','openai'],row!.encryptedKey!))
  })
  await t.test('competing settings and provider-key updates share one CAS boundary',async()=>{
   const owner=randomUUID()
   const results=await Promise.allSettled([store.save(owner,{...input(owner),apiKey:'settings-key'}),provider.save(owner,'openai',0,'provider-key')])
   assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal((await store.get(owner)).revision,1)
   assert.ok(['settings-key','provider-key'].includes((await store.apiKey(owner))!))
   await assert.rejects(store.save(owner,input('other',1)),AgentSettingsError)
   await assert.rejects(store.save(owner,input(owner)),AgentSettingsError)
  })
  await t.test('omitted key preserves ciphertext; explicit removal revokes only matching grants',async()=>{
   const owner=randomUUID();await store.save(owner,{...input(owner),apiKey:'preserved-key'})
   const [before]=await db.select().from(agentSettings).where(eq(agentSettings.ownerSubject,owner))
   await store.save(owner,{...input(owner,1),model:'runtime-selected-model'})
   const [after]=await db.select().from(agentSettings).where(eq(agentSettings.ownerSubject,owner));assert.equal(after!.encryptedKey,before!.encryptedKey)
   await db.insert(providerKeyGrants).values([{ownerSubject:owner,provider:'openai',targetType:'terminal',targetId:'one'},{ownerSubject:owner,provider:'anthropic',targetType:'terminal',targetId:'one'}])
   await store.save(owner,{...input(owner,2),apiKey:null})
   assert.equal(await store.apiKey(owner),undefined)
   assert.deepEqual((await db.select().from(providerKeyGrants).where(eq(providerKeyGrants.ownerSubject,owner))).map(r=>r.provider),['anthropic'])
  })
  await t.test('validation or encryption failures roll back without changing revisions or ciphertext',async()=>{
   const owner=randomUUID();await store.save(owner,{...input(owner),apiKey:'original'})
   await assert.rejects(store.save(owner,{...input(owner,1),model:''}))
   available=false
   try{await assert.rejects(store.save(owner,{...input(owner,1),apiKey:'replacement'}),AgentSettingsError);assert.equal((await store.get(owner)).keyStorageAvailable,false)}finally{available=true}
   assert.equal((await store.get(owner)).revision,1);assert.equal(await store.apiKey(owner),'original')
   await assert.rejects(store.save(owner,input(owner,Number.MAX_SAFE_INTEGER)),AgentSettingsError)
  })
 }finally{await pool?.close();if(created)await admin.sql`DROP DATABASE ${admin.sql(name)}`;await admin.close()}
})
