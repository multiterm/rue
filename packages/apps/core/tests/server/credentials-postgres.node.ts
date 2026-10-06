import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,randomBytes,createHash} from 'node:crypto'
import {Hono} from 'hono'
import type {Database} from 'better-sqlite3'
import {createPostgresDatabase,migratePostgresDatabase,createPostgresWorkerRepository} from '@multiterm/rue-db/postgres'
import {createPostgresSessionServices} from '../../src/server/postgres-session-services.js'
import {providerKeyAccountRoutes,providerKeyDeliveryRoutes} from '../../src/server/routes/provider-keys.js'
import {workerHealthSchema} from '../../src/storage/workers.js'
import type {ServerContext} from '../../src/server/context.js'
import {ConfigSchema} from '../../src/config/index.js'
import {Bus} from '../../src/bus/index.js'
const adminUrl=process.env.RUE_PG_TEST_ADMIN_URL

test('PostgreSQL credential HTTP preserves consent and live authority without SQLite',{skip:!adminUrl},async t=>{
 const admin=createPostgresDatabase({url:adminUrl,maxConnections:1}),name='rue_test_'+randomUUID().replaceAll('-','')
 let pool:ReturnType<typeof createPostgresDatabase>|undefined,created=false,sqliteAccess=0
 try{
  await admin.sql`CREATE DATABASE ${admin.sql(name)}`;created=true
  const url=new URL(adminUrl!);url.pathname='/'+name;pool=createPostgresDatabase({url:url.toString(),maxConnections:8});await migratePostgresDatabase(pool.db)
  const services=createPostgresSessionServices(pool.db,()=>Buffer.alloc(32,9)),store=services.credentials
  const ctx:ServerContext={db:new Proxy({} as Database,{get(){sqliteAccess++;throw Error('SQLite forbidden')}}),sessions:services,config:ConfigSchema.parse({}),bus:new Bus()}
  const app=new Hono();app.use('*',async(c,next)=>{c.set('ctx',ctx);c.set('principal',{subject:c.req.header('x-fixture-owner')??'owner',principalType:'user',scopes:[]});return next()})
  app.route('/keys',providerKeyAccountRoutes());app.route('/workers',providerKeyDeliveryRoutes('worker'));app.route('/terminal',providerKeyDeliveryRoutes('terminal',async()=>{throw Error('unexpected refresh')}))
  const request=(path:string,method='GET',body?:unknown,token='',owner='owner')=>app.request(path,{method,headers:{'content-type':'application/json',authorization:'Bearer '+token,'x-fixture-owner':owner},body:body===undefined?undefined:JSON.stringify(body)})
  const provider='fixture-provider'
  await t.test('account CAS has one winner and never exposes plaintext in metadata',async()=>{
   const writes=await Promise.all(Array.from({length:6},()=>request('/keys/'+provider,'PUT',{expectedOwnerSubject:'owner',expectedRevision:0,apiKey:'fixture-api-key'})))
   assert.equal(writes.filter(r=>r.status===200).length,1);assert.equal(writes.filter(r=>r.status===409).length,5)
   const metadata=await (await request('/keys')).text();assert.equal(metadata.includes('fixture-api-key'),false);assert.equal(metadata.includes('encrypted'),false)
   const other=await store.keys.list('other');assert.equal(other.keys.some(k=>k.configured),false)
   assert.equal((await request('/keys/catalog')).status,200)
  })
  const workers=createPostgresWorkerRepository(pool.db,value=>workerHealthSchema.parse(value)),enrollment=await workers.create('owner','Fixture host',randomUUID()),instance=randomUUID()
  const lease=await workers.connect(enrollment.worker.id,enrollment.secret!,instance),path='/workers/'+enrollment.worker.id+'/provider-keys/'+provider,auth={instance,generation:lease.generation}
  await t.test('worker delivery requires consent and returns a stable usage identifier',async()=>{
   assert.equal((await request(path,'POST',auth,enrollment.secret!)).status,403)
   assert.deepEqual(await (await request(path,'POST',{...auth,availability:true},enrollment.secret!)).json(),{provider,granted:false})
   const input={expectedOwnerSubject:'owner',expectedRevision:1,target:{type:'worker',id:enrollment.worker.id},enabled:true,acknowledgeExposure:true}
   assert.equal((await request('/keys/'+provider+'/grants','PUT',input)).status,200)
   const delivered=await (await request(path,'POST',auth,enrollment.secret!)).json() as {apiKey:string;credentialId:string}
   assert.equal(delivered.apiKey,'fixture-api-key');assert.match(delivered.credentialId,/^key_[a-f0-9]{64}$/)
   assert.equal((await (await request(path,'POST',auth,enrollment.secret!)).json() as {credentialId:string}).credentialId,delivered.credentialId)
   assert.equal((await request(path,'POST',{...auth,instance:randomUUID()},enrollment.secret!)).status>=400,true)
  })
  await t.test('revocation after initial validation is rechecked before delivery and access audit',async()=>{
   const before=(await pool!.sql`SELECT count(*) AS n FROM provider_key_audit WHERE action='access'`)[0]!.n
   const original=store.transportOwner
   store.transportOwner=async(...args)=>{const owner=await original(...args);await workers.change(owner,enrollment.worker.id,'revoke',0);return owner}
   try{const response=await request(path,'POST',auth,enrollment.secret!);assert.ok(response.status>=400);assert.equal((await response.text()).includes('fixture-api-key'),false)}finally{store.transportOwner=original}
   assert.equal((await pool!.sql`SELECT count(*) AS n FROM provider_key_audit WHERE action='access'`)[0]!.n,before)
  })
  await t.test('terminal OAuth delivery exposes only access tokens, never refresh tokens',async()=>{
   const session=randomUUID(),id='term_'+randomBytes(24).toString('base64url'),token='rue_terminal_'+randomBytes(32).toString('base64url'),instance=randomUUID(),now=Date.now(),expires=now+3600000
   await services.conversations.create('oauth-owner',{id:session})
   await pool!.sql`INSERT INTO terminal_connections(id,owner_subject,session_id,pi_session_id,token_hash,created_at,expires_at,activated_at,instance_id,relay_protocol,last_seen_at,lease_expires_at) VALUES(${id},'oauth-owner',${session},${randomUUID()},${createHash('sha256').update(token).digest('hex')},${now},${expires},${now},${instance},2,${now},${now+60000})`
   const access='header.'+Buffer.from(JSON.stringify({exp:Math.floor(expires/1000),'https://api.openai.com/auth':{chatgpt_account_id:'fixture-account'}})).toString('base64url')+'.signature'
   await store.oauth.save('oauth-owner',0,{type:'oauth',access,refresh:'fixture-refresh-secret',expires,accountId:'fixture-account'})
   const path='/terminal/connections/'+id+'/provider-keys/openai-codex'
   assert.equal((await request(path,'POST',{instance},token)).status,403)
   await store.oauth.grant('oauth-owner',1,id,true)
   const response=await request(path,'POST',{instance},token),body=await response.text();assert.equal(response.status,200);assert.equal(body.includes('fixture-refresh-secret'),false)
   assert.equal(JSON.parse(body).accessToken,access)
   await store.oauth.remove('oauth-owner',2)
   assert.ok((await request(path,'POST',{instance},token)).status>=400)
  })
  assert.equal(sqliteAccess,0)
 }finally{await pool?.close();if(created)await admin.sql`DROP DATABASE ${admin.sql(name)} WITH (FORCE)`;await admin.close()}
})
