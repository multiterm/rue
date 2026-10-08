import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {createHash,randomUUID} from 'node:crypto'
import {Hono} from 'hono'
import type {Database} from 'better-sqlite3'
import {MIGRATIONS} from '../src/storage/schema.ts'
import {attachComputer,enqueueTerminalPrompt,pollComputer,transitionCommand,publishCommand,computerQueue,remoteComputers,recoverableQueuedMessages,recoverableQueuedCount,restoreExpiredQueuedPrompt,configureComputer} from '../src/storage/terminal-relay.ts'
import {listMessages,listParts} from '../src/storage/messages.ts'
import {recordTaskNotification} from '../src/storage/notifications.ts'
import {terminalAccountRoutes} from '../src/server/routes/terminal-pairing.ts'
import {createWorker,connectWorker,heartbeatWorker,changeWorker} from '../src/storage/workers.ts'
import {createManagedAgent,changeManagedAgent,managedGrant} from '../src/storage/managed-agents.ts'
function database(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const migration of MIGRATIONS)sqlite.exec(migration.sql)
 let depth=0
 const db={name:':memory:',prepare:(sql:string)=>sqlite.prepare(sql),transaction:(fn:()=>unknown)=>{const run=()=>{const name='t'+depth++,nested=depth>1;sqlite.exec(nested?`SAVEPOINT ${name}`:'BEGIN IMMEDIATE');try{const value=fn();sqlite.exec(nested?`RELEASE ${name}`:'COMMIT');return value}catch(error){sqlite.exec(nested?`ROLLBACK TO ${name}`:'ROLLBACK');throw error}finally{depth--}};return Object.assign(run,{immediate:run})}} as unknown as Database
 return {db,sqlite}
}
function fixture(protocol=2){
 const {db,sqlite}=database(),now=Date.now(),id='term_'+'a'.repeat(32),sessionId='ses_queue',token='rue_terminal_'+'b'.repeat(43),instance=randomUUID()
 db.prepare('INSERT INTO sessions(id,owner_subject,created_at,updated_at) VALUES(?,?,?,?)').run(sessionId,'owner',now,now)
 db.prepare('INSERT INTO terminal_connections(id,owner_subject,session_id,pi_session_id,token_hash,expires_at,created_at,activated_at,remote_enabled) VALUES(?,?,?,?,?,?,?,?,1)').run(id,'owner',sessionId,'pi',createHash('sha256').update(token).digest('hex'),now+7*86400000,now,now)
 attachComputer(db,token,id,instance,now,protocol)
 const queue=(text='Hello',time=now,content?:any[])=>enqueueTerminalPrompt(db,'owner',sessionId,randomUUID(),text,time,content)
 const expire=(command:string)=>db.prepare("UPDATE terminal_commands SET status='expired' WHERE id=?").run(command)
 return {db,sqlite,now,id,sessionId,token,instance,protocol,queue,expire}
}
test('queue-position migration preserves existing chronological order and same-time insertion order',()=>{
 const sqlite=new DatabaseSync(':memory:');try{
  for(const migration of MIGRATIONS.filter(m=>m.id<29))sqlite.exec(migration.sql)
  sqlite.prepare('INSERT INTO sessions(id,created_at,updated_at) VALUES(?,?,?)').run('s',1,1)
  sqlite.prepare('INSERT INTO terminal_connections(id,owner_subject,session_id,pi_session_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?,?,?)').run('c','local','s','pi','hash',9999,1)
  for(const [id,time] of [['late',300],['first',100],['second',100]] as const)sqlite.prepare("INSERT INTO terminal_commands(id,connection_id,request_id,text,user_message_id,assistant_message_id,status,created_at,updated_at) VALUES(?,'c',?,'text','user','assistant','queued',?,?)").run(id,id,time,time)
  sqlite.exec(MIGRATIONS.find(m=>m.id===29)!.sql)
  assert.deepEqual(sqlite.prepare('SELECT id FROM terminal_commands ORDER BY queue_position').all().map(row=>row.id),['first','second','late'])
  assert.equal(sqlite.prepare("SELECT created_at FROM terminal_commands WHERE id='late'").get()!.created_at,300)
 }finally{sqlite.close()}
})
test('queued requests remain durable behind a twenty-minute run and execute in FIFO order',()=>{
 const f=fixture();try{
  const first=f.queue('Long task'),second=f.queue('Second'),third=f.queue('Third')
  transitionCommand(f.db,f.token,f.id,f.instance,first.id,'claim',f.now);transitionCommand(f.db,f.token,f.id,f.instance,first.id,'start',f.now)
  for(let elapsed=20000;elapsed<=1200000;elapsed+=20000)pollComputer(f.db,f.token,f.id,f.instance,f.now+elapsed,2)
  assert.deepEqual(computerQueue(f.db,'owner',f.id,f.now+1200000)?.map(row=>[row.id,row.status]),[[first.id,'running'],[second.id,'queued'],[third.id,'queued']])
  publishCommand(f.db,f.token,f.id,f.instance,first.id,1,'Done','completed',f.now+1200000)
  assert.throws(()=>transitionCommand(f.db,f.token,f.id,f.instance,third.id,'claim',f.now+1200000),/command_out_of_order/)
  assert.equal(transitionCommand(f.db,f.token,f.id,f.instance,second.id,'claim',f.now+1200000).status,'claimed')
  assert.equal(transitionCommand(f.db,f.token,f.id,f.instance,second.id,'start',f.now+1200000).status,'running')
 }finally{f.sqlite.close()}
})
test('legacy execution timeout starts at dispatch, not the original queue creation time',()=>{
 const f=fixture(1);try{
  const queued=f.queue()
  for(let elapsed=20000;elapsed<=1200000;elapsed+=20000)pollComputer(f.db,f.token,f.id,f.instance,f.now+elapsed,1)
  transitionCommand(f.db,f.token,f.id,f.instance,queued.id,'claim',f.now+1200000)
  assert.equal(transitionCommand(f.db,f.token,f.id,f.instance,queued.id,'start',f.now+1200000).status,'running')
  assert.equal(publishCommand(f.db,f.token,f.id,f.instance,queued.id,1,'Done','completed',f.now+1200001).status,'completed')
 }finally{f.sqlite.close()}
})
test('disconnects retain queued work, but expired execution and approval leases are never revived',()=>{
 const f=fixture();try{
  const running=f.queue('Run'),queued=f.queue('Wait')
  transitionCommand(f.db,f.token,f.id,f.instance,running.id,'claim',f.now);transitionCommand(f.db,f.token,f.id,f.instance,running.id,'start',f.now)
  assert.deepEqual(computerQueue(f.db,'owner',f.id,f.now+600001)?.map(row=>row.id),[queued.id])
  assert.equal((f.db.prepare('SELECT status FROM terminal_commands WHERE id=?').get(running.id) as any).status,'interrupted')
  const next=randomUUID();attachComputer(f.db,f.token,f.id,next,f.now+600001,2)
  assert.equal(transitionCommand(f.db,f.token,f.id,next,queued.id,'claim',f.now+600001).status,'claimed')
  for(let elapsed=20000;elapsed<=300000;elapsed+=20000)pollComputer(f.db,f.token,f.id,next,f.now+600001+elapsed,2)
  assert.equal((f.db.prepare('SELECT status FROM terminal_commands WHERE id=?').get(queued.id) as any).status,'expired')
  assert.deepEqual(recoverableQueuedMessages(f.db,'owner',f.id),[])
  assert.throws(()=>restoreExpiredQueuedPrompt(f.db,'owner',f.id,queued.id,f.sessionId,f.now+900001),/not_recoverable/)
  assert.throws(()=>transitionCommand(f.db,f.token,f.id,next,running.id,'start',f.now+900001),/command_unavailable/)
 }finally{f.sqlite.close()}
})
test('managed stop, credential expiry and resume preserve never-claimed prompts on the same connection',()=>{
 const f=database(),now=Date.now(),oldKey=process.env.RUE_SETTINGS_ENCRYPTION_KEY;process.env.RUE_SETTINGS_ENCRYPTION_KEY=Buffer.alloc(32,1).toString('base64')
 try{
  const worker=createWorker(f.db,'owner','Host',randomUUID(),now),instance=randomUUID(),health={version:'test',platform:'linux',architecture:'arm64',dockerAvailable:true,acceptingWork:true,freeMemoryBytes:1e9,cpus:2,capabilities:['managed-agents-v1']}
  let lease=connectWorker(f.db,worker.worker.id,worker.secret!,instance,now)
  heartbeatWorker(f.db,worker.worker.id,worker.secret!,instance,lease.generation,health,now)
  const agent=createManagedAgent(f.db,'owner',{workerId:worker.worker.id,requestId:randomUUID(),name:'Agent',acknowledgeExecution:true,config:{provider:'openai',model:'test',permission:'read-only',mounts:[],shareToolOutput:false,shareThinking:false}},now).agent
  let auth={id:worker.worker.id,secret:worker.secret!,instance,generation:lease.generation}
  const grant=managedGrant(f.db,auth,agent.id,agent.revision,now),pi=randomUUID();attachComputer(f.db,grant.token,grant.id,pi,now,2)
  const queued=enqueueTerminalPrompt(f.db,'owner',grant.sessionId,randomUUID(),'Retain across stop',now)
  const stopped=changeManagedAgent(f.db,'owner',agent.id,{action:'stop',requestId:randomUUID(),expectedRevision:agent.revision},now+1).agent
  const later=now+1800000
  assert.equal(computerQueue(f.db,'owner',grant.id,later)?.[0]?.id,queued.id)
  assert.throws(()=>transitionCommand(f.db,grant.token,grant.id,pi,queued.id,'claim',later))
  lease=connectWorker(f.db,worker.worker.id,worker.secret!,instance,later);auth={...auth,generation:lease.generation};heartbeatWorker(f.db,auth.id,auth.secret,auth.instance,auth.generation,health,later)
  const resumed=changeManagedAgent(f.db,'owner',agent.id,{action:'resume',requestId:randomUUID(),expectedRevision:stopped.revision},later).agent
  const fresh=managedGrant(f.db,auth,agent.id,resumed.revision,later),next=randomUUID();attachComputer(f.db,fresh.token,fresh.id,next,later,2)
  assert.equal(fresh.id,grant.id);assert.equal(pollComputer(f.db,fresh.token,fresh.id,next,later,2).commands[0]?.id,queued.id)
  assert.equal(transitionCommand(f.db,fresh.token,fresh.id,next,queued.id,'claim',later).status,'claimed')
  const pending=enqueueTerminalPrompt(f.db,'owner',fresh.sessionId,randomUUID(),'Cancel on explicit host revoke',later+1)
  changeWorker(f.db,'owner',worker.worker.id,'revoke',worker.worker.revision,later+2)
  assert.deepEqual(computerQueue(f.db,'owner',fresh.id,later+3),[])
  assert.equal((f.db.prepare('SELECT status FROM terminal_commands WHERE id=?').get(pending.id) as any).status,'cancelled')
 }finally{f.sqlite.close();if(oldKey===undefined)delete process.env.RUE_SETTINGS_ENCRYPTION_KEY;else process.env.RUE_SETTINGS_ENCRYPTION_KEY=oldKey}
})
test('explicit recovery preserves IDs and attachments, appends at the tail, and cannot dispatch twice',()=>{
 const f=fixture();try{
  const content=[{type:'text' as const,text:'Saved request'},{type:'file' as const,name:'note.txt',mimeType:'text/plain',data:Buffer.from('retained file').toString('base64'),size:13}]
  const old=f.queue('Saved request[Attachment: note.txt]',f.now,content);f.expire(old.id)
  recordTaskNotification(f.db,f.sessionId,`terminal:${old.id}`,'task_failed',f.now)
  const newer=f.queue('Existing queue',f.now+1),originalParts=listParts(f.db,old.user_message_id)
  assert.equal(recoverableQueuedCount(f.db,'owner',f.id),1);assert.equal(recoverableQueuedCount(f.db,'other',f.id),undefined)
  assert.equal(remoteComputers(f.db,'owner',f.now+1)[0]!.runs.find(row=>row.id===old.id)?.expiredBeforeDispatch,true)
  assert.equal(restoreExpiredQueuedPrompt(f.db,'other',f.id,old.id,f.sessionId,f.now+2),undefined)
  assert.throws(()=>restoreExpiredQueuedPrompt(f.db,'owner',f.id,old.id,'another-session',f.now+2),/queue_session_changed/)
  assert.equal(restoreExpiredQueuedPrompt(f.db,'owner',f.id,old.id,f.sessionId,f.now+2)?.status,'queued')
  const position=(f.db.prepare('SELECT queue_position FROM terminal_commands WHERE id=?').get(old.id) as any).queue_position
  restoreExpiredQueuedPrompt(f.db,'owner',f.id,old.id,f.sessionId,f.now+3)
  assert.equal((f.db.prepare('SELECT queue_position FROM terminal_commands WHERE id=?').get(old.id) as any).queue_position,position)
  assert.deepEqual(computerQueue(f.db,'owner',f.id,f.now+3)?.map(row=>row.id),[newer.id,old.id])
  assert.deepEqual(listParts(f.db,old.user_message_id),originalParts);assert.equal(listMessages(f.db,f.sessionId).length,4)
  assert.equal((f.db.prepare('SELECT created_at FROM terminal_commands WHERE id=?').get(old.id) as any).created_at,f.now)
  assert.equal((f.db.prepare('SELECT count(*) n FROM notifications WHERE event_key=?').get(`terminal:${old.id}`) as any).n,0)
  transitionCommand(f.db,f.token,f.id,f.instance,newer.id,'claim',f.now+3);transitionCommand(f.db,f.token,f.id,f.instance,newer.id,'start',f.now+3);publishCommand(f.db,f.token,f.id,f.instance,newer.id,1,'Done','completed',f.now+3)
  transitionCommand(f.db,f.token,f.id,f.instance,old.id,'claim',f.now+4);transitionCommand(f.db,f.token,f.id,f.instance,old.id,'start',f.now+4)
  assert.equal(restoreExpiredQueuedPrompt(f.db,'owner',f.id,old.id,f.sessionId,f.now+5)?.status,'running')
 }finally{f.sqlite.close()}
})
test('recovery never resurrects erased history, cancelled work or a full queue',()=>{
 const f=fixture();try{
  const erased=f.queue('Erased');f.expire(erased.id);f.db.prepare('DELETE FROM messages WHERE id=?').run(erased.user_message_id)
  assert.equal(recoverableQueuedCount(f.db,'owner',f.id),0)
  assert.throws(()=>restoreExpiredQueuedPrompt(f.db,'owner',f.id,erased.id,f.sessionId,f.now),/not_recoverable/)
  const cancelled=f.queue('Cancel');configureComputer(f.db,'owner',f.id,'Test',false,0)
  assert.equal((f.db.prepare('SELECT status FROM terminal_commands WHERE id=?').get(cancelled.id) as any).status,'cancelled')
  assert.throws(()=>restoreExpiredQueuedPrompt(f.db,'owner',f.id,cancelled.id,f.sessionId,f.now),/not_recoverable/)
  configureComputer(f.db,'owner',f.id,'Test',true,1)
  const expired=f.queue('Recover later');f.expire(expired.id)
  for(let i=0;i<10;i++)f.queue('Queued '+i)
  assert.throws(()=>restoreExpiredQueuedPrompt(f.db,'owner',f.id,expired.id,f.sessionId,f.now),/computer_queue_full/)
  assert.equal((f.db.prepare('SELECT status FROM terminal_commands WHERE id=?').get(expired.id) as any).status,'expired')
 }finally{f.sqlite.close()}
})
test('queue API exposes recovery count without attachment bytes and requires owner confirmation',async()=>{
 const f=fixture();try{
  const old=f.queue('Recover');f.expire(old.id)
  const app=new Hono();app.use('*',async(c,next)=>{c.set('ctx',{db:f.db,bus:{publish:()=>{}}} as any);c.set('principal',{subject:c.req.header('x-owner')??'owner',principalType:c.req.header('x-type')??'user',scopes:[]} as any);return next()});app.route('/terminal',terminalAccountRoutes())
  const queue=await app.request(`/terminal/computers/${f.id}/queue`);assert.equal(queue.status,200);assert.deepEqual(await queue.json(),{messages:[],recoverableCount:1})
  const url=`/terminal/computers/${f.id}/queue/${old.id}/requeue`,post=(body:unknown,headers={})=>app.request(url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)})
  assert.equal((await post({expectedSessionId:f.sessionId,acknowledgeRequeue:false})).status,400)
  assert.equal((await post({expectedSessionId:f.sessionId,acknowledgeRequeue:true},{'x-owner':'other'})).status,404)
  assert.equal((await post({expectedSessionId:f.sessionId,acknowledgeRequeue:true},{'x-type':'machine'})).status,403)
  assert.equal((await post({expectedSessionId:f.sessionId,acknowledgeRequeue:true})).status,200)
 }finally{f.sqlite.close()}
})
