import { z } from 'zod'
import { defineTool } from './define.js'
import type { ToolRegistry } from './registry.js'
import type { Tool } from './types.js'

/**
 * The ToolSearch tool. When many tools are available (e.g. an MCP server that
 * exposes dozens), they are deferred to keep the prompt small. The model calls
 * ToolSearch to fetch the schemas it needs; matched tools are revealed in the
 * registry and become callable on the next round.
 *
 * This is a factory, not a constant — the tool closes over the registry it
 * searches and reveals into.
 */
export function createToolSearchTool(registry: ToolRegistry): Tool {
  return defineTool({
    name: 'ToolSearch',
    description:
      'Find and load deferred tools by name or keyword. Use `select:Name1,Name2` ' +
      'to load specific tools, or free-text keywords to search. Loaded tools ' +
      'become callable on the next turn.',
    schema: z.object({
      query: z
        .string()
        .describe('Keywords, or `select:<name>[,<name>...]` for exact tools.'),
      max_results: z
        .number()
        .int()
        .positive()
        .max(25)
        .optional()
        .describe('Maximum tools to load (default 5).')
    }),
    readOnly: true,
    call: async input => {
      const matches = registry.search(input.query, input.max_results ?? 5)
      if (matches.length === 0) {
        return { content: `No deferred tools matched "${input.query}".` }
      }
      registry.reveal(matches.map(m => m.function.name))
      const block = matches
        .map(m => `<function>${JSON.stringify(m.function)}</function>`)
        .join('\n')
      return {
        content:
          `Loaded ${matches.length} tool(s). They are now callable:\n` +
          `<functions>\n${block}\n</functions>`
      }
    }
  })
}
