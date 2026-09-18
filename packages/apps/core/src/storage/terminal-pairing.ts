import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { Database } from 'better-sqlite3'
import { createSession } from './sessions.js'

const PAIR_TTL = 5 * 60_000
const TOKEN_TTL = 7 * 24 * 60 * 60_000
const MAX_ATTEMPTS = 5
const MAX_PENDING = 100
const opaqueId = () => randomBytes(24).toString('base64url')
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const challengeSchema = z.string().length(64).regex(/^[a-f0-9]{64}$/)
const verifierSchema = z.string().length(43).regex(/^[A-Za-z0-9_-]{43}$/)
const subjectSchema = z.string().min(1).max(512)
const sessionSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
const nameSchema = z.string().trim().min(1).max(60).regex(/^[^\x00-\x1f\x7f]*$/)

export class TerminalPairingError extends Error {
  constructor(readonly code: 'invalid_request' | 'pairing_unavailable' | 'already_approved' | 'invalid_pairing' | 'invalid_terminal_credential') { super(code) }
}
interface PairingRow {
  id: string; verifier_hash: string; pi_session_id: string; expires_at: number
  owner_subject: string | null; bot_name: string | null; code_hash: string | null
  attempts: number; consumed_at: number | null
}
interface ConnectionRow {
  id: string; owner_subject: string; session_id: string; pi_session_id: string
  token_hash: string; expires_at: number; activated_at: number | null
  revoked_at: number | null; created_at: number
}
export interface TerminalConnection {
  id: string; ownerSubject: string; sessionId: string; piSessionId: string
  expiresAt: number; activatedAt: number | null; revokedAt: number | null
}
function publicConnection(row: ConnectionRow): TerminalConnection {
  return { id: row.id, ownerSubject: row.owner_subject, sessionId: row.session_id, piSessionId: row.pi_session_id,
    expiresAt: row.expires_at, activatedAt: row.activated_at, revokedAt: row.revoked_at }
}
function equalHash(left: string, right: string): boolean {
  return left.length === 64 && right.length === 64 && timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
}
function pending(db: Database, id: string, now: number): PairingRow | undefined {
  return db.prepare('SELECT * FROM terminal_pairing_requests WHERE id=? AND expires_at>? AND consumed_at IS NULL AND attempts<?')
    .get(id, now, MAX_ATTEMPTS) as PairingRow | undefined
}

/** The client retains a random 32-byte verifier. Only its SHA-256 challenge reaches this endpoint. */
export function requestTerminalPairing(db: Database, challenge: string, piSessionId: string, now = Date.now()) {
  if (!challengeSchema.safeParse(challenge).success || !sessionSchema.safeParse(piSessionId).success) throw new TerminalPairingError('invalid_request')
  return db.transaction(() => {
    // Removing terminal requests cannot revive a code; absent requests fail closed.
    db.prepare('DELETE FROM terminal_pairing_requests WHERE expires_at<=? OR consumed_at IS NOT NULL OR attempts>=?').run(now, MAX_ATTEMPTS)
    const { n } = db.prepare('SELECT count(*) AS n FROM terminal_pairing_requests WHERE expires_at>? AND consumed_at IS NULL AND attempts<?').get(now, MAX_ATTEMPTS) as { n: number }
    if (n >= MAX_PENDING) throw new TerminalPairingError('pairing_unavailable')
    const id = opaqueId(), expiresAt = now + PAIR_TTL
    db.prepare('INSERT INTO terminal_pairing_requests(id,verifier_hash,pi_session_id,expires_at) VALUES(?,?,?,?)').run(id, challenge, piSessionId, expiresAt)
    return { requestId: id, expiresAt }
  }).immediate()
}

/** Must be called only after authenticated browser approval; identity never comes from the request body. */
export function approveTerminalPairing(db: Database, requestId: string, ownerSubject: string, botName: string, now = Date.now()) {
  const name = nameSchema.safeParse(botName)
  if (!name.success || !subjectSchema.safeParse(ownerSubject).success) throw new TerminalPairingError('invalid_request')
  return db.transaction(() => {
    const row = pending(db, requestId, now)
    if (!row) throw new TerminalPairingError('invalid_pairing')
    if (row.owner_subject !== null) throw new TerminalPairingError('already_approved')
    const code = String(randomInt(0, 1_000_000_000_000)).padStart(12, '0')
    db.prepare('UPDATE terminal_pairing_requests SET owner_subject=?,bot_name=?,code_hash=? WHERE id=?')
      .run(ownerSubject, name.data, hash(`${requestId}:${code}`), requestId)
    return { code, expiresAt: row.expires_at, ownerSubject }
  }).immediate()
}

/** A correct OTP alone is insufficient: exchange also requires the terminal's secret verifier. */
export function exchangeTerminalPairing(db: Database, requestId: string, verifier: string, code: string, now = Date.now()) {
  if (!verifierSchema.safeParse(verifier).success || code.length !== 12 || !/^\d{12}$/.test(code)) throw new TerminalPairingError('invalid_pairing')
  const result = db.transaction(() => {
    const row = pending(db, requestId, now)
    if (!row?.owner_subject || !row.code_hash || !row.bot_name || !equalHash(row.verifier_hash, hash(verifier))) return undefined
    if (!equalHash(row.code_hash, hash(`${requestId}:${code}`))) {
      // Return, rather than throw inside the transaction, so failed attempts remain durable.
      db.prepare('UPDATE terminal_pairing_requests SET attempts=attempts+1 WHERE id=?').run(requestId)
      return undefined
    }
    const id = `term_${opaqueId()}`, sessionId = `ses_${opaqueId()}`
    const token = `rue_terminal_${randomBytes(32).toString('base64url')}`
    const expiresAt = now + TOKEN_TTL
    createSession(db, { id: sessionId, ownerSubject: row.owner_subject, title: row.bot_name, agent: 'pi-terminal', meta: { terminalConnectionId: id } })
    db.prepare('INSERT INTO terminal_connections(id,owner_subject,session_id,pi_session_id,token_hash,expires_at,created_at,name) VALUES(?,?,?,?,?,?,?,?)')
      .run(id, row.owner_subject, sessionId, row.pi_session_id, hash(token), expiresAt, now, row.bot_name)
    db.prepare('UPDATE terminal_pairing_requests SET consumed_at=?,code_hash=NULL WHERE id=?').run(now, requestId)
    return { id, ownerSubject: row.owner_subject, sessionId, piSessionId: row.pi_session_id, token, expiresAt }
  }).immediate()
  if (!result) throw new TerminalPairingError('invalid_pairing')
  return result
}

function credential(db: Database, token: string, now: number): ConnectionRow {
  if (token.length !== 56 || !/^rue_terminal_[A-Za-z0-9_-]{43}$/.test(token)) throw new TerminalPairingError('invalid_terminal_credential')
  const row = db.prepare('SELECT c.* FROM terminal_connections c JOIN sessions s ON s.id=c.session_id AND s.owner_subject=c.owner_subject WHERE c.token_hash=? AND c.expires_at>? AND c.revoked_at IS NULL')
    .get(hash(token), now) as ConnectionRow | undefined
  if (!row) throw new TerminalPairingError('invalid_terminal_credential')
  return row
}
/** Activate only after the terminal shows and explicitly confirms the approved owner and scope. */
export function activateTerminalConnection(db: Database, token: string, now = Date.now(), confirmedOwnerSubject?: string): TerminalConnection {
  return db.transaction(() => {
    const row = credential(db, token, now)
    if (confirmedOwnerSubject !== undefined && confirmedOwnerSubject !== row.owner_subject) throw new TerminalPairingError('invalid_terminal_credential')
    db.prepare('UPDATE terminal_connections SET activated_at=COALESCE(activated_at,?) WHERE id=?').run(now, row.id)
    return publicConnection({ ...row, activated_at: row.activated_at ?? now })
  }).immediate()
}
/** Scope checks belong on every request AND during each long-lived stream delivery. */
export function authenticateTerminalConnection(db: Database, token: string, connectionId: string, now = Date.now()): TerminalConnection {
  const row = credential(db, token, now)
  if (row.id !== connectionId || row.activated_at === null) throw new TerminalPairingError('invalid_terminal_credential')
  return publicConnection(row)
}
/** A terminal can revoke only its own connection, including an unconfirmed grant. */
export function revokeTerminalCredential(db: Database, token: string, connectionId: string, now = Date.now()): boolean {
  return db.transaction(() => {
    const row = credential(db, token, now)
    if (row.id !== connectionId) throw new TerminalPairingError('invalid_terminal_credential')
    return revokeTerminalConnection(db, row.owner_subject, row.id, now)
  }).immediate()
}
export function listTerminalConnections(db: Database, ownerSubject: string): TerminalConnection[] {
  return (db.prepare('SELECT * FROM terminal_connections WHERE owner_subject=? ORDER BY created_at DESC').all(ownerSubject) as ConnectionRow[]).map(publicConnection)
}
export function revokeTerminalConnection(db: Database, ownerSubject: string, connectionId: string, now = Date.now()): boolean {
  return db.prepare('UPDATE terminal_connections SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND owner_subject=?')
    .run(now, connectionId, ownerSubject).changes === 1
}
