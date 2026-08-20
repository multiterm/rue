import { z } from 'zod'
import { defineTool } from './define.js'
import type { Tool } from './types.js'

/**
 * The Agent tool — delegate a self-contained task to a sub-agent. The sub-agent
 * runs its own query loop with its own tool set and reports a result back.
 *
 * Sub-agents are spawned via an injected {@link SubAgentSpawner} so this module
 * stays decoupled from the query loop (no import cycle).
 */

export type AgentType = 'general' | 'explore'

export interface SubAgentResult {
  readonly text: string
  readonly turns: number
}

export type SubAgentSpawner = (input: {
  readonly agentType: AgentType
  readonly prompt: string
}) => Promise<SubAgentResult>

interface AgentTypeInfo {
  readonly id: AgentType
  readonly summary: string
}

const AGENT_TYPES: ReadonlyArray<AgentTypeInfo> = [
  { id: 'general', summary: 'General-purpose sub-agent with the full tool set.' },
  { id: 'explore', summary: 'Read-only research sub-agent — investigates and reports, changes nothing.' }
]

/** The system prompt that frames a sub-agent of the given type. */
export function agentSystemPrompt(type: AgentType): string {
  if (type === 'explore') {
    return (
      'You are a research sub-agent. Investigate the assigned task using the ' +
      'available read-only tools and report your findings concisely. You cannot ' +
      'modify anything — do not attempt to.'
    )
  }
  return (
    'You are a focused sub-agent. Complete the assigned task using the available ' +
    'tools and report the result concisely. Do only what was asked.'
  )
}

export function createAgentTool(spawn: SubAgentSpawner): Tool {
  return defineTool({
    name: 'Agent',
    description:
      'Delegate a self-contained task to a sub-agent that runs its own tool ' +
      'loop and reports back. Use this for focused research or a well-scoped ' +
      'unit of work. Agent types:\n' +
      AGENT_TYPES.map(a => `- ${a.id}: ${a.summary}`).join('\n'),
    schema: z.object({
      description: z.string().describe('A short 3-7 word task description.'),
      prompt: z.string().describe('Full, self-contained instructions for the sub-agent.'),
      agent_type: z
        .enum(['general', 'explore'])
        .optional()
        .describe('Sub-agent type (default: general).')
    }),
    source: 'agent',
    readOnly: false,
    call: async input => {
      const result = await spawn({ agentType: input.agent_type ?? 'general', prompt: input.prompt })
      return { content: result.text || '(the sub-agent produced no output)' }
    }
  })
}
