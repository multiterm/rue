import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import { parseFrontmatter } from '../skills/frontmatter.js'
import { memoryAgeDays, memoryAgeLabel, memoryFreshnessText } from './age.js'
import { MEMORY_TYPES, type Memory, type MemoryHeader, type MemoryType, type MemoryWriteInput } from './types.js'

/**
 * The memory directory — `.md` files under `userData/memory/`, one per memory,
 * plus an auto-regenerated `MEMORY.md` index. Memories are sorted newest-first
 * so the most recent context surfaces first.
 */

const INDEX_FILE = 'MEMORY.md'
const MAX_MEMORIES = 200

export function memoryDir(): string {
  return join(app.getPath('userData'), 'memory')
}

// #region -- Read ---------------------------------------

/** All memories, header-only, newest-first. */
export async function scanMemories(): Promise<ReadonlyArray<MemoryHeader>> {
  const dir = memoryDir()
  await fs.mkdir(dir, { recursive: true }).catch(() => undefined)
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])

  const headers: MemoryHeader[] = []
  for (const entry of entries) {
    if (headers.length >= MAX_MEMORIES) break
    if (!entry.isFile() || entry.name === INDEX_FILE) continue
    if (!entry.name.toLowerCase().endsWith('.md')) continue
    const header = await readHeader(join(dir, entry.name), entry.name)
    if (header) headers.push(header)
  }
  return headers.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

async function readHeader(filePath: string, fileName: string): Promise<MemoryHeader | null> {
  try {
    const [raw, stat] = await Promise.all([fs.readFile(filePath, 'utf8'), fs.stat(filePath)])
    const { fields } = parseFrontmatter(raw)
    const name = str(fields.name) || fileName.replace(/\.md$/i, '')
    return {
      name,
      description: str(fields.description) || name,
      type: normalizeType(fields.type),
      mtimeMs: stat.mtimeMs,
      ageDays: memoryAgeDays(stat.mtimeMs)
    }
  } catch {
    return null
  }
}

export async function readMemory(name: string): Promise<Memory | null> {
  const filePath = memoryFilePath(name)
  if (!filePath) return null
  try {
    const [raw, stat] = await Promise.all([fs.readFile(filePath, 'utf8'), fs.stat(filePath)])
    const { fields, body } = parseFrontmatter(raw)
    const ageDays = memoryAgeDays(stat.mtimeMs)
    return {
      name: str(fields.name) || name,
      description: str(fields.description) || name,
      type: normalizeType(fields.type),
      content: body,
      mtimeMs: stat.mtimeMs,
      ageDays,
      freshness: memoryFreshnessText(ageDays)
    }
  } catch {
    return null
  }
}

/** The memory index as one line per memory — injected into the system prompt. */
export async function memoryIndexText(): Promise<string> {
  const headers = await scanMemories()
  return headers
    .map(h => `- [${h.type}] ${h.name} (${memoryAgeLabel(h.ageDays)}): ${h.description}`)
    .join('\n')
}

// #endregion -- Read ------------------------------------

// #region -- Write --------------------------------------

export async function writeMemory(input: MemoryWriteInput): Promise<Memory> {
  const dir = memoryDir()
  await fs.mkdir(dir, { recursive: true })
  const name = slug(input.name)
  if (!name) throw new Error('Invalid memory name — use letters, digits, and hyphens.')

  const type = normalizeType(input.type)
  const description = oneLine(input.description)
  const filePath = join(dir, `${name}.md`)
  const fileBody =
    `---\nname: ${name}\ndescription: ${description}\ntype: ${type}\n---\n\n` +
    `${input.content.trim()}\n`
  await fs.writeFile(filePath, fileBody, 'utf8')
  await regenerateIndex()

  const stat = await fs.stat(filePath)
  return {
    name,
    description,
    type,
    content: input.content.trim(),
    mtimeMs: stat.mtimeMs,
    ageDays: 0,
    freshness: ''
  }
}

export async function deleteMemory(name: string): Promise<boolean> {
  const filePath = memoryFilePath(name)
  if (!filePath) return false
  try {
    await fs.unlink(filePath)
    await regenerateIndex()
    return true
  } catch {
    return false
  }
}

/** Rewrite `MEMORY.md` so the on-disk index always matches the memory files. */
async function regenerateIndex(): Promise<void> {
  const index = await memoryIndexText()
  const body = `# Memory Index\n\n${index || '(no memories yet)'}\n`
  await fs.writeFile(join(memoryDir(), INDEX_FILE), body, 'utf8').catch(() => undefined)
}

// #endregion -- Write -----------------------------------

// #region -- Helpers ------------------------------------

function memoryFilePath(name: string): string | null {
  const safe = slug(name)
  return safe ? join(memoryDir(), `${safe}.md`) : null
}

/** Slugify a memory name into a traversal-safe filename stem. */
function slug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function str(value: string | ReadonlyArray<string> | undefined): string {
  return typeof value === 'string' ? value : ''
}

function normalizeType(value: string | ReadonlyArray<string> | undefined): MemoryType {
  return typeof value === 'string' && (MEMORY_TYPES as ReadonlyArray<string>).includes(value)
    ? (value as MemoryType)
    : 'project'
}

// #endregion -- Helpers ---------------------------------

export function registerMemoryIpc(): void {
  ipcMain.handle('rue:memory:scan', () => scanMemories())
  ipcMain.handle('rue:memory:index', () => memoryIndexText())
  ipcMain.handle('rue:memory:read', (_e, name: string) => readMemory(name))
  ipcMain.handle('rue:memory:write', (_e, input: MemoryWriteInput) => writeMemory(input))
  ipcMain.handle('rue:memory:delete', (_e, name: string) => deleteMemory(name))
}
