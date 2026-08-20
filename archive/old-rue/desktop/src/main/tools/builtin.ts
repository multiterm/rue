import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { dialog, ipcMain } from 'electron'

const execFileAsync = promisify(execFile)

/**
 * Rue's built-in agent tools. Exposed to the LLM through the same agentic
 * loop as MCP tools, but executed here in the main process.
 *
 * Safety model: every file/shell path is constrained to the chat's folder
 * scopes (the allowlist). Mutating tools (write/edit/bash) additionally ask
 * the user to confirm. A chat with no folder scope cannot use these tools.
 */

interface ToolDef {
  readonly type: 'function'
  readonly function: {
    readonly name: string
    readonly description: string
    readonly parameters: Record<string, unknown>
  }
}

function strProp(description: string): Record<string, unknown> {
  return { type: 'string', description }
}

function schema(props: Record<string, unknown>, required: ReadonlyArray<string>): Record<string, unknown> {
  return { type: 'object', properties: props, required }
}

export const BUILTIN_TOOL_DEFS: ReadonlyArray<ToolDef> = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: "Read a UTF-8 text file. The path must be inside the chat's folder scope.",
      parameters: schema({ path: strProp('Absolute path to the file') }, ['path'])
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a text file. The user is asked to confirm.',
      parameters: schema(
        { path: strProp('Absolute path'), content: strProp('Full new file contents') },
        ['path', 'content']
      )
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        'Replace an exact, unique string in a file with new text. The user is asked to confirm. ' +
        'Prefer this over write_file for changes to existing files.',
      parameters: schema(
        {
          path: strProp('Absolute path'),
          old_string: strProp('Exact text to find — must be unique in the file'),
          new_string: strProp('Replacement text')
        },
        ['path', 'old_string', 'new_string']
      )
    }
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description: "Search file contents for a regular expression within the chat's folder scope.",
      parameters: schema(
        { pattern: strProp('Regular expression'), path: strProp('Optional directory to search') },
        ['pattern']
      )
    }
  },
  {
    type: 'function',
    function: {
      name: 'glob',
      description: "List files matching a glob pattern within the chat's folder scope.",
      parameters: schema(
        { pattern: strProp('Glob, e.g. **/*.ts'), path: strProp('Optional base directory') },
        ['pattern']
      )
    }
  },
  {
    type: 'function',
    function: {
      name: 'bash',
      description: "Run a shell command in the chat's folder scope. The user is asked to confirm.",
      parameters: schema({ command: strProp('The shell command to run') }, ['command'])
    }
  },
  {
    type: 'function',
    function: {
      name: 'verify',
      description:
        "Run a project verification script (typecheck/test/build/lint) in the chat's folder scope " +
        'and report pass/fail with output. Use this to confirm a change is correct before finishing. ' +
        'No confirmation needed — it does not modify files.',
      parameters: schema(
        {
          script: strProp('One of: typecheck, test, build, lint. Defaults to typecheck.'),
          path: strProp('Optional project directory inside the folder scope')
        },
        []
      )
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_checkpoint',
      description:
        "Stage all changes and create a git commit in the chat's folder scope — a reviewable, " +
        'roll-back-able checkpoint. The user is asked to confirm.',
      parameters: schema(
        {
          message: strProp('Commit message'),
          path: strProp('Optional repository directory inside the folder scope')
        },
        ['message']
      )
    }
  }
]

export const BUILTIN_TOOL_NAMES: ReadonlyArray<string> = BUILTIN_TOOL_DEFS.map(t => t.function.name)

function norm(p: string): string {
  return resolve(p).replace(/\/+$/, '')
}

/** True if `p` resolves to a location inside one of the scope folders. */
function withinScopes(p: string, scopes: ReadonlyArray<string>): boolean {
  const target = norm(p)
  return scopes.some(s => {
    const base = norm(s)
    return target === base || target.startsWith(`${base}/`)
  })
}

/**
 * Files the agent must never modify, even inside an allowed scope — editing a
 * `.git` internal or Rue's own tool/debug code could corrupt the repo or
 * let a self-healing agent disable its own guardrails.
 */
const PROTECTED_SUFFIXES: ReadonlyArray<string> = [
  '/src/main/tools/builtin.ts',
  '/src/main/debug.ts'
]

/** True if a mutating tool must refuse to touch this path. */
function isProtected(p: string): boolean {
  const target = norm(p)
  if (target.includes('/.git/') || target.endsWith('/.git')) return true
  return PROTECTED_SUFFIXES.some(suffix => target.endsWith(suffix))
}

/**
 * Compile a glob pattern to a RegExp anchored to a full relative path.
 * Supports `**` (any depth, including none), `*` (one segment), and `?`.
 */
function globToRegExp(pattern: string): RegExp {
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '*' && pattern[i + 1] === '*') {
      re += '.*'
      i++
      if (pattern[i + 1] === '/') i++
    } else if (c === '*') {
      re += '[^/]*'
    } else if (c === '?') {
      re += '[^/]'
    } else if ('/.+^${}()|[]\\'.includes(c)) {
      re += `\\${c}`
    } else {
      re += c
    }
  }
  return new RegExp(`^${re}$`)
}

/** Recursively yield file paths relative to `dir`, skipping noise directories. */
async function* walkFiles(dir: string, rel = ''): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const childRel = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      yield* walkFiles(resolve(dir, entry.name), childRel)
    } else if (entry.isFile()) {
      yield childRel
    }
  }
}

// Once the user picks "Allow for this session", mutating tools stop prompting.
let allowMutationsThisSession = false

/** Confirm a mutating action. Returns false if the user denies. */
async function confirmMutation(detail: string): Promise<boolean> {
  if (allowMutationsThisSession) return true
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Allow', 'Allow for this session', 'Deny'],
    defaultId: 0,
    cancelId: 2,
    title: 'Rue — confirm agent action',
    message: 'Rue wants to make a change',
    detail
  })
  if (response === 1) allowMutationsThisSession = true
  return response === 0 || response === 1
}

/** Execute a built-in tool. Always resolves — failures come back as `{ error }`. */
export async function executeBuiltinTool(
  name: string,
  args: Record<string, unknown>,
  scopes: ReadonlyArray<string>
): Promise<unknown> {
  if (scopes.length === 0) {
    return {
      error: 'This chat has no folder scope. Add a folder (chat ••• menu → Folder scope) to use file tools.'
    }
  }
  const arg = (k: string): string => (typeof args[k] === 'string' ? (args[k] as string) : '')
  const root = scopes[0] ?? ''

  try {
    switch (name) {
      case 'read_file': {
        const path = arg('path')
        if (!withinScopes(path, scopes)) return { error: `Path is outside the folder scope: ${path}` }
        const content = await fs.readFile(path, 'utf8')
        return { content: content.slice(0, 100_000) }
      }
      case 'write_file': {
        const path = arg('path')
        if (!withinScopes(path, scopes)) return { error: `Path is outside the folder scope: ${path}` }
        if (isProtected(path)) return { error: `Protected file — the agent may not modify it: ${path}` }
        if (!(await confirmMutation(`Write file:\n${path}`))) return { error: 'The user denied this write.' }
        await fs.writeFile(path, arg('content'), 'utf8')
        return { ok: true, path }
      }
      case 'edit_file': {
        const path = arg('path')
        if (!withinScopes(path, scopes)) return { error: `Path is outside the folder scope: ${path}` }
        if (isProtected(path)) return { error: `Protected file — the agent may not modify it: ${path}` }
        const oldStr = arg('old_string')
        const original = await fs.readFile(path, 'utf8')
        const occurrences = original.split(oldStr).length - 1
        if (occurrences === 0) return { error: 'old_string was not found in the file.' }
        if (occurrences > 1) {
          return { error: `old_string is not unique (${occurrences} matches) — add surrounding context.` }
        }
        if (!(await confirmMutation(`Edit file:\n${path}`))) return { error: 'The user denied this edit.' }
        await fs.writeFile(path, original.replace(oldStr, arg('new_string')), 'utf8')
        return { ok: true, path }
      }
      case 'glob': {
        const base = arg('path') || root
        if (!withinScopes(base, scopes)) return { error: `Path is outside the folder scope: ${base}` }
        const matcher = globToRegExp(arg('pattern'))
        const matches: string[] = []
        for await (const rel of walkFiles(base)) {
          if (!matcher.test(rel)) continue
          matches.push(rel)
          if (matches.length >= 200) break
        }
        return { matches }
      }
      case 'grep': {
        const base = arg('path') || root
        if (!withinScopes(base, scopes)) return { error: `Path is outside the folder scope: ${base}` }
        try {
          const { stdout } = await execFileAsync('grep', ['-rnI', '--', arg('pattern'), base], {
            maxBuffer: 2_000_000
          })
          return { matches: stdout.split('\n').filter(Boolean).slice(0, 200) }
        } catch (err) {
          // grep exits 1 with no output when there are no matches.
          if ((err as { code?: number }).code === 1) return { matches: [] }
          throw err
        }
      }
      case 'bash': {
        const command = arg('command')
        if (!(await confirmMutation(`Run command:\n${command}`))) {
          return { error: 'The user denied this command.' }
        }
        const { stdout, stderr } = await execFileAsync('bash', ['-lc', command], {
          cwd: root,
          timeout: 60_000,
          maxBuffer: 2_000_000
        })
        return { stdout, stderr }
      }
      case 'verify': {
        const base = arg('path') || root
        if (!withinScopes(base, scopes)) return { error: `Path is outside the folder scope: ${base}` }
        const script = arg('script') || 'typecheck'
        // Allowlisted so the model can't smuggle a shell command through `script`.
        if (!['typecheck', 'test', 'build', 'lint'].includes(script)) {
          return { error: `verify: script must be one of typecheck, test, build, lint` }
        }
        try {
          const { stdout, stderr } = await execFileAsync('bash', ['-lc', `pnpm run ${script}`], {
            cwd: base,
            timeout: 240_000,
            maxBuffer: 4_000_000
          })
          return { content: `✓ pnpm run ${script} passed\n${`${stdout}${stderr}`.trim()}`.slice(0, 8000) }
        } catch (err) {
          const e = err as { stdout?: string; stderr?: string; message?: string }
          const out = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() || e.message || ''
          return { error: `✗ pnpm run ${script} failed\n${out}`.slice(0, 8000) }
        }
      }
      case 'git_checkpoint': {
        const base = arg('path') || root
        if (!withinScopes(base, scopes)) return { error: `Path is outside the folder scope: ${base}` }
        if (!(await confirmMutation(`Create a git checkpoint commit in:\n${base}`))) {
          return { error: 'The user denied this checkpoint.' }
        }
        try {
          await execFileAsync('git', ['add', '-A'], { cwd: base, timeout: 30_000 })
          const { stdout } = await execFileAsync('git', ['commit', '-m', arg('message') || 'rue checkpoint'], {
            cwd: base,
            timeout: 30_000,
            maxBuffer: 2_000_000
          })
          return { content: stdout.trim() || 'Checkpoint committed.' }
        } catch (err) {
          const e = err as { stdout?: string }
          if (typeof e.stdout === 'string' && e.stdout.includes('nothing to commit')) {
            return { content: 'Nothing to commit — the working tree is already clean.' }
          }
          return { error: `Checkpoint failed: ${(err as Error).message}` }
        }
      }
      default:
        return { error: `Unknown built-in tool: ${name}` }
    }
  } catch (err) {
    return { error: (err as Error).message }
  }
}

export function registerToolsIpc(): void {
  ipcMain.handle('rue:tools:list', () => BUILTIN_TOOL_DEFS)
  ipcMain.handle(
    'rue:tools:call',
    (_e, name: string, args: Record<string, unknown>, scopes: ReadonlyArray<string>) =>
      executeBuiltinTool(name, args, Array.isArray(scopes) ? scopes : [])
  )
}
