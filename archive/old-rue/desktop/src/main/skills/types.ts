/**
 * A skill — a named, reusable instruction set. Skills are invoked two ways:
 * by the user as a slash command, and by the model via the `Skill` tool.
 *
 * The shape is deliberately plain + serializable: it crosses the IPC boundary
 * (disk skills loaded in the main process, consumed in the renderer).
 */
export interface Skill {
  readonly name: string
  readonly description: string
  /** When the model should reach for this skill. Surfaced in the tool catalog. */
  readonly whenToUse?: string
  /** Hint shown next to the skill's argument input, e.g. `<file pattern>`. */
  readonly argumentHint?: string
  /** Prompt template. `$ARGUMENTS` is substituted at invocation time. */
  readonly body: string
  readonly source: 'bundled' | 'user' | 'project' | 'mcp'
  /** Invocable by the user via a slash command. */
  readonly userInvocable: boolean
  /** Invocable by the model via the `Skill` tool. */
  readonly modelInvocable: boolean
  /**
   * Set when the skill is an MCP server prompt. The body is empty — invoking
   * the skill fetches the rendered prompt from the server via `prompts/get`.
   */
  readonly mcp?: { readonly server: string; readonly prompt: string }
}
