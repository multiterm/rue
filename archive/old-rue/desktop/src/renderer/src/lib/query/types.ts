import type { RueSettings } from '../../../../preload/index.js'
import type { ChatMessage } from '../openrouter.js'
import type { ToolEvent } from '../toolEvents.js'
import type { ToolRegistry } from '../tools/index.js'

/** Why a query loop stopped. */
export type StopReason = 'completed' | 'max_turns' | 'token_budget' | 'aborted'

export interface QueryConfig {
  readonly messages: ReadonlyArray<ChatMessage>
  readonly registry: ToolRegistry
  readonly settings: RueSettings
  /** Folder scopes for the active chat — passed to every tool. */
  readonly scopes: ReadonlyArray<string>
  readonly signal: AbortSignal
  /** Hard cap on model turns before the loop gives up. */
  readonly maxTurns?: number
  /** Resolve an `ask` permission decision. Defaults to auto-allow. */
  readonly confirm?: (reason: string) => Promise<boolean>
}

/** A single structured trace record emitted by the loop for debug mode. */
export interface DebugEntry {
  readonly time: number
  readonly turn: number
  readonly kind: 'turn' | 'model' | 'tool' | 'recovery' | 'terminal'
  readonly message: string
  readonly detail?: Record<string, unknown>
}

/**
 * A discrete event the query state machine yields. High-frequency streaming
 * text deltas are delivered through {@link QueryCallbacks.onAssistantText}
 * directly rather than as events — only turn-level transitions are events.
 */
export type QueryEvent =
  | { readonly type: 'assistant'; readonly text: string; readonly streaming: boolean }
  | { readonly type: 'tool'; readonly event: ToolEvent }
  | { readonly type: 'status'; readonly status: string | null }
  | { readonly type: 'debug'; readonly entry: DebugEntry }

/** Hooks the loop drives — the main session wires these to React state. */
export interface QueryCallbacks {
  readonly onAssistantText?: (text: string, streaming: boolean) => void
  readonly onToolEvent?: (event: ToolEvent) => void
  readonly onStatus?: (status: string | null) => void
  readonly onFirstToken?: () => void
  /** Structured loop trace — wired only when debug mode is enabled. */
  readonly onDebug?: (entry: DebugEntry) => void
}

export interface QueryResult {
  readonly text: string
  readonly turns: number
  readonly stopReason: StopReason
}
