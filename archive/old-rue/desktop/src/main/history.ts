import { app, ipcMain } from 'electron'
import Database from 'better-sqlite3'
import { join } from 'node:path'

export interface Conversation {
  readonly id: number
  readonly title: string
  readonly createdAt: number
  readonly updatedAt: number
  /** Folder directories this chat is scoped to (context retrieval + tool allowlist). */
  readonly scopes: ReadonlyArray<string>
}

export interface StoredMessage {
  readonly id: number
  readonly conversationId: number
  readonly role: 'user' | 'assistant'
  readonly content: string
  readonly createdAt: number
  readonly rating: number
}

export interface PreferencePair {
  readonly prompt: string
  readonly chosen: string
  readonly rejected: string
}

let db: Database.Database | null = null

export function initHistory(): void {
  const path = join(app.getPath('userData'), 'rue-history.db')
  db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      scopes TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      rating INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
  `)

  // Best-effort column adds for older databases.
  for (const stmt of [
    'ALTER TABLE messages ADD COLUMN rating INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE conversations ADD COLUMN scopes TEXT'
  ]) {
    try {
      db.exec(stmt)
    } catch {
      // Column already exists — fine.
    }
  }
}

export function closeHistory(): void {
  db?.close()
  db = null
}

function requireDb(): Database.Database {
  if (!db) throw new Error('History DB not initialized')
  return db
}

export function createConversation(title: string): Conversation {
  const now = Date.now()
  const result = requireDb()
    .prepare('INSERT INTO conversations (title, created_at, updated_at) VALUES (?, ?, ?)')
    .run(title, now, now)
  return {
    id: Number(result.lastInsertRowid),
    title,
    createdAt: now,
    updatedAt: now,
    scopes: []
  }
}

interface ConvRow {
  id: number
  title: string
  created_at: number
  updated_at: number
  scopes: string | null
}

function parseScopes(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

export function listConversations(): Conversation[] {
  const rows = requireDb()
    .prepare<[], ConvRow>('SELECT id, title, created_at, updated_at, scopes FROM conversations ORDER BY updated_at DESC LIMIT 100')
    .all()
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    scopes: parseScopes(r.scopes)
  }))
}

export function setConversationScopes(id: number, scopes: ReadonlyArray<string>): void {
  requireDb()
    .prepare('UPDATE conversations SET scopes = ? WHERE id = ?')
    .run(JSON.stringify(scopes), id)
}

interface MsgRow {
  id: number
  conversation_id: number
  role: 'user' | 'assistant'
  content: string
  created_at: number
  rating: number
}

export function getMessages(conversationId: number): StoredMessage[] {
  const rows = requireDb()
    .prepare<[number], MsgRow>('SELECT id, conversation_id, role, content, created_at, rating FROM messages WHERE conversation_id = ? ORDER BY id ASC')
    .all(conversationId)
  return rows.map(r => ({
    id: r.id,
    conversationId: r.conversation_id,
    role: r.role,
    content: r.content,
    createdAt: r.created_at,
    rating: r.rating
  }))
}

export function addMessage(conversationId: number, role: 'user' | 'assistant', content: string): StoredMessage {
  const now = Date.now()
  const result = requireDb()
    .prepare('INSERT INTO messages (conversation_id, role, content, created_at, rating) VALUES (?, ?, ?, ?, 0)')
    .run(conversationId, role, content, now)
  requireDb()
    .prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
    .run(now, conversationId)
  return {
    id: Number(result.lastInsertRowid),
    conversationId,
    role,
    content,
    createdAt: now,
    rating: 0
  }
}

export function rateMessage(messageId: number, rating: -1 | 0 | 1): void {
  requireDb().prepare('UPDATE messages SET rating = ? WHERE id = ?').run(rating, messageId)
}

interface PreferenceRow {
  prompt: string
  chosen: string
  rejected: string
}

export function exportPreferencePairs(): PreferencePair[] {
  return requireDb()
    .prepare<[], PreferenceRow>(`
      WITH ranked AS (
        SELECT
          id,
          conversation_id,
          role,
          content,
          rating,
          LAG(content) OVER (PARTITION BY conversation_id ORDER BY id) AS prev_user_prompt,
          LAG(role) OVER (PARTITION BY conversation_id ORDER BY id) AS prev_role
        FROM messages
      )
      SELECT
        prev_user_prompt AS prompt,
        CASE WHEN rating = 1 THEN content ELSE NULL END AS chosen,
        CASE WHEN rating = -1 THEN content ELSE NULL END AS rejected
      FROM ranked
      WHERE role = 'assistant' AND rating != 0 AND prev_role = 'user'
    `)
    .all()
    .filter(r => r.prompt && (r.chosen || r.rejected)) as PreferenceRow[]
}

export function renameConversation(id: number, title: string): void {
  requireDb().prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(title, Date.now(), id)
}

export function deleteConversation(id: number): void {
  requireDb().prepare('DELETE FROM conversations WHERE id = ?').run(id)
}

export function registerHistoryIpc(): void {
  ipcMain.handle('rue:history:list', () => listConversations())
  ipcMain.handle('rue:history:create', (_e, title: string) => createConversation(title))
  ipcMain.handle('rue:history:messages', (_e, id: number) => getMessages(id))
  ipcMain.handle('rue:history:append', (_e, id: number, role: 'user' | 'assistant', content: string) =>
    addMessage(id, role, content)
  )
  ipcMain.handle('rue:history:rename', (_e, id: number, title: string) => renameConversation(id, title))
  ipcMain.handle('rue:history:set-scopes', (_e, id: number, scopes: ReadonlyArray<string>) =>
    setConversationScopes(id, scopes)
  )
  ipcMain.handle('rue:history:delete', (_e, id: number) => deleteConversation(id))
  ipcMain.handle('rue:history:rate', (_e, id: number, rating: -1 | 0 | 1) => rateMessage(id, rating))
  ipcMain.handle('rue:history:export-rl', () => exportPreferencePairs())
}
