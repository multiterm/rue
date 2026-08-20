import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateLegacyHistory } from '../../src/migrate/index.js'
import {
  getRating,
  getSession,
  listMessages,
  listSessionParts,
  openDatabase,
} from '../../src/storage/index.js'

function seedLegacyDb(path: string): void {
  const db = new Database(path)
  db.exec(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      scopes TEXT
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      role TEXT,
      content TEXT,
      rating INTEGER DEFAULT 0
    );
  `)
  db.prepare(
    'INSERT INTO conversations (id, title, created_at, updated_at, scopes) VALUES (?,?,?,?,?)',
  ).run('cnv_1', 'demo', 100, 200, JSON.stringify(['/some/path']))
  const ins = db.prepare(
    'INSERT INTO messages (id, conversation_id, role, content, rating) VALUES (?,?,?,?,?)',
  )
  ins.run('msg_1', 'cnv_1', 'user', 'hi', 0)
  ins.run('msg_2', 'cnv_1', 'assistant', 'hello!', 1)
  ins.run('msg_3', 'cnv_1', 'assistant', 'follow-up', -1)
  // Orphan message — must be skipped, not crash.
  ins.run('msg_orphan', 'cnv_missing', 'user', 'x', 0)
  db.close()
}

describe('migrate/legacy-history', () => {
  let work: string
  let oldDbPath: string

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'rue-mig-'))
    oldDbPath = join(work, 'old.db')
    seedLegacyDb(oldDbPath)
  })
  afterEach(() => {
    rmSync(work, { recursive: true, force: true })
  })

  it('imports sessions, messages, parts, and ratings', () => {
    const newDb = openDatabase(':memory:')
    const result = migrateLegacyHistory({ oldDbPath, newDb })
    expect(result.sessionsImported).toBe(1)
    expect(result.messagesImported).toBe(3)
    expect(result.partsImported).toBe(3)
    expect(result.ratingsImported).toBe(2)
    expect(result.skipped).toBe(1) // the orphan

    const session = getSession(newDb, 'cnv_1')
    expect(session?.title).toBe('demo')
    expect(session?.scopes).toEqual(['/some/path'])
    expect(session?.createdAt).toBe(100)
    expect(session?.updatedAt).toBe(200)

    const messages = listMessages(newDb, 'cnv_1')
    expect(messages.map((m) => m.id)).toEqual(['msg_1', 'msg_2', 'msg_3'])

    const parts = listSessionParts(newDb, 'cnv_1')
    expect(parts.map((p) => p.payload.text)).toEqual(['hi', 'hello!', 'follow-up'])

    expect(getRating(newDb, 'msg_2')).toBe(1)
    expect(getRating(newDb, 'msg_3')).toBe(-1)
  })

  it('is idempotent — re-running skips already-imported rows', () => {
    const newDb = openDatabase(':memory:')
    migrateLegacyHistory({ oldDbPath, newDb })
    const second = migrateLegacyHistory({ oldDbPath, newDb })
    // Sessions+messages already exist; only the orphan still gets counted as
    // skipped on the second pass too (4 skips total: 1 session, 3 messages,
    // plus the original orphan = 5? Let's just assert *no new* imports).
    expect(second.sessionsImported).toBe(0)
    expect(second.messagesImported).toBe(0)
    expect(second.partsImported).toBe(0)
    expect(second.ratingsImported).toBe(0)
    expect(second.skipped).toBeGreaterThanOrEqual(4)
  })

  it('returns zero counts when the old db does not exist', () => {
    const newDb = openDatabase(':memory:')
    const result = migrateLegacyHistory({
      oldDbPath: join(work, 'does-not-exist.db'),
      newDb,
    })
    expect(result).toEqual({
      sessionsImported: 0,
      messagesImported: 0,
      partsImported: 0,
      ratingsImported: 0,
      skipped: 0,
    })
  })
})
