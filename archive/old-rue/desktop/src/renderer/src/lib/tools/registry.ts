import type { ToolDefinition } from '../openrouter.js'
import type { Tool, ToolContext, ToolResult } from './types.js'

/**
 * The tool registry — the single source of truth for what tools exist, which
 * are exposed to the model, and how a tool call is dispatched.
 *
 * Deferral: deferred tools are kept out of the initial prompt to save context.
 * When the model calls ToolSearch, matched tools are `reveal`ed and from then
 * on appear in `apiTools()`. The loop re-reads `apiTools()` every round, so a
 * reveal in round N takes effect in round N+1.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>()
  private readonly revealed = new Set<string>()

  register(tool: Tool): void {
    this.tools.set(tool.name, tool)
  }

  registerAll(tools: Iterable<Tool>): void {
    for (const tool of tools) this.register(tool)
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  all(): ReadonlyArray<Tool> {
    return [...this.tools.values()]
  }

  /** True once any registered tool is deferred — gates ToolSearch wiring. */
  hasDeferredTools(): boolean {
    return this.all().some(t => t.defer)
  }

  /** Tool definitions for the model API: non-deferred tools + revealed ones. */
  apiTools(): ReadonlyArray<ToolDefinition> {
    return this.all()
      .filter(tool => !tool.defer || this.revealed.has(tool.name))
      .map(toApiDefinition)
  }

  /** Mark deferred tools as visible to the model from the next round on. */
  reveal(names: ReadonlyArray<string>): void {
    for (const name of names) {
      if (this.tools.has(name)) this.revealed.add(name)
    }
  }

  /**
   * ToolSearch backend. Supports `select:Name1,Name2` for exact selection and
   * free-text keyword matching, ranked by hits across name/description/hint.
   */
  search(query: string, maxResults: number): ReadonlyArray<ToolDefinition> {
    const deferred = this.all().filter(t => t.defer)
    const trimmed = query.trim()

    if (trimmed.toLowerCase().startsWith('select:')) {
      const names = new Set(
        trimmed.slice('select:'.length).split(',').map(s => s.trim()).filter(Boolean)
      )
      return deferred.filter(t => names.has(t.name)).map(toApiDefinition)
    }

    const terms = trimmed.toLowerCase().split(/\s+/).filter(Boolean)
    if (terms.length === 0) return []
    return deferred
      .map(tool => ({ tool, score: scoreTool(tool, terms) }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, maxResults))
      .map(entry => toApiDefinition(entry.tool))
  }

  /**
   * Run a tool call end-to-end: validate input, check permissions (resolving
   * `ask` via `ctx.confirm`), execute. Always resolves — failures come back as
   * `{ isError: true }` so one bad call never breaks the loop.
   */
  async dispatch(name: string, rawArgs: unknown, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (!tool) return { content: `Unknown tool: ${name}`, isError: true }

    let input: unknown
    try {
      input = tool.parseInput(rawArgs)
    } catch (err) {
      return { content: `Invalid arguments for ${name}: ${(err as Error).message}`, isError: true }
    }

    const permission = tool.checkPermissions(input, ctx)
    if (permission.behavior === 'deny') {
      return { content: `Denied: ${permission.reason}`, isError: true }
    }
    if (permission.behavior === 'ask') {
      const approved = await ctx.confirm(permission.reason)
      if (!approved) {
        return { content: `The user declined: ${permission.reason}`, isError: true }
      }
    }

    try {
      return await tool.call(input, ctx)
    } catch (err) {
      return { content: `${name} failed: ${(err as Error).message}`, isError: true }
    }
  }
}

function toApiDefinition(tool: Tool): ToolDefinition {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || tool.name,
      parameters:
        Object.keys(tool.parameters).length > 0
          ? tool.parameters
          : { type: 'object', properties: {} }
    }
  }
}

function scoreTool(tool: Tool, terms: ReadonlyArray<string>): number {
  const haystack = `${tool.name} ${tool.description} ${tool.searchHint ?? ''}`.toLowerCase()
  let score = 0
  for (const term of terms) {
    if (tool.name.toLowerCase().includes(term)) score += 3
    else if (haystack.includes(term)) score += 1
  }
  return score
}
