import { promises as fs } from 'node:fs'
import { join, extname, relative } from 'node:path'

const SUPPORTED_EXTENSIONS = new Set([
  '.md', '.markdown', '.txt', '.rst', '.org',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift',
  '.json', '.yaml', '.yml', '.toml', '.xml',
  '.html', '.css', '.scss', '.sh'
])

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.cache',
  'venv', '.venv', '__pycache__', 'target', '.idea', '.vscode',
  'coverage', '.nx'
])

const MAX_FILE_BYTES = 256 * 1024
const MAX_FILES = 500

export interface ScannedFile {
  readonly path: string
  readonly relativePath: string
  readonly text: string
}

export async function scanFolder(root: string): Promise<ScannedFile[]> {
  const files: ScannedFile[] = []
  await walk(root, root, files)
  return files
}

async function walk(root: string, current: string, out: ScannedFile[]): Promise<void> {
  if (out.length >= MAX_FILES) return
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(current, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (out.length >= MAX_FILES) return
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue
    const path = join(current, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      await walk(root, path, out)
      continue
    }
    if (!entry.isFile()) continue
    const ext = extname(entry.name).toLowerCase()
    if (!SUPPORTED_EXTENSIONS.has(ext)) continue
    try {
      const stat = await fs.stat(path)
      if (stat.size > MAX_FILE_BYTES) continue
      const text = await fs.readFile(path, 'utf-8')
      out.push({ path, relativePath: relative(root, path), text })
    } catch {
      // Unreadable file — skip.
    }
  }
}
