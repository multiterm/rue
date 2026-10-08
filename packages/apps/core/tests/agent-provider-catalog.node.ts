import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {randomBytes} from 'node:crypto'
import {MIGRATIONS} from '../src/storage/schema.js'
import {saveProviderKey,grantProviderKey,delegatedProviderKey,delegatedProviderKeyAvailable,providerSchema} from '../src/storage/provider-keys.js'
import {reportedProviders} from '../src/storage/reported-providers.js'
import {runtimeInfo} from '../../../../extensions/rue/runtime-info.ts'
import {agentStatus} from '../../../../extensions/rue/status.ts'
import type {Database} from 'better-sqlite3'
test('new provider IDs retain encryption, explicit grants, owner scope and revocation',()=>{
 const sqlite=new DatabaseSync(':memory:');for(const m of MIGRATIONS)sqlite.exec(m.sql)
 let depth=0
 const db={name:':memory:',prepare:(sql:string)=>sqlite.prepare(sql),transaction:(fn:()=>unknown)=>{const run=()=>{const name='s'+depth++,nested=depth>1;sqlite.exec(nested?`SAVEPOINT ${name}`:'BEGIN IMMEDIATE');try{const value=fn();sqlite.exec(nested?`RELEASE ${name}`:'COMMIT');return value}catch(error){sqlite.exec(nested?`ROLLBACK TO ${name}`:'ROLLBACK');throw error}finally{depth--}};return Object.assign(run,{immediate:run})}} as unknown as Database
 const old=process.env.RUE_SETTINGS_ENCRYPTION_KEY;process.env.RUE_SETTINGS_ENCRYPTION_KEY=randomBytes(32).toString('base64')
 try{
  const now=Date.now(),status=agentStatus({cwd:'/workspace',branch:null,idle:true,thinking:'off',entries:[],runtime:runtimeInfo('0.86.0',[{provider:'future-provider',id:'new-model',contextWindow:100000}],[{id:'future-provider',name:'Future',auth:{apiKey:{}}}])})
  db.prepare('INSERT INTO sessions(id,owner_subject,created_at,updated_at) VALUES(?,?,?,?)').run('session','owner',now,now)
  db.prepare('INSERT INTO terminal_connections(id,owner_subject,session_id,pi_session_id,token_hash,expires_at,created_at,activated_at,last_seen_at,relay_health) VALUES(?,?,?,?,?,?,?,?,?,?)').run('connection','owner','session','pi','hash',now+60000,now,now,now,JSON.stringify({status}))
  assert.equal(reportedProviders(db,'owner')[0]?.id,'future-provider');assert.deepEqual(reportedProviders(db,'other'),[])
  const saved=saveProviderKey(db,'owner','future-provider',0,'fixture-key')
  assert.equal(saved.keys.find(k=>k.provider==='future-provider')?.configured,true)
  assert.equal(JSON.stringify(saved).includes('fixture-key'),false)
  const target={type:'terminal' as const,id:'connection'}
  assert.equal(delegatedProviderKeyAvailable(db,'owner','future-provider',target),false)
  assert.throws(()=>delegatedProviderKey(db,'owner','future-provider',target),/not_granted/)
  assert.throws(()=>grantProviderKey(db,'other','future-provider',0,target,true),/unavailable/)
  grantProviderKey(db,'owner','future-provider',1,target,true)
  assert.equal(delegatedProviderKey(db,'owner','future-provider',target).apiKey,'fixture-key')
  grantProviderKey(db,'owner','future-provider',2,target,false)
  assert.throws(()=>delegatedProviderKey(db,'owner','future-provider',target),/not_granted/)
  assert.equal(providerSchema.safeParse('openai-codex').success,false)
  assert.equal(providerSchema.safeParse('../future-provider').success,false)
 }finally{if(old===undefined)delete process.env.RUE_SETTINGS_ENCRYPTION_KEY;else process.env.RUE_SETTINGS_ENCRYPTION_KEY=old;sqlite.close()}
})
