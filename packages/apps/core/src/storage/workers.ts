import {projectBinding,projectDeadline} from './projects.js'
import { clearProviderKeyGrants } from './provider-keys.js'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Database } from 'better-sqlite3'
import type { RueWorker, RueWorkerAction, RueWorkerHealth, RueWorkerLease } from '@multiterm/rue-sdk'

export const WORKER_LEASE_MS = 60_000
export const workerIdSchema = z.string().uuid()
export const workerHealthSchema = z.object({
  version: z.string().min(1).max(40).regex(/^[a-zA-Z0-9.+_-]+$/),
  platform: z.string().min(1).max(32).regex(/^[a-zA-Z0-9_-]+$/),
  architecture: z.string().min(1).max(32).regex(/^[a-zA-Z0-9_-]+$/),
  dockerAvailable: z.boolean(), acceptingWork: z.boolean(),
  runtimeImage:z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
  runtimeReleases:z.array(z.object({image:z.string().regex(/^sha256:[a-f0-9]{64}$/),piVersion:z.string().regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}$/),createdAt:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)}).strict()).max(8).optional(),
  resources:z.object({freeDiskBytes:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),minimumFreeDiskBytes:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),blockedBy:z.enum(['disk_pressure','memory_pressure','resource_probe_failed']).nullable()}).strict().optional(),
  freeMemoryBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  cpus: z.number().int().min(1).max(65536),
  capabilities: z.array(z.enum(['host-health-v1','managed-agents-v1','managed-purge-v1','managed-mcp-v1','managed-compact-v1','managed-codex-v1','managed-filesystem-v1','managed-filesystem-v2','managed-runtime-rollout-v1','managed-dynamic-providers-v1','managed-agent-upgrade-v1'])).max(11),
}).strict()
import {WorkerError} from '@multiterm/rue-db'
export {WorkerError}
interface WorkerRow {
  id: string; owner_subject: string; name: string; token_hash: string; enrollment_request_id: string
  desired: 'active' | 'draining'; revision: number; generation: number; instance_id: string | null
  lease_expires_at: number | null; last_seen_at: number | null; health: string | null
  revoked_at: number | null; created_at: number; managed_agent_count?: number; project_binding_id:string|null
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const newSecret = () => `rue_worker_${randomBytes(32).toString('base64url')}`
const row = (db: Database, id: string) => db.prepare("SELECT w.*,(SELECT count(*) FROM managed_agents a WHERE a.worker_id=w.id AND a.desired!='destroyed') AS managed_agent_count FROM workers w WHERE id=?").get(id) as WorkerRow | undefined
function publicWorker(w: WorkerRow, now: number): RueWorker {
  return { id: w.id, ...(w.project_binding_id?{keyAuthorityId:w.project_binding_id}:{}), ownerSubject: w.owner_subject, name: w.name, managedAgentCount: w.managed_agent_count ?? 0, desired: w.desired, revision: w.revision,
    generation: w.generation, createdAt: w.created_at, serverNow: now, lastSeenAt: w.last_seen_at,
    leaseExpiresAt: w.lease_expires_at, status: w.revoked_at !== null ? 'revoked' : w.last_seen_at === null ? 'unconfirmed' : (w.lease_expires_at ?? 0) <= now || now < w.last_seen_at ? 'offline' : 'online',
    health: w.health ? JSON.parse(w.health) : null }
}
function audit(db: Database, w: WorkerRow, action: string, now: number) {
  db.prepare('INSERT INTO worker_audit VALUES(?,?,?,?,?)').run(randomUUID(), w.id, action, w.revision, now)
}
export function listWorkers(db: Database, owner: string, now = Date.now()) {
  return (db.prepare("SELECT w.*,(SELECT count(*) FROM managed_agents a WHERE a.worker_id=w.id AND a.desired!='destroyed') AS managed_agent_count FROM workers w WHERE owner_subject=? ORDER BY created_at DESC,id").all(owner) as WorkerRow[]).map(w => publicWorker(w, now))
}
export function createWorker(db: Database, owner: string, name: string, requestId: string, now = Date.now(),projectBindingId?:string) {
  return db.transaction(() => {
    if(projectBindingId&&(projectBinding(db,projectBindingId)?.owner_subject!==owner||projectDeadline(db,projectBindingId,now)<=now))throw new WorkerError(401,'worker_project_fenced')
    const existing = db.prepare('SELECT * FROM workers WHERE owner_subject=? AND enrollment_request_id=?').get(owner, requestId) as WorkerRow | undefined
    if (existing) {
      if (existing.name !== name || (existing.project_binding_id??undefined)!==projectBindingId) throw new WorkerError(409, 'worker_request_conflict')
      // An ambiguous creation never enrolls another host. Lost secrets require rotation.
      return { worker: publicWorker(existing, now) }
    }
    const count = db.prepare('SELECT count(*) AS n FROM workers WHERE owner_subject=?').get(owner) as { n: number }
    if (count.n >= 100) throw new WorkerError(429, 'worker_limit')
    const id = randomUUID(), secret = newSecret()
    db.prepare('INSERT INTO workers(id,owner_subject,name,token_hash,enrollment_request_id,created_at,project_binding_id) VALUES(?,?,?,?,?,?,?)').run(id, owner, name, hash(secret), requestId, now,projectBindingId??null)
    const w = row(db, id)!; audit(db, w, 'enroll', now)
    return { worker: publicWorker(w, now), secret }
  }).immediate()
}
export function changeWorker(db: Database, owner: string, id: string, action: RueWorkerAction, revision: number, now = Date.now()) {
  return db.transaction(() => {
    const w = row(db, id)
    if (!w || w.owner_subject !== owner) throw new WorkerError(404, 'worker_not_found')
    if (w.revision !== revision || w.revoked_at !== null) throw new WorkerError(409, 'worker_revision_conflict')
    const secret = action === 'rotate' ? newSecret() : undefined
    if (action === 'rotate' || action === 'revoke') {
      // Immediate rotation: old streams and all their leases are fenced, no overlap.
      db.prepare('UPDATE workers SET token_hash=?,revoked_at=?,instance_id=NULL,lease_expires_at=NULL,health=NULL,generation=generation+1,revision=revision+1 WHERE id=?')
        .run(secret ? hash(secret) : w.token_hash, action === 'revoke' ? now : null, id)
    } else db.prepare('UPDATE workers SET desired=?,revision=revision+1 WHERE id=?').run(action === 'drain' ? 'draining' : 'active', id)
    if (action === 'revoke') clearProviderKeyGrants(db, owner, { type: 'worker', id })
    const next = row(db, id)!; audit(db, next, action, now)
    return { worker: publicWorker(next, now), ...(secret ? { secret } : {}) }
  }).immediate()
}
function credential(db: Database, id: string, secret: string) {
  if (!/^rue_worker_[A-Za-z0-9_-]{43}$/.test(secret)) throw new WorkerError(401, 'invalid_worker_credential')
  const w = db.prepare('SELECT * FROM workers WHERE id=? AND token_hash=? AND revoked_at IS NULL').get(id, hash(secret)) as WorkerRow | undefined
  if (!w) throw new WorkerError(401, 'invalid_worker_credential')
  return w
}
export function workerProjectBinding(db:Database,id:string,secret:string){return credential(db,id,secret).project_binding_id}
function lease(w: WorkerRow, now: number): RueWorkerLease {
  return { protocol: 1, runtimeReleaseVersion:1, agentUpgradeVersion:1, resourceHealthVersion:1, generation: w.generation, serverNow: now, expiresAt: w.lease_expires_at!, worker: publicWorker(w, now) }
}
export function connectWorker(db: Database, id: string, secret: string, instance: string, now = Date.now()) {
  return db.transaction(() => {
    const w = credential(db, id, secret)
    const expiresAt=Math.min(now+WORKER_LEASE_MS,projectDeadline(db,w.project_binding_id,now))
    if(expiresAt<=now)throw new WorkerError(401,'worker_project_fenced')
    const live = (w.lease_expires_at ?? 0) > now && w.last_seen_at !== null && now >= w.last_seen_at
    if (live && w.instance_id !== instance) throw new WorkerError(409, 'worker_already_connected')
    const generation = w.generation + (live && w.instance_id === instance ? 0 : 1)
    db.prepare('UPDATE workers SET instance_id=?,generation=?,last_seen_at=?,lease_expires_at=?,health=NULL WHERE id=?').run(instance, generation, now, expiresAt, id)
    return lease(row(db, id)!, now)
  }).immediate()
}
export function validateWorker(db: Database, id: string, secret: string, instance: string, generation: number, now = Date.now()) {
  const w = credential(db, id, secret)
  if(projectDeadline(db,w.project_binding_id,now)<=now)throw new WorkerError(401,'worker_project_fenced')
  if (w.instance_id !== instance || w.generation !== generation || !w.lease_expires_at || w.lease_expires_at <= now || w.last_seen_at === null || now < w.last_seen_at) throw new WorkerError(409, 'worker_session_fenced')
  return w
}
export function heartbeatWorker(db: Database, id: string, secret: string, instance: string, generation: number, health: RueWorkerHealth, now = Date.now()) {
  return db.transaction(() => {
    const w = validateWorker(db, id, secret, instance, generation, now)
    const safe = workerHealthSchema.parse(health)
    safe.acceptingWork = safe.acceptingWork && w.desired === 'active' && safe.dockerAvailable
    db.prepare('UPDATE workers SET last_seen_at=?,lease_expires_at=?,health=? WHERE id=?').run(now, Math.min(now+WORKER_LEASE_MS,projectDeadline(db,w.project_binding_id,now)), JSON.stringify(safe), id)
    return lease(row(db, id)!, now)
  }).immediate()
}
