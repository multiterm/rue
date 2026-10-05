import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHash,randomBytes,randomUUID} from 'node:crypto'
import {eq} from 'drizzle-orm'
import {createPostgresDatabase} from '../src/postgres/client.ts'
import {migratePostgresDatabase} from '../src/postgres/migrate.ts'
import {createPostgresTerminalPairingRepository} from '../src/postgres/terminal-pairing.ts'
import {createPostgresTerminalRelayRepository} from '../src/postgres/terminal-relay.ts'
import {terminalConnections,terminalCommands,parts,notifications,messages} from '../src/postgres/schema.ts'
import {validateContent} from '../../../apps/core/src/storage/attachments.ts'
const adminUrl=process.env.RUE_PG_TEST_ADMIN_URL

test('PostgreSQL relay transactions and fencing',{skip:!adminUrl},async t=>{
 const admin=createPostgresDatabase({url:adminUrl,maxConnections:1}),name='rue_test_'+randomUUID().replaceAll('-','')
 let pool:ReturnType<typeof createPostgresDatabase>|undefined,created=false
 try{
  await admin.sql`CREATE DATABASE ${admin.sql(name)}`;created=true
  const url=new URL(adminUrl!);url.pathname='/'+name;pool=createPostgresDatabase({url:url.toString(),maxConnections:8});await migratePostgresDatabase(pool.db)
  const db=pool.db,pairing=createPostgresTerminalPairingRepository(db),now=Date.now()
  const relay=createPostgresTerminalRelayRepository(db,{validateContent,mergeHealth:(_previous,input)=>input,catalogHash:()=>undefined,summaryHealth:()=>null,catalog:()=>({piVersion:null,catalog:null,catalogHash:null})})
  async function fixture(){
   const owner=randomUUID(),verifier=randomBytes(32).toString('base64url'),request=await pairing.request(createHash('sha256').update(verifier).digest('hex'),randomUUID(),now)
   const approval=await pairing.approve(request.requestId,owner,'Bot',now),grant=await pairing.exchange(request.requestId,verifier,approval.code,now)
   await pairing.activate(grant.token,now)
   const [host]=await db.select().from(terminalConnections).where(eq(terminalConnections.id,grant.id))
   await relay.configure(owner,grant.id,'Bot',true,host!.settingsRevision)
   const instance=randomUUID();await relay.attach(grant.token,grant.id,instance,now,2)
   return {owner,grant,instance}
  }
  await t.test('concurrent identical requests create exactly one command and message pair',async()=>{
   const {owner,grant:g,instance}=await fixture(),request=randomUUID()
   const rows=await Promise.all(Array.from({length:6},()=>relay.enqueue(owner,g.sessionId,request,'hello',now)))
   assert.equal(new Set(rows.map(row=>row.id)).size,1)
   assert.equal((await db.select().from(messages).where(eq(messages.sessionId,g.sessionId))).length,2)
   await assert.rejects(relay.enqueue(owner,g.sessionId,request,'changed',now),/request_id_conflict/)
   await assert.rejects(relay.enqueue('other-owner',g.sessionId,randomUUID(),'no',now),/terminal_transport_unavailable/)
   const command=rows[0]!
   await relay.transition(g.token,g.id,instance,command.id,'claim',now)
   await relay.transition(g.token,g.id,instance,command.id,'start',now)
   await relay.publish(g.token,g.id,instance,command.id,1,'done','completed',now)
   await relay.publish(g.token,g.id,instance,command.id,1,'done','completed',now)
   assert.equal((await db.select().from(notifications).where(eq(notifications.sessionId,g.sessionId))).length,1)
  })
  await t.test('concurrent queue capacity is bounded and messages roll back on rejection',async()=>{
   const {owner,grant:g}=await fixture()
   const outcomes=await Promise.allSettled(Array.from({length:14},()=>relay.enqueue(owner,g.sessionId,randomUUID(),'hello',now)))
   assert.equal(outcomes.filter(value=>value.status==='fulfilled').length,10)
   assert.equal((await db.select().from(messages).where(eq(messages.sessionId,g.sessionId))).length,20)
   const queue=await relay.queue(owner,g.id,now+300001)
   assert.equal(queue!.length,10);assert.ok(queue!.every(row=>row.status==='queued'))
   const stored=await db.select().from(terminalCommands).where(eq(terminalCommands.connectionId,g.id))
   assert.ok(stored.every(row=>row.startedAt===null&&row.instanceId===null))
   assert.equal(new Set(stored.map(row=>row.queuePosition)).size,10)
  })
  await t.test('claims are FIFO and an instance takeover fences execution, not queued intent',async()=>{
   const {owner,grant:g,instance}=await fixture()
   const a=await relay.enqueue(owner,g.sessionId,randomUUID(),'first',now),b=await relay.enqueue(owner,g.sessionId,randomUUID(),'second',now)
   await assert.rejects(relay.transition(g.token,g.id,instance,b.id,'claim',now),/command_out_of_order/)
   await relay.transition(g.token,g.id,instance,a.id,'claim',now)
   const next=randomUUID();await relay.attach(g.token,g.id,next,now+1,2)
   await assert.rejects(relay.transition(g.token,g.id,instance,a.id,'start',now+1),/computer_instance_changed/)
   assert.equal((await db.select().from(terminalCommands).where(eq(terminalCommands.id,a.id)))[0]!.status,'interrupted')
   const poll=await relay.poll(g.token,g.id,next,now+2,2)
   assert.deepEqual(poll.commands.map(row=>row.id),[b.id])
   await assert.rejects(relay.poll(g.token,g.id,next,now+60002,2),/computer_lease_expired/)
  })
  await t.test('attachment bytes survive storage and require a running claim to retrieve',async()=>{
   const {owner,grant:g,instance}=await fixture(),data=Buffer.from([0,255,1,128,0]).toString('base64')
   const row=await relay.enqueue(owner,g.sessionId,randomUUID(),'binary',now,[{type:'file',name:'a.bin',mimeType:'application/octet-stream',data}])
   await assert.rejects(relay.input(g.token,g.id,instance,row.id,now),/command_unavailable/)
   await relay.transition(g.token,g.id,instance,row.id,'claim',now);await relay.transition(g.token,g.id,instance,row.id,'start',now)
   const content=await relay.input(g.token,g.id,instance,row.id,now)
   assert.equal(content[0]!.data,data)
  })
  await t.test('owner projections isolate accounts and omit transport credentials and command results',async()=>{
   const {owner,grant:g}=await fixture()
   await relay.enqueue(owner,g.sessionId,randomUUID(),'private prompt',now)
   const list=await relay.list(owner,now)
   assert.equal(list.length,1);assert.equal(list[0]!.id,g.id);assert.equal(list[0]!.status,'online')
   assert.equal(list[0]!.runs.length,1)
   for(const field of ['tokenHash','instanceId','relayHealth','text','result'])assert.equal(JSON.stringify(list).includes('"'+field+'":'),false)
   assert.deepEqual(await relay.list('absent-owner',now),[])
   assert.equal(await relay.queue('absent-owner',g.id,now),undefined)
   assert.equal(await relay.catalog('absent-owner',g.id),undefined)
   const queue=await relay.queue(owner,g.id,now)
   assert.deepEqual(Object.keys(queue![0]!).sort(),['created_at','id','status','text','updated_at','user_message_id'])
  })
  await t.test('explicit queue recovery is single-winner, retains messages and removes the stale outcome',async()=>{
   const {owner,grant:g}=await fixture(),row=await relay.enqueue(owner,g.sessionId,randomUUID(),'recover',now)
   await db.update(terminalCommands).set({status:'expired'}).where(eq(terminalCommands.id,row.id))
   await db.insert(notifications).values({id:randomUUID(),ownerSubject:owner,sessionId:g.sessionId,eventKey:`terminal:${row.id}`,kind:'task_failed',createdAt:now})
   assert.equal(await relay.recoverableCount(owner,g.id),1)
   assert.equal((await relay.recoverableMessages(owner,g.id))![0]!.id,row.id)
   await assert.rejects(relay.restoreQueue(owner,g.id,row.id,'wrong-session',now),/queue_session_changed/)
   const outcomes=await Promise.all(Array.from({length:5},()=>relay.restoreQueue(owner,g.id,row.id,g.sessionId,now)))
   assert.equal(outcomes.filter(value=>value!.changed).length,1)
   assert.equal(await relay.recoverableCount(owner,g.id),0)
   assert.equal((await db.select().from(messages).where(eq(messages.sessionId,g.sessionId))).length,2)
   assert.equal((await db.select().from(notifications).where(eq(notifications.sessionId,g.sessionId))).length,0)
  })
  await t.test('claimed work cannot be restored as never-dispatched work',async()=>{
   const {owner,grant:g,instance}=await fixture(),row=await relay.enqueue(owner,g.sessionId,randomUUID(),'claimed',now)
   await relay.transition(g.token,g.id,instance,row.id,'claim',now)
   await db.update(terminalCommands).set({status:'expired'}).where(eq(terminalCommands.id,row.id))
   assert.equal(await relay.recoverableCount(owner,g.id),0)
   await assert.rejects(relay.restoreQueue(owner,g.id,row.id,g.sessionId,now),/queue_request_not_recoverable/)
  })
  await t.test('mirror snapshots are monotonic and final receipts are immutable',async()=>{
   const {grant:g,instance}=await fixture(),event=randomUUID()
   const first=await relay.mirror(g.token,g.id,instance,event,'assistant','partial',now,{version:1,final:false})
   await relay.mirror(g.token,g.id,instance,event,'assistant','finished',now+1,{version:2,final:true})
   await relay.mirror(g.token,g.id,instance,event,'assistant','stale',now+2,{version:1,final:false})
   await assert.rejects(relay.mirror(g.token,g.id,instance,event,'assistant','changed',now+3,{version:3,final:true}),/mirror_conflict/)
   assert.equal((await db.select().from(parts).where(eq(parts.id,'txt_'+first.messageId)))[0]!.payload.text,'finished')
   const {receipts}=await relay.receipts(g.token,g.id,now+4)
   assert.equal(receipts[0]!.sha256,createHash('sha256').update('finished').digest('hex'));assert.equal(receipts[0]!.final,true)
  })
 }finally{await pool?.close();if(created)await admin.sql`DROP DATABASE ${admin.sql(name)}`;await admin.close()}
})
