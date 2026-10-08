import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHash,randomBytes,randomUUID} from 'node:crypto'
import {eq} from 'drizzle-orm'
import {createPostgresDatabase} from '../src/postgres/client.ts'
import {migratePostgresDatabase} from '../src/postgres/migrate.ts'
import {createPostgresWorkerRepository} from '../src/postgres/workers.ts'
import {createPostgresTerminalPairingRepository} from '../src/postgres/terminal-pairing.ts'
import {createPostgresTerminalRelayRepository} from '../src/postgres/terminal-relay.ts'
import {createPostgresCompactionRepository} from '../src/postgres/managed-compaction.ts'
import {managedAgents,managedCompactions,terminalConnections} from '../src/postgres/schema.ts'
import {workerHealthSchema} from '../../../apps/core/src/storage/workers.ts'
import {compactRequestSchema} from '../../../apps/core/src/storage/managed-compaction.ts'
import {validateContent} from '../../../apps/core/src/storage/attachments.ts'
const adminUrl=process.env.RUE_PG_TEST_ADMIN_URL
const health={version:'1.0.0',platform:'linux',architecture:'arm64',dockerAvailable:true,acceptingWork:true,freeMemoryBytes:1000,cpus:2,capabilities:['host-health-v1','managed-compact-v1']}

test('PostgreSQL managed compaction authority and single-use claims',{skip:!adminUrl},async t=>{
 const admin=createPostgresDatabase({url:adminUrl,maxConnections:1}),name='rue_test_'+randomUUID().replaceAll('-','')
 let pool:ReturnType<typeof createPostgresDatabase>|undefined,created=false
 try{
  await admin.sql`CREATE DATABASE ${admin.sql(name)}`;created=true
  const url=new URL(adminUrl!);url.pathname='/'+name;pool=createPostgresDatabase({url:url.toString(),maxConnections:8});await migratePostgresDatabase(pool.db)
  const db=pool.db,now=Date.now(),worker=createPostgresWorkerRepository(db,raw=>workerHealthSchema.parse(raw)),pairing=createPostgresTerminalPairingRepository(db)
  const relay=createPostgresTerminalRelayRepository(db,{validateContent,mergeHealth:(_p,h)=>h,catalogHash:()=>undefined,summaryHealth:()=>null,catalog:()=>({piVersion:null,catalog:null,catalogHash:null})})
  const store=createPostgresCompactionRepository(db,{worker,relay,parseRequest:raw=>compactRequestSchema.parse(raw)})
  const request=()=>({requestId:randomUUID(),expectedRevision:1,acknowledgeModelUse:true})
  async function fixture(){
   const owner=randomUUID(),enrolled=await worker.create(owner,'Host',randomUUID(),now),instance=randomUUID()
   const lease=await worker.connect(enrolled.worker.id,enrolled.secret!,instance,now)
   const auth={id:enrolled.worker.id,secret:enrolled.secret!,instance,generation:lease.generation}
   await worker.heartbeat(auth.id,auth.secret,instance,auth.generation,health,now)
   const verifier=randomBytes(32).toString('base64url'),pending=await pairing.request(createHash('sha256').update(verifier).digest('hex'),randomUUID(),now)
   const approved=await pairing.approve(pending.requestId,owner,'Bot',now),grant=await pairing.exchange(pending.requestId,verifier,approved.code,now)
   await pairing.activate(grant.token,now)
   const [host]=await db.select().from(terminalConnections).where(eq(terminalConnections.id,grant.id));await relay.configure(owner,grant.id,'Bot',true,host!.settingsRevision)
   const agentId=randomUUID()
   await db.insert(managedAgents).values({id:agentId,ownerSubject:owner,workerId:auth.id,connectionId:grant.id,sessionId:grant.sessionId,name:'Bot',config:'{}',desired:'running',revision:1,grantRevision:1,grantGeneration:auth.generation,grantBoot:1,observed:'running',observedRevision:1,observedGeneration:auth.generation,createdAt:now})
   const runtime={id:grant.id,token:grant.token,instance:randomUUID()};await relay.attach(runtime.token,runtime.id,runtime.instance,now,2)
   return {owner,agentId,auth,runtime,sessionId:grant.sessionId}
  }
  await t.test('request and claim have one winner; only its nonce can acknowledge',async()=>{
   const f=await fixture(),input=request(),requested=await Promise.all(Array.from({length:5},()=>store.request(f.owner,f.agentId,input,now)))
   assert.equal(new Set(requested.map(c=>c.id)).size,1);const id=requested[0]!.id
   assert.equal((await store.workerCommands(f.auth,now))[0]!.id,id)
   await store.assign(f.auth,id,now)
   assert.equal((await store.runtimeCommands(f.runtime,now))[0]!.id,id)
   const claims=await Promise.all(Array.from({length:6},()=>store.claim(f.runtime,id,now)))
   const executed=claims.filter(c=>c.execute);assert.equal(executed.length,1)
   const won=executed[0]!;assert.ok(won.execute)
   assert.deepEqual(await store.runtimeCommands(f.runtime,now),[])
   await assert.rejects(store.acknowledge(f.runtime,id,randomBytes(32).toString('base64url'),'succeeded',now),/managed_compact_ack_fenced/)
   const receipt=await store.acknowledge(f.runtime,id,won.nonce,'succeeded',now)
   assert.equal(receipt.status,'succeeded');assert.equal(JSON.stringify(receipt).includes(won.nonce),false)
   assert.deepEqual(await store.acknowledge(f.runtime,id,won.nonce,'succeeded',now),receipt)
   await assert.rejects(store.acknowledge(f.runtime,id,won.nonce,'failed',now),/managed_compact_ack_fenced/)
   const [saved]=await db.select().from(managedCompactions).where(eq(managedCompactions.id,id));assert.notEqual(saved!.nonceHash,won.nonce)
  })
  await t.test('expired execution is uncertain, blocks prompts and cannot be replayed',async()=>{
   const f=await fixture(),c=await store.request(f.owner,f.agentId,request(),now);await store.assign(f.auth,c.id,now)
   const claim=await store.claim(f.runtime,c.id,now);assert.ok(claim.execute)
   await db.update(managedCompactions).set({expiresAt:now+1}).where(eq(managedCompactions.id,c.id))
   assert.equal((await store.list(f.owner,f.agentId,now+2))[0]!.status,'uncertain')
   assert.equal((await store.claim(f.runtime,c.id,now+2)).execute,false)
   await assert.rejects(store.request(f.owner,f.agentId,request(),now+2),/managed_compact_pending_or_uncertain/)
   await assert.rejects(relay.enqueue(f.owner,f.sessionId,randomUUID(),'do not dispatch',now+2),/computer_not_ready/)
   await assert.rejects(store.acknowledge(f.runtime,c.id,claim.nonce,'succeeded',now+2),/managed_compact_ack_fenced/)
  })
  await t.test('revision changes cancel unstarted work and never expose other owners',async()=>{
   const f=await fixture(),other=await fixture(),c=await store.request(f.owner,f.agentId,request(),now)
   await assert.rejects(store.list(other.owner,f.agentId,now),/managed_agent_not_found/)
   await assert.rejects(store.assign(other.auth,c.id,now),/managed_agent_not_found/)
   await assert.rejects(store.claim(other.runtime,c.id,now),/managed_agent_not_found/)
   await db.update(managedAgents).set({revision:2}).where(eq(managedAgents.id,f.agentId))
   assert.equal((await store.list(f.owner,f.agentId,now))[0]!.status,'cancelled')
   assert.equal((await store.claim(f.runtime,c.id,now)).execute,false)
  })
  await t.test('runtime takeover fences a running compaction and its old nonce',async()=>{
   const f=await fixture(),c=await store.request(f.owner,f.agentId,request(),now);await store.assign(f.auth,c.id,now)
   const claim=await store.claim(f.runtime,c.id,now);assert.ok(claim.execute)
   const replacement={...f.runtime,instance:randomUUID()};await relay.attach(replacement.token,replacement.id,replacement.instance,now+1,2)
   assert.equal((await store.list(f.owner,f.agentId,now+1))[0]!.status,'uncertain')
   await assert.rejects(store.acknowledge(f.runtime,c.id,claim.nonce,'succeeded',now+1),/computer_instance_changed/)
   await assert.rejects(store.acknowledge(replacement,c.id,claim.nonce,'succeeded',now+1),/managed_compact_ack_fenced/)
  })
 }finally{await pool?.close();if(created)await admin.sql`DROP DATABASE ${admin.sql(name)}`;await admin.close()}
})
