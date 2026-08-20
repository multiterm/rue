/**
 * Wire-shape types shared by every provider adapter.
 *
 * Lifted verbatim from the old @multiterm/rue-desktop renderer/lib/openrouter.ts to
 * keep the existing test fixtures compatible. The naming follows OpenAI's
 * conventions because three of our four formerly-supported providers spoke
 * OpenAI-compatible JSON; Anthropic gets a small adapter inside its module.
 */

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: ChatContent
}

export type ChatContent = string | ReadonlyArray<TextPart | ImagePart>

export interface TextPart {
  readonly type: 'text'
  readonly text: string
}

export interface ImagePart {
  readonly type: 'image_url'
  readonly image_url: { readonly url: string }
}

export interface ToolDefinition {
  readonly type: 'function'
  readonly function: {
    readonly name: string
    readonly description: string
    readonly parameters: Record<string, unknown>
  }
}

export interface ToolCall {
  readonly id: string
  readonly name: string
  readonly arguments: string
}

export interface ChatRequest {
  readonly apiKey: string
  readonly model: string
  readonly messages: ReadonlyArray<ChatMessage>
  readonly tools?: ReadonlyArray<ToolDefinition>
  readonly signal?: AbortSignal
  /** Cap on output tokens. Defaults to {@link DEFAULT_MAX_OUTPUT_TOKENS}. */
  readonly maxTokens?: number
}

export interface ChatToolResponse {
  readonly content: string
  readonly toolCalls: ReadonlyArray<ToolCall>
  /** True when the response was cut off by the output-token cap. */
  readonly truncated?: boolean
}

/** Default output-token cap, shared by every provider adapter. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 4096

/**
 * Provider classifier — the runtime contract the session loop programs
 * against. Hides the differences between OpenRouter / Anthropic / Ollama
 * behind one streaming function.
 */
export interface Provider {
  readonly id: string
  /**
   * Run one turn. Stream text deltas via `onText` (cumulative deltas, not
   * cumulative text). Resolve with the finalized tool-aware response.
   */
  chat(
    req: ChatRequest,
    onText: (delta: string) => void,
  ): Promise<ChatToolResponse>
}

/** A provider-specific error with the HTTP status that produced it. */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly providerId: string,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

/**
 * Detect context-overflow errors thrown by provider adapters.
 *
 * Kept here so it sits next to the error type that produced it. Compaction
 * code imports this rather than duplicating the heuristic.
 */
export function isContextOverflow(err: unknown): boolean {
  const e = err as { status?: number; message?: string }
  if (e.status !== 400) return false
  const msg = (e.message ?? '').toLowerCase()
  return (
    msg.includes('context') ||
    msg.includes('too long') ||
    msg.includes('maximum') ||
    msg.includes('token')
  )
}
