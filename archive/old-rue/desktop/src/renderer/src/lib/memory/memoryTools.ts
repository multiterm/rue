import { z } from 'zod'
import { defineTool } from '../tools/define.js'
import type { Tool } from '../tools/types.js'

/**
 * Temporal memory tools. `MemoryWrite` persists a durable note; `MemoryRead`
 * fetches one by name (the memory index is injected into the system prompt, so
 * the model already knows which memories exist). A recalled memory carries its
 * freshness caveat when it has aged.
 */
export function createMemoryTools(): ReadonlyArray<Tool> {
  return [memoryWrite, memoryRead]
}

const memoryWrite = defineTool({
  name: 'MemoryWrite',
  description:
    'Save a durable memory for future sessions. Use it for facts about the ' +
    'user, their feedback/preferences, ongoing project context, or external ' +
    'references — NOT for things derivable from the code or git history.',
  schema: z.object({
    name: z.string().describe('Short kebab-case identifier, e.g. "deploy-process".'),
    description: z.string().describe('One-line summary — used later to judge relevance.'),
    type: z
      .enum(['user', 'feedback', 'project', 'reference'])
      .describe('user = who they are; feedback = how to work; project = ongoing work; reference = external pointers.'),
    content: z.string().describe('The memory content itself.')
  }),
  source: 'memory',
  readOnly: false,
  call: async input => {
    const memory = await window.rue.memory.write(input)
    return { content: `Saved memory "${memory.name}" (${memory.type}).` }
  }
})

const memoryRead = defineTool({
  name: 'MemoryRead',
  description: 'Read the full content of a saved memory by name (see the memory index in your context).',
  schema: z.object({ name: z.string().describe('The memory name to read.') }),
  source: 'memory',
  readOnly: true,
  call: async input => {
    const memory = await window.rue.memory.read(input.name)
    if (!memory) {
      return { content: `No memory named "${input.name}".`, isError: true }
    }
    // An aged memory is prefixed with its freshness caveat.
    const prefix = memory.freshness ? `${memory.freshness}\n\n` : ''
    return { content: `${prefix}${memory.content}` }
  }
})
