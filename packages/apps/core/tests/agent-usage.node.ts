import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {randomUUID,createHash} from 'node:crypto'
import {attachComputer} from '../src/storage/terminal-relay.ts'
import {terminalClientRoutes} from '../src/server/routes/terminal-pairing.ts'
import type {Database} from 'better-sqlite3'
import {MIGRATIONS} from '../src/storage/schema.ts'
import {agentUsage,recordAgentUsage,usageCredential} from '../src/storage/agent-usage.ts'
import {sessionRoutes} from '../src/server/routes/sessions.ts'
import {Hono} from 'hono'
function fixture(){const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const migration of MIGRATIONS)sqlite.exec(migration.sql);const db={name:':memory:',prepare:(sql:string)=>sqlite.prepare(sql),transaction:(fn:()=>unknown)=>Object.assign(fn,{immediate:fn})} as unknown as Database;for(const [id,owner] of [['agent-a','alice'],['agent-b','bob']])db.prepare('INSERT INTO sessions(id,owner_subject,created_at,updated_at) VALUES(?,?,1,1)').run(id,owner);return {db,sqlite}}
const sample=()=>({eventId:randomUUID(),provider:'openai',model:'model',credentialId:null,time:Date.now(),input:100,output:20,cacheRead:5,cacheWrite:0,costUsd:0.03})
test('ledger deduplicates retries, separates agents/providers and preserves unpriced usage',()=>{
 const f=fixture();try{
 const event=sample();assert.equal(recordAgentUsage(f.db,'alice','agent-a','connection-a',event),true);assert.equal(recordAgentUsage(f.db,'alice','agent-a','connection-a',event),false)
 recordAgentUsage(f.db,'bob','agent-b','connection-b',sample())
 recordAgentUsage(f.db,'alice','agent-a','connection-a',{...sample(),provider:'openai-codex',costUsd:null})
 const data=agentUsage(f.db,'alice','agent-a',7) as any
 assert.equal(data.rows.length,2);assert.equal(data.rows.find((r:any)=>r.provider==='openai').requests,1)
 assert.equal(data.rows.find((r:any)=>r.provider==='openai-codex').costUsd,null)
 assert.equal(data.rows.find((r:any)=>r.provider==='openai-codex').unpricedRequests,1)
 assert.deepEqual(agentUsage(f.db,'bob','agent-a',7).rows,[])
 }finally{f.sqlite.close()}
})
test('opaque credential references are key-stable, rotate with key changes, and are owner/provider bound',()=>{
 const previous=process.env.RUE_SETTINGS_ENCRYPTION_KEY;process.env.RUE_SETTINGS_ENCRYPTION_KEY=Buffer.alloc(32,5).toString('base64')
 const f=fixture();try{
 const first=usageCredential(f.db,'alice','openai','synthetic-private-key')
 assert.equal(first,usageCredential(f.db,'alice','openai','synthetic-private-key'))
 assert.notEqual(first,usageCredential(f.db,'alice','openai','rotated-private-key'))
 assert.notEqual(first,usageCredential(f.db,'bob','openai','synthetic-private-key'))
 assert.throws(()=>recordAgentUsage(f.db,'bob','agent-b','b',{...sample(),credentialId:first}))
 assert.throws(()=>recordAgentUsage(f.db,'alice','agent-a','a',{...sample(),provider:'anthropic',credentialId:first}))
 recordAgentUsage(f.db,'alice','agent-a','a',{...sample(),credentialId:first})
 const report=JSON.stringify(agentUsage(f.db,'alice','agent-a',30));assert.ok(!report.includes('synthetic-private-key'));assert.ok(report.includes(first))
 }finally{f.sqlite.close();if(previous===undefined)delete process.env.RUE_SETTINGS_ENCRYPTION_KEY;else process.env.RUE_SETTINGS_ENCRYPTION_KEY=previous}
})
test('rejects malformed/negative telemetry and future dates; daily grouping uses UTC',()=>{
 const f=fixture();try{
 assert.throws(()=>recordAgentUsage(f.db,'alice','agent-a','a',{...sample(),input:-1}))
 assert.throws(()=>recordAgentUsage(f.db,'alice','agent-a','a',{...sample(),costUsd:Infinity}))
 assert.throws(()=>recordAgentUsage(f.db,'alice','agent-a','a',{...sample(),time:Date.now()+3600000}))
 const now=Date.UTC(2026,8,30,12),time=Date.UTC(2026,8,29,23,59)
 recordAgentUsage(f.db,'alice','agent-a','a',{...sample(),time},now)
 assert.equal((agentUsage(f.db,'alice','agent-a',7,now).rows[0] as any).time,Date.UTC(2026,8,29))
 }finally{f.sqlite.close()}
})
test('terminal telemetry requires the current credential and lease instance and deduplicates HTTP retries',async()=>{
 const f=fixture();try{
 const id='term_'+'a'.repeat(32),token='rue_terminal_'+'b'.repeat(43),instance=randomUUID(),now=Date.now()
 f.db.prepare('INSERT INTO terminal_connections(id,owner_subject,session_id,pi_session_id,token_hash,expires_at,created_at,activated_at,remote_enabled) VALUES(?,?,?,?,?,?,?,?,1)').run(id,'alice','agent-a','pi',createHash('sha256').update(token).digest('hex'),now+86400000,now,now)
 attachComputer(f.db,token,id,instance,now,2)
 const app=new Hono();app.use('*',async(c,next)=>{c.set('ctx' as never,{db:f.db} as never);await next()});app.route('/terminal-client',terminalClientRoutes())
 const event=sample(),send=(identity=instance,bearer=token)=>app.request(`/terminal-client/connections/${id}/relay/usage`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${bearer}`},body:JSON.stringify({instance:identity,event})})
 assert.equal((await send(randomUUID())).status,409)
 assert.equal((await send(instance,'bad-token')).status,401)
 assert.equal((await send()).status,200);assert.equal((await (await send()).json()).recorded,false)
 assert.equal((agentUsage(f.db,'alice','agent-a',7).rows[0] as any).requests,1)
 f.db.prepare('UPDATE terminal_connections SET revoked_at=? WHERE id=?').run(now,id)
 assert.equal((await send()).status,401)
 }finally{f.sqlite.close()}
})
test('HTTP usage page rejects other owners and invalid/unbounded ranges',async()=>{
 const f=fixture();try{
 const app=new Hono();app.use('*',async(c,next)=>{c.set('ctx' as never,{db:f.db} as never);c.set('principal' as never,{subject:'alice',principalType:'user'} as never);await next()});app.route('/',sessionRoutes())
 assert.equal((await app.request('/session/agent-b/usage')).status,404)
 assert.equal((await app.request('/session/agent-a/usage?days=999999')).status,400)
 const response=await app.request('/session/agent-a/usage?days=30');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal((await response.json()).ownerSubject,'alice')
 }finally{f.sqlite.close()}
})
