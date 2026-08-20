import type { McpTool, Skill } from '../../../../preload/index.js'
import type { ToolDefinition } from '../openrouter.js'
import { createMemoryTools } from '../memory/memoryTools.js'
import { createSkillTool } from '../skills/skillTool.js'
import { createAgentTool, type SubAgentSpawner } from './agentTool.js'
import { createCameraTool } from './cameraTool.js'
import { createDictateTool } from './voiceTool.js'
import { loadBuiltinTools } from './builtins.js'
import { loadMcpTools } from './mcpTools.js'
import { createMcpResourceTools } from './mcpResourceTools.js'
import { ToolRegistry } from './registry.js'
import { createScheduleTools } from './scheduleTools.js'
import { createTaskTools } from './taskTool.js'
import { createToolSearchTool } from './toolSearch.js'
import type { Tool } from './types.js'

export interface BuildRegistryOptions {
  /** When set, registers the `Agent` tool that spawns sub-agents. */
  readonly spawn?: SubAgentSpawner
  /** Keep only read-only tools — used for `explore` sub-agents. */
  readonly readOnlyOnly?: boolean
  /** Registers the session tools — task checklist + agentic scheduling. */
  readonly includeTaskTools?: boolean
}

/**
 * Assemble a tool registry for a turn: built-in (main-process) tools, MCP
 * tools + resource tools, the `Skill` meta-tool, optional Task + Agent tools,
 * and — when anything is deferred — the ToolSearch tool that surfaces them.
 */
export function buildRegistry(
  builtinDefs: ReadonlyArray<ToolDefinition>,
  mcpTools: ReadonlyArray<McpTool>,
  skills: ReadonlyArray<Skill> = [],
  options: BuildRegistryOptions = {}
): ToolRegistry {
  const registry = new ToolRegistry()
  const keep = (tool: Tool): boolean => !options.readOnlyOnly || tool.readOnly

  for (const tool of loadBuiltinTools(builtinDefs)) if (keep(tool)) registry.register(tool)
  for (const tool of loadMcpTools(mcpTools)) if (keep(tool)) registry.register(tool)
  if (mcpTools.length > 0) {
    registry.registerAll(createMcpResourceTools())
  }
  if (skills.some(skill => skill.modelInvocable)) {
    registry.register(createSkillTool(skills))
  }
  for (const tool of createMemoryTools()) if (keep(tool)) registry.register(tool)
  for (const tool of [createCameraTool(), createDictateTool()]) if (keep(tool)) registry.register(tool)
  if (options.includeTaskTools) {
    registry.registerAll(createTaskTools())
    registry.registerAll(createScheduleTools())
  }
  if (options.spawn) {
    registry.register(createAgentTool(options.spawn))
  }
  if (registry.hasDeferredTools()) {
    registry.register(createToolSearchTool(registry))
  }
  return registry
}

export { ToolRegistry } from './registry.js'
export { defineTool } from './define.js'
export { mcpToolName, splitMcpToolName } from './mcpTools.js'
export type { Tool, ToolContext, ToolResult, PermissionDecision, ToolSource } from './types.js'
