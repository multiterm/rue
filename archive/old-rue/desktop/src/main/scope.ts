import { dialog, ipcMain } from 'electron'
import { scanFolder } from './notebook/scan.js'
import { rank, type FileBlob } from './notebook/rank.js'

/**
 * Per-chat folder scopes. Unlike notebooks (a persistent index), a scope is
 * just a folder bound to a conversation. Folders are scanned fresh per query
 * and the top-ranked chunks are returned as retrieval context.
 */

const MAX_CONTEXT_CHARS = 12_000

/** Open the native directory picker; returns the chosen path or null. */
export async function pickScopeFolder(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: 'Add a folder to this chat',
    properties: ['openDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0] ?? null
}

/** Scan the scoped folders, rank their chunks against the query, and return a
 *  bounded context block. */
export async function searchScopes(paths: ReadonlyArray<string>, query: string): Promise<string> {
  if (paths.length === 0 || !query.trim()) return ''

  const blobs: FileBlob[] = []
  for (const path of paths) {
    try {
      const files = await scanFolder(path)
      for (const f of files) blobs.push({ filePath: `${path}/${f.relativePath}`, text: f.text })
    } catch {
      // Folder may have been moved/deleted — skip it.
    }
  }
  if (blobs.length === 0) return ''

  const ranked = rank(query, blobs, 8)
  let total = 0
  const out: string[] = []
  for (const chunk of ranked) {
    if (total + chunk.text.length > MAX_CONTEXT_CHARS) break
    out.push(`## ${chunk.filePath}\n${chunk.text}`)
    total += chunk.text.length
  }
  return out.join('\n\n---\n\n')
}

export function registerScopeIpc(): void {
  ipcMain.handle('rue:scope:pick-folder', () => pickScopeFolder())
  ipcMain.handle('rue:scope:search', (_e, paths: ReadonlyArray<string>, query: string) =>
    searchScopes(paths, query)
  )
}
