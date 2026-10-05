import {agentStatusSchema,mergeAgentStatus,acknowledgedCatalogHash} from './agent-status.js'
import {recordTaskNotification} from './notifications.js'
import { managedAcceptingPrompts } from './managed-agents.js'
import { createHash, randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import { authenticateTerminalConnection, type TerminalConnection } from './terminal-pairing.js'
import { appendMessage, appendPart, updatePart, getPart, listParts } from './messages.js'
import { appendContent, checkAttachmentBudget, type MessageContent } from './attachments.js'

export const RELAY_LEASE_MS = 60_000
export const APPROVAL_TIMEOUT_MS = 5 * 60_000
export const LEGACY_RUN_TIMEOUT_MS = 10 * 60_000
export const MAX_REMOTE_RUN_MS = 24 * 60 * 60_000
export interface RelayHealth { status?:import('./agent-status.js').AgentStatus; transport?: 'websocket' | 'https'; agentWorking?: boolean; uploadFailures: number; retries: number; lastUploadAt: number | null; pendingCount: number; pendingBytes: number; pollLatencyMs: number }
function storedHealth(raw:string|null):RelayHealth|null{try{const value=raw?JSON.parse(raw):null;return value&&typeof value==='object'&&!Array.isArray(value)?value:null}catch{return null}}
function summaryHealth(raw:string|null){const health=storedHealth(raw);if(!health?.status)return health;const {catalog,...status}=health.status;return {...health,status}}
const lease = (h: Host, now: number) => ({ protocol: h.relay_protocol, agentStatusVersion:1, agentCatalogVersion:1, agentCatalogHash:acknowledgedCatalogHash(storedHealth(h.relay_health)?.status), serverNow: now, expiresAt: h.lease_expires_at, durationMs: RELAY_LEASE_MS })
const expired = (h: Host, now: number) => h.relay_protocol === 2 ? !h.lease_expires_at || now >= h.lease_expires_at || now < (h.last_seen_at ?? 0) : now - (h.last_seen_at ?? 0) > 30_000
import {RelayError} from '@multiterm/rue-db'
export {RelayError}
interface Host { relay_protocol: number; lease_expires_at: number | null; relay_health: string | null; id: string; owner_subject: string; session_id: string; name: string; settings_revision: number; remote_enabled: number; instance_id: string | null; last_seen_at: number | null; revoked_at: number | null; expires_at: number; activated_at: number | null }
export interface TerminalCommand { queue_position:number|null; queue_restored_at:number|null; claimed_at: number | null; started_at: number | null; lease_expires_at: number | null; hasAttachments?: boolean; id: string; connection_id: string; request_id: string; text: string; user_message_id: string; assistant_message_id: string; status: string; instance_id: string | null; version: number; result: string; created_at: number; updated_at: number }
const host = (db: Database, id: string) => db.prepare('SELECT * FROM terminal_connections WHERE id=?').get(id) as Host | undefined
const command = (db: Database, id: string, connection: string) => db.prepare('SELECT * FROM terminal_commands WHERE id=? AND connection_id=?').get(id, connection) as TerminalCommand | undefined
function nextQueuePosition(db:Database,id:string){return (db.prepare('SELECT COALESCE(MAX(COALESCE(queue_position,rowid)),0)+1 AS position FROM terminal_commands WHERE connection_id=?').get(id) as {position:number}).position}
function message(db: Database, sessionId: string, role: 'user' | 'assistant', text: string, origin: string, content?: MessageContent[]) {
  const id = `msg_${randomUUID()}`
  appendMessage(db, { id, sessionId, role, agent: 'pi-terminal', meta: { origin } })
  if (content) appendContent(db, sessionId, id, content)
  else appendPart(db, { id: `txt_${id}`, sessionId, messageId: id, type: 'text', payload: { text } })
  return id
}
function finish(db: Database, row: TerminalCommand, status: string, now: number) {
  db.prepare('UPDATE terminal_commands SET status=?,updated_at=? WHERE id=?').run(status, now, row.id)
  updatePart(db, `txt_${row.assistant_message_id}`, { text: row.result || `[Remote run ${status}]`, remoteStatus: status })
  const sessionId=host(db,row.connection_id)?.session_id
  if(sessionId)recordTaskNotification(db,sessionId,`terminal:${row.id}`,'task_failed',now)
}
function reconcile(db: Database, id: string, now: number) {
  return db.transaction(()=>{
    const h = host(db, id)
    if (!h) return
    const managed=db.prepare('SELECT a.desired,a.purged_at,w.revoked_at AS worker_revoked FROM managed_agents a JOIN workers w ON w.id=a.worker_id WHERE a.connection_id=?').get(id) as {desired:string;purged_at:number|null;worker_revoked:number|null}|undefined
    const explicitlyRevoked=Boolean(managed&&(managed.worker_revoked!==null||managed.desired==='destroyed'||managed.purged_at!==null))
    const rows = db.prepare("SELECT * FROM terminal_commands WHERE connection_id=? AND status IN ('queued','claimed','running')").all(id) as TerminalCommand[]
    for (const row of rows) {
      // Retention is not execution authority. Never-started work survives age,
      // disconnects and temporary credential expiry. Explicit disable/revoke
      // still cancels work; claims and runs remain fenced by their own clocks.
      if (h.revoked_at!==null || explicitlyRevoked || !h.remote_enabled || (row.status!=='queued'&&h.expires_at<=now)) finish(db,row,'cancelled',now)
      else if(row.status==='queued')continue
      else if(row.status==='claimed'&&now-(row.claimed_at??row.created_at)>=APPROVAL_TIMEOUT_MS)finish(db,row,'expired',now)
      else if(row.instance_id!==h.instance_id||expired(h,now)||(h.relay_protocol===2?!row.lease_expires_at||now>=row.lease_expires_at||(row.status==='running'&&now-(row.started_at??row.created_at)>=MAX_REMOTE_RUN_MS):now-(row.started_at??row.claimed_at??row.created_at)>=LEGACY_RUN_TIMEOUT_MS))finish(db,row,'interrupted',now)
    }
  }).immediate()
}
export function reconcileTerminalSession(db: Database, sessionId: string) {
  const c = db.prepare('SELECT id FROM terminal_connections WHERE session_id=?').get(sessionId) as { id: string } | undefined
  if (c) reconcile(db, c.id, Date.now())
}
export function remoteComputers(db: Database, owner: string, now = Date.now()) {
  const rows = db.prepare('SELECT * FROM terminal_connections WHERE owner_subject=? ORDER BY created_at DESC').all(owner) as Host[]
  return rows.map(h => {
    reconcile(db, h.id, now)
    const managed = db.prepare('SELECT id FROM managed_agents WHERE connection_id=?').get(h.id) as {id:string}|undefined
    const runs = db.prepare(`SELECT id,status,user_message_id AS userMessageId,created_at,updated_at,CASE WHEN status='expired' AND claimed_at IS NULL AND started_at IS NULL AND instance_id IS NULL AND lease_expires_at IS NULL AND version=0 AND result='' THEN 1 ELSE 0 END AS expiredBeforeDispatch FROM terminal_commands WHERE connection_id=? ORDER BY created_at DESC,rowid DESC LIMIT 10`).all(h.id) as Array<{id:string;status:string;userMessageId:string;created_at:number;updated_at:number;expiredBeforeDispatch:number}>
    return { id: h.id, managedAgentId: managed?.id, sessionId: h.session_id, ownerSubject: h.owner_subject, name: h.name || 'Paired computer', revision: h.settings_revision, remoteEnabled: Boolean(h.remote_enabled), serverNow: now, lastSeenAt: h.last_seen_at, expiresAt: h.expires_at, relayProtocol: h.relay_protocol, leaseExpiresAt: h.lease_expires_at, health: summaryHealth(h.relay_health), status: h.revoked_at ? 'revoked' : h.expires_at <= now ? 'expired' : !h.activated_at ? 'unconfirmed' : expired(h, now) ? 'offline' : 'online', runs:runs.map(run=>({...run,expiredBeforeDispatch:run.expiredBeforeDispatch===1})) }
  })
}
export function computerCatalog(db:Database,owner:string,id:string){
 const h=host(db,id);if(!h||h.owner_subject!==owner||h.revoked_at!==null)return undefined
 const parsed=agentStatusSchema.safeParse(storedHealth(h.relay_health)?.status),status=parsed.success?parsed.data:undefined
 return {ownerSubject:owner,connectionId:id,sessionId:h.session_id,piVersion:status?.piVersion??null,catalog:status?.catalog??null,catalogHash:acknowledgedCatalogHash(status)??null,observedAt:h.last_seen_at}
}
export function computerQueue(db: Database, owner: string, id: string, now = Date.now()) {
  const computer = host(db, id)
  if (!computer || computer.owner_subject !== owner) return undefined
  reconcile(db, id, now)
  // This is the live queue, not the last ten historical runs. A long-running
  // command must not disappear just because newer completed runs exist.
  return db.prepare("SELECT id,text,status,user_message_id,created_at,updated_at FROM terminal_commands WHERE connection_id=? AND status IN ('queued','claimed','running') ORDER BY COALESCE(queue_position,rowid),rowid").all(id) as Array<Pick<TerminalCommand, 'id' | 'text' | 'status' | 'user_message_id' | 'created_at' | 'updated_at'>>
}
export interface RecoverableQueuedMessage {id:string;text:string;user_message_id:string;created_at:number;updated_at:number}
const recoverableWhere=`r.connection_id=? AND r.status='expired' AND r.claimed_at IS NULL AND r.started_at IS NULL AND r.instance_id IS NULL AND r.lease_expires_at IS NULL AND r.version=0 AND r.result=''
 AND EXISTS(SELECT 1 FROM messages u WHERE u.id=r.user_message_id AND u.session_id=? AND u.role='user' AND EXISTS(SELECT 1 FROM parts p WHERE p.message_id=u.id AND p.session_id=u.session_id))
 AND EXISTS(SELECT 1 FROM messages a JOIN parts p ON p.message_id=a.id AND p.session_id=a.session_id AND p.id='txt_'||a.id WHERE a.id=r.assistant_message_id AND a.session_id=? AND a.role='assistant')`
export function recoverableQueuedCount(db:Database,owner:string,id:string){
 const h=host(db,id);if(!h||h.owner_subject!==owner)return undefined
 return (db.prepare(`SELECT count(*) AS n FROM terminal_commands r WHERE ${recoverableWhere}`).get(id,h.session_id,h.session_id) as {n:number}).n
}
export function recoverableQueuedMessages(db:Database,owner:string,id:string){
 const h=host(db,id);if(!h||h.owner_subject!==owner)return undefined
 return db.prepare(`SELECT r.id,r.text,r.user_message_id,r.created_at,r.updated_at FROM terminal_commands r WHERE ${recoverableWhere} ORDER BY r.created_at DESC,r.rowid DESC LIMIT 20`).all(id,h.session_id,h.session_id) as RecoverableQueuedMessage[]
}
/** Explicit owner recovery only. Never restore anything claimed, started, cancelled or uncertain. */
export function restoreExpiredQueuedPrompt(db:Database,owner:string,id:string,commandId:string,expectedSessionId:string,suppliedNow?:number){
 return db.transaction(()=>{
  const now=suppliedNow??Date.now(),h=host(db,id)
  if(!h||h.owner_subject!==owner)return undefined
  if(h.session_id!==expectedSessionId)throw new RelayError('queue_session_changed')
  const row=command(db,commandId,id);if(!row)return undefined
  if(row.queue_restored_at!=null&&row.status!=='expired')return {id:row.id,status:row.status,restored:true,changed:false}
  if(!db.prepare(`SELECT 1 FROM terminal_commands r WHERE r.id=? AND ${recoverableWhere}`).get(commandId,id,h.session_id,h.session_id))throw new RelayError('queue_request_not_recoverable')
  const managed=db.prepare('SELECT a.owner_subject,a.desired,a.purged_at,w.owner_subject AS worker_owner,w.revoked_at AS worker_revoked FROM managed_agents a LEFT JOIN workers w ON w.id=a.worker_id WHERE a.connection_id=?').get(id) as {owner_subject:string;desired:string;purged_at:number|null;worker_owner:string|null;worker_revoked:number|null}|undefined
  if(managed&&(managed.owner_subject!==owner||managed.worker_owner!==owner||managed.worker_revoked!==null||managed.desired==='destroyed'||managed.purged_at!==null))throw new RelayError('computer_not_ready')
  if(h.revoked_at!==null||!h.remote_enabled||h.activated_at===null||(h.expires_at<=now&&!managed))throw new RelayError('computer_not_ready')
  reconcile(db,id,now)
  const active=(db.prepare("SELECT count(*) AS n FROM terminal_commands WHERE connection_id=? AND status IN ('queued','claimed','running')").get(id) as {n:number}).n
  if(active>=10)throw new RelayError('computer_queue_full')
  db.prepare("UPDATE terminal_commands SET status='queued',queue_position=?,queue_restored_at=?,updated_at=? WHERE id=?").run(nextQueuePosition(db,id),now,now,row.id)
  updatePart(db,`txt_${row.assistant_message_id}`,{text:'[Waiting for computer]',remoteStatus:'queued',queueRestoredAt:now})
  db.prepare('UPDATE sessions SET updated_at=? WHERE id=?').run(now,h.session_id)
  // Replace the stale expiry outcome with the eventual outcome of this same request.
  db.prepare('DELETE FROM notifications WHERE owner_subject=? AND event_key=?').run(owner,`terminal:${row.id}`)
  return {id:row.id,status:'queued',restored:true,changed:true}
 }).immediate()
}
export function configureComputer(db: Database, owner: string, id: string, name: string, remoteEnabled: boolean, expectedRevision: number) {
  if (!db.prepare('UPDATE terminal_connections SET name=?,remote_enabled=?,settings_revision=settings_revision+1 WHERE id=? AND owner_subject=? AND settings_revision=? AND revoked_at IS NULL').run(name, Number(remoteEnabled), id, owner, expectedRevision).changes) throw new RelayError('computer_settings_conflict')
  reconcile(db, id, Date.now())
}
export function attachComputer(db: Database, token: string, id: string, instance: string, now = Date.now(), protocol = 1) {
  if (![1, 2].includes(protocol) || (protocol !== 2 && db.prepare('SELECT 1 FROM managed_agents WHERE connection_id=?').get(id))) throw new RelayError('relay_protocol_mismatch')
  return db.transaction(() => {
    const connection = authenticateTerminalConnection(db, token, id, now)
    const previous = host(db, id)!
    reconcile(db, id, now)
    if (previous.instance_id === instance && previous.relay_protocol !== protocol) throw new RelayError('relay_protocol_mismatch')
    // A fresh process cannot know whether the previous one dispatched a prompt.
    if (previous.instance_id !== instance) {
      for (const row of db.prepare("SELECT * FROM terminal_commands WHERE connection_id=? AND status IN ('claimed','running')").all(id) as TerminalCommand[]) finish(db, row, 'interrupted', now)
    }
    db.prepare('UPDATE terminal_connections SET instance_id=?,last_seen_at=?,relay_protocol=?,lease_expires_at=?,relay_health=NULL WHERE id=?').run(instance, now, protocol, protocol === 2 ? Math.min(now + RELAY_LEASE_MS, connection.expiresAt) : null, id)
    return { ...connection, lease: lease(host(db, id)!, now) }
  }).immediate()
}
function bound(db: Database, token: string, id: string, instance: string, now: number): TerminalConnection {
  const c = authenticateTerminalConnection(db, token, id, now)
  const h = host(db, id)!
  if (h.instance_id !== instance) throw new RelayError('computer_instance_changed')
  if (h.relay_protocol === 2 && expired(h, now)) throw new RelayError('computer_lease_expired')
  return c
}
export function validateRelaySocket(db: Database, token: string, id: string, instance: string, now = Date.now()) {
  const connection = bound(db, token, id, instance, now)
  if (host(db, id)!.relay_protocol !== 2) throw new RelayError('relay_protocol_mismatch')
  return connection
}
export function pollComputer(db: Database, token: string, id: string, instance: string, now = Date.now(), protocol = 1, health?: RelayHealth) {
  return db.transaction(() => {
    const c = bound(db, token, id, instance, now)
    const h = host(db, id)!
    if (h.relay_protocol !== protocol) throw new RelayError('relay_protocol_mismatch')
    reconcile(db, id, now) // Never renew an already-expired command.
    const expiresAt = Math.min(now + RELAY_LEASE_MS, c.expiresAt)
    db.prepare('UPDATE terminal_connections SET last_seen_at=?,lease_expires_at=?,relay_health=? WHERE id=?').run(now, protocol === 2 ? expiresAt : null, health ? JSON.stringify(health.status?{...health,status:mergeAgentStatus(storedHealth(h.relay_health)?.status,health.status)}:health) : null, id)
    if (protocol === 2) db.prepare("UPDATE terminal_commands SET lease_expires_at=MIN(?, CASE WHEN status='running' THEN COALESCE(started_at,created_at)+? ELSE COALESCE(claimed_at,created_at)+? END) WHERE connection_id=? AND instance_id=? AND status IN ('claimed','running')").run(expiresAt, MAX_REMOTE_RUN_MS, APPROVAL_TIMEOUT_MS, id, instance)
    return { connection: c, lease: lease(host(db, id)!, now), remoteEnabled: Boolean(host(db, id)!.remote_enabled), commands: (db.prepare("SELECT * FROM terminal_commands WHERE connection_id=? AND status IN ('queued','claimed','running') ORDER BY CASE WHEN status='queued' THEN 1 ELSE 0 END,COALESCE(queue_position,rowid),rowid LIMIT 10").all(id) as TerminalCommand[]).filter(row => row.status !== 'queued' || managedAcceptingPrompts(db, id, now)).map(row => ({ ...row, hasAttachments: Boolean(db.prepare("SELECT 1 FROM parts WHERE message_id=? AND type='file' LIMIT 1").get(row.user_message_id)) })) }
  }).immediate()
}
export function enqueueTerminalPrompt(db: Database, owner: string, sessionId: string, requestId: string, text: string, now = Date.now(), content?: MessageContent[]) {
  return db.transaction(() => {
    const h = db.prepare('SELECT * FROM terminal_connections WHERE session_id=? AND owner_subject=?').get(sessionId, owner) as Host | undefined
    if (!h) throw new RelayError('terminal_transport_unavailable')
    reconcile(db, h.id, now)
    const existing = db.prepare('SELECT * FROM terminal_commands WHERE connection_id=? AND request_id=?').get(h.id, requestId) as TerminalCommand | undefined
    if (existing) {
      const previous = listParts(db, existing.user_message_id).map(p => ({ type: p.type, ...p.payload }))
      if (existing.text !== text || JSON.stringify(previous) !== JSON.stringify(content ?? [{ type: 'text', text }])) throw new RelayError('request_id_conflict')
      return existing
    }
    if (!managedAcceptingPrompts(db, h.id, now)) throw new RelayError('computer_not_ready')
    checkAttachmentBudget(db, owner, content)
    if (h.revoked_at || h.expires_at <= now || !h.activated_at || !h.remote_enabled || !h.instance_id || expired(h, now)) throw new RelayError('computer_not_ready')
    const count = db.prepare("SELECT count(*) AS n FROM terminal_commands WHERE connection_id=? AND status IN ('queued','claimed','running')").get(h.id) as { n: number }
    if (count.n >= 10) throw new RelayError('computer_queue_full')
    const id = randomUUID(), user = message(db, sessionId, 'user', text, 'dashboard', content), assistant = message(db, sessionId, 'assistant', '[Awaiting approval on computer]', 'computer')
    updatePart(db, `txt_${assistant}`, { text: '[Waiting for computer]', remoteStatus: 'queued' })
    db.prepare("INSERT INTO terminal_commands(id,connection_id,request_id,text,user_message_id,assistant_message_id,status,created_at,updated_at,queue_position) VALUES(?,?,?,?,?,?,'queued',?,?,?)").run(id,h.id,requestId,text,user,assistant,now,now,nextQueuePosition(db,h.id))
    return command(db, id, h.id)!
  }).immediate()
}
export function transitionCommand(db: Database, token: string, id: string, instance: string, commandId: string, action: 'claim' | 'start' | 'reject', now = Date.now()) {
  return db.transaction(() => {
    bound(db, token, id, instance, now); reconcile(db, id, now)
    const row = command(db, commandId, id)
    if (!row || !host(db, id)!.remote_enabled) throw new RelayError('command_unavailable')
    const next = action === 'claim' ? 'claimed' : action === 'start' ? 'running' : 'rejected'
    if (row.instance_id === instance && row.status === next) return row
    if (action !== 'reject' && !managedAcceptingPrompts(db, id, now)) throw new RelayError('command_unavailable')
    if (action === 'claim') {
      if (row.status !== 'queued' || db.prepare("SELECT id FROM terminal_commands WHERE connection_id=? AND status IN ('claimed','running')").get(id)) throw new RelayError('computer_busy')
      const first=db.prepare("SELECT id FROM terminal_commands WHERE connection_id=? AND status='queued' ORDER BY COALESCE(queue_position,rowid),rowid LIMIT 1").get(id) as {id:string}|undefined
      if(first?.id!==row.id)throw new RelayError('command_out_of_order')
    } else if (row.status !== 'claimed' || row.instance_id !== instance) throw new RelayError('command_unavailable')
    db.prepare('UPDATE terminal_commands SET status=?,instance_id=?,updated_at=? WHERE id=?').run(next, instance, now, row.id)
    const h = host(db, id)!
    if (action === 'claim') db.prepare('UPDATE terminal_commands SET claimed_at=?,lease_expires_at=? WHERE id=?').run(now, h.lease_expires_at, row.id)
    if (action === 'start') db.prepare('UPDATE terminal_commands SET started_at=?,lease_expires_at=? WHERE id=?').run(now, h.lease_expires_at, row.id)
    if (next === 'rejected') finish(db, row, next, now)
    else updatePart(db, `txt_${row.assistant_message_id}`, { text: next === 'running' ? '[Working on computer]' : '[Awaiting local approval]', remoteStatus: next })
    return command(db, commandId, id)!
  }).immediate()
}
export function terminalCommandInput(db: Database, token: string, id: string, instance: string, commandId: string, now = Date.now()) {
  bound(db, token, id, instance, now); reconcile(db, id, now)
  const row = command(db, commandId, id)
  if (!row || row.instance_id !== instance || row.status !== 'running' || !host(db, id)!.remote_enabled) throw new RelayError('command_unavailable')
  return listParts(db, row.user_message_id).map(part => ({ type: part.type, ...part.payload }))
}
export function publishCommand(db: Database, token: string, id: string, instance: string, commandId: string, version: number, text: string, status: 'running' | 'completed' | 'failed', now = Date.now(), transcript = false) {
  return db.transaction(() => {
    const c = bound(db, token, id, instance, now); reconcile(db, id, now)
    const row = command(db, commandId, id)
    if (!row || row.instance_id !== instance) throw new RelayError('command_unavailable')
    if (row.version === version && row.result === text && row.status === status) return row
    if (row.status !== 'running' || version <= row.version || !host(db, id)!.remote_enabled) throw new RelayError('command_revision_conflict')
    db.prepare('UPDATE terminal_commands SET version=?,result=?,status=?,updated_at=? WHERE id=?').run(version, text, status, now, row.id)
    updatePart(db, `txt_${row.assistant_message_id}`, { text: text || (status === 'failed' ? '[Remote run failed]' : '…'), remoteStatus: status, ...(transcript ? { superseded: status !== 'failed' } : {}) })
    db.prepare('UPDATE sessions SET updated_at=? WHERE id=?').run(now, c.sessionId)
    if(status==='completed'||status==='failed')recordTaskNotification(db,c.sessionId,`terminal:${row.id}`,status==='completed'?'task_completed':'task_failed',now)
    return command(db, commandId, id)!
  }).immediate()
}
/** Read-only delivery evidence for this credential's own recent mirrored messages. */
export function terminalMirrorReceipts(db: Database, token: string, id: string, now = Date.now()) {
  const connection = authenticateTerminalConnection(db, token, id, now)
  const rows = db.prepare(`SELECT t.event_id, t.message_id, t.text, p.payload
    FROM terminal_mirrors t JOIN messages m ON m.id=t.message_id
    JOIN parts p ON p.id='txt_' || t.message_id
    WHERE t.connection_id=? AND m.session_id=? ORDER BY m.seq DESC LIMIT 128`)
    .all(id, connection.sessionId) as { event_id: string; message_id: string; text: string; payload: string }[]
  return { receipts: rows.map(row => {
    const payload = JSON.parse(row.payload)
    return { eventId: row.event_id, messageId: row.message_id, sha256: createHash('sha256').update(row.text).digest('hex'), version: payload.mirrorVersion ?? null, final: payload.mirrorFinal === true }
  }) }
}

export function mirrorTerminalText(db: Database, token: string, id: string, instance: string, eventId: string, role: 'user' | 'assistant', text: string, now = Date.now(), snapshot?: { version: number; final: boolean; outcome?:'failed'|'interrupted'; reasoning?: { id: string; chunk: number }; tool?: { id: string; name: string; status: string; chunk: number } }) {
  return db.transaction(() => {
    const c = bound(db, token, id, instance, now)
    if(snapshot?.outcome&&(!snapshot.final||role!=='assistant'))throw new RelayError('mirror_conflict')
    if (snapshot?.reasoning && (role !== 'assistant' || snapshot.tool)) throw new RelayError('mirror_conflict')
    const existing = db.prepare('SELECT * FROM terminal_mirrors WHERE connection_id=? AND event_id=?').get(id, eventId) as { message_id: string; role: string; text: string } | undefined
    const payload = { text, ...(snapshot ? { mirrorVersion: snapshot.version, mirrorFinal: snapshot.final, remoteStatus: snapshot.outcome??(snapshot.final ? 'completed' : 'running'), ...(snapshot.outcome?{mirrorOutcome:snapshot.outcome}:{}), ...(snapshot.tool ? { tool: snapshot.tool } : {}), ...(snapshot.reasoning ? { reasoning: snapshot.reasoning } : {}) } : {}) }
    if (existing) {
      if (existing.role !== role) throw new RelayError('mirror_conflict')
      const previous = getPart(db, `txt_${existing.message_id}`)?.payload
      if (JSON.stringify(previous?.reasoning) !== JSON.stringify(snapshot?.reasoning)) throw new RelayError('mirror_conflict')
      if (snapshot && typeof previous?.mirrorVersion === 'number') {
        if (snapshot.version < previous.mirrorVersion) return { sessionId: c.sessionId, messageId: existing.message_id }
        if (snapshot.version === previous.mirrorVersion) {
          if (existing.text !== text || previous.mirrorFinal !== snapshot.final || previous.mirrorOutcome!==snapshot.outcome || JSON.stringify(previous.tool) !== JSON.stringify(snapshot.tool)) throw new RelayError('mirror_conflict')
        } else {
          if (previous.mirrorFinal) throw new RelayError('mirror_conflict')
          updatePart(db, `txt_${existing.message_id}`, payload)
          db.prepare('UPDATE terminal_mirrors SET text=? WHERE connection_id=? AND event_id=?').run(text, id, eventId)
          db.prepare('UPDATE sessions SET updated_at=? WHERE id=?').run(now, c.sessionId)
        }
      } else if (snapshot || previous?.mirrorVersion !== undefined || existing.text !== text) throw new RelayError('mirror_conflict')
      return { sessionId: c.sessionId, messageId: existing.message_id }
    }
    const mid = message(db, c.sessionId, role, text, 'computer')
    if (snapshot) updatePart(db, `txt_${mid}`, payload)
    if (snapshot?.reasoning) db.prepare("UPDATE parts SET type='reasoning' WHERE id=?").run(`txt_${mid}`)
    db.prepare('INSERT INTO terminal_mirrors VALUES(?,?,?,?,?)').run(id, eventId, mid, role, text)
    return { sessionId: c.sessionId, messageId: mid }
  }).immediate()
}
