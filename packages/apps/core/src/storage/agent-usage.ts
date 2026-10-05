import type {Database} from 'better-sqlite3'
import {createHmac} from 'node:crypto'
import {z} from 'zod'
import {encryptionKey} from './agent-settings.js'
const count=z.number().int().nonnegative().max(1e12)
export const usageEventSchema=z.object({eventId:z.string().uuid(),provider:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/),model:z.string().min(1).max(256),credentialId:z.string().regex(/^key_[a-f0-9]{64}$/).nullable(),time:z.number().int().nonnegative(),input:count,output:count,cacheRead:count,cacheWrite:count,costUsd:z.number().finite().nonnegative().max(1e6).nullable()}).strict()
export type UsageEvent=z.infer<typeof usageEventSchema>
export function usageCredential(db:Database,owner:string,provider:string,apiKey:string){
 const secret=encryptionKey(db)
 if(!secret)throw Error('Credential storage unavailable')
 const id='key_'+createHmac('sha256',secret).update(JSON.stringify([owner,provider,apiKey])).digest('hex')
 db.prepare('INSERT OR IGNORE INTO usage_credentials(id,owner_subject,provider,created_at) VALUES(?,?,?,?)').run(id,owner,provider,Date.now())
 return id
}
export function recordAgentUsage(db:Database,owner:string,session:string,connection:string,input:UsageEvent,now=Date.now()){
 const event=usageEventSchema.parse(input)
 if(!db.prepare('SELECT 1 FROM sessions WHERE id=? AND owner_subject=?').get(session,owner))throw Error('Invalid usage owner')
 if(event.time>now+300000)throw Error('Invalid usage time')
 if(event.credentialId&&!db.prepare('SELECT 1 FROM usage_credentials WHERE id=? AND owner_subject=? AND provider=?').get(event.credentialId,owner,event.provider))throw Error('Invalid usage credential')
 return db.prepare(`INSERT OR IGNORE INTO agent_usage_events(owner_subject,session_id,connection_id,event_id,provider,model,credential_id,time,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,cost_usd) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(owner,session,connection,event.eventId,event.provider,event.model,event.credentialId,event.time,event.input,event.output,event.cacheRead,event.cacheWrite,event.costUsd).changes===1
}
export function agentUsage(db:Database,owner:string,session:string,days:number,now=Date.now()){
 const from=Math.floor(now/86400000)*86400000-(days-1)*86400000,to=now
 const rows=db.prepare(`SELECT (time/86400000)*86400000 AS time,provider,credential_id AS credentialId,COUNT(*) AS requests,SUM(input_tokens) AS input,SUM(output_tokens) AS output,SUM(cache_read_tokens) AS cacheRead,SUM(cache_write_tokens) AS cacheWrite,SUM(cost_usd) AS costUsd,SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unpricedRequests FROM agent_usage_events WHERE owner_subject=? AND session_id=? AND time>=? AND time<=? GROUP BY 1,2,3 ORDER BY 1,2,3`).all(owner,session,from,to)
 return {ownerSubject:owner,sessionId:session,from,to,timezone:'UTC',basis:'runtime-estimate',rows}
}
