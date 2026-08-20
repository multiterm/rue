import { app, dialog, ipcMain } from 'electron'
import Database from 'better-sqlite3'
import { join, basename } from 'node:path'
import { scanFolder } from './scan.js'
import { rank, type RankedChunk, type FileBlob } from './rank.js'

export interface Notebook {
  readonly id: number
  readonly name: string
  readonly path: string
  readonly fileCount: number
  readonly updatedAt: number
}

let db: Database.Database | null = null

export function initNotebooks(): void {
  const path = join(app.getPath('userData'), 'rue-notebooks.db')
  db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS notebooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notebook_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notebook_id INTEGER NOT NULL,
      relative_path TEXT NOT NULL,
      text TEXT NOT NULL,
      FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_files_notebook ON notebook_files(notebook_id);
  `)
}

export function closeNotebooks(): void {
  db?.close()
  db = null
}

function requireDb(): Database.Database {
  if (!db) throw new Error('Notebooks DB not initialized')
  return db
}

export async function createFromPicker(): Promise<Notebook | null> {
  const result = await dialog.showOpenDialog({
    title: 'Select notebook folder',
    properties: ['openDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return createFromPath(result.filePaths[0]!)
}

export async function createFromPath(path: string): Promise<Notebook> {
  const name = basename(path)
  const now = Date.now()
  requireDb()
    .prepare('INSERT OR REPLACE INTO notebooks (name, path, updated_at) VALUES (?, ?, ?)')
    .run(name, path, now)

  const row = requireDb()
    .prepare<[string], { id: number }>('SELECT id FROM notebooks WHERE path = ?')
    .get(path)
  if (!row) throw new Error('Notebook insertion failed')

  await reindex(row.id)
  return getNotebook(row.id)
}

export async function reindex(id: number): Promise<number> {
  const row = requireDb()
    .prepare<[number], { path: string }>('SELECT path FROM notebooks WHERE id = ?')
    .get(id)
  if (!row) throw new Error(`Notebook ${id} not found`)

  const files = await scanFolder(row.path)
  const tx = requireDb().transaction((nb: number, scanned: ReadonlyArray<{ relativePath: string; text: string }>) => {
    requireDb().prepare('DELETE FROM notebook_files WHERE notebook_id = ?').run(nb)
    const insert = requireDb().prepare('INSERT INTO notebook_files (notebook_id, relative_path, text) VALUES (?, ?, ?)')
    for (const f of scanned) insert.run(nb, f.relativePath, f.text)
    requireDb().prepare('UPDATE notebooks SET updated_at = ? WHERE id = ?').run(Date.now(), nb)
  })
  tx(id, files)
  return files.length
}

export function listNotebooks(): Notebook[] {
  return requireDb()
    .prepare<[], { id: number; name: string; path: string; updated_at: number; cnt: number }>(`
      SELECT n.id, n.name, n.path, n.updated_at,
        (SELECT COUNT(*) FROM notebook_files WHERE notebook_id = n.id) AS cnt
      FROM notebooks n
      ORDER BY n.updated_at DESC
    `)
    .all()
    .map(r => ({ id: r.id, name: r.name, path: r.path, updatedAt: r.updated_at, fileCount: r.cnt }))
}

export function getNotebook(id: number): Notebook {
  const list = listNotebooks()
  const found = list.find(n => n.id === id)
  if (!found) throw new Error(`Notebook ${id} not found`)
  return found
}

export function deleteNotebook(id: number): void {
  requireDb().prepare('DELETE FROM notebooks WHERE id = ?').run(id)
}

export interface NotebookSearchResult {
  readonly chunks: ReadonlyArray<RankedChunk>
  readonly contextText: string
}

const MAX_CONTEXT_CHARS = 12_000

export function searchNotebook(id: number, query: string): NotebookSearchResult {
  const files = requireDb()
    .prepare<[number], { relative_path: string; text: string }>(`SELECT relative_path, text FROM notebook_files WHERE notebook_id = ?`)
    .all(id)
    .map((r): FileBlob => ({ filePath: r.relative_path, text: r.text }))

  const ranked = rank(query, files, 8)
  let total = 0
  const accepted: RankedChunk[] = []
  for (const chunk of ranked) {
    if (total + chunk.text.length > MAX_CONTEXT_CHARS) break
    accepted.push(chunk)
    total += chunk.text.length
  }

  const contextText = accepted
    .map(c => `## ${c.filePath}\n${c.text}`)
    .join('\n\n---\n\n')

  return { chunks: accepted, contextText }
}

export function registerNotebookIpc(): void {
  ipcMain.handle('rue:notebook:list', () => listNotebooks())
  ipcMain.handle('rue:notebook:create', () => createFromPicker())
  ipcMain.handle('rue:notebook:reindex', (_e, id: number) => reindex(id))
  ipcMain.handle('rue:notebook:delete', (_e, id: number) => deleteNotebook(id))
  ipcMain.handle('rue:notebook:search', (_e, id: number, query: string) => searchNotebook(id, query))
}
