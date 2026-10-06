import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {setTimeout} from 'node:timers/promises'
import type {Database} from 'better-sqlite3'
import {createPostgresDatabase,migratePostgresDatabase} from '@multiterm/rue-db/postgres'
import {createRueTrpcClient} from '@multiterm/rue-trpc/client'
import {createApp} from '../../src/server/app.js'
import {createPostgresSessionServices} from '../../src/server/postgres-session-services.js'
import type {ServerContext} from '../../src/server/context.js'
import {ConfigSchema} from '../../src/config/index.js'
import {Bus} from '../../src/bus/index.js'
import {getAuthBackend} from '../../src/auth/index.js'
import {anthropicProvider} from '../../src/provider/anthropic.js'
const adminUrl=process.env.RUE_PG_TEST_ADMIN_URL

test('real PostgreSQL session REST and typed client integration never touch SQLite',{skip:!adminUrl},async t=>{
 const admin=createPostgresDatabase({url:adminUrl,maxConnections:1}),name='rue_test_'+randomUUID().replaceAll('-','')
 let pool:ReturnType<typeof createPostgresDatabase>|undefined,created=false,sqliteAccess=0
 try {
  await admin.sql`CREATE DATABASE ${admin.sql(name)}`;created=true
  const url=new URL(adminUrl!);url.pathname='/'+name;pool=createPostgresDatabase({url:url.toString(),maxConnections:8});await migratePostgresDatabase(pool.db)
  const services=createPostgresSessionServices(pool.db,()=>undefined)
  const ctx:ServerContext={db:new Proxy({} as Database,{get(){sqliteAccess++;throw Error('SQLite access forbidden in PostgreSQL integration')}}),sessions:services,config:ConfigSchema.parse({}),bus:new Bus()}
  const app=createApp({ctx})
  const request=(path:string,method='GET',body?:unknown)=>app.request(path,{method,...body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)}})
  const client=createRueTrpcClient({baseUrl:'https://rue.test',fetch:async(url,init)=>app.fetch(new Request(url,init))})
  async function create(){const response=await request('/session','POST',{title:'PostgreSQL chat',meta:{text:'unicode '+String.fromCharCode(0,0xd800)}});assert.equal(response.status,200);return await response.json() as {id:string}}
  await t.test('REST create/update and typed tRPC read share the owner-filtered primary',async()=>{
   const {id}=await create()
   assert.equal((await client.session.query({id})).title,'PostgreSQL chat')
   assert.equal((await request('/session/'+id,'PATCH',{title:'Updated'})).status,200)
   assert.equal((await client.session.query({id})).title,'Updated')
   const foreign=randomUUID();await services.conversations.create('other',{id:foreign,title:'Private'})
   assert.equal((await request('/session/'+foreign)).status,404)
   assert.deepEqual(await (await request('/session/'+foreign+'/messages')).json(),[])
   assert.equal((await request('/session/'+foreign,'PATCH',{title:'stolen'})).status,404)
   await assert.rejects(client.session.query({id:foreign}),error=>(error as {data?:{code?:string}}).data?.code==='NOT_FOUND')
   assert.equal((await request('/session/'+id,'DELETE')).status,200)
   assert.equal((await request('/session/'+id)).status,404)
  })
  await t.test('transcript polling strips bytes; authenticated attachment download preserves them',async()=>{
   const {id}=await create(),messageId=randomUUID(),partId=randomUUID(),bytes=Buffer.from([0,1,127,255])
   await services.conversations.appendMessage('local',{id:messageId,sessionId:id,role:'user'})
   await services.conversations.appendPart('local',{id:partId,sessionId:id,messageId,type:'file',payload:{data:bytes.toString('base64'),name:'fixture.bin',mime:'application/octet-stream'}})
   const transcript=await (await request('/session/'+id+'/parts')).json() as Array<{payload:Record<string,unknown>}>
   assert.equal(transcript.length,1);assert.equal('data' in transcript[0]!.payload,false)
   const response=await request('/session/'+id+'/attachments/'+partId)
   assert.equal(response.status,200);assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes)
   const second=await create();assert.equal((await request('/session/'+second.id+'/attachments/'+partId)).status,404)
  })
  await t.test('async history reset holds admission until commit and releases on errors',async()=>{
   const {id}=await create(),messageId=randomUUID();await services.conversations.appendMessage('local',{id:messageId,sessionId:id,role:'user'})
   const clear=()=>request('/session/'+id+'/history','DELETE',{expectedLastMessageId:messageId})
   const original=services.history.clear;let release!:()=>void
   const gate=new Promise<void>(resolve=>{release=resolve})
   services.history.clear=async(...args)=>{await gate;return original(...args)}
   const pending=clear()
   try{
    for(let i=0;i<100&&!ctx.historyResets?.has('local');i++)await setTimeout(2)
    assert.equal(ctx.historyResets?.has('local'),true)
    assert.equal((await clear()).status,409)
   }finally{release();services.history.clear=original}
   assert.equal((await pending).status,200);assert.equal(ctx.historyResets?.size,0)
   assert.deepEqual(await (await request('/session/'+id+'/messages')).json(),[])
   assert.equal((await clear()).status,409);assert.equal(ctx.historyResets?.size,0)
   ctx.activeRuns=new Map([['local',1]]);assert.equal((await clear()).status,409);ctx.activeRuns.clear()
  })
  await t.test('two-turn cloud chat persists ordered streams and never reads SQLite',async()=>{
   assert.equal(process.env.RUE_AUTH_BACKEND,'memory','Use an isolated memory credential backend')
   const auth=getAuthBackend();await auth.set('anthropic','fixture-only-key')
   const chat=t.mock.method(anthropicProvider,'chat',async(request,onText)=>{onText('Hello');onText(' from');onText(' PostgreSQL');return {content:'Hello from PostgreSQL',toolCalls:[]}})
   try {
    const {id}=await create()
    for(const text of ['first question','second question']){
     const response=await request('/session/'+id+'/message','POST',{text,wait:true,provider:'anthropic',model:'fixture-model'})
     assert.equal(response.status,200);assert.equal((await response.json() as {text:string}).text,'Hello from PostgreSQL')
    }
    assert.equal(chat.mock.callCount(),2)
    assert.ok(JSON.stringify(chat.mock.calls[1]!.arguments[0].messages).includes('first question'))
    assert.ok(JSON.stringify(chat.mock.calls[1]!.arguments[0].messages).includes('Hello from PostgreSQL'))
    const rows=await services.conversations.listMessages('local',id);assert.deepEqual(rows.map(r=>r.role),['user','assistant','user','assistant'])
    const transcript=await services.conversations.listSessionParts('local',id)
    assert.equal(transcript.filter(p=>p.type==='text'&&p.payload.streaming===false&&p.payload.text==='Hello from PostgreSQL').length,2)
    assert.equal(ctx.activeRuns?.size,0)
    assert.equal(Number((await pool!.sql`SELECT count(*) AS n FROM notifications WHERE session_id=${id} AND kind='task_completed'`)[0]!.n),2)
   }finally{chat.mock.restore();await auth.remove('anthropic')}
  })
  await t.test('admission and streaming failures release slots without rerunning inference or leaking SQL',async()=>{
   assert.equal(process.env.RUE_AUTH_BACKEND,'memory')
   const auth=getAuthBackend();await auth.set('anthropic','fixture-only-key')
   const chat=t.mock.method(anthropicProvider,'chat',async(_request,onText)=>{onText('stream');onText(' more');return {content:'stream more',toolCalls:[]}})
   const begin=services.conversations.beginCloud,update=services.conversations.updatePart
   try {
    const {id}=await create(),send=()=>request('/session/'+id+'/message','POST',{text:'question',wait:true,provider:'anthropic',model:'fixture-model'})
    services.conversations.beginCloud=async()=>{throw Error('SQL parameters: fixture-private-value')}
    const admission=await send();assert.equal(admission.status,503);assert.equal((await admission.text()).includes('fixture-private-value'),false)
    assert.equal(ctx.activeRuns?.size,0);assert.equal(chat.mock.callCount(),0);assert.deepEqual(await services.conversations.listMessages('local',id),[])
    services.conversations.beginCloud=begin
    let failed=false
    services.conversations.updatePart=async(...args)=>{if(!failed&&args[2].streaming===true){failed=true;throw Error('SQL parameters: fixture-private-value')}return update(...args)}
    const response=await send();assert.equal(response.status,200);assert.equal((await response.json() as {stopReason:string}).stopReason,'error')
    assert.equal(chat.mock.callCount(),1);assert.equal(ctx.activeRuns?.size,0)
    const transcript=await services.conversations.listSessionParts('local',id)
    assert.equal(JSON.stringify(transcript).includes('fixture-private-value'),false)
    assert.ok(transcript.some(p=>p.type==='error'&&p.payload.message==='conversation_storage_unavailable'))
    assert.equal(transcript.some(p=>p.payload.streaming===true),false)
   }finally{services.conversations.beginCloud=begin;services.conversations.updatePart=update;chat.mock.restore();await auth.remove('anthropic')}
  })
  await t.test('REST and tRPC redact database exception details',async()=>{
   const get=services.conversations.get
   services.conversations.get=async()=>{throw Error('SQL parameters: fixture-sensitive-value')}
   try {
    const response=await request('/session/failure');assert.equal(response.status,500);assert.equal((await response.text()).includes('fixture-sensitive-value'),false)
    await assert.rejects(client.session.query({id:'failure'}),error=>(error as Error).message==='internal_error'&&!JSON.stringify(error).includes('fixture-sensitive-value'))
   }finally{services.conversations.get=get}
  })
  await t.test('SSE replay awaits PostgreSQL ownership checks without dropping or reordering live events',async()=>{
   const {id}=await create(),foreign=randomUUID();await services.conversations.create('other',{id:foreign})
   const seen=ctx.bus.publish('fixture.event',{ownerSubject:'local',marker:'seen'})
   ctx.bus.publish('fixture.event',{sessionId:id,marker:'replayed-owned'})
   ctx.bus.publish('fixture.event',{sessionId:foreign,marker:'foreign-secret'})
   const history=ctx.bus.historySince.bind(ctx.bus)
   const spy=t.mock.method(ctx.bus,'historySince',cursor=>{const events=history(cursor);queueMicrotask(()=>ctx.bus.publish('fixture.event',{ownerSubject:'local',marker:'live-after-replay'}));return events})
   const response=await app.request('/event',{headers:{'last-event-id':String(seen.id)}})
   const reader=response.body!.getReader(),timer=globalThis.setTimeout(()=>{void reader.cancel()},3000);let output=''
   try {
    while(!output.includes('live-after-replay')){const chunk=await reader.read();if(chunk.done)break;output+=new TextDecoder().decode(chunk.value)}
    assert.ok(output.includes('replayed-owned'));assert.ok(output.includes('live-after-replay'));assert.equal(output.includes('foreign-secret'),false)
    assert.ok(output.indexOf('replayed-owned')<output.indexOf('live-after-replay'))
   }finally{globalThis.clearTimeout(timer);await reader.cancel();spy.mock.restore()}
   assert.equal(ctx.bus.listenerCount(),0)
  })
  await t.test('settings HTTP uses PostgreSQL revisions and rejects identity changes',async()=>{
   const response=await request('/agent/settings');assert.equal(response.status,200)
   const metadata=await response.json() as {models:string[];revision:number;keyStorageAvailable:boolean}
   assert.equal(metadata.revision,0);assert.equal(metadata.keyStorageAvailable,false);assert.equal(typeof metadata.models[0],'string')
   const input={harness:'pi',provider:'openai',model:metadata.models[0],systemPrompt:'fixture prompt',expectedOwnerSubject:'local',expectedRevision:0}
   const saved=await request('/agent/settings','PUT',input);assert.equal(saved.status,200);assert.equal((await saved.json() as {revision:number}).revision,1)
   assert.equal((await request('/agent/settings','PUT',input)).status,409)
   assert.equal((await request('/agent/settings','PUT',{...input,expectedRevision:1,expectedOwnerSubject:'other'})).status,409)
  })
  await t.test('device pairing has one HTTP winner and no losing registrations; preferences use CAS',async()=>{
   const source=randomUUID(),created=await request('/pairing','POST',{deviceId:source,name:'Source',platform:'web'})
   assert.equal(created.status,200)
   const pair=await created.json() as {id:string;token:string},targets=Array.from({length:6},()=>randomUUID())
   const results=await Promise.all(targets.map(deviceId=>request('/pairing/redeem','POST',{deviceId,name:'Target',platform:'desktop',token:pair.token})))
   assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===410).length,5)
   const devices=await (await request('/device')).json() as Array<{id:string}>
   assert.equal(devices.filter(d=>targets.includes(d.id)).length,1)
   const claimed=await (await request('/pairing/'+pair.id)).json() as {claimedDeviceId:string}
   assert.ok(targets.includes(claimed.claimedDeviceId))
   assert.equal((await request('/device/'+claimed.claimedDeviceId,'DELETE')).status,200)
   const key='fixture-'+randomUUID()
   const writes=await Promise.all(Array.from({length:6},(_,i)=>request('/sync/preferences/'+key,'PUT',{value:{i},expectedVersion:0,deviceId:source})))
   assert.equal(writes.filter(r=>r.status===200).length,1);assert.equal(writes.filter(r=>r.status===409).length,5)
   for(const version of [1.5,-1,'1',null])assert.equal((await request('/sync/preferences/'+key,'PUT',{value:'bad',expectedVersion:version})).status,400)
   assert.equal((await request('/device/register','POST',null)).status,400)
  })
  await t.test('usage and credential-scope rejection use the same application boundary',async()=>{
   const {id}=await create(),response=await request('/session/'+id+'/usage?days=7')
   assert.equal(response.status,200);assert.equal((await response.json() as {ownerSubject:string}).ownerSubject,'local')
   assert.equal((await request('/session/'+id+'/usage?days=8')).status,400)
   assert.equal((await app.request('/session',{headers:{authorization:'Bearer rue_terminal_fixture'}})).status,401)
  })
  assert.equal(sqliteAccess,0)
 }finally{await pool?.close();if(created)await admin.sql`DROP DATABASE ${admin.sql(name)}`;await admin.close()}
})
