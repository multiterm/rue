import type { McpTool } from '../../../../preload/index.js'
import type { Tool, ToolResult } from './types.js'

/**
 * Adapt connected MCP servers' tools into registry `Tool`s. A server's tools
 * are deferred (hidden behind ToolSearch) once the count crosses a threshold —
 * a single chatty server otherwise floods the prompt.
 */

const SEP = '__'
const DEFER_THRESHOLD = 12

/** Registry name for an MCP tool: `<server>__<tool>`. */
export function mcpToolName(serverName: string, name: string): string {
  return `${serverName}${SEP}${name}`
}

/** Split a registry name back into its server + bare tool name. */
export function splitMcpToolName(combined: string): { serverName: string; name: string } {
  const idx = combined.indexOf(SEP)
  if (idx === -1) return { serverName: '', name: combined }
  return { serverName: combined.slice(0, idx), name: combined.slice(idx + SEP.length) }
}

export function loadMcpTools(mcpTools: ReadonlyArray<McpTool>): ReadonlyArray<Tool> {
  const defer = mcpTools.length > DEFER_THRESHOLD
  return mcpTools.map(tool => toMcpTool(tool, defer))
}

function toMcpTool(mcp: McpTool, defer: boolean): Tool {
  const hasSchema = mcp.inputSchema && Object.keys(mcp.inputSchema).length > 0
  return {
    name: mcpToolName(mcp.serverName, mcp.name),
    description: mcp.description || mcp.name,
    parameters: hasSchema ? mcp.inputSchema : { type: 'object', properties: {} },
    source: 'mcp',
    defer,
    readOnly: false,
    searchHint: `${mcp.serverName} ${mcp.name}`,
    parseInput: raw => (raw && typeof raw === 'object' ? raw : {}),
    checkPermissions: () => ({ behavior: 'allow' }),
    call: async input => {
      const result = await window.rue.mcp.callTool(
        mcp.serverName,
        mcp.name,
        input as Record<string, unknown>
      )
      return normalizeMcpResult(result)
    }
  }
}

/** Normalize an MCP `tools/call` response (content blocks) into a `ToolResult`. */
function normalizeMcpResult(result: unknown): ToolResult {
  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>
    if (typeof obj.error === 'string') return { content: obj.error, isError: true }
    if (Array.isArray(obj.content)) {
      const text = obj.content
        .map(part => {
          const block = part as Record<string, unknown>
          return typeof block.text === 'string' ? block.text : ''
        })
        .filter(Boolean)
        .join('\n')
      return { content: text || '(empty result)', isError: obj.isError === true }
    }
  }
  if (typeof result === 'string') return { content: result }
  return { content: JSON.stringify(result, null, 2) }
}
