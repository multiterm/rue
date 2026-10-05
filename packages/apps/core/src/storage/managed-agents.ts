import {validFilesystemPolicy,requiresWorkspaceRoots,type FilesystemPolicy} from '@multiterm/rue-sdk'
import {agentStatusSchema} from './agent-status.js'
import {compactionHoldsRuntime} from './managed-maintenance-state.js'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Database } from 'better-sqlite3'
import { createSession, deleteSession } from './sessions.js'
import { encryptCredential, decryptCredential } from './agent-settings.js'
import { clearProviderKeyGrants } from './provider-keys.js'
import {projectDeadline} from './projects.js'
import {resolveMcpProfiles} from './mcp.js'
import { validateWorker, WorkerError } from './workers.js'

export const managedConfigSchema = z.object({
  filesystem:z.custom<FilesystemPolicy>(validFilesystemPolicy).optional(),
  provider: z.string().max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
  model: z.string().min(1).max(128).refine(value=>!/[\x00-\x1f\x7f]/.test(value)),
  permission: z.enum(['read-only','coding']),
  mounts: z.array(z.string().max(32).regex(/^[a-z][a-z0-9_-]*$/).refine(value=>!/[\r\n]/.test(value))).max(8).refine(v => new Set(v).size === v.length),
  shareToolOutput: z.boolean(), shareThinking: z.boolean(), thinkingLevel: z.enum(['off','minimal','low','medium','high','xhigh']).optional(), autoCompaction: z.boolean().optional(),
  mcp:z.array(z.string().uuid()).max(4).refine(ids=>new Set(ids).size===ids.length).optional(),
}).strict().refine(config=>!config.mcp?.length||config.permission==='coding')
export const managedCreateSchema = z.object({
  requestId: z.string().uuid(), workerId: z.string().uuid(),
  name: z.string().trim().min(1).max(60).regex(/^[^\x00-\x1f\x7f]+$/),
  acknowledgeExecution: z.literal(true), acknowledgeFilesystem:z.literal(true).optional(), config: managedConfigSchema,
}).strict()
export const managedChangeSchema = z.object({
  requestId: z.string().uuid(), expectedRevision: z.number().int().positive(),
  action: z.enum(['stop','resume','reload','destroy','purge','configure','upgrade']),
  image:z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),expectedImage:z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),piVersion:z.string().regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}$/).optional(), acknowledgePurge:z.literal(true).optional(),
  config:managedConfigSchema.optional(),acknowledgeExecution:z.literal(true).optional(),acknowledgeFilesystem:z.literal(true).optional(),
}).strict().refine(input=>input.action==='configure'?Boolean(input.config&&input.acknowledgeExecution):input.action==='upgrade'?Boolean(!input.config&&input.acknowledgeExecution&&input.image&&input.expectedImage&&input.piVersion):input.config===undefined&&input.acknowledgeExecution===undefined).refine(input=>input.action==='upgrade'||(input.image===undefined&&input.expectedImage===undefined&&input.piVersion===undefined))
interface AgentRow {
  runtime_image:string|null;previous_runtime_image:string|null;runtime_update_state:string|null;runtime_update_version:string|null;runtime_update_boot_at:number|null
  id: string; owner_subject: string; worker_id: string; session_id: string | null; connection_id: string | null
  name: string; config: string; desired: 'running'|'stopped'|'destroyed'; revision: number; created_at: number
  grant_revision: number | null; grant_generation: number | null; grant_boot: number | null; encrypted_grant: string | null
  purge_requested_at: number|null; purged_at:number|null
  observed: string; observed_revision: number | null; observed_generation: number | null; observed_at: number | null; error: string | null
}
interface OperationRow { id: string; owner_subject: string; request_id: string; intent: string; agent_id: string; revision: number; action: string; status: string; created_at: number; completed_at: number | null }
const agent = (db: Database, id: string) => db.prepare('SELECT * FROM managed_agents WHERE id=?').get(id) as AgentRow | undefined
const publicAgent = (a: AgentRow) => ({ runtimeImage:a.runtime_image,previousRuntimeImage:a.previous_runtime_image,runtimeUpdateState:a.runtime_update_state,runtimeUpdateVersion:a.runtime_update_version,id:a.id, workerId:a.worker_id, sessionId:a.session_id, connectionId:a.connection_id,
  name:a.name, desired:a.desired, purgeRequested:a.purge_requested_at!==null, purgedAt:a.purged_at, revision:a.revision, createdAt:a.created_at, config:JSON.parse(a.config) as z.infer<typeof managedConfigSchema>,
  observed:a.observed, observedRevision:a.observed_revision, observedGeneration:a.observed_generation, observedAt:a.observed_at, error:a.error })
const publicOperation = (o: OperationRow) => ({ id:o.id, agentId:o.agent_id, revision:o.revision, action:o.action, status:o.status, createdAt:o.created_at, completedAt:o.completed_at })
function owned(db: Database, owner: string, id: string) {
  const a=agent(db,id); if(!a || a.owner_subject!==owner) throw new WorkerError(404,'managed_agent_not_found'); return a
}
function retry(db: Database, owner: string, request: string, intent: string) {
  const o=db.prepare('SELECT * FROM managed_operations WHERE owner_subject=? AND request_id=?').get(owner,request) as OperationRow | undefined
  if(!o)return
  if(o.intent!==intent)throw new WorkerError(409,'managed_request_conflict')
  return { agent:publicAgent(owned(db,owner,o.agent_id)), operation:publicOperation(o) }
}
function operation(db: Database, a: AgentRow, request: string, intent: string, action: string, now: number) {
  db.prepare("UPDATE managed_operations SET status='superseded',completed_at=? WHERE agent_id=? AND status='pending'").run(now,a.id)
  const id=randomUUID()
  db.prepare('INSERT INTO managed_operations(id,owner_subject,request_id,intent,agent_id,revision,action,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,a.owner_subject,request,intent,a.id,a.revision,action,now)
  return {agent:publicAgent(a),operation:publicOperation(db.prepare('SELECT * FROM managed_operations WHERE id=?').get(id) as OperationRow)}
}
export function listManagedAgents(db: Database, owner: string) {
  return (db.prepare('SELECT * FROM managed_agents WHERE owner_subject=? ORDER BY created_at,id').all(owner) as AgentRow[]).map(publicAgent)
}
export function managedOperations(db: Database, owner: string, id: string) {
  owned(db,owner,id)
  return (db.prepare('SELECT * FROM managed_operations WHERE agent_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100').all(id) as OperationRow[]).map(publicOperation)
}
function requireFilesystemCapability(db:Database,workerId:string,config:{filesystem?:FilesystemPolicy}){
 if(!config.filesystem?.directories.length)return
 const w=db.prepare('SELECT health FROM workers WHERE id=? AND revoked_at IS NULL').get(workerId) as {health:string|null}|undefined
 const capability=requiresWorkspaceRoots(config.filesystem)?'managed-filesystem-v2':'managed-filesystem-v1'
 if(!w?.health||!JSON.parse(w.health).capabilities?.includes(capability))throw new WorkerError(409,'managed_filesystem_not_supported')
}
function requireProviderCapability(db:Database,workerId:string,provider:string){
 if(['openai','anthropic','google','openrouter'].includes(provider))return
 const capability=provider==='openai-codex'?'managed-codex-v1':'managed-dynamic-providers-v1'
 const row=db.prepare('SELECT health FROM workers WHERE id=? AND revoked_at IS NULL').get(workerId) as {health:string|null}|undefined
 if(!row?.health||!JSON.parse(row.health).capabilities?.includes(capability))throw new WorkerError(409,provider==='openai-codex'?'managed_codex_not_supported':'managed_provider_protocol_not_supported')
}
export function createManagedAgent(db: Database, owner: string, raw: unknown, now=Date.now()) {
  const input=managedCreateSchema.parse(raw), intent=JSON.stringify(['create',input])
  return db.transaction(()=>{
    const previous=retry(db,owner,input.requestId,intent); if(previous)return previous
    const w=db.prepare('SELECT id,health,project_binding_id FROM workers WHERE id=? AND owner_subject=? AND revoked_at IS NULL').get(input.workerId,owner) as {id:string;health:string|null;project_binding_id:string|null}|undefined
    if(!w)throw new WorkerError(404,'worker_not_found')
    if(projectDeadline(db,w.project_binding_id,now)<=now)throw new WorkerError(401,'worker_project_fenced')
    requireProviderCapability(db,input.workerId,input.config.provider)
    requireFilesystemCapability(db,input.workerId,input.config)
    if(input.config.filesystem?.directories.length&&input.acknowledgeFilesystem!==true)throw new WorkerError(409,'managed_filesystem_consent_required')
    if(input.config.mcp?.length){
      if(!w.health||!JSON.parse(w.health).capabilities?.includes('managed-mcp-v1'))throw new WorkerError(409,'managed_mcp_not_supported')
      resolveMcpProfiles(db,owner,input.config.mcp)
    }
    // Stored bot count is independent of the host's operator-configured runtime capacity.
    const id=randomUUID(), sessionId=`ses_${randomUUID()}`, connectionId=`term_${randomBytes(24).toString('base64url')}`
    createSession(db,{id:sessionId,ownerSubject:owner,title:input.name,agent:'pi-terminal',provider:input.config.provider,model:input.config.model,meta:{terminalConnectionId:connectionId,managedAgentId:id,workerId:input.workerId}})
    // Only the managed grant endpoint can supply the initial terminal credential.
    db.prepare('INSERT INTO terminal_connections(id,owner_subject,session_id,pi_session_id,token_hash,expires_at,created_at,name,activated_at,remote_enabled) VALUES(?,?,?,?,?,?,?,?,?,1)')
      .run(connectionId,owner,sessionId,id,createHash('sha256').update(randomBytes(32)).digest('hex'),now,now,input.name,now)
    db.prepare("INSERT INTO managed_agents(id,owner_subject,worker_id,session_id,connection_id,name,config,desired,created_at) VALUES(?,?,?,?,?,?,?,'running',?)")
      .run(id,owner,input.workerId,sessionId,connectionId,input.name,JSON.stringify(input.config),now)
    return operation(db,agent(db,id)!,input.requestId,intent,'create',now)
  }).immediate()
}
export function changeManagedAgent(db: Database, owner: string, id: string, raw: unknown, now=Date.now()) {
  const input=managedChangeSchema.parse(raw), intent=JSON.stringify([id,input])
  return db.transaction(()=>{
    const previous=retry(db,owner,input.requestId,intent);if(previous)return previous
    const a=owned(db,owner,id)
    if(a.revision!==input.expectedRevision)throw new WorkerError(409,'managed_revision_conflict')
    if(['updating','rolling_back'].includes(a.runtime_update_state??'')&&!['stop','destroy'].includes(input.action))throw new WorkerError(409,'managed_upgrade_in_progress')
    if(input.action==='purge'){
      if(input.acknowledgePurge!==true||a.desired!=='destroyed'||a.purge_requested_at!==null)throw new WorkerError(409,'managed_purge_requires_destroy_and_consent')
      db.prepare("UPDATE managed_agents SET purge_requested_at=?,revision=revision+1,observed='pending',error=NULL WHERE id=?").run(now,id)
      return operation(db,agent(db,id)!,input.requestId,intent,'purge',now)
    }
    if(a.desired==='destroyed')throw new WorkerError(409,'managed_revision_conflict')
    if(input.action==='reload' && a.desired!=='running')throw new WorkerError(409,'managed_reload_requires_running')
    if(['resume','reload','configure','upgrade'].includes(input.action)){
      const w=db.prepare('SELECT project_binding_id FROM workers WHERE id=?').get(a.worker_id) as {project_binding_id:string|null}
      if(projectDeadline(db,w.project_binding_id,now)<=now)throw new WorkerError(401,'worker_project_fenced')
    }
    if(input.action==='upgrade'){
      if(a.desired!=='running')throw new WorkerError(409,'managed_upgrade_requires_running')
      if(!a.session_id||!a.connection_id||!db.prepare('SELECT 1 FROM terminal_connections WHERE id=? AND owner_subject=? AND revoked_at IS NULL').get(a.connection_id,owner))throw new WorkerError(409,'managed_upgrade_connection_unavailable')
      const w=db.prepare('SELECT health,desired,lease_expires_at,revoked_at FROM workers WHERE id=? AND owner_subject=?').get(a.worker_id,owner) as {health:string|null;desired:string;lease_expires_at:number|null;revoked_at:number|null}|undefined
      const health=w?.health?JSON.parse(w.health):null,current=a.runtime_image??health?.runtimeImage
      if(!w||w.revoked_at!==null||w.desired!=='active'||!w.lease_expires_at||w.lease_expires_at<=now||!health?.capabilities?.includes('managed-agent-upgrade-v1'))throw new WorkerError(409,'managed_upgrade_not_supported')
      if(current!==input.expectedImage||input.image===current||!health.runtimeReleases?.some((r:any)=>r.image===input.image&&r.piVersion===input.piVersion))throw new WorkerError(409,'managed_upgrade_candidate_changed')
      if(db.prepare("SELECT 1 FROM runtime_rollouts WHERE worker_id=? AND phase NOT IN ('succeeded','failed')").get(a.worker_id))throw new WorkerError(409,'managed_host_rollout_active')
      db.prepare("UPDATE managed_agents SET runtime_image=?,previous_runtime_image=?,runtime_update_state='updating',runtime_update_version=?,runtime_update_boot_at=NULL WHERE id=?").run(input.image,current,input.piVersion,id)
    }
    if(input.action==='configure'){
      const config=input.config!
      requireProviderCapability(db,a.worker_id,config.provider)
      requireFilesystemCapability(db,a.worker_id,config)
      if(JSON.stringify(config.filesystem??null)!==JSON.stringify(JSON.parse(a.config).filesystem??null)&&input.acknowledgeFilesystem!==true)throw new WorkerError(409,'managed_filesystem_consent_required')
      if(config.mcp?.length){
        const w=db.prepare('SELECT health FROM workers WHERE id=? AND revoked_at IS NULL').get(a.worker_id) as {health:string|null}|undefined
        if(!w?.health||!JSON.parse(w.health).capabilities?.includes('managed-mcp-v1'))throw new WorkerError(409,'managed_mcp_not_supported')
        resolveMcpProfiles(db,owner,config.mcp)
      }
      db.prepare('UPDATE managed_agents SET config=? WHERE id=?').run(JSON.stringify(config),id)
      db.prepare('UPDATE sessions SET provider=?,model=?,updated_at=? WHERE id=?').run(config.provider,config.model,now,a.session_id)
    }
    const desired=input.action==='stop'||input.action==='configure'?'stopped':input.action==='destroy'?'destroyed':'running'
    db.prepare("UPDATE managed_agents SET desired=?,revision=revision+1,observed='pending',error=NULL WHERE id=?").run(desired,id)
    // A reload drains the current run. Every other transition immediately fences
    // old grants, so rapid stop/resume cannot resurrect an old container.
    if(!['reload','upgrade'].includes(input.action)){
      if(a.runtime_update_state==='updating')db.prepare("UPDATE managed_agents SET runtime_image=previous_runtime_image,previous_runtime_image=runtime_image,runtime_update_state='cancelled' WHERE id=?").run(id)
      else if(a.runtime_update_state==='rolling_back')db.prepare("UPDATE managed_agents SET runtime_update_state='cancelled' WHERE id=?").run(id)
      db.prepare('UPDATE managed_agents SET grant_revision=NULL,grant_generation=NULL,encrypted_grant=NULL WHERE id=?').run(id)
      if(a.connection_id)db.prepare('UPDATE terminal_connections SET lease_expires_at=? WHERE id=?').run(now,a.connection_id)
    }
    if(desired==='destroyed' && a.connection_id){
      db.prepare('UPDATE terminal_connections SET revoked_at=?,remote_enabled=0 WHERE id=?').run(now,a.connection_id)
      clearProviderKeyGrants(db,owner,{type:'terminal',id:a.connection_id})
    }
    return operation(db,agent(db,id)!,input.requestId,intent,input.action,now)
  }).immediate()
}
import type {WorkerAuthority} from '@multiterm/rue-db'
export type {WorkerAuthority}
function worker(db:Database, auth:WorkerAuthority, now:number) { return validateWorker(db,auth.id,auth.secret,auth.instance,auth.generation,now) }
function runtimeStatus(db:Database,connectionId:string|null){
 if(!connectionId)return null
 const row=db.prepare('SELECT relay_health,last_seen_at,lease_expires_at FROM terminal_connections WHERE id=?').get(connectionId) as {relay_health:string|null;last_seen_at:number|null;lease_expires_at:number|null}|undefined
 try{const parsed=agentStatusSchema.safeParse(row?.relay_health?JSON.parse(row.relay_health).status:null);if(!parsed.success)return null;const {catalog,...report}=parsed.data;return {report,observedAt:row!.last_seen_at,leaseExpiresAt:row!.lease_expires_at}}catch{return null}
}
export function managedSnapshot(db: Database, auth: WorkerAuthority, now=Date.now()) {
  const w=worker(db,auth,now)
  // Renew credential validity, never execution authority: every agent request
  // remains capped by this worker's current lease and generation.
  db.prepare("UPDATE terminal_connections SET expires_at=? WHERE revoked_at IS NULL AND id IN (SELECT connection_id FROM managed_agents WHERE worker_id=? AND desired='running' AND grant_generation=? AND grant_revision IS NOT NULL)").run(now+300000,w.id,w.generation)
  const rows=db.prepare('SELECT * FROM managed_agents WHERE worker_id=? AND purged_at IS NULL ORDER BY created_at,id').all(w.id) as AgentRow[]
  return {generation:w.generation,serverNow:now,expiresAt:w.lease_expires_at,desired:w.desired,agents:rows.map(a=>({
    ...publicAgent(a), runtimeStatus:runtimeStatus(db,a.connection_id), connected: Boolean(a.connection_id && db.prepare('SELECT 1 FROM terminal_connections WHERE id=? AND lease_expires_at>? AND revoked_at IS NULL').get(a.connection_id,now)), busy: managedBusy(db,a.connection_id,now), grantRevision:a.grant_revision, grantGeneration:a.grant_generation, grantBoot:a.grant_boot,
  }))}
}
export function managedBusy(db: Database, connectionId: string | null, now=Date.now()) {
  if(!connectionId)return false
  const active=db.prepare('SELECT lease_expires_at FROM terminal_connections WHERE id=?').get(connectionId) as {lease_expires_at:number|null}|undefined
  if(!active?.lease_expires_at || active.lease_expires_at<=now)return false
  if(compactionHoldsRuntime(db,connectionId,true))return true
  if(db.prepare("SELECT 1 FROM terminal_commands WHERE connection_id=? AND status IN ('claimed','running') LIMIT 1").get(connectionId))return true
  const row=db.prepare('SELECT relay_health FROM terminal_connections WHERE id=?').get(connectionId) as {relay_health:string|null}|undefined
  if(!row?.relay_health)return false
  const health=JSON.parse(row.relay_health)
  return health.agentWorking===true || Number(health.pendingCount)>0
}
export function managedGrant(db: Database, auth: WorkerAuthority, id: string, revision: number, now=Date.now(), boot=1) {
  if(!Number.isSafeInteger(boot)||boot<1)throw new WorkerError(409,'managed_boot_invalid')
  return db.transaction(()=>{
    const w=worker(db,auth,now), a=agent(db,id)
    if(!a || a.worker_id!==w.id || a.owner_subject!==w.owner_subject)throw new WorkerError(404,'managed_agent_not_found')
    if(a.desired!=='running'||a.revision!==revision||!a.session_id||!a.connection_id||w.desired!=='active')throw new WorkerError(409,'managed_grant_fenced')
    if(a.runtime_image){const health=w.health?JSON.parse(w.health):null;if(!health?.capabilities?.includes('managed-agent-upgrade-v1'))throw new WorkerError(409,'managed_upgrade_not_supported')}
    requireProviderCapability(db,a.worker_id,JSON.parse(a.config).provider)
    requireFilesystemCapability(db,a.worker_id,JSON.parse(a.config))
    const c=db.prepare('SELECT revoked_at FROM terminal_connections WHERE id=?').get(a.connection_id) as {revoked_at:number|null}|undefined
    if(!c || c.revoked_at!==null)throw new WorkerError(409,'managed_grant_revoked')
    const sameEpoch=a.grant_revision===revision && a.grant_generation===w.generation
    const previousBoot=sameEpoch?(a.grant_boot??1):0
    if(boot<previousBoot || boot>previousBoot+1)throw new WorkerError(409,'managed_boot_fenced')
    const replacing=!sameEpoch || boot!==previousBoot
    if(a.grant_revision!==null && replacing && a.grant_generation===w.generation && managedBusy(db,a.connection_id,now))throw new WorkerError(409,'managed_reload_pending')
    let token: string
    if(a.encrypted_grant && !replacing)token=decryptCredential(db,[a.owner_subject,'managed-agent',id],a.encrypted_grant)
    else {
      token=`rue_terminal_${randomBytes(32).toString('base64url')}`
      const encrypted=encryptCredential(db,[a.owner_subject,'managed-agent',id],token)
      db.prepare('UPDATE managed_agents SET grant_revision=?,grant_generation=?,grant_boot=?,encrypted_grant=? WHERE id=?').run(revision,w.generation,boot,encrypted,id)
      if(['updating','rolling_back'].includes(a.runtime_update_state??''))db.prepare('UPDATE managed_agents SET runtime_update_boot_at=COALESCE(runtime_update_boot_at,?) WHERE id=?').run(now,id)
      db.prepare('UPDATE terminal_connections SET token_hash=?,instance_id=NULL,lease_expires_at=NULL WHERE id=?').run(createHash('sha256').update(token).digest('hex'),a.connection_id)
    }
    db.prepare('UPDATE terminal_connections SET expires_at=? WHERE id=?').run(now+300000,a.connection_id)
    const mcp=resolveMcpProfiles(db,a.owner_subject,JSON.parse(a.config).mcp)
    return {agent:publicAgent(a),...(mcp.length?{mcp}:{}),token,id:a.connection_id,sessionId:a.session_id,piSessionId:a.id,ownerSubject:a.owner_subject,
      generation:w.generation,boot,serverNow:now,expiresAt:w.lease_expires_at}
  }).immediate()
}
export const managedReportSchema=z.object({revision:z.number().int().positive(),boot:z.number().int().positive().default(1),state:z.enum(['starting','running','stopped','destroyed','purged','failed']),error:z.enum(['capacity_unavailable','mount_unavailable','runtime_unavailable','runtime_failed','ownership_conflict','authority_lost']).nullable()}).strict()
export function reportManagedAgent(db:Database,auth:WorkerAuthority,id:string,raw:unknown,now=Date.now()) {
  const input=managedReportSchema.parse(raw)
  return db.transaction(()=>{
    const w=worker(db,auth,now), a=agent(db,id)
    if(!a||a.worker_id!==w.id||a.owner_subject!==w.owner_subject)throw new WorkerError(404,'managed_agent_not_found')
    if(a.revision!==input.revision)throw new WorkerError(409,'managed_revision_conflict')
    if(['starting','running','failed'].includes(input.state) && a.grant_generation===w.generation && a.grant_revision===a.revision && input.boot!==(a.grant_boot??1))throw new WorkerError(409,'managed_boot_fenced')
    const purge=input.state==='purged'
    if(purge&&(a.desired!=='destroyed'||a.purge_requested_at===null||input.error!==null))throw new WorkerError(409,'managed_purge_not_authorized')
    let success=input.error===null&&(purge||(input.state===a.desired&&a.purge_requested_at===null))
    if(purge){
      if(a.session_id)deleteSession(db,a.session_id,a.owner_subject)
      db.prepare('UPDATE managed_agents SET purged_at=COALESCE(purged_at,?) WHERE id=?').run(now,id)
    }
    if((input.state==='running'&&(a.desired!=='running'||a.grant_revision!==a.revision||a.grant_generation!==w.generation)) || (input.state==='destroyed'&&a.desired!=='destroyed'))throw new WorkerError(409,'managed_report_fenced')
    if(['updating','rolling_back'].includes(a.runtime_update_state??'')){
      const status=runtimeStatus(db,a.connection_id)
      const version=status?.observedAt&&status.leaseExpiresAt&&status.leaseExpiresAt>now&&a.runtime_update_boot_at&&status.observedAt>=a.runtime_update_boot_at?status.report.piVersion:undefined
      const connected=Boolean(a.connection_id&&a.runtime_update_boot_at&&db.prepare('SELECT 1 FROM terminal_connections WHERE id=? AND lease_expires_at>? AND last_seen_at>=? AND revoked_at IS NULL').get(a.connection_id,now,a.runtime_update_boot_at))
      const verified=input.error===null&&input.state==='running'&&connected&&(a.runtime_update_state==='rolling_back'||version===a.runtime_update_version)
      const failed=input.error!==null||input.state==='failed'||(input.state==='running'&&!verified&&(Boolean(version)||Boolean(a.runtime_update_boot_at&&now-a.runtime_update_boot_at>90000)))
      if(failed){
        db.prepare("UPDATE managed_operations SET status='superseded',completed_at=? WHERE agent_id=? AND action='upgrade' AND status='pending'").run(now,id)
        if(a.runtime_update_state==='updating')db.prepare("UPDATE managed_agents SET runtime_image=previous_runtime_image,previous_runtime_image=runtime_image,runtime_update_state='rolling_back',runtime_update_boot_at=NULL,revision=revision+1,observed='pending',error=NULL WHERE id=?").run(id)
        else {db.prepare("UPDATE managed_agents SET runtime_update_state='failed',desired='stopped',revision=revision+1,grant_revision=NULL,grant_generation=NULL,encrypted_grant=NULL,observed='failed',error='runtime_failed' WHERE id=?").run(id);if(a.connection_id)db.prepare('UPDATE terminal_connections SET lease_expires_at=? WHERE id=?').run(now,a.connection_id)}
        return publicAgent(agent(db,id)!)
      }
      if(verified)db.prepare('UPDATE managed_agents SET runtime_update_state=?,previous_runtime_image=NULL WHERE id=?').run(a.runtime_update_state==='updating'?'updated':'rolled_back',id)
      else if(input.state==='running'){input.state='starting';success=false}
    }
    if(!['updating','rolling_back'].includes(a.runtime_update_state??'')&&['stopped','destroyed','purged'].includes(input.state))db.prepare('UPDATE managed_agents SET previous_runtime_image=NULL WHERE id=?').run(id)
    db.prepare('UPDATE managed_agents SET observed=?,observed_revision=?,observed_generation=?,observed_at=?,error=? WHERE id=?')
      .run(input.state,input.revision,w.generation,now,input.error,id)
    if(success)db.prepare("UPDATE managed_operations SET status='succeeded',completed_at=? WHERE agent_id=? AND revision=? AND status='pending'").run(now,id,input.revision)
    return publicAgent(agent(db,id)!)
  }).immediate()
}
/** No authority renewal. Shared by the relay and an independent runtime watchdog. */
export function managedAuthority(db:Database,connectionId:string,now=Date.now()):number|undefined {
  const a=db.prepare('SELECT * FROM managed_agents WHERE connection_id=?').get(connectionId) as AgentRow|undefined
  if(!a)return
  const w=db.prepare('SELECT * FROM workers WHERE id=?').get(a.worker_id) as {generation:number;lease_expires_at:number|null;last_seen_at:number|null;revoked_at:number|null;project_binding_id:string|null}|undefined
  if(a.desired!=='running'||a.grant_revision===null||!w||w.revoked_at!==null||a.grant_generation!==w.generation||!w.lease_expires_at||w.lease_expires_at<=now||w.last_seen_at===null||now<w.last_seen_at)throw new WorkerError(401,'managed_authority_expired')
  const deadline=Math.min(w.lease_expires_at,projectDeadline(db,w.project_binding_id,now))
  if(deadline<=now)throw new WorkerError(401,'worker_project_fenced')
  return deadline
}
export function managedAcceptingPrompts(db:Database,connectionId:string,now=Date.now()) {
  const a=db.prepare('SELECT a.*,w.desired AS worker_desired FROM managed_agents a JOIN workers w ON w.id=a.worker_id WHERE connection_id=?').get(connectionId) as (AgentRow&{worker_desired:string})|undefined
  if(!a)return true
  try {managedAuthority(db,connectionId,now)}catch{return false}
  const rollout=db.prepare("SELECT 1 FROM runtime_rollouts WHERE worker_id=? AND phase NOT IN ('preflight','succeeded','failed')").get(a.worker_id)
  return !rollout && !['updating','rolling_back'].includes(a.runtime_update_state??'') && a.worker_desired==='active' && a.revision===a.grant_revision && !compactionHoldsRuntime(db,connectionId)
}
