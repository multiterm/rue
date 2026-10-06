import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {Hono} from 'hono'
import {createPostgresDatabase,migratePostgresDatabase} from '@multiterm/rue-db/postgres'
import {createPostgresSessionServices} from '../../src/server/postgres-session-services.js'
import {providerOAuthRoutes} from '../../src/server/routes/provider-oauth.js'
import {CodexLogin,type CodexLoginProvider} from '../../src/server/codex-login.js'
import {ConfigSchema} from '../../src/config/index.js'
import {Bus} from '../../src/bus/index.js'
import type {ServerContext} from '../../src/server/context.js'
const adminUrl=process.env.RUE_PG_TEST_ADMIN_URL
test('PostgreSQL OAuth login has atomic admission, confirmation and cancellation',{skip:!adminUrl},async t=>{
 const admin=createPostgresDatabase({url:adminUrl,maxConnections:1}),name='rue_test_'+randomUUID().replaceAll('-','')
 let pool:ReturnType<typeof createPostgresDatabase>|undefined,created=false
 try{
  await admin.sql`CREATE DATABASE ${admin.sql(name)}`;created=true
  const url=new URL(adminUrl!);url.pathname='/'+name;pool=createPostgresDatabase({url:url.toString()});await migratePostgresDatabase(pool.db)
  const services=createPostgresSessionServices(pool.db,()=>Buffer.alloc(32,9)),store=services.credentials
  const ctx={sessions:services,config:ConfigSchema.parse({}),bus:new Bus()} as ServerContext
  Object.defineProperty(ctx,'db',{get(){throw Error('SQLite forbidden')}})
  const expires=Date.now()+3600000,access='header.'+Buffer.from(JSON.stringify({exp:Math.floor(expires/1000),'https://api.openai.com/auth':{chatgpt_account_id:'fixture-account'}})).toString('base64url')+'.signature'
  const credential={type:'oauth' as const,access,refresh:'fixture-refresh',expires,accountId:'fixture-account'}
  let starts=0,polls=0,poll:CodexLoginProvider['poll']=async()=>({status:'review',credential})
  const provider:CodexLoginProvider={start:async()=>{starts++;return {deviceId:'fixture-device',userCode:'CODE-1234',intervalMs:0}},poll:async(...args)=>{polls++;return poll(...args)}}
  const app=new Hono();app.use('*',async(c,next)=>{c.set('ctx',ctx);c.set('principal',{subject:c.req.header('x-owner')??'owner',principalType:'user',scopes:[]});return next()});app.route('/oauth',providerOAuthRoutes(provider))
  const request=(path:string,body?:unknown,owner='owner')=>app.request('/oauth/openai-codex'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json','x-owner':owner},body:body?JSON.stringify(body):undefined})
  const start=(id:string,owner='owner',revision=0)=>request('/start',{requestId:id,expectedOwnerSubject:owner,expectedRevision:revision,acknowledgeStorage:true},owner)
  const action=(id:string,verb:string,owner='owner')=>request(`/flows/${id}/${verb}`,{expectedOwnerSubject:owner,...(verb==='confirm'?{acknowledgeAccount:true}:{})},owner)
  await t.test('concurrent HTTP starts/polls/confirmations are single-winner and secrets stay private',async()=>{
   const id=randomUUID(),responses=await Promise.all(Array.from({length:6},()=>start(id)))
   assert.ok(responses.every(r=>r.status===200));assert.equal(starts,1)
   assert.equal((await request(`/flows/${id}`,undefined,'other')).status,404)
   await Promise.all(Array.from({length:6},()=>action(id,'poll')));assert.equal(polls,1)
   assert.equal((await store.oauth.metadata('owner')).configured,false)
   const confirmations=await Promise.all(Array.from({length:6},()=>action(id,'confirm')))
   assert.ok(confirmations.every(r=>r.status===200));assert.equal((await store.oauth.metadata('owner')).revision,1)
   const body=await (await request('')).text();for(const secret of [access,'fixture-refresh','fixture-device'])assert.equal(body.includes(secret),false)
  })
  await t.test('cancellation fences a late provider exchange and cancel-before-start contacts no provider',async()=>{
   const id=randomUUID(),owner='cancel-owner';let release!:(value:{status:'review';credential:typeof credential})=>void,entered!:()=>void
   const begun=new Promise<void>(resolve=>{entered=resolve});poll=async()=>{entered();return new Promise(resolve=>{release=resolve})}
   await start(id,owner);const pending=action(id,'poll',owner);await begun
   await action(id,'cancel',owner);release({status:'review',credential})
   assert.equal((await (await pending).json() as any).status,'cancelled');assert.equal((await store.oauth.metadata(owner)).configured,false)
   const cancelled=randomUUID(),before=starts;await action(cancelled,'cancel',owner);await start(cancelled,owner);assert.equal(starts,before)
   poll=async()=>({status:'review',credential})
  })
  await t.test('revision races roll back confirmation and restart cannot replay uncertain exchanges',async()=>{
   const owner='revision-owner',id=randomUUID();await start(id,owner);await action(id,'poll',owner)
   await store.oauth.remove(owner,0);assert.equal((await action(id,'confirm',owner)).status,409)
   assert.equal((await store.oauth.metadata(owner)).configured,false)
   const restart=randomUUID();await store.login.reserve('restart-owner',restart,0)
   assert.equal((await new CodexLogin(provider).status(store.login,'restart-owner',restart)).status,'failed')
  })
  await t.test('concurrent allocations share the owner quota',async()=>{
   const results=await Promise.allSettled(Array.from({length:10},()=>store.login.cancel('quota-owner',randomUUID())))
   assert.equal(results.filter(r=>r.status==='fulfilled').length,5)
  })
 }finally{await pool?.close();if(created)await admin.sql`DROP DATABASE ${admin.sql(name)} WITH (FORCE)`;await admin.close()}
})
