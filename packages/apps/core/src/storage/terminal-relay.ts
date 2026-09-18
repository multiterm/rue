import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import { authenticateTerminalConnection, type TerminalConnection } from './terminal-pairing.js'
import { appendMessage, appendPart, updatePart } from './messages.js'

export class RelayError extends Error { constructor(readonly code: string) { super(code) } }
interface Host { id: string; owner_subject: string; session_id: string; name: string; settings_revision: number; remote_enabled: number; instance_id: string | null; last_seen_at: number | null; revoked_at: number | null; expires_at: number; activated_at: number | null }
export interface TerminalCommand { id: string; connection_id: string; request_id: string; text: string; user_message_id: string; assistant_message_id: string; status: string; instance_id: string | null; version: number; result: string; created_at: number; updated_at: number }
const host = (db: Database, id: string) => db.prepare('SELECT * FROM terminal_connections WHERE id=?').get(id) as Host | undefined
const command = (db: Database, id: string, connection: string) => db.prepare('SELECT * FROM terminal_commands WHERE id=? AND connection_id=?').get(id, connection) as TerminalCommand | undefined
function message(db: Database, sessionId: string, role: 'user' | 'assistant', text: string, origin: string) {
  const id = `msg_${randomUUID()}`
  appendMessage(db, { id, sessionId, role, agent: 'pi-terminal', meta: { origin } })
  appendPart(db, { id: `txt_${id}`, sessionId, messageId: id, type: 'text', payload: { text } })
  return id
}
function finish(db: Database, row: TerminalCommand, status: string, now: number) {
  db.prepare('UPDATE terminal_commands SET status=?,updated_at=? WHERE id=?').run(status, now, row.id)
  updatePart(db, `txt_${row.assistant_message_id}`, { text: row.result || `[Remote run ${status}]`, remoteStatus: status })
}
function reconcile(db: Database, id: string, now: number) {
  const h = host(db, id)
  if (!h) return
  const rows = db.prepare("SELECT * FROM terminal_commands WHERE connection_id=? AND status IN ('queued','claimed','running')").all(id) as TerminalCommand[]
  for (const row of rows) {
    if (h.revoked_at || h.expires_at <= now || !h.remote_enabled) finish(db, row, 'cancelled', now)
    else if (['queued','claimed'].includes(row.status) && now - row.created_at > 300_000) finish(db, row, 'expired', now)
    else if (row.status !== 'queued' && (now - row.created_at > 600_000 || now - (h.last_seen_at ?? 0) > 30_000 || row.instance_id !== h.instance_id)) finish(db, row, 'interrupted', now)
  }
}
export function reconcileTerminalSession(db: Database, sessionId: string) {
  const c = db.prepare('SELECT id FROM terminal_connections WHERE session_id=?').get(sessionId) as { id: string } | undefined
  if (c) reconcile(db, c.id, Date.now())
}
export function remoteComputers(db: Database, owner: string, now = Date.now()) {
  const rows = db.prepare('SELECT * FROM terminal_connections WHERE owner_subject=? ORDER BY created_at DESC').all(owner) as Host[]
  return rows.map(h => {
    reconcile(db, h.id, now)
    const runs = db.prepare('SELECT id,status,created_at,updated_at FROM terminal_commands WHERE connection_id=? ORDER BY created_at DESC LIMIT 10').all(h.id)
    return { id: h.id, sessionId: h.session_id, ownerSubject: h.owner_subject, name: h.name || 'Paired computer', revision: h.settings_revision, remoteEnabled: Boolean(h.remote_enabled), lastSeenAt: h.last_seen_at, expiresAt: h.expires_at, status: h.revoked_at ? 'revoked' : h.expires_at <= now ? 'expired' : !h.activated_at ? 'unconfirmed' : now - (h.last_seen_at ?? 0) > 30_000 ? 'offline' : 'online', runs }
  })
}
export function configureComputer(db: Database, owner: string, id: string, name: string, remoteEnabled: boolean, expectedRevision: number) {
  if (!db.prepare('UPDATE terminal_connections SET name=?,remote_enabled=?,settings_revision=settings_revision+1 WHERE id=? AND owner_subject=? AND settings_revision=? AND revoked_at IS NULL').run(name, Number(remoteEnabled), id, owner, expectedRevision).changes) throw new RelayError('computer_settings_conflict')
  reconcile(db, id, Date.now())
}
export function attachComputer(db: Database, token: string, id: string, instance: string, now = Date.now()) {
  return db.transaction(() => {
    const connection = authenticateTerminalConnection(db, token, id, now)
    const previous = host(db, id)!
    // A fresh process cannot know whether the previous one dispatched a prompt.
    if (previous.instance_id !== instance) {
      for (const row of db.prepare("SELECT * FROM terminal_commands WHERE connection_id=? AND status IN ('claimed','running')").all(id) as TerminalCommand[]) finish(db, row, 'interrupted', now)
    }
    db.prepare('UPDATE terminal_connections SET instance_id=?,last_seen_at=? WHERE id=?').run(instance, now, id)
    return connection
  }).immediate()
}
function bound(db: Database, token: string, id: string, instance: string, now: number): TerminalConnection {
  const c = authenticateTerminalConnection(db, token, id, now)
  if (host(db, id)?.instance_id !== instance) throw new RelayError('computer_instance_changed')
  return c
}
export function pollComputer(db: Database, token: string, id: string, instance: string, now = Date.now()) {
  return db.transaction(() => {
    const c = bound(db, token, id, instance, now)
    reconcile(db, id, now) // Check the old heartbeat before advancing it.
    db.prepare('UPDATE terminal_connections SET last_seen_at=? WHERE id=?').run(now, id)
    return { connection: c, remoteEnabled: Boolean(host(db, id)!.remote_enabled), commands: db.prepare("SELECT * FROM terminal_commands WHERE connection_id=? AND status IN ('queued','claimed','running') ORDER BY created_at LIMIT 10").all(id) as TerminalCommand[] }
  }).immediate()
}
export function enqueueTerminalPrompt(db: Database, owner: string, sessionId: string, requestId: string, text: string, now = Date.now()) {
  return db.transaction(() => {
    const h = db.prepare('SELECT * FROM terminal_connections WHERE session_id=? AND owner_subject=?').get(sessionId, owner) as Host | undefined
    if (!h) throw new RelayError('terminal_transport_unavailable')
    reconcile(db, h.id, now)
    const existing = db.prepare('SELECT * FROM terminal_commands WHERE connection_id=? AND request_id=?').get(h.id, requestId) as TerminalCommand | undefined
    if (existing) { if (existing.text !== text) throw new RelayError('request_id_conflict'); return existing }
    if (h.revoked_at || h.expires_at <= now || !h.activated_at || !h.remote_enabled || !h.instance_id || now - (h.last_seen_at ?? 0) > 30_000) throw new RelayError('computer_not_ready')
    const count = db.prepare("SELECT count(*) AS n FROM terminal_commands WHERE connection_id=? AND status IN ('queued','claimed','running')").get(h.id) as { n: number }
    if (count.n >= 10) throw new RelayError('computer_queue_full')
    const id = randomUUID(), user = message(db, sessionId, 'user', text, 'dashboard'), assistant = message(db, sessionId, 'assistant', '[Awaiting approval on computer]', 'computer')
    db.prepare("INSERT INTO terminal_commands(id,connection_id,request_id,text,user_message_id,assistant_message_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'queued',?,?)").run(id, h.id, requestId, text, user, assistant, now, now)
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
    if (action === 'claim') {
      if (row.status !== 'queued' || db.prepare("SELECT id FROM terminal_commands WHERE connection_id=? AND status IN ('claimed','running')").get(id)) throw new RelayError('computer_busy')
    } else if (row.status !== 'claimed' || row.instance_id !== instance) throw new RelayError('command_unavailable')
    db.prepare('UPDATE terminal_commands SET status=?,instance_id=?,updated_at=? WHERE id=?').run(next, instance, now, row.id)
    if (next === 'rejected') finish(db, row, next, now)
    return command(db, commandId, id)!
  }).immediate()
}
export function publishCommand(db: Database, token: string, id: string, instance: string, commandId: string, version: number, text: string, status: 'running' | 'completed' | 'failed', now = Date.now()) {
  return db.transaction(() => {
    const c = bound(db, token, id, instance, now); reconcile(db, id, now)
    const row = command(db, commandId, id)
    if (!row || row.instance_id !== instance) throw new RelayError('command_unavailable')
    if (row.version === version && row.result === text && row.status === status) return row
    if (row.status !== 'running' || version <= row.version || !host(db, id)!.remote_enabled) throw new RelayError('command_revision_conflict')
    db.prepare('UPDATE terminal_commands SET version=?,result=?,status=?,updated_at=? WHERE id=?').run(version, text, status, now, row.id)
    updatePart(db, `txt_${row.assistant_message_id}`, { text: text || (status === 'failed' ? '[Remote run failed]' : '…'), remoteStatus: status })
    db.prepare('UPDATE sessions SET updated_at=? WHERE id=?').run(now, c.sessionId)
    return command(db, commandId, id)!
  }).immediate()
}
export function mirrorTerminalText(db: Database, token: string, id: string, instance: string, eventId: string, role: 'user' | 'assistant', text: string, now = Date.now()) {
  return db.transaction(() => {
    const c = bound(db, token, id, instance, now)
    const existing = db.prepare('SELECT * FROM terminal_mirrors WHERE connection_id=? AND event_id=?').get(id, eventId) as { message_id: string; role: string; text: string } | undefined
    if (existing) { if (existing.role !== role || existing.text !== text) throw new RelayError('mirror_conflict'); return { sessionId: c.sessionId, messageId: existing.message_id } }
    const mid = message(db, c.sessionId, role, text, 'computer')
    db.prepare('INSERT INTO terminal_mirrors VALUES(?,?,?,?,?)').run(id, eventId, mid, role, text)
    return { sessionId: c.sessionId, messageId: mid }
  }).immediate()
}
