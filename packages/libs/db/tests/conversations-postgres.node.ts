import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {eq} from 'drizzle-orm'
import {createPostgresDatabase} from '../src/postgres/client.js'
import {migratePostgresDatabase} from '../src/postgres/migrate.js'
import {createPostgresConversationRepository} from '../src/postgres/conversations.js'
import {messages,parts,preferences,sessions} from '../src/postgres/schema.js'
const adminUrl=process.env.RUE_PG_TEST_ADMIN_URL

test('PostgreSQL conversation writes and owner-isolated projections',{skip:!adminUrl},async t=>{
 const admin=createPostgresDatabase({url:adminUrl,maxConnections:1}),name='rue_test_'+randomUUID().replaceAll('-','')
 let pool:ReturnType<typeof createPostgresDatabase>|undefined,created=false
 try{
  await admin.sql`CREATE DATABASE ${admin.sql(name)}`;created=true
  const url=new URL(adminUrl!);url.pathname='/'+name;pool=createPostgresDatabase({url:url.toString(),maxConnections:8});await migratePostgresDatabase(pool.db)
  const db=pool.db,store=createPostgresConversationRepository(db)
  async function fixture(){const owner=randomUUID(),id=randomUUID();await store.create(owner,{id,title:'Original',meta:{preserved:true}});return {owner,id}}
  await t.test('create, patch and deletion retain ownership and independent concurrent fields',async()=>{
   const {owner,id}=await fixture()
   assert.equal((await store.get(owner,id))?.terminalConnectionId,null)
   await Promise.all([store.update(owner,id,{title:'Changed'}),store.update(owner,id,{model:'runtime-model'})])
   const row=await store.get(owner,id);assert.equal(row?.title,'Changed');assert.equal(row?.model,'runtime-model');assert.deepEqual(row?.meta,{preserved:true})
   assert.equal(await store.update('other',id,{title:'stolen'}),undefined);assert.equal(await store.delete('other',id),false)
   assert.equal(await store.delete(owner,id),true);assert.equal(await store.get(owner,id),undefined)
  })
  await t.test('concurrent messages and parts allocate distinct ordered sequences',async()=>{
   const {owner,id}=await fixture()
   const rows=await Promise.all(Array.from({length:16},()=>store.appendMessage(owner,{id:randomUUID(),sessionId:id,role:'user'},[{type:'text',text:'hello'}])))
   assert.deepEqual(rows.map(r=>r.seq).sort((a,b)=>a-b),Array.from({length:16},(_,i)=>i))
   assert.equal((await store.listMessages(owner,id)).length,16)
   const messageId=rows[0]!.id
   await Promise.all(Array.from({length:8},()=>store.appendPart(owner,{id:randomUUID(),sessionId:id,messageId,type:'text',payload:{text:'more'}})))
   assert.deepEqual((await store.listParts(owner,messageId)).map(p=>p.seq),Array.from({length:9},(_,i)=>i))
  })
  await t.test('cross-owner messages, parts and ratings never leak or mutate',async()=>{
   const {owner,id}=await fixture(),mid=randomUUID(),pid=randomUUID()
   await store.appendMessage(owner,{id:mid,sessionId:id,role:'assistant'})
   await store.appendPart(owner,{id:pid,sessionId:id,messageId:mid,type:'text',payload:{text:'private'}})
   await store.setRating(owner,mid,1)
   assert.equal(await store.getMessage('other',mid),undefined);assert.equal(await store.getPart('other',pid),undefined)
   assert.deepEqual(await store.listMessages('other',id),[]);assert.deepEqual(await store.listParts('other',mid),[]);assert.deepEqual(await store.listSessionParts('other',id),[])
   assert.equal(await store.getRating('other',mid),0);assert.equal(await store.updatePart('other',pid,{text:'stolen'}),undefined)
   await assert.rejects(store.setRating('other',mid,-1),/message_not_found/)
   await assert.rejects(store.appendMessage('other',{id:randomUUID(),sessionId:id,role:'user'}),/session_not_found/)
   assert.deepEqual((await store.getPart(owner,pid))?.payload,{text:'private'});assert.equal(await store.getRating(owner,mid),1)
  })
  await t.test('part insertion checks message/session association even within one account',async()=>{
   const {owner,id}=await fixture(),other=randomUUID(),mid=randomUUID()
   await store.create(owner,{id:other});await store.appendMessage(owner,{id:mid,sessionId:id,role:'user'})
   await assert.rejects(store.appendPart(owner,{id:randomUUID(),sessionId:other,messageId:mid,type:'text',payload:{text:'wrong session'}}),/message_not_found/)
   assert.deepEqual(await store.listSessionParts(owner,other),[])
  })
  await t.test('a failing attachment rolls back message, earlier parts and session touch',async()=>{
   const {owner,id}=await fixture(),mid=randomUUID(),before=await store.get(owner,id)
   await assert.rejects(store.appendMessage(owner,{id:mid,sessionId:id,role:'user',time:before!.updatedAt+123},[{type:'text',text:'first'},{type:null,text:'invalid'} as never]))
   assert.equal(await store.getMessage(owner,mid),undefined);assert.deepEqual(await store.listSessionParts(owner,id),[])
   assert.equal((await store.get(owner,id))?.updatedAt,before!.updatedAt)
  })
  await t.test('JSON edge cases survive updates, ratings clear and deletion cascades',async()=>{
   const {owner,id}=await fixture(),mid=randomUUID(),pid=randomUUID(),text='Unicode '+String.fromCharCode(0,0xd800)
   await store.appendMessage(owner,{id:mid,sessionId:id,role:'assistant',meta:{text}})
   await store.appendPart(owner,{id:pid,sessionId:id,messageId:mid,type:'text',payload:{text}})
   assert.equal((await store.updatePart(owner,pid,{text,finished:true}))?.payload.text,text)
   await store.setRating(owner,mid,-1);assert.equal(await store.getRating(owner,mid),-1)
   await store.setRating(owner,mid,0);assert.equal(await store.getRating(owner,mid),0)
   await store.setRating(owner,mid,1);assert.equal(await store.delete(owner,id),true)
   assert.equal((await db.select().from(sessions).where(eq(sessions.id,id))).length,0)
   assert.equal((await db.select().from(messages).where(eq(messages.id,mid))).length,0)
   assert.equal((await db.select().from(parts).where(eq(parts.id,pid))).length,0)
   assert.equal((await db.select().from(preferences).where(eq(preferences.messageId,mid))).length,0)
  })
 }finally{await pool?.close();if(created)await admin.sql`DROP DATABASE ${admin.sql(name)}`;await admin.close()}
})
