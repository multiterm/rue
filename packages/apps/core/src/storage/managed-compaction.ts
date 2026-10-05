import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto'
import type {Database} from 'better-sqlite3'
import {z} from 'zod'
import {managedAuthority,managedBusy,type WorkerAuthority} from './managed-agents.js'
import {validateWorker,WorkerError} from './workers.js'
import {validateRelaySocket} from './terminal-relay.js'
import {compactionHoldsRuntime} from './managed-maintenance-state.js'
export const COMPACT_CAPABILITY='managed-compact-v1'
export const COMPACT_QUEUE_MS=300000,COMPACT_RUN_MS=120000
export const compactRequestSchema=z.object({requestId:z.string().uuid(),expectedRevision:z.number().int().positive(),acknowledgeModelUse:z.literal(true)}).strict()
type Status='queued'|'assigned'|'running'|'succeeded'|'failed'|'cancelled'|'uncertain'
interface Command {id:string;owner_subject:string;request_id:string;agent_id:string;revision:number;generation:number;boot:number;status:Status;created_at:number;expires_at:number;started_at:number|null;completed_at:number|null;runtime_instance:string|null;nonce_hash:string|null}
interface Target {id:string;owner_subject:string;worker_id:string;connection_id:string|null;revision:number;desired:string;grant_revision:number|null;grant_generation:number|null;grant_boot:number|null;observed:string;observed_revision:number|null;observed_generation:number|null}
export interface CompactRuntimeAuthority {id:string;token:string;instance:string}
const digest=(value:string)=>createHash('sha256').update(value).digest()
const publicCommand=(c:Command)=>({id:c.id,agentId:c.agent_id,kind:'compact' as const,revision:c.revision,status:c.status,createdAt:c.created_at,expiresAt:c.expires_at,startedAt:c.started_at,completedAt:c.completed_at})
const target=(db:Database,id:string)=>db.prepare('SELECT * FROM managed_agents WHERE id=?').get(id) as Target|undefined
const command=(db:Database,id:string)=>db.prepare('SELECT * FROM managed_compactions WHERE id=?').get(id) as Command|undefined
function owned(db:Database,owner:string,id:string){const a=target(db,id);if(!a||a.owner_subject!==owner)throw new WorkerError(404,'managed_agent_not_found');return a}
function connected(db:Database,a:Target,now:number){
 if(!a.connection_id)return false
 return Boolean(db.prepare(`SELECT 1 FROM terminal_connections WHERE id=? AND revoked_at IS NULL AND remote_enabled=1
  AND activated_at IS NOT NULL AND instance_id IS NOT NULL AND relay_protocol=2 AND lease_expires_at>? AND expires_at>? AND last_seen_at<=?`).get(a.connection_id,now,now,now))
}
function epoch(db:Database,c:Command,a:Target,now:number){
 if(a.desired!=='running'||!a.connection_id||a.grant_revision!==c.revision||a.grant_generation!==c.generation||a.grant_boot!==c.boot)return false
 try{managedAuthority(db,a.connection_id,now)}catch{return false}
 if(!connected(db,a,now))return false
 if(c.runtime_instance&&!db.prepare('SELECT 1 FROM terminal_connections WHERE id=? AND instance_id=?').get(a.connection_id,c.runtime_instance))return false
 return true
}
function reconcile(db:Database,a:Target,now:number){
 const rows=db.prepare("SELECT * FROM managed_compactions WHERE agent_id=? AND status IN ('queued','assigned','running')").all(a.id) as Command[]
 for(const c of rows)if(now<c.created_at||now>=c.expires_at||!epoch(db,c,a,now)||(c.status!=='running'&&a.revision!==c.revision)){
  db.prepare('UPDATE managed_compactions SET status=?,completed_at=? WHERE id=?').run(c.status==='running'?'uncertain':'cancelled',now,c.id)
 }
}
function capable(health:string|null){if(!health||!JSON.parse(health).capabilities?.includes(COMPACT_CAPABILITY))throw new WorkerError(409,'managed_compact_not_supported')}
/** Storage protocol only. No prompt, summary, token or transcript is stored here. */
export function requestManagedCompaction(db:Database,owner:string,id:string,raw:unknown,now=Date.now()){
 const input=compactRequestSchema.parse(raw)
 return db.transaction(()=>{
  const a=owned(db,owner,id);reconcile(db,a,now)
  const prior=db.prepare('SELECT * FROM managed_compactions WHERE owner_subject=? AND request_id=?').get(owner,input.requestId) as Command|undefined
  if(prior){if(prior.agent_id!==id||prior.revision!==input.expectedRevision)throw new WorkerError(409,'managed_request_conflict');return publicCommand(prior)}
  const w=db.prepare('SELECT health,desired FROM workers WHERE id=? AND owner_subject=? AND revoked_at IS NULL').get(a.worker_id,owner) as {health:string|null;desired:string}|undefined
  if(!w)throw new WorkerError(409,'managed_compact_not_ready');capable(w.health)
  if(a.revision!==input.expectedRevision)throw new WorkerError(409,'managed_revision_conflict')
  if(w.desired!=='active'||a.desired!=='running'||a.grant_revision!==a.revision||!a.grant_generation||!a.grant_boot||!a.connection_id||!connected(db,a,now)||a.observed!=='running'||a.observed_revision!==a.revision||a.observed_generation!==a.grant_generation)throw new WorkerError(409,'managed_compact_not_ready')
  managedAuthority(db,a.connection_id,now)
  if(compactionHoldsRuntime(db,a.connection_id))throw new WorkerError(409,'managed_compact_pending_or_uncertain')
  if(managedBusy(db,a.connection_id,now)||db.prepare("SELECT 1 FROM terminal_commands WHERE connection_id=? AND status IN ('queued','claimed','running') LIMIT 1").get(a.connection_id))throw new WorkerError(409,'managed_compact_agent_busy')
  const count=db.prepare('SELECT COUNT(*) AS total,SUM(CASE WHEN created_at>? THEN 1 ELSE 0 END) AS recent FROM managed_compactions WHERE agent_id=?').get(now-86400000,id) as {total:number;recent:number|null}
  if(count.total>=1000||(count.recent??0)>=24)throw new WorkerError(429,'managed_compact_limit')
  const cid=randomUUID()
  db.prepare(`INSERT INTO managed_compactions(id,owner_subject,request_id,agent_id,revision,generation,boot,status,created_at,expires_at)
   VALUES(?,?,?,?,?,?,?,'queued',?,?)`).run(cid,owner,input.requestId,id,a.revision,a.grant_generation,a.grant_boot,now,now+COMPACT_QUEUE_MS)
  return publicCommand(command(db,cid)!)
 }).immediate()
}
export function managedCompactions(db:Database,owner:string,id:string,now=Date.now()){
 return db.transaction(()=>{const a=owned(db,owner,id);reconcile(db,a,now);return (db.prepare('SELECT * FROM managed_compactions WHERE agent_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100').all(id) as Command[]).map(publicCommand)}).immediate()
}
/** Manager must first verify the selected container's ownership and immutable image capability. */
export function assignManagedCompaction(db:Database,auth:WorkerAuthority,id:string,now=Date.now()){
 return db.transaction(()=>{
  const w=validateWorker(db,auth.id,auth.secret,auth.instance,auth.generation,now),c=command(db,id)
  if(!c)throw new WorkerError(404,'managed_compact_not_found')
  const a=owned(db,w.owner_subject,c.agent_id)
  if(a.worker_id!==w.id)throw new WorkerError(404,'managed_compact_not_found')
  reconcile(db,a,now);const current=command(db,id)!
  if(current.status!=='queued')return publicCommand(current)
  capable(w.health)
  if(w.desired!=='active'||!epoch(db,current,a,now))throw new WorkerError(409,'managed_compact_not_ready')
  if(managedBusy(db,a.connection_id,now))throw new WorkerError(409,'managed_compact_agent_busy')
  db.prepare("UPDATE managed_compactions SET status='assigned' WHERE id=? AND status='queued'").run(id)
  return publicCommand(command(db,id)!)
 }).immediate()
}
function runtime(db:Database,auth:CompactRuntimeAuthority,id:string,now:number){
 const connection=validateRelaySocket(db,auth.token,auth.id,auth.instance,now),c=command(db,id)
 if(!c)throw new WorkerError(404,'managed_compact_not_found')
 const a=owned(db,connection.ownerSubject,c.agent_id)
 if(a.connection_id!==auth.id)throw new WorkerError(404,'managed_compact_not_found')
 reconcile(db,a,now);return {a,c:command(db,id)!}
}
/** Only the first committed claim returns execute:true. A lost reply is uncertain, never replayed. */
export function claimManagedCompaction(db:Database,auth:CompactRuntimeAuthority,id:string,now=Date.now()){
 return db.transaction(()=>{
  const {a,c}=runtime(db,auth,id,now)
  if(c.status!=='assigned')return {execute:false as const,command:publicCommand(c)}
  const w=db.prepare('SELECT desired FROM workers WHERE id=?').get(a.worker_id) as {desired:string}
  if(w.desired!=='active'||!epoch(db,c,a,now))throw new WorkerError(409,'managed_compact_not_ready')
  // The runner reserves locally before this request; its health may already say
  // working because of that reservation. Existing prompt claims still fence it.
  if(db.prepare("SELECT 1 FROM terminal_commands WHERE connection_id=? AND status IN ('claimed','running') LIMIT 1").get(a.connection_id))throw new WorkerError(409,'managed_compact_agent_busy')
  const nonce=randomBytes(32).toString('base64url'),deadline=now+COMPACT_RUN_MS
  db.prepare("UPDATE managed_compactions SET status='running',runtime_instance=?,nonce_hash=?,started_at=?,expires_at=? WHERE id=? AND status='assigned'").run(auth.instance,digest(nonce).toString('hex'),now,deadline,id)
  return {execute:true as const,command:publicCommand(command(db,id)!),nonce,serverNow:now,deadline}
 }).immediate()
}
export function workerCompactions(db:Database,auth:WorkerAuthority,now=Date.now()){
 const w=validateWorker(db,auth.id,auth.secret,auth.instance,auth.generation,now)
 const agents=db.prepare('SELECT * FROM managed_agents WHERE worker_id=? AND owner_subject=? AND purged_at IS NULL').all(w.id,w.owner_subject) as Target[]
 return db.transaction(()=>agents.flatMap(a=>{reconcile(db,a,now);return (db.prepare("SELECT * FROM managed_compactions WHERE agent_id=? AND status='queued'").all(a.id) as Command[]).map(c=>({...publicCommand(c),generation:c.generation,boot:c.boot}))})).immediate()
}
export function runtimeCompactions(db:Database,auth:CompactRuntimeAuthority,now=Date.now()){
 const connection=validateRelaySocket(db,auth.token,auth.id,auth.instance,now)
 const a=db.prepare('SELECT * FROM managed_agents WHERE connection_id=? AND owner_subject=?').get(auth.id,connection.ownerSubject) as Target|undefined
 if(!a)throw new WorkerError(404,'managed_agent_not_found')
 return db.transaction(()=>{reconcile(db,a,now);return (db.prepare("SELECT * FROM managed_compactions WHERE agent_id=? AND status='assigned'").all(a.id) as Command[]).map(publicCommand)}).immediate()
}
export function acknowledgeManagedCompaction(db:Database,auth:CompactRuntimeAuthority,id:string,nonce:string,outcome:'succeeded'|'failed',now=Date.now()){
 if(!/^[A-Za-z0-9_-]{43}$/.test(nonce)||!['succeeded','failed'].includes(outcome))throw new WorkerError(409,'managed_compact_ack_invalid')
 return db.transaction(()=>{
  const {a,c}=runtime(db,auth,id,now)
  if(!epoch(db,c,a,now)||c.runtime_instance!==auth.instance||!c.nonce_hash||!/^[a-f0-9]{64}$/.test(c.nonce_hash)||!timingSafeEqual(digest(nonce),Buffer.from(c.nonce_hash,'hex')))throw new WorkerError(409,'managed_compact_ack_fenced')
  if(c.status===outcome)return publicCommand(c)
  if(c.status!=='running')throw new WorkerError(409,'managed_compact_ack_fenced')
  db.prepare('UPDATE managed_compactions SET status=?,completed_at=? WHERE id=?').run(outcome,now,id)
  return publicCommand(command(db,id)!)
 }).immediate()
}
