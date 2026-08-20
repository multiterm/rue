import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import { parseFrontmatter } from './frontmatter.js'
import type { Skill } from './types.js'

/**
 * Loads user-authored skills from disk. A skill is either `skills/<name>.md`
 * or `skills/<name>/SKILL.md` under the app's userData directory — drop a
 * Markdown file with frontmatter there and it becomes available to the model.
 */

const MAX_SKILLS = 100

/** Absolute path to the user skills directory. */
export function skillsDir(): string {
  return join(app.getPath('userData'), 'skills')
}

export async function loadUserSkills(): Promise<ReadonlyArray<Skill>> {
  const dir = skillsDir()
  // Create the directory so users have an obvious place to drop skill files.
  await fs.mkdir(dir, { recursive: true }).catch(() => undefined)

  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])

  const skills: Skill[] = []
  for (const entry of entries) {
    if (skills.length >= MAX_SKILLS) break
    const filePath = entry.isDirectory()
      ? join(dir, entry.name, 'SKILL.md')
      : entry.name.toLowerCase().endsWith('.md')
        ? join(dir, entry.name)
        : null
    if (!filePath) continue
    const skill = await readSkillFile(filePath, entry.name)
    if (skill) skills.push(skill)
  }
  return skills
}

async function readSkillFile(filePath: string, entryName: string): Promise<Skill | null> {
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch {
    return null
  }
  const { fields, body } = parseFrontmatter(raw)
  if (!body.trim()) return null

  const name = str(fields.name) || entryName.replace(/\.md$/i, '')
  const whenToUse = str(fields['when-to-use'])
  return {
    name,
    description: str(fields.description) || whenToUse || name,
    whenToUse: whenToUse || undefined,
    argumentHint: str(fields['argument-hint']) || undefined,
    body,
    source: 'user',
    userInvocable: bool(fields['user-invocable'], true),
    modelInvocable: !bool(fields['disable-model-invocation'], false)
  }
}

function str(value: string | ReadonlyArray<string> | undefined): string {
  return typeof value === 'string' ? value : ''
}

function bool(value: string | ReadonlyArray<string> | undefined, fallback: boolean): boolean {
  if (typeof value !== 'string') return fallback
  return value === 'true' || value === 'yes' || value === '1'
}

export function registerSkillsIpc(): void {
  ipcMain.handle('rue:skills:list', () => loadUserSkills())
}
