import type { Database } from 'better-sqlite3'
import type { MessageRow, PartRow, Role, PartType, Rating } from './types.js'

interface RawMessageRow {
  id: string
  session_id: string
  role: Role
  time: number
  provider: string | null
  model: string | null
  agent: string | null
  meta: string
  seq: number
}
interface RawPartRow {
  id: string
  session_id: string
  message_id: string
  type: PartType
  seq: number
  payload: string
}

function fromMessage(r: RawMessageRow): MessageRow {
  return {
    id: r.id,
    sessionId: r.session_id,
    role: r.role,
    time: r.time,
    provider: r.provider,
    model: r.model,
    agent: r.agent,
    meta: JSON.parse(r.meta) as Record<string, unknown>,
    seq: r.seq,
  }
}
function fromPart(r: RawPartRow): PartRow {
  return {
    id: r.id,
    sessionId: r.session_id,
    messageId: r.message_id,
    type: r.type,
    seq: r.seq,
    payload: JSON.parse(r.payload) as Record<string, unknown>,
  }
}

/** Next monotonic sequence number for messages within a session. */
function nextMessageSeq(db: Database, sessionId: string): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM messages WHERE session_id = ?')
    .get(sessionId) as { next: number }
  return row.next
}

/** Next monotonic sequence number for parts within a message. */
function nextPartSeq(db: Database, messageId: string): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM parts WHERE message_id = ?')
    .get(messageId) as { next: number }
  return row.next
}

export function appendMessage(
  db: Database,
  input: {
    id: string
    sessionId: string
    role: Role
    provider?: string | null
    model?: string | null
    agent?: string | null
    meta?: Record<string, unknown>
    time?: number
  },
): MessageRow {
  const seq = nextMessageSeq(db, input.sessionId)
  const time = input.time ?? Date.now()
  db.prepare(
    `INSERT INTO messages
       (id, session_id, role, time, provider, model, agent, meta, seq)
     VALUES (@id, @session_id, @role, @time, @provider, @model, @agent, @meta, @seq)`,
  ).run({
    id: input.id,
    session_id: input.sessionId,
    role: input.role,
    time,
    provider: input.provider ?? null,
    model: input.model ?? null,
    agent: input.agent ?? null,
    meta: JSON.stringify(input.meta ?? {}),
    seq,
  })
  // Touch session.updated_at
  db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(time, input.sessionId)
  return getMessage(db, input.id)!
}

export function getMessage(db: Database, id: string): MessageRow | undefined {
  const row = db
    .prepare('SELECT * FROM messages WHERE id = ?')
    .get(id) as RawMessageRow | undefined
  return row ? fromMessage(row) : undefined
}

export function listMessages(db: Database, sessionId: string): MessageRow[] {
  const rows = db
    .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY seq ASC')
    .all(sessionId) as RawMessageRow[]
  return rows.map(fromMessage)
}

export function appendPart(
  db: Database,
  input: {
    id: string
    sessionId: string
    messageId: string
    type: PartType
    payload: Record<string, unknown>
  },
): PartRow {
  const seq = nextPartSeq(db, input.messageId)
  db.prepare(
    `INSERT INTO parts (id, session_id, message_id, type, seq, payload)
     VALUES (@id, @session_id, @message_id, @type, @seq, @payload)`,
  ).run({
    id: input.id,
    session_id: input.sessionId,
    message_id: input.messageId,
    type: input.type,
    seq,
    payload: JSON.stringify(input.payload),
  })
  return getPart(db, input.id)!
}

/** Replace a part's payload (used to flip tool-call state from running → completed). */
export function updatePart(
  db: Database,
  id: string,
  payload: Record<string, unknown>,
): PartRow | undefined {
  const row = db.prepare('SELECT * FROM parts WHERE id = ?').get(id) as RawPartRow | undefined
  if (!row) return undefined
  db.prepare('UPDATE parts SET payload = ? WHERE id = ?').run(
    JSON.stringify(payload),
    id,
  )
  return getPart(db, id)
}

export function getPart(db: Database, id: string): PartRow | undefined {
  const row = db.prepare('SELECT * FROM parts WHERE id = ?').get(id) as RawPartRow | undefined
  return row ? fromPart(row) : undefined
}

export function listParts(db: Database, messageId: string): PartRow[] {
  const rows = db
    .prepare('SELECT * FROM parts WHERE message_id = ? ORDER BY seq ASC')
    .all(messageId) as RawPartRow[]
  return rows.map(fromPart)
}

export function listSessionParts(db: Database, sessionId: string): PartRow[] {
  const rows = db
    .prepare(
      `SELECT p.* FROM parts p
       JOIN messages m ON m.id = p.message_id
       WHERE p.session_id = ?
       ORDER BY m.seq ASC, p.seq ASC`,
    )
    .all(sessionId) as RawPartRow[]
  return rows.map(fromPart)
}

export function setRating(db: Database, messageId: string, rating: Rating): void {
  if (rating === 0) {
    db.prepare('DELETE FROM preferences WHERE message_id = ?').run(messageId)
    return
  }
  db.prepare(
    `INSERT INTO preferences (message_id, rating) VALUES (?, ?)
     ON CONFLICT(message_id) DO UPDATE SET rating = excluded.rating`,
  ).run(messageId, rating)
}

export function getRating(db: Database, messageId: string): Rating {
  const row = db
    .prepare('SELECT rating FROM preferences WHERE message_id = ?')
    .get(messageId) as { rating: Rating } | undefined
  return row?.rating ?? 0
}
