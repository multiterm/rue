import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import type {Database} from 'better-sqlite3'
import {and,eq} from 'drizzle-orm'
import {createPostgresDatabase} from '../src/postgres/client.ts'
import type {RuePostgresDatabase} from '../src/postgres/client.ts'
import {migratePostgresDatabase} from '../src/postgres/migrate.ts'
import {createPostgresOAuthRepository,PostgresOAuthError} from '../src/postgres/provider-oauth.ts'
import {sessions,terminalConnections,providerOauthCredentials} from '../src/postgres/schema.ts'
import {encryptCredential,decryptCredential} from '../../../apps/core/src/storage/agent-settings.ts'
import {validateCodexCredential} from '../../../apps/core/src/storage/provider-oauth.ts'
type Tx=Parameters<Parameters<RuePostgresDatabase['transaction']>[0]>[0]
const adminUrl=process.env.RUE_PG_TEST_ADMIN_URL,keyContext={name:':memory:'} as Database
const credential=(expires:number,accountId='account')=>({type:'oauth' as const,accountId,expires,refresh:'refresh-never-return',access:'e30.'+Buffer.from(JSON.stringify({exp:Math.floor(expires/1000),'https://api.openai.com/auth':{chatgpt_account_id:accountId}})).toString('base64url')+'.signature'})
const code=(expected:string)=>(error:unknown)=>error instanceof PostgresOAuthError&&error.code===expected

test('PostgreSQL OAuth durable refresh claims and authority rechecks',{skip:!adminUrl},async t=>{
 const old=process.env.RUE_SETTINGS_ENCRYPTION_KEY;process.env.RUE_SETTINGS_ENCRYPTION_KEY=Buffer.alloc(32,26).toString('base64')
 const name='rue_test_'+randomUUID().replaceAll('-',''),admin=createPostgresDatabase({url:adminUrl,maxConnections:1})
 let pool:ReturnType<typeof createPostgresDatabase>|undefined,created=false
 try{
  await admin.sql`CREATE DATABASE ${admin.sql(name)}`;created=true
  const url=new URL(adminUrl!);url.pathname='/'+name;pool=createPostgresDatabase({url:url.toString(),maxConnections:8});await migratePostgresDatabase(pool.db)
  const db=pool.db,options={codec:{encrypt:(scope:string[],value:string)=>encryptCredential(keyContext,scope,value),decrypt:(scope:string[],value:string)=>decryptCredential(keyContext,scope,value)},keyStorageAvailable:()=>true,parseCredential:validateCodexCredential}
  const store=createPostgresOAuthRepository(db,options)
  async function setup(owner:string){
   const id=randomUUID(),now=Date.now()
   await db.insert(sessions).values({id,ownerSubject:owner,createdAt:now,updatedAt:now})
   await db.insert(terminalConnections).values({id,ownerSubject:owner,sessionId:id,piSessionId:id,tokenHash:'hash-'+id,createdAt:now,expiresAt:now+600000,activatedAt:now,instanceId:'instance',leaseExpiresAt:now+60000})
   await store.save(owner,0,credential(now+20000));await store.grant(owner,1,id,true)
   const authorize=async(tx:Tx)=>{const [row]=await tx.select().from(terminalConnections).where(and(eq(terminalConnections.id,id),eq(terminalConnections.ownerSubject,owner),eq(terminalConnections.tokenHash,'hash-'+id),eq(terminalConnections.instanceId,'instance')));return Boolean(row?.leaseExpiresAt&&row.leaseExpiresAt>Date.now())}
   return {id,authorize}
  }
  await t.test('local callers share refresh; another repository cannot claim the same rotating token',async()=>{
   const {id,authorize}=await setup('singleflight'),other=createPostgresOAuthRepository(db,options)
   let release!:()=>void,started!:()=>void,calls=0
   const gate=new Promise<void>(resolve=>{release=resolve}),ready=new Promise<void>(resolve=>{started=resolve})
   const fetch=async()=>{calls++;started();await gate;return credential(Date.now()+3600000)}
   const first=store.access('singleflight',id,authorize,fetch);void first.catch(()=>{})
   let second:Promise<unknown>|undefined
   try{
    await Promise.race([ready,first]);second=store.access('singleflight',id,authorize,fetch);void second.catch(()=>{})
    await assert.rejects(other.access('singleflight',id,authorize,fetch),code('oauth_refresh_in_progress'))
   }finally{release()}
   const values=await Promise.all([first,second]);assert.equal(calls,1)
   assert.equal(JSON.stringify(values).includes('refresh-never-return'),false)
   assert.equal((await store.metadata('singleflight')).state,'ready')
  })
  await t.test('removal during refresh cannot be undone by a late provider response',async()=>{
   const {id,authorize}=await setup('removed');let release!:()=>void,started!:()=>void
   const gate=new Promise<void>(resolve=>{release=resolve}),ready=new Promise<void>(resolve=>{started=resolve})
   const access=store.access('removed',id,authorize,async()=>{started();await gate;return credential(Date.now()+3600000)});void access.catch(()=>{})
   try{await Promise.race([ready,access]);await store.remove('removed',2)}finally{release()}
   await assert.rejects(access,code('oauth_reauthorization_required'))
   const [row]=await db.select().from(providerOauthCredentials).where(eq(providerOauthCredentials.ownerSubject,'removed'))
   assert.equal(row!.state,'removed');assert.equal(row!.encryptedCredential,null);assert.equal(row!.refreshNonce,null)
  })
  await t.test('authority must still be live after refresh and other owners cannot trigger it',async()=>{
   const {id,authorize}=await setup('expired');let release!:()=>void,started!:()=>void,calls=0
   const gate=new Promise<void>(resolve=>{release=resolve}),ready=new Promise<void>(resolve=>{started=resolve})
   const fetch=async()=>{calls++;started();await gate;return credential(Date.now()+3600000)}
   await assert.rejects(store.access('other',id,authorize,fetch),code('oauth_authority_expired'));assert.equal(calls,0)
   const access=store.access('expired',id,authorize,fetch);void access.catch(()=>{})
   try{await Promise.race([ready,access]);await db.update(terminalConnections).set({leaseExpiresAt:0}).where(eq(terminalConnections.id,id))}finally{release()}
   await assert.rejects(access,code('oauth_authority_expired'));assert.equal(calls,1)
  })
  await t.test('uncertain refresh does not retry a possibly rotated refresh token',async()=>{
   const {id,authorize}=await setup('uncertain');let calls=0
   const fetch=async()=>{calls++;throw Error('private-provider-error')}
   await assert.rejects(store.access('uncertain',id,authorize,fetch),code('oauth_reauthorization_required'))
   await assert.rejects(store.access('uncertain',id,authorize,fetch),code('oauth_reauthorization_required'))
   assert.equal(calls,1);assert.equal((await store.metadata('uncertain')).state,'reauthorize')
  })
 }finally{
  await pool?.close();if(created)await admin.sql`DROP DATABASE ${admin.sql(name)}`;await admin.close()
  if(old===undefined)delete process.env.RUE_SETTINGS_ENCRYPTION_KEY;else process.env.RUE_SETTINGS_ENCRYPTION_KEY=old
 }
})
