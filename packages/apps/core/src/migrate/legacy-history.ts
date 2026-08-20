/**
 * One-shot migration of the old `@multiterm/rue-desktop` SQLite history into the
 * new `@multiterm/rue-core` schema.
 *
 * Old schema (from desktop/src/main/history.ts):
 *   conversations(id TEXT, title TEXT, created_at, updated_at, scopes JSON)
 *   messages(id TEXT, conversation_id TEXT, role TEXT, content TEXT, rating)
 *
 * Mapping:
 *   conversations → sessions (one row each; scopes JSON copied)
 *   messages      → messages + parts:
 *       - one new `messages` row per old row
 *       - one `parts` row of type='text' containing the old `content`
 *       - if `rating != 0`, write a `preferences` row
 *
 * Idempotent: if a session/message with the same id already exists in the
 * new DB, that row is skipped.
 */

import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import {
  appendMessage,
  appendPart,
  createSession,
  getMessage,
  getSession,
  setRating,
} from '../storage/index.js'
import type { Rating, Role } from '../storage/index.js'

export interface MigrationResult {
  sessionsImported: number
  messagesImported: number
  partsImported: number
  ratingsImported: number
  skipped: number
}

interface OldConversation {
  id: string
  title: string | null
  created_at: number | null
  updated_at: number | null
  scopes: string | null
}
interface OldMessage {
  id: string
  conversation_id: string
  role: string
  content: string
  rating: number | null
}

export function migrateLegacyHistory(opts: {
  oldDbPath: string
  newDb: Database.Database
}): MigrationResult {
  const result: MigrationResult = {
    sessionsImported: 0,
    messagesImported: 0,
    partsImported: 0,
    ratingsImported: 0,
    skipped: 0,
  }
  if (!existsSync(opts.oldDbPath)) return result

  const old = new Database(opts.oldDbPath, { readonly: true })
  try {
    const conversations = old
      .prepare('SELECT id, title, created_at, updated_at, scopes FROM conversations')
      .all() as OldConversation[]

    const messages = old
      .prepare(
        'SELECT id, conversation_id, role, content, rating FROM messages ORDER BY conversation_id, rowid',
      )
      .all() as OldMessage[]

    // Move into the new DB in a single transaction so partial failures roll back.
    const tx = opts.newDb.transaction(() => {
      const sessionsCreatedThisRun = new Set<string>()
      for (const conv of conversations) {
        if (getSession(opts.newDb, conv.id)) {
          result.skipped++
          continue
        }
        const scopes = parseScopes(conv.scopes)
        createSession(opts.newDb, {
          id: conv.id,
          title: conv.title ?? '',
          scopes,
          meta: { importedFrom: 'desktop-history' },
        })
        sessionsCreatedThisRun.add(conv.id)
        result.sessionsImported++
      }

      // Per-conversation sequence reset; we rely on the storage layer's
      // monotonic seq derivation, which scans existing rows — so inserting
      // messages in the original order is sufficient.
      for (const m of messages) {
        if (getMessage(opts.newDb, m.id)) {
          result.skipped++
          continue
        }
        if (!getSession(opts.newDb, m.conversation_id)) {
          // Orphan message; skip rather than create a phantom session.
          result.skipped++
          continue
        }
        const role: Role = isRole(m.role) ? m.role : 'user'
        appendMessage(opts.newDb, {
          id: m.id,
          sessionId: m.conversation_id,
          role,
          meta: { importedFrom: 'desktop-history' },
        })
        result.messagesImported++

        if (m.content) {
          appendPart(opts.newDb, {
            id: `${m.id}__text`,
            sessionId: m.conversation_id,
            messageId: m.id,
            type: 'text',
            payload: { text: m.content },
          })
          result.partsImported++
        }

        const rating = clampRating(m.rating)
        if (rating !== 0) {
          setRating(opts.newDb, m.id, rating)
          result.ratingsImported++
        }
      }

      // Restore historical timestamps AFTER messages have been inserted,
      // since appendMessage touches sessions.updated_at to "now".
      const fixTs = opts.newDb.prepare(
        'UPDATE sessions SET created_at = ?, updated_at = ? WHERE id = ?',
      )
      for (const conv of conversations) {
        if (!sessionsCreatedThisRun.has(conv.id)) continue
        if (conv.created_at && conv.updated_at) {
          fixTs.run(conv.created_at, conv.updated_at, conv.id)
        }
      }
    })
    tx()
  } finally {
    old.close()
  }
  return result
}

function parseScopes(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string')
  } catch {
    // fall through
  }
  return []
}

function isRole(s: string): s is Role {
  return s === 'user' || s === 'assistant' || s === 'system'
}

function clampRating(n: number | null): Rating {
  if (n === 1) return 1
  if (n === -1) return -1
  return 0
}
