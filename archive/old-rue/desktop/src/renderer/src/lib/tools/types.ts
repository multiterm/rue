import type { RueSettings } from '../../../../preload/index.js'

/**
 * The unified tool model for Rue's agentic loop. Built-in (main-process),
 * MCP, and — in later phases — skill / agent / memory tools all conform to
 * this single `Tool` shape so the loop dispatches them uniformly.
 *
 * `Tool` is intentionally NOT generic over its input: the registry stores a
 * heterogeneous collection, so input is erased to `unknown` at the boundary.
 * `defineTool` (define.ts) restores full typing inside a tool's own body.
 */

// #region -- Permissions --------------------------------

/** The verdict `checkPermissions` returns before a tool runs. */
export type PermissionDecision =
  | { readonly behavior: 'allow' }
  | { readonly behavior: 'deny'; readonly reason: string }
  | { readonly behavior: 'ask'; readonly reason: string }

// #endregion -- Permissions -----------------------------

// #region -- Execution context --------------------------

/** Ambient state handed to every tool invocation. */
export interface ToolContext {
  /** Folder scopes bound to the active chat — the file-tool allowlist. */
  readonly scopes: ReadonlyArray<string>
  readonly settings: RueSettings
  /** Aborts when the user stops generation. */
  readonly signal: AbortSignal
  /** Resolve an `ask` permission decision. The loop wires this to a prompt. */
  readonly confirm: (reason: string) => Promise<boolean>
  /**
   * Attach an image (data URL) to the conversation — it is appended to the
   * tool-result message so the model can see it. Used by CameraCapture.
   */
  readonly addImage?: (dataUrl: string) => void
}

/** What a tool hands back to the loop (and, as text, to the model). */
export interface ToolResult {
  /** Text appended to the conversation as the tool result. */
  readonly content: string
  /** When true, the model is told the call failed. */
  readonly isError?: boolean
}

// #endregion -- Execution context -----------------------

// #region -- Tool ---------------------------------------

/** Origin of a tool — drives deferral defaults and UI grouping. */
export type ToolSource = 'builtin' | 'mcp' | 'skill' | 'agent' | 'memory'

export interface Tool {
  readonly name: string
  readonly description: string
  /** JSON Schema for the tool's input, sent verbatim to the model API. */
  readonly parameters: Record<string, unknown>
  readonly source: ToolSource
  /** Hidden from the initial prompt; revealed on demand via ToolSearch. */
  readonly defer: boolean
  /** Makes no changes and is safe to run alongside other tools. */
  readonly readOnly: boolean
  /** Extra keywords ToolSearch indexes beyond name + description. */
  readonly searchHint?: string
  /** Validate + coerce raw model arguments. Throws on invalid input. */
  parseInput(raw: unknown): unknown
  checkPermissions(input: unknown, ctx: ToolContext): PermissionDecision
  call(input: unknown, ctx: ToolContext): Promise<ToolResult>
}

// #endregion -- Tool ------------------------------------
