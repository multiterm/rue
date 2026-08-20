/**
 * Structured tool-call events for the agentic loop. `runAgenticLoop` emits
 * one per MCP tool invocation; the renderer draws them as cards.
 */

export type ToolKind = 'read' | 'edit' | 'write' | 'search' | 'run' | 'fetch' | 'tool'
export type ToolStatus = 'running' | 'done' | 'error'

export interface ToolEvent {
  readonly id: string
  /** Server-qualified tool name, e.g. `fs__edit_file`. */
  readonly name: string
  /** Human label, e.g. `Edit(window.ts)`. */
  readonly title: string
  readonly kind: ToolKind
  readonly status: ToolStatus
  /** One-line result, e.g. `+12 −3` or `1.2 KB`. */
  readonly summary?: string
  /** Expandable body — a diff, command output, or raw result. */
  readonly detail?: string
}

function truncate(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function basename(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function pickArg(args: Record<string, unknown>, keys: ReadonlyArray<string>): string | undefined {
  for (const k of keys) {
    const v = args[k]
    if (typeof v === 'string' && v.trim()) return v
  }
  return undefined
}

/** The file-path argument of a tool call, if it has one. */
export function toolPathArg(args: Record<string, unknown>): string | undefined {
  return pickArg(args, ['path', 'file_path', 'filePath', 'filename', 'file', 'dir', 'directory'])
}

/** Heuristically classify a bare tool name into a card kind. */
export function classifyTool(name: string): ToolKind {
  const n = name.toLowerCase()
  if (/edit|replace|patch|modify|apply_diff/.test(n)) return 'edit'
  if (/write|create_file|new_file|save_file/.test(n)) return 'write'
  if (/read|cat|view_file|get_file|open_file|file_content/.test(n)) return 'read'
  if (/search|grep|find|glob|list_dir|list_files/.test(n)) return 'search'
  if (/run|exec|bash|shell|command|terminal/.test(n)) return 'run'
  if (/fetch|http|web|browse|crawl/.test(n)) return 'fetch'
  return 'tool'
}

const VERB: Record<ToolKind, string> = {
  read: 'Read',
  edit: 'Edit',
  write: 'Write',
  search: 'Search',
  run: 'Run',
  fetch: 'Fetch',
  tool: 'Tool'
}

/** Build the card title from the tool kind, bare name, and arguments. */
export function toolTitle(kind: ToolKind, bareName: string, args: Record<string, unknown>): string {
  const path = pickArg(args, ['path', 'file_path', 'filePath', 'filename', 'file'])
  if ((kind === 'read' || kind === 'edit' || kind === 'write') && path) {
    return `${VERB[kind]}(${basename(path)})`
  }
  if (kind === 'search') {
    const q = pickArg(args, ['query', 'pattern', 'q', 'search'])
    return q ? `Search(${truncate(q, 32)})` : 'Search'
  }
  if (kind === 'run') {
    const cmd = pickArg(args, ['command', 'cmd', 'script'])
    return cmd ? `Run(${truncate(cmd, 40)})` : 'Run'
  }
  if (kind === 'fetch') {
    const url = pickArg(args, ['url', 'uri', 'href'])
    return url ? `Fetch(${hostOf(url)})` : 'Fetch'
  }
  return bareName
}

/** Normalize an MCP `callTool` result (or our `{ error }` wrapper) to text. */
function resultToText(result: unknown): { text: string; isError: boolean } {
  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>
    if (typeof obj.error === 'string') return { text: obj.error, isError: true }
    if (Array.isArray(obj.content)) {
      const text = obj.content
        .map(part => {
          const p = part as Record<string, unknown>
          return typeof p.text === 'string' ? p.text : ''
        })
        .filter(Boolean)
        .join('\n')
      return { text, isError: obj.isError === true }
    }
  }
  if (typeof result === 'string') return { text: result, isError: false }
  return { text: JSON.stringify(result, null, 2), isError: false }
}

/** Count added/removed lines from an edit tool's old/new string arguments. */
function diffFromArgs(args: Record<string, unknown>): { summary: string; detail: string } | null {
  const oldStr = pickArg(args, ['old_str', 'old_string', 'oldText', 'old', 'search'])
  const newStr = pickArg(args, ['new_str', 'new_string', 'newText', 'new', 'replace'])
  if (oldStr === undefined && newStr === undefined) return null
  const oldLines = oldStr ? oldStr.split('\n') : []
  const newLines = newStr ? newStr.split('\n') : []
  const detail = [...oldLines.map(l => `-${l}`), ...newLines.map(l => `+${l}`)].join('\n')
  return { summary: `+${newLines.length} −${oldLines.length}`, detail }
}

/** Finish a running event: derive status, summary and detail from the result. */
export function finishToolEvent(
  base: ToolEvent,
  args: Record<string, unknown>,
  result: unknown
): ToolEvent {
  const { text, isError } = resultToText(result)
  if (isError) {
    return { ...base, status: 'error', summary: truncate(text, 80) || 'failed', detail: text }
  }
  if (base.kind === 'edit' || base.kind === 'write') {
    const diff = diffFromArgs(args)
    if (diff) return { ...base, status: 'done', summary: diff.summary, detail: text || diff.detail }
  }
  const lineCount = text ? text.split('\n').length : 0
  const summary = text
    ? base.kind === 'search' || base.kind === 'read'
      ? `${lineCount} line${lineCount === 1 ? '' : 's'}`
      : truncate(text, 64)
    : 'done'
  return { ...base, status: 'done', summary, detail: text || undefined }
}
