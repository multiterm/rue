import {randomUUID} from 'node:crypto'
import type {Database} from 'better-sqlite3'
import {z} from 'zod'
import type {RueRuntimeControlGrant} from '@multiterm/rue-sdk'
import type {TerminalConnection} from './terminal-pairing.js'
import {managedAuthority} from './managed-agents.js'
import {WorkerError} from './workers.js'
import {cancelRuntimeRollout,requestRuntimeRollout,runtimeRollout,rolloutRequestSchema} from './runtime-rollouts.js'
import {RuntimeControlError} from '@multiterm/rue-db'
export {RuntimeControlError}
const expected=z.object({expectedOwnerSubject:z.string().min(1).max(512),expectedRevision:z.number().int().nonnegative()})
export const runtimeControlGrantInput=z.discriminatedUnion('enabled',[
 expected.extend({enabled:z.literal(false)}).strict(),
 expected.extend({enabled:z.literal(true),expectedAgentRevision:z.number().int().positive(),expectedWorkerId:z.string().uuid(),expectedConnectionId:z.string().regex(/^term_[A-Za-z0-9_-]{32}$/),expiresInSeconds:z.union([z.literal(3600),z.literal(86400),z.literal(604800)]),acknowledgeHostControl:z.literal(true)}).strict(),
])
interface BoundAgent {id:string;revision:number;owner_subject:string;worker_id:string;connection_id:string|null;session_id:string|null;desired:string;purged_at:number|null;worker_owner:string;worker_name:string;worker_desired:string;worker_revoked:number|null;health:string|null;lease_expires_at:number|null;last_seen_at:number|null}
interface Grant {agent_id:string;owner_subject:string;worker_id:string;connection_id:string;revision:number;enabled:number;expires_at:number;updated_at:number}
function ownedAgent(db:Database,owner:string,id:string){
 const a=db.prepare(`SELECT a.*,w.owner_subject AS worker_owner,w.name AS worker_name,w.desired AS worker_desired,w.revoked_at AS worker_revoked,w.health,w.lease_expires_at,w.last_seen_at FROM managed_agents a JOIN workers w ON w.id=a.worker_id WHERE a.id=? AND a.owner_subject=?`).get(id,owner) as BoundAgent|undefined
 if(!a||a.worker_owner!==owner)throw new RuntimeControlError(404,'managed_agent_not_found')
 return a
}
const grant=(db:Database,id:string)=>db.prepare('SELECT * FROM runtime_control_grants WHERE agent_id=?').get(id) as Grant|undefined
function bindingValid(db:Database,a:BoundAgent){
 if(!a.connection_id||a.desired==='destroyed'||a.purged_at!==null||a.worker_revoked!==null)return false
 return Boolean(db.prepare('SELECT 1 FROM terminal_connections WHERE id=? AND owner_subject=? AND session_id=? AND revoked_at IS NULL').get(a.connection_id,a.owner_subject,a.session_id))
}
function active(db:Database,a:BoundAgent,g:Grant|undefined,now:number){return Boolean(g&&g.enabled===1&&g.updated_at<=now&&g.expires_at>now&&g.owner_subject===a.owner_subject&&g.worker_id===a.worker_id&&g.connection_id===a.connection_id&&bindingValid(db,a))}
function managerReady(a:BoundAgent,now:number){
 if(a.worker_revoked!==null||!a.lease_expires_at||a.lease_expires_at<=now||a.last_seen_at===null||a.last_seen_at>now)return false
 try{return Boolean(a.health&&JSON.parse(a.health).capabilities?.includes('managed-runtime-rollout-v1'))}catch{return false}
}
function audit(db:Database,a:BoundAgent,revision:number,action:string,now:number,rolloutId:string|null=null){db.prepare('INSERT INTO runtime_control_audit(id,owner_subject,agent_id,worker_id,grant_revision,action,rollout_id,created_at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),a.owner_subject,a.id,a.worker_id,revision,action,rolloutId,now)}
export function runtimeControlGrant(db:Database,owner:string,id:string,now=Date.now()):RueRuntimeControlGrant{
 const a=ownedAgent(db,owner,id),g=grant(db,id)
 return {ownerSubject:owner,agentId:id,agentRevision:a.revision,workerId:a.worker_id,workerName:a.worker_name,connectionId:a.connection_id,revision:g?.revision??0,enabled:active(db,a,g,now),expiresAt:g?.expires_at??null,updatedAt:g?.updated_at??null,serverNow:now,managerReady:managerReady(a,now),audit:db.prepare('SELECT action,created_at AS createdAt,rollout_id AS rolloutId FROM runtime_control_audit WHERE owner_subject=? AND agent_id=? ORDER BY created_at DESC,rowid DESC LIMIT 10').all(owner,id) as RueRuntimeControlGrant['audit']}
}
/** Account route enforces a human principal; an agent cannot invoke this through its relay. */
export function updateRuntimeControlGrant(db:Database,owner:string,id:string,raw:unknown,suppliedNow?:number){
 const input=runtimeControlGrantInput.parse(raw)
 return db.transaction(()=>{
  const now=suppliedNow??Date.now()
  const a=ownedAgent(db,owner,id),previous=grant(db,id)
  if(input.expectedOwnerSubject!==owner)throw new RuntimeControlError(409,'runtime_control_owner_changed')
  if(input.expectedRevision!==(previous?.revision??0))throw new RuntimeControlError(409,'runtime_control_revision_conflict')
  if(input.enabled){
   if(input.expectedAgentRevision!==a.revision||input.expectedWorkerId!==a.worker_id||input.expectedConnectionId!==a.connection_id)throw new RuntimeControlError(409,'runtime_control_agent_changed')
   if(!bindingValid(db,a))throw new RuntimeControlError(409,'runtime_control_agent_unavailable')
   if(!managerReady(a,now))throw new RuntimeControlError(409,'runtime_rollout_manager_upgrade_required')
  }
  if(!previous&&!input.enabled)return runtimeControlGrant(db,owner,id,now)
  const revision=(previous?.revision??0)+1,expiresAt=input.enabled?now+input.expiresInSeconds*1000:previous!.expires_at
  db.prepare(`INSERT INTO runtime_control_grants(agent_id,owner_subject,worker_id,connection_id,revision,enabled,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(agent_id) DO UPDATE SET owner_subject=excluded.owner_subject,worker_id=excluded.worker_id,connection_id=excluded.connection_id,revision=excluded.revision,enabled=excluded.enabled,expires_at=excluded.expires_at,updated_at=excluded.updated_at`).run(id,owner,input.enabled?a.worker_id:previous!.worker_id,input.enabled?a.connection_id:previous!.connection_id,revision,input.enabled?1:0,expiresAt,now)
  audit(db,input.enabled?a:{...a,worker_id:previous!.worker_id},revision,input.enabled?'approved':'revoked',now)
  if(!input.enabled){
   const pending=db.prepare("SELECT r.id FROM runtime_rollouts r JOIN runtime_control_requests d ON d.rollout_id=r.id WHERE d.agent_id=? AND r.owner_subject=? AND r.phase='preflight'").all(id,owner) as {id:string}[]
   for(const row of pending){cancelRuntimeRollout(db,owner,row.id,now);audit(db,a,revision,'pending_cancelled',now,row.id)}
  }
  return runtimeControlGrant(db,owner,id,now)
 }).immediate()
}
function delegated(db:Database,connection:TerminalConnection,now:number){
 const row=db.prepare('SELECT id FROM managed_agents WHERE connection_id=? AND owner_subject=?').get(connection.id,connection.ownerSubject) as {id:string}|undefined
 if(!row)throw new RuntimeControlError(403,'runtime_control_not_approved')
 const a=ownedAgent(db,connection.ownerSubject,row.id),g=grant(db,a.id)
 if(connection.piSessionId!==a.id||connection.sessionId!==a.session_id)throw new RuntimeControlError(403,'runtime_control_not_approved')
 managedAuthority(db,connection.id,now)
 if(!active(db,a,g,now))throw new RuntimeControlError(403,'runtime_control_not_approved')
 return {a,g:g!}
}
export function runtimeControlDelegation(db:Database,connection:TerminalConnection,now=Date.now()){
 try{
  const {a,g}=delegated(db,connection,now)
  const pending=Boolean(db.prepare("SELECT 1 FROM runtime_rollouts WHERE worker_id=? AND phase NOT IN ('succeeded','failed')").get(a.worker_id))
  const blockedBy=!managerReady(a,now)?'manager_unavailable':a.worker_desired!=='active'?'host_draining':pending?'rollout_in_progress':null
  return {approved:true,canSubmit:blockedBy===null,blockedBy,grantRevision:g.revision,grantExpiresAt:g.expires_at}
 }catch(error){if(!(error instanceof RuntimeControlError)&&!(error instanceof WorkerError))throw error;return {approved:false,canSubmit:false,blockedBy:'approval_required',grantRevision:null,grantExpiresAt:null}}
}
export function requestDelegatedRuntimeRollout(db:Database,identify:(now:number)=>TerminalConnection,raw:unknown,suppliedNow?:number){
 const input=rolloutRequestSchema.parse(raw)
 return db.transaction(()=>{
  const now=suppliedNow??Date.now()
  const {a,g}=delegated(db,identify(now),now)
  const existing=db.prepare('SELECT r.id,d.agent_id FROM runtime_rollouts r LEFT JOIN runtime_control_requests d ON d.rollout_id=r.id WHERE r.owner_subject=? AND r.request_id=?').get(a.owner_subject,input.requestId) as {id:string;agent_id:string|null}|undefined
  if(existing&&existing.agent_id!==a.id)throw new RuntimeControlError(409,'runtime_control_request_conflict')
  const job=requestRuntimeRollout(db,a.owner_subject,a.worker_id,input,now)
  const inserted=db.prepare('INSERT OR IGNORE INTO runtime_control_requests(rollout_id,agent_id,grant_revision,created_at) VALUES(?,?,?,?)').run(job.id,a.id,g.revision,now)
  if(inserted.changes)audit(db,a,g.revision,'rollout_requested',now,job.id)
  return job
 }).immediate()
}
export function delegatedRuntimeRollout(db:Database,connection:TerminalConnection,id:string,now=Date.now()){
 const {a}=delegated(db,connection,now)
 if(!db.prepare('SELECT 1 FROM runtime_control_requests WHERE rollout_id=? AND agent_id=?').get(id,a.id))throw new RuntimeControlError(404,'runtime_rollout_not_found')
 const job=runtimeRollout(db,a.owner_subject,id)
 if(job.workerId!==a.worker_id)throw new RuntimeControlError(404,'runtime_rollout_not_found')
 return job
}
