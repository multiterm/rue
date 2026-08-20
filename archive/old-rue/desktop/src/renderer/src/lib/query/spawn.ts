import type { McpTool, RueSettings, Skill } from '../../../../preload/index.js'
import type { ChatMessage, ToolDefinition } from '../openrouter.js'
import { agentSystemPrompt, type SubAgentSpawner } from '../tools/agentTool.js'
import { buildRegistry } from '../tools/index.js'
import { runQuery } from './runQuery.js'

/** Sub-agents get a tighter turn budget than the main session. */
const SUBAGENT_MAX_TURNS = 6

export interface SpawnerDeps {
  readonly builtinTools: ReadonlyArray<ToolDefinition>
  readonly mcpTools: ReadonlyArray<McpTool>
  readonly skills: ReadonlyArray<Skill>
  readonly settings: RueSettings
  readonly scopes: ReadonlyArray<string>
  readonly signal: AbortSignal
  readonly confirm: (reason: string) => Promise<boolean>
}

/**
 * Build the sub-agent spawner the `Agent` tool calls. Each sub-agent gets its
 * own registry — crucially WITHOUT the `Agent` tool, so sub-agents cannot
 * recurse — and runs the same {@link runQuery} loop. An `explore` agent gets a
 * read-only tool set.
 */
export function createSpawner(deps: SpawnerDeps): SubAgentSpawner {
  return async ({ agentType, prompt }) => {
    const registry = buildRegistry(deps.builtinTools, deps.mcpTools, deps.skills, {
      readOnlyOnly: agentType === 'explore'
    })
    const messages: ReadonlyArray<ChatMessage> = [
      { role: 'system', content: agentSystemPrompt(agentType) },
      { role: 'user', content: prompt }
    ]
    const result = await runQuery({
      messages,
      registry,
      settings: deps.settings,
      scopes: deps.scopes,
      signal: deps.signal,
      maxTurns: SUBAGENT_MAX_TURNS,
      confirm: deps.confirm
    })
    return { text: result.text, turns: result.turns }
  }
}
