import type { ToolDefinition } from '../openrouter.js'
import { toolPathArg } from '../toolEvents.js'
import type { PermissionDecision, Tool, ToolContext, ToolResult } from './types.js'

/**
 * Adapt Rue's main-process built-in tools (read_file, edit_file, bash, …)
 * into registry `Tool`s. Each one's `call` is a thin IPC proxy to
 * `window.rue.tools.call`; the actual file/shell work — and the mutation
 * confirmation dialog — still runs in the main process.
 */

const READ_ONLY_TOOLS: ReadonlySet<string> = new Set(['read_file', 'grep', 'glob', 'verify'])

export function loadBuiltinTools(defs: ReadonlyArray<ToolDefinition>): ReadonlyArray<Tool> {
  return defs.map(toBuiltinTool)
}

function toBuiltinTool(def: ToolDefinition): Tool {
  const name = def.function.name
  return {
    name,
    description: def.function.description,
    parameters: def.function.parameters,
    source: 'builtin',
    defer: false,
    readOnly: READ_ONLY_TOOLS.has(name),
    parseInput: raw => (raw && typeof raw === 'object' ? raw : {}),
    checkPermissions: (input, ctx) => checkScope(input as Record<string, unknown>, ctx),
    call: async (input, ctx) => {
      const result = await window.rue.tools.call(name, input as Record<string, unknown>, ctx.scopes)
      return normalizeBuiltinResult(result)
    }
  }
}

/**
 * Folder-scope allowlist: a path argument must resolve inside one of the
 * chat's bound folders. (The main process enforces this too — this is the
 * fast, user-legible rejection.)
 */
function checkScope(input: Record<string, unknown>, ctx: ToolContext): PermissionDecision {
  const path = toolPathArg(input)
  if (ctx.scopes.length > 0 && path && !isWithinScopes(path, ctx.scopes)) {
    return { behavior: 'deny', reason: `Path "${path}" is outside this chat's folder scope.` }
  }
  return { behavior: 'allow' }
}

function isWithinScopes(path: string, scopes: ReadonlyArray<string>): boolean {
  // String-only normalization: the renderer has no Node `path`. Absolute
  // paths only — relative paths can't be checked here and are left to the
  // main process, which resolves and re-validates against the scopes.
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const target = norm(path)
  return scopes.some(scope => {
    const base = norm(scope)
    return target === base || target.startsWith(`${base}/`)
  })
}

/** Flatten the main process's varied result objects into a `ToolResult`. */
function normalizeBuiltinResult(result: unknown): ToolResult {
  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>
    if (typeof obj.error === 'string') return { content: obj.error, isError: true }
    if (typeof obj.content === 'string') return { content: obj.content }
    if (Array.isArray(obj.matches)) {
      return { content: obj.matches.length > 0 ? obj.matches.join('\n') : '(no matches)' }
    }
    if (typeof obj.stdout === 'string' || typeof obj.stderr === 'string') {
      const out = [obj.stdout, obj.stderr].filter(s => typeof s === 'string' && s).join('\n')
      return { content: out || '(no output)' }
    }
    if (obj.ok === true) {
      return { content: typeof obj.path === 'string' ? `Done: ${obj.path}` : 'Done' }
    }
  }
  if (typeof result === 'string') return { content: result }
  return { content: JSON.stringify(result, null, 2) }
}
