import type { Database } from 'better-sqlite3'
import type { SessionRow } from './types.js'

interface RawSessionRow {
  id: string
  title: string
  agent: string | null
  provider: string | null
  model: string | null
  directory: string | null
  scopes: string
  parent_id: string | null
  owner_subject: string
  created_at: number
  updated_at: number
  meta: string
}

function fromRaw(r: RawSessionRow): SessionRow {
  return {
    id: r.id,
    title: r.title,
    agent: r.agent,
    provider: r.provider,
    model: r.model,
    directory: r.directory,
    scopes: JSON.parse(r.scopes) as string[],
    parentId: r.parent_id,
    ownerSubject: r.owner_subject,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    meta: JSON.parse(r.meta) as Record<string, unknown>,
  }
}

export function createSession(
  db: Database,
  input: {
    id: string
    title?: string
    agent?: string | null
    provider?: string | null
    model?: string | null
    directory?: string | null
    scopes?: string[]
    parentId?: string | null
    ownerSubject?: string
    meta?: Record<string, unknown>
  },
): SessionRow {
  const now = Date.now()
  db.prepare(
    `INSERT INTO sessions
       (id, title, agent, provider, model, directory, scopes, parent_id, owner_subject, created_at, updated_at, meta)
     VALUES (@id, @title, @agent, @provider, @model, @directory, @scopes, @parent_id, @owner_subject, @created_at, @updated_at, @meta)`,
  ).run({
    id: input.id,
    title: input.title ?? '',
    agent: input.agent ?? null,
    provider: input.provider ?? null,
    model: input.model ?? null,
    directory: input.directory ?? null,
    scopes: JSON.stringify(input.scopes ?? []),
    parent_id: input.parentId ?? null,
    owner_subject: input.ownerSubject ?? 'local',
    created_at: now,
    updated_at: now,
    meta: JSON.stringify(input.meta ?? {}),
  })
  return getSession(db, input.id, input.ownerSubject ?? 'local')!
}

export function getSession(db: Database, id: string, ownerSubject = 'local'): SessionRow | undefined {
  const row = db
    .prepare('SELECT * FROM sessions WHERE id = ? AND owner_subject = ?')
    .get(id, ownerSubject) as RawSessionRow | undefined
  return row ? fromRaw(row) : undefined
}

export function listSessions(db: Database, limit = 100, ownerSubject = 'local'): SessionRow[] {
  const rows = db
    .prepare('SELECT * FROM sessions WHERE owner_subject = ? ORDER BY updated_at DESC LIMIT ?')
    .all(ownerSubject, limit) as RawSessionRow[]
  return rows.map(fromRaw)
}

export function updateSession(
  db: Database,
  id: string,
  patch: Partial<
    Pick<
      SessionRow,
      | 'title'
      | 'agent'
      | 'provider'
      | 'model'
      | 'directory'
      | 'scopes'
      | 'meta'
    >
  >,
  ownerSubject = 'local',
): SessionRow | undefined {
  const existing = getSession(db, id, ownerSubject)
  if (!existing) return undefined
  const next = { ...existing, ...patch }
  db.prepare(
    `UPDATE sessions
        SET title = ?, agent = ?, provider = ?, model = ?, directory = ?, scopes = ?, meta = ?, updated_at = ?
      WHERE id = ? AND owner_subject = ?`,
  ).run(
    next.title,
    next.agent,
    next.provider,
    next.model,
    next.directory,
    JSON.stringify(next.scopes),
    JSON.stringify(next.meta),
    Date.now(),
    id,
    ownerSubject,
  )
  return getSession(db, id, ownerSubject)
}

export function deleteSession(db: Database, id: string, ownerSubject = 'local'): boolean {
  const result = db.prepare('DELETE FROM sessions WHERE id = ? AND owner_subject = ?').run(id, ownerSubject)
  return result.changes > 0
}
