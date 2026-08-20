import { z } from 'zod'
import { defineTool } from './define.js'
import type { Tool } from './types.js'

/**
 * Tools for browsing MCP server resources. Both are deferred — they only
 * matter once the model decides it wants server-side context, so they sit
 * behind ToolSearch rather than spending prompt budget up front.
 */
export function createMcpResourceTools(): ReadonlyArray<Tool> {
  return [listMcpResources, readMcpResource]
}

const listMcpResources = defineTool({
  name: 'ListMcpResources',
  description: 'List the resources exposed by connected MCP servers.',
  schema: z.object({}),
  source: 'mcp',
  defer: true,
  readOnly: true,
  searchHint: 'mcp resource list browse',
  call: async () => {
    const resources = await window.rue.mcp.listResources()
    if (resources.length === 0) return { content: 'No MCP resources are available.' }
    return {
      content: resources
        .map(resource => {
          const label = resource.name && resource.name !== resource.uri ? ` — ${resource.name}` : ''
          const desc = resource.description ? `: ${resource.description}` : ''
          return `- [${resource.serverName}] ${resource.uri}${label}${desc}`
        })
        .join('\n')
    }
  }
})

const readMcpResource = defineTool({
  name: 'ReadMcpResource',
  description: 'Read the contents of a resource from a connected MCP server.',
  schema: z.object({
    server: z.string().describe('MCP server name (from ListMcpResources).'),
    uri: z.string().describe('Resource URI (from ListMcpResources).')
  }),
  source: 'mcp',
  defer: true,
  readOnly: true,
  searchHint: 'mcp resource read fetch',
  call: async input => {
    try {
      const content = await window.rue.mcp.readResource(input.server, input.uri)
      return { content: content || '(the resource is empty)' }
    } catch (err) {
      return { content: `Failed to read resource: ${(err as Error).message}`, isError: true }
    }
  }
})
