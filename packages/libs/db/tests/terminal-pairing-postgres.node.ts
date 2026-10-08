import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHash,randomBytes,randomUUID} from 'node:crypto'
import {eq} from 'drizzle-orm'
import {createPostgresDatabase} from '../src/postgres/client.ts'
import {migratePostgresDatabase} from '../src/postgres/migrate.ts'
import {createPostgresTerminalPairingRepository} from '../src/postgres/terminal-pairing.ts'
import {createPostgresWorkerRepository} from '../src/postgres/workers.ts'
import {TerminalPairingError} from '../src/terminal-types.ts'
import {terminalPairingRequests,terminalConnections,terminalCommands,messages,parts,providerKeys,providerKeyGrants,managedAgents} from '../src/postgres/schema.ts'
import {workerHealthSchema} from '../../../apps/core/src/storage/workers.ts'
const adminUrl=process.env.RUE_PG_TEST_ADMIN_URL
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
const code=(expected:string)=>(error:unknown)=>error instanceof TerminalPairingError&&error.code===expected

test('PostgreSQL terminal pairing, history retention and parent authority',{skip:!adminUrl},async t=>{
 const admin=createPostgresDatabase({url:adminUrl,maxConnections:1}),name='rue_test_'+randomUUID().replaceAll('-','')
 let pool:ReturnType<typeof createPostgresDatabase>|undefined,created=false
 try{
  await admin.sql`CREATE DATABASE ${admin.sql(name)}`;created=true
  const url=new URL(adminUrl!);url.pathname='/'+name;pool=createPostgresDatabase({url:url.toString(),maxConnections:8});await migratePostgresDatabase(pool.db)
  const db=pool.db,store=createPostgresTerminalPairingRepository(db),now=1790000000000
  async function pending(pi=randomUUID()){const verifier=randomBytes(32).toString('base64url'),request=await store.request(hash(verifier),pi,now);return {...request,verifier,pi}}
  async function paired(owner:string,pi=randomUUID()){const request=await pending(pi),approval=await store.approve(request.requestId,owner,'Bot',now);return store.exchange(request.requestId,request.verifier,approval.code,now)}
  await t.test('approval/exchange have one winner and activation must confirm the approved owner',async()=>{
   const request=await pending()
   const approvals=await Promise.allSettled(['alice','bob'].map(owner=>store.approve(request.requestId,owner,'Bot',now)))
   assert.equal(approvals.filter(result=>result.status==='fulfilled').length,1)
   const approval=(approvals.find(result=>result.status==='fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof store.approve>>>).value
   const exchanges=await Promise.allSettled(Array.from({length:6},()=>store.exchange(request.requestId,request.verifier,approval.code,now)))
   assert.equal(exchanges.filter(result=>result.status==='fulfilled').length,1)
   const connection=(exchanges.find(result=>result.status==='fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof store.exchange>>>).value
   await assert.rejects(store.authenticate(connection.token,connection.id,now),code('invalid_terminal_credential'))
   await assert.rejects(store.activate(connection.token,now,'not-the-approved-owner'),code('invalid_terminal_credential'))
   await store.activate(connection.token,now,approval.ownerSubject)
   const view=await store.authenticate(connection.token,connection.id,now)
   assert.equal(view.ownerSubject,approval.ownerSubject);assert.equal(JSON.stringify(view).includes(connection.token),false)
  })
  await t.test('failed OTP attempts persist, but guessing a verifier cannot burn approvals',async()=>{
   const request=await pending(),approval=await store.approve(request.requestId,'attempt-owner','Bot',now)
   await assert.rejects(store.exchange(request.requestId,randomBytes(32).toString('base64url'),approval.code,now),code('invalid_pairing'))
   assert.equal((await db.select().from(terminalPairingRequests).where(eq(terminalPairingRequests.id,request.requestId)))[0]!.attempts,0)
   const wrong=approval.code==='000000000000'?'111111111111':'000000000000'
   for(let i=0;i<5;i++)await assert.rejects(store.exchange(request.requestId,request.verifier,wrong,now),code('invalid_pairing'))
   assert.equal((await db.select().from(terminalPairingRequests).where(eq(terminalPairingRequests.id,request.requestId)))[0]!.attempts,5)
   await assert.rejects(store.exchange(request.requestId,request.verifier,approval.code,now),code('invalid_pairing'))
  })
  await t.test('re-pairing retains session IDs/history but cancels work and removes consent',async()=>{
   const pi=randomUUID(),first=await paired('history',pi);await store.activate(first.token,now)
   await db.insert(messages).values({id:'assistant',sessionId:first.sessionId,role:'assistant',time:now,seq:0})
   await db.insert(parts).values({id:'txt_assistant',messageId:'assistant',sessionId:first.sessionId,type:'text',seq:0,payload:{text:'partial'}})
   await db.insert(terminalCommands).values({id:'command',connectionId:first.id,requestId:'request',text:'run',userMessageId:'assistant',assistantMessageId:'assistant',status:'running',result:'partial',createdAt:now,updatedAt:now})
   await db.insert(providerKeys).values({ownerSubject:'history',provider:'anthropic',revision:1,encryptedKey:'opaque'})
   await db.insert(providerKeyGrants).values({ownerSubject:'history',provider:'anthropic',targetType:'terminal',targetId:first.id})
   await db.update(terminalConnections).set({expiresAt:now,instanceId:'old-instance',leaseExpiresAt:now+60000,relayHealth:'{}',remoteEnabled:1}).where(eq(terminalConnections.id,first.id))
   const renewed=await paired('history',pi)
   assert.equal(renewed.id,first.id);assert.equal(renewed.sessionId,first.sessionId);assert.notEqual(renewed.token,first.token)
   assert.equal((await db.select().from(terminalCommands))[0]!.status,'cancelled')
   assert.deepEqual((await db.select().from(parts))[0]!.payload,{text:'partial',remoteStatus:'cancelled'})
   assert.equal((await db.select().from(providerKeyGrants)).length,0)
   const [row]=await db.select().from(terminalConnections).where(eq(terminalConnections.id,first.id));assert.equal(row!.leaseExpiresAt,null);assert.equal(row!.relayHealth,null);assert.equal(row!.remoteEnabled,0)
   await assert.rejects(store.authenticate(first.token,first.id,now),code('invalid_terminal_credential'))
   await store.activate(renewed.token,now)
   const other=await paired('different-owner',pi);assert.notEqual(other.id,first.id)
  })
  await t.test('managed transport expires with its worker, without renewing authority',async()=>{
   const connection=await paired('managed');await store.activate(connection.token,now)
   const workerStore=createPostgresWorkerRepository(db,raw=>workerHealthSchema.parse(raw)),worker=await workerStore.create('managed','Host',randomUUID(),now),lease=await workerStore.connect(worker.worker.id,worker.secret!,randomUUID(),now)
   await db.insert(managedAgents).values({id:randomUUID(),ownerSubject:'managed',workerId:worker.worker.id,connectionId:connection.id,name:'Managed',config:'{}',desired:'running',revision:1,grantRevision:1,grantGeneration:lease.generation,createdAt:now})
   assert.equal((await store.authenticate(connection.token,connection.id,now)).expiresAt,lease.expiresAt)
   await assert.rejects(store.authenticate(connection.token,connection.id,lease.expiresAt),code('invalid_terminal_credential'))
   await workerStore.change('managed',worker.worker.id,'revoke',worker.worker.revision,now+1)
   await assert.rejects(store.authenticate(connection.token,connection.id,now+2),code('invalid_terminal_credential'))
  })
  await t.test('pending-request quota is atomic',async()=>{
   await db.delete(terminalPairingRequests)
   await db.insert(terminalPairingRequests).values(Array.from({length:99},()=>({id:randomUUID(),verifierHash:hash('fixture'),piSessionId:randomUUID(),expiresAt:now+300000})))
   const results=await Promise.allSettled(Array.from({length:5},()=>pending()))
   assert.equal(results.filter(result=>result.status==='fulfilled').length,1)
   assert.equal(results.filter(result=>result.status==='rejected'&&code('pairing_unavailable')(result.reason)).length,4)
  })
 }finally{await pool?.close();if(created)await admin.sql`DROP DATABASE ${admin.sql(name)}`;await admin.close()}
})
