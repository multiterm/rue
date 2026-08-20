import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { Paths } from '../global/paths.js'
import { MIGRATIONS } from './schema.js'

/**
 * Open (or create) the rue SQLite database.
 *
 * - Creates parent directory if missing.
 * - Enables WAL + foreign keys.
 * - Applies any pending migrations in order.
 *
 * Pass an alternate `path` for tests (e.g. `:memory:` or a tempfile).
 */
export function openDatabase(path: string = Paths.db): Database.Database {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  return db
}

function applyMigrations(db: Database.Database): void {
  // Bootstrap migrations table if missing.
  const tableExists = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'",
    )
    .get()
  if (!tableExists) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `)
  }
  const applied = new Set<number>(
    db
      .prepare('SELECT id FROM migrations')
      .all()
      .map((r) => (r as { id: number }).id),
  )
  const insert = db.prepare(
    'INSERT INTO migrations (id, name, applied_at) VALUES (?, ?, ?)',
  )
  const now = Date.now()
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue
    db.exec('BEGIN')
    try {
      // The first migration creates the migrations table itself; skip CREATE
      // on re-application but always run the rest. We drop the inline CREATE
      // by relying on `IF NOT EXISTS` patterns. To stay simple, the bootstrap
      // above creates the migrations table, and the first migration's own
      // `CREATE TABLE migrations` will fail unless we strip it. Detect and
      // skip duplicate-table errors only for migration 1.
      try {
        db.exec(m.sql)
      } catch (err) {
        const msg = (err as Error).message
        if (m.id === 1 && /table migrations already exists/i.test(msg)) {
          // Re-run the migration with the CREATE TABLE migrations clause removed.
          const stripped = m.sql.replace(
            /CREATE TABLE migrations\s*\([\s\S]*?\);/i,
            '',
          )
          db.exec(stripped)
        } else {
          throw err
        }
      }
      insert.run(m.id, m.name, now)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw new Error(
        `Migration ${m.id} (${m.name}) failed: ${(err as Error).message}`,
      )
    }
  }
}
