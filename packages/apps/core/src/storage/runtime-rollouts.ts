import {randomUUID} from 'node:crypto'
import type {Database} from 'better-sqlite3'
import {z} from 'zod'
import {validateWorker,WorkerError} from './workers.js'
import {managedBusy,type WorkerAuthority} from './managed-agents.js'
import type {RueRuntimeRollout,RueRuntimeRolloutPhase} from '@multiterm/rue-sdk'
export const ROLLOUT_CAPABILITY='managed-runtime-rollout-v1'
const digest=z.string().regex(/^sha256:[a-f0-9]{64}$/)
export const rolloutRequestSchema=z.object({requestId:z.string().uuid(),expectedWorkerRevision:z.number().int().nonnegative(),expectedImage:digest,image:digest,acknowledgeHostExecution:z.literal(true)}).strict()
const terminal=new Set(['succeeded','failed'])
interface AgentFence {id:string;revision:number;desired:string}
interface Row {id:string;owner_subject:string;worker_id:string;request_id:string;intent:string;phase:RueRuntimeRolloutPhase;image:string;previous_image:string;worker_revision:number;agents:string;created_at:number;updated_at:number;expires_at:number;phase_at:number;error:string|null}
interface Agent {id:string;owner_subject:string;worker_id:string;revision:number;desired:string;observed:string;observed_revision:number|null;observed_generation:number|null;grant_revision:number|null;grant_generation:number|null;connection_id:string|null;purged_at:number|null}
const get=(db:Database,id:string)=>db.prepare('SELECT * FROM runtime_rollouts WHERE id=?').get(id) as Row|undefined
const agents=(db:Database,workerId:string)=>db.prepare('SELECT * FROM managed_agents WHERE worker_id=? AND purged_at IS NULL ORDER BY id').all(workerId) as Agent[]
const publicJob=(row:Row):RueRuntimeRollout=>({id:row.id,workerId:row.worker_id,requestId:row.request_id,phase:row.phase,image:row.image,previousImage:row.previous_image,createdAt:row.created_at,updatedAt:row.updated_at,expiresAt:row.expires_at,error:row.error})
function phase(db:Database,row:Row,next:RueRuntimeRolloutPhase,now:number,error:string|null=null){db.prepare('UPDATE runtime_rollouts SET phase=?,updated_at=?,phase_at=?,error=? WHERE id=?').run(next,now,now,error,row.id);row.phase=next;row.phase_at=now;row.error=error}
function audit(db:Database,row:Row,action:string,now:number){db.prepare('INSERT INTO worker_audit(id,worker_id,action,revision,created_at) VALUES(?,?,?,?,?)').run(randomUUID(),row.worker_id,`runtime-rollout:${action}`,row.worker_revision,now)}
function workerDesired(db:Database,row:Row,desired:'active'|'draining',now:number){db.prepare('UPDATE workers SET desired=?,revision=revision+1 WHERE id=? AND revision=?').run(desired,row.worker_id,row.worker_revision);row.worker_revision++;db.prepare('UPDATE runtime_rollouts SET worker_revision=? WHERE id=?').run(row.worker_revision,row.id);audit(db,row,desired,now)}
function delegatedPreflightAllowed(db:Database,row:Row,now:number){
 const link=db.prepare('SELECT agent_id FROM runtime_control_requests WHERE rollout_id=?').get(row.id) as {agent_id:string}|undefined
 if(!link)return true
 return Boolean(db.prepare(`SELECT 1 FROM runtime_control_grants g JOIN managed_agents a ON a.id=g.agent_id JOIN terminal_connections c ON c.id=a.connection_id WHERE g.agent_id=? AND g.owner_subject=? AND g.worker_id=? AND g.enabled=1 AND g.expires_at>? AND g.updated_at<=? AND a.owner_subject=g.owner_subject AND a.worker_id=g.worker_id AND a.connection_id=g.connection_id AND a.desired!='destroyed' AND a.purged_at IS NULL AND c.owner_subject=g.owner_subject AND c.session_id=a.session_id AND c.revoked_at IS NULL`).get(link.agent_id,row.owner_subject,row.worker_id,now,now))
}
function fences(db:Database,row:Row){
 const expected=JSON.parse(row.agents) as AgentFence[],current=agents(db,row.worker_id)
 return current.length===expected.length&&expected.every(f=>current.some(a=>a.id===f.id&&a.revision===f.revision&&a.desired===f.desired))
}
function transitionAgents(db:Database,row:Row,running:boolean,now:number){
 const saved=JSON.parse(row.agents) as Array<AgentFence&{resume?:boolean}>
 for(const item of saved){
  if(!item.resume)continue
  item.revision++;item.desired=running?'running':'stopped'
  db.prepare("UPDATE managed_agents SET desired=?,revision=?,observed='pending',error=NULL,grant_revision=NULL,grant_generation=NULL,encrypted_grant=NULL WHERE id=?").run(item.desired,item.revision,item.id)
  db.prepare('UPDATE terminal_connections SET lease_expires_at=? WHERE id=(SELECT connection_id FROM managed_agents WHERE id=?)').run(now,item.id)
 }
 row.agents=JSON.stringify(saved);db.prepare('UPDATE runtime_rollouts SET agents=? WHERE id=?').run(row.agents,row.id)
}
export function runtimeRolloutHoldsHost(db:Database,workerId:string){return Boolean(db.prepare("SELECT 1 FROM runtime_rollouts WHERE worker_id=? AND phase NOT IN ('preflight','succeeded','failed')").get(workerId))}
export function requestRuntimeRollout(db:Database,owner:string,workerId:string,raw:unknown,now=Date.now()){
 const input=rolloutRequestSchema.parse(raw),intent=JSON.stringify([workerId,input])
 return db.transaction(()=>{
  const previous=db.prepare('SELECT * FROM runtime_rollouts WHERE owner_subject=? AND request_id=?').get(owner,input.requestId) as Row|undefined
  if(previous){if(previous.intent!==intent)throw new WorkerError(409,'rollout_request_conflict');return publicJob(previous)}
  const worker=db.prepare('SELECT * FROM workers WHERE id=? AND owner_subject=? AND revoked_at IS NULL').get(workerId,owner) as {revision:number;desired:string;lease_expires_at:number|null;health:string|null;last_seen_at:number|null}|undefined
  if(!worker)throw new WorkerError(404,'worker_not_found')
  if(db.prepare('SELECT 1 FROM managed_agents WHERE worker_id=? AND runtime_image IS NOT NULL AND purged_at IS NULL LIMIT 1').get(workerId))throw new WorkerError(409,'runtime_rollout_has_individual_images')
  if(worker.revision!==input.expectedWorkerRevision||worker.desired!=='active')throw new WorkerError(409,'worker_revision_conflict')
  const health=worker.health?JSON.parse(worker.health):null
  if(!worker.last_seen_at||now<worker.last_seen_at||!worker.lease_expires_at||worker.lease_expires_at<=now||!health?.capabilities?.includes(ROLLOUT_CAPABILITY))throw new WorkerError(409,'runtime_rollout_manager_upgrade_required')
  if(health.runtimeImage!==input.expectedImage||input.image===input.expectedImage)throw new WorkerError(409,'runtime_image_conflict')
  if(db.prepare("SELECT 1 FROM runtime_rollouts WHERE worker_id=? AND phase NOT IN ('succeeded','failed')").get(workerId))throw new WorkerError(409,'runtime_rollout_active')
  if((db.prepare('SELECT count(*) AS n FROM runtime_rollouts WHERE owner_subject=? AND created_at>?').get(owner,now-86400000) as {n:number}).n>=24)throw new WorkerError(429,'runtime_rollout_rate_limited')
  const id=randomUUID(),snapshot=agents(db,workerId).map(a=>({id:a.id,revision:a.revision,desired:a.desired,resume:a.desired==='running'}))
  if(snapshot.length>64)throw new WorkerError(409,'runtime_rollout_inventory_too_large')
  db.prepare("INSERT INTO runtime_rollouts(id,owner_subject,worker_id,request_id,intent,phase,image,previous_image,worker_revision,agents,created_at,updated_at,expires_at,phase_at) VALUES(?,?,?,?,?,'preflight',?,?,?,?,?,?,?,?)").run(id,owner,workerId,input.requestId,intent,input.image,input.expectedImage,worker.revision,JSON.stringify(snapshot),now,now,now+1800000,now)
  const row=get(db,id)!;audit(db,row,'requested',now);return publicJob(row)
 }).immediate()
}
export function runtimeRollout(db:Database,owner:string,id:string){const row=get(db,id);if(!row||row.owner_subject!==owner)throw new WorkerError(404,'runtime_rollout_not_found');return publicJob(row)}
export function runtimeRollouts(db:Database,owner:string,workerId:string){return (db.prepare('SELECT * FROM runtime_rollouts WHERE owner_subject=? AND worker_id=? ORDER BY created_at DESC LIMIT 50').all(owner,workerId) as Row[]).map(publicJob)}
export function pollRuntimeRollout(db:Database,auth:WorkerAuthority,suppliedNow?:number){
 return db.transaction(()=>{
  const now=suppliedNow??Date.now()
  const worker=validateWorker(db,auth.id,auth.secret,auth.instance,auth.generation,now)
  const row=db.prepare("SELECT * FROM runtime_rollouts WHERE worker_id=? AND phase NOT IN ('succeeded','failed') ORDER BY created_at LIMIT 1").get(auth.id) as Row|undefined
  if(!row)return {job:null}
  if(row.owner_subject!==worker.owner_subject)throw new WorkerError(401,'rollout_owner_changed')
  if(row.phase==='preflight'&&!delegatedPreflightAllowed(db,row,now)){phase(db,row,'failed',now,'runtime_control_not_approved');audit(db,row,'approval_lapsed',now);return {job:publicJob(get(db,row.id)!)}}
  if(row.phase!=='uncertain'&&(worker.revision!==row.worker_revision||!fences(db,row))){phase(db,row,row.phase==='preflight'?'failed':'uncertain',now,'concurrent_configuration_change');audit(db,row,row.phase,now)}
  if(!terminal.has(row.phase)&&row.phase!=='uncertain'&&now>=row.expires_at){phase(db,row,row.phase==='preflight'?'failed':'uncertain',now,'rollout_expired');audit(db,row,row.phase,now)}
  const current=agents(db,row.worker_id),saved=JSON.parse(row.agents) as Array<AgentFence&{resume?:boolean}>
  const stopped=()=>current.every(a=>['stopped','destroyed'].includes(a.desired)&&a.observed===a.desired&&a.observed_revision===a.revision)
  const healthy=()=>{
   const expectedImage=row.phase==='rollback_verifying'?row.previous_image:row.image
   if(!worker.health||JSON.parse(worker.health).runtimeImage!==expectedImage)return false
   return saved.filter(a=>a.resume).every(item=>{const a=current.find(a=>a.id===item.id);return a?.observed==='running'&&a.observed_revision===a.revision&&a.observed_generation===worker.generation&&a.grant_generation===worker.generation&&a.grant_revision===a.revision&&a.connection_id&&Boolean(db.prepare('SELECT 1 FROM terminal_connections WHERE id=? AND lease_expires_at>? AND last_seen_at>? AND revoked_at IS NULL').get(a.connection_id,now,now-15000))})
  }
  if(row.phase==='draining'){
   const idle=current.every(a=>a.desired!=='running'||(a.connection_id&&db.prepare('SELECT 1 FROM terminal_connections WHERE id=? AND lease_expires_at>? AND last_seen_at>? AND revoked_at IS NULL').get(a.connection_id,now,now-15000)&&!managedBusy(db,a.connection_id,now)))
   if(idle){transitionAgents(db,row,false,now);phase(db,row,'stopping',now)}
  }else if(row.phase==='stopping'&&stopped())phase(db,row,'installing',now)
  else if(row.phase==='verifying'){
   if(healthy()){phase(db,row,'succeeded',now);audit(db,row,'succeeded',now)}
   else if(now-row.phase_at>120000){workerDesired(db,row,'draining',now);transitionAgents(db,row,false,now);phase(db,row,'rollback_stopping',now,'candidate_unhealthy')}
  }else if(row.phase==='rollback_stopping'&&stopped())phase(db,row,'rollback_installing',now)
  else if(row.phase==='rollback_verifying'){
   if(healthy()){phase(db,row,'failed',now,'candidate_unhealthy_rolled_back');audit(db,row,'rolled_back',now)}
   else if(now-row.phase_at>120000){phase(db,row,'uncertain',now,'rollback_unconfirmed');audit(db,row,'uncertain',now)}
  }
  return {job:publicJob(get(db,row.id)!)}
 }).immediate()
}
export function cancelRuntimeRollout(db:Database,owner:string,id:string,now=Date.now()){
 return db.transaction(()=>{
  const row=get(db,id);if(!row||row.owner_subject!==owner)throw new WorkerError(404,'runtime_rollout_not_found')
  if(row.phase==='failed'&&row.error==='cancelled')return publicJob(row)
  if(row.phase!=='preflight')throw new WorkerError(409,'runtime_rollout_already_started')
  phase(db,row,'failed',now,'cancelled');audit(db,row,'cancelled',now);return publicJob(get(db,id)!)
 }).immediate()
}
export function resolveRuntimeRollout(db:Database,owner:string,id:string,expectedUpdatedAt:number,now=Date.now()){
 return db.transaction(()=>{
  const row=get(db,id);if(!row||row.owner_subject!==owner)throw new WorkerError(404,'runtime_rollout_not_found')
  if(row.phase==='failed'&&row.error==='operator_resolved')return publicJob(row)
  if(row.phase!=='uncertain'||row.updated_at!==expectedUpdatedAt)throw new WorkerError(409,'runtime_rollout_revision_conflict')
  const worker=db.prepare('SELECT desired FROM workers WHERE id=? AND owner_subject=?').get(row.worker_id,owner) as {desired:string}|undefined
  if(worker?.desired!=='draining'||agents(db,row.worker_id).some(a=>!['stopped','destroyed'].includes(a.desired)||a.observed!==a.desired||a.observed_revision!==a.revision))throw new WorkerError(409,'runtime_rollout_host_not_stopped')
  phase(db,row,'failed',now,'operator_resolved');audit(db,row,'operator_resolved',now);return publicJob(get(db,id)!)
 }).immediate()
}
export const rolloutReportSchema=z.object({action:z.enum(['ready','installed','rejected']),image:digest.optional()}).strict()
export function reportRuntimeRollout(db:Database,auth:WorkerAuthority,id:string,raw:unknown,suppliedNow?:number){
 const input=rolloutReportSchema.parse(raw)
 return db.transaction(()=>{
  const now=suppliedNow??Date.now()
  const worker=validateWorker(db,auth.id,auth.secret,auth.instance,auth.generation,now),row=get(db,id)
  if(!row||row.worker_id!==worker.id||row.owner_subject!==worker.owner_subject)throw new WorkerError(404,'runtime_rollout_not_found')
  if(terminal.has(row.phase)||row.phase==='uncertain')return publicJob(row)
  if(row.phase==='preflight'&&!delegatedPreflightAllowed(db,row,now)){phase(db,row,'failed',now,'runtime_control_not_approved');audit(db,row,'approval_lapsed',now);return publicJob(get(db,id)!)}
  if(worker.revision!==row.worker_revision||!fences(db,row)){phase(db,row,row.phase==='preflight'?'failed':'uncertain',now,'concurrent_configuration_change');return publicJob(get(db,id)!)}
  if(now>=row.expires_at){phase(db,row,row.phase==='preflight'?'failed':'uncertain',now,'rollout_expired');return publicJob(get(db,id)!)}
  if(input.action==='rejected'){
   phase(db,row,row.phase==='preflight'?'failed':'uncertain',now,'runtime_image_unavailable');audit(db,row,row.phase,now)
  }else if(input.action==='ready'){
   if(row.phase!=='preflight')return publicJob(row)
   if(input.image!==row.image)throw new WorkerError(409,'runtime_image_conflict')
   workerDesired(db,row,'draining',now);phase(db,row,'draining',now);audit(db,row,'draining',now)
  }else{
   const rollback=row.phase==='rollback_installing',expected=rollback?row.previous_image:row.image
   if(!['installing','rollback_installing'].includes(row.phase))return publicJob(row)
   if(input.image!==expected)throw new WorkerError(409,'runtime_image_conflict')
   transitionAgents(db,row,true,now);workerDesired(db,row,'active',now);phase(db,row,rollback?'rollback_verifying':'verifying',now);audit(db,row,row.phase,now)
  }
  return publicJob(get(db,id)!)
 }).immediate()
}
