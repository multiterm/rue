import {
  chatWithTools,
  type ChatMessage,
  type ChatToolResponse,
  type ImagePart,
  type TextPart,
  type ToolDefinition
} from '../openrouter.js'
import { chatStreamWithToolsAnthropic } from '../anthropic.js'
import { chatOllama } from '../ollama.js'
import { classifyTool, finishToolEvent, toolTitle, type ToolEvent } from '../toolEvents.js'
import type { ToolContext } from '../tools/index.js'
import { compactConversation, estimateTokens, isContextOverflow } from './compaction.js'
import type {
  DebugEntry,
  QueryCallbacks,
  QueryConfig,
  QueryEvent,
  QueryResult,
  StopReason
} from './types.js'

/** Default ceiling on model turns — orders of magnitude above normal use. */
export const DEFAULT_MAX_TURNS = 8

/** Soft context cap: compact the history before it grows unmanageably large. */
const TOKEN_BUDGET = 120_000

/** Attempts for transient model errors, and for context-overflow recovery. */
const MAX_RETRIES = 3

/** Raised output-token cap used when a turn is cut off by the default cap. */
const ESCALATED_MAX_OUTPUT_TOKENS = 32_768

// #region -- State machine -------------------------------

/** Immutable snapshot the loop carries from one turn to the next. */
interface QueryState {
  /** The running conversation. Mutated in place within a turn, replaced on recovery. */
  readonly conversation: ChatMessage[]
  readonly turn: number
  /** Recovery re-entries so far — bounds compaction/retry attempts. */
  readonly recoveries: number
  /** Set for one turn after an output-token-cap escalation re-entry. */
  readonly maxTokensOverride?: number
}

/**
 * The agentic query loop, as a generator-based state machine. Each `while`
 * iteration is one turn: call the model, dispatch any tools, feed results
 * back. Two recovery sub-loops re-enter via `continue` instead of failing:
 *
 *   - proactive: history over {@link TOKEN_BUDGET} is compacted before the call
 *   - reactive:  a context-overflow error compacts and retries the same turn
 *
 * Turn-level transitions are `yield`ed as {@link QueryEvent}s; streaming text
 * deltas go straight to `onStreamText` (too frequent to be worth eventing).
 */
async function* queryLoop(
  config: QueryConfig,
  ctx: ToolContext,
  pendingImages: string[],
  onStreamText: (textSoFar: string) => void
): AsyncGenerator<QueryEvent, QueryResult> {
  const maxTurns = config.maxTurns ?? DEFAULT_MAX_TURNS
  let state: QueryState = { conversation: [...config.messages], turn: 0, recoveries: 0 }
  let finalText = ''

  while (true) {
    const { conversation, turn, recoveries, maxTokensOverride } = state

    if (config.signal.aborted) return terminal(finalText, turn, 'aborted')

    // Proactive context recovery — compact before the model rejects the call.
    if (estimateTokens(conversation) > TOKEN_BUDGET) {
      const compacted = compactConversation(conversation)
      if (!compacted) return terminal(finalText, turn, 'token_budget')
      yield debug(turn, 'recovery', 'History over budget — compacted', {
        from: conversation.length,
        to: compacted.length
      })
      state = { conversation: compacted, turn, recoveries: recoveries + 1 }
      continue
    }

    yield debug(turn, 'turn', `Turn ${turn + 1} — calling model`, { messages: conversation.length })

    const tools = config.registry.apiTools()
    let reply: ChatToolResponse
    try {
      reply = await callModel(conversation, tools, config, maxTokensOverride, onStreamText)
    } catch (err) {
      // Reactive context recovery — the model rejected the prompt as too long.
      if (isContextOverflow(err) && recoveries < MAX_RETRIES) {
        const compacted = compactConversation(conversation)
        if (compacted) {
          yield debug(turn, 'recovery', 'Model rejected prompt — compacted and retrying')
          state = { conversation: compacted, turn, recoveries: recoveries + 1 }
          continue
        }
      }
      throw err
    }

    yield debug(turn, 'model', 'Model replied', {
      textChars: reply.content.length,
      toolCalls: reply.toolCalls.length
    })

    // Output-token recovery — the turn was cut off by the cap. Raise the cap
    // and retry the same turn, but only once (maxTokensOverride still unset).
    if (reply.truncated && maxTokensOverride === undefined && recoveries < MAX_RETRIES) {
      yield debug(turn, 'recovery', 'Response hit the output-token cap — raising it and retrying')
      state = {
        conversation,
        turn,
        recoveries: recoveries + 1,
        maxTokensOverride: ESCALATED_MAX_OUTPUT_TOKENS
      }
      continue
    }

    // Plain text and no tool calls — the turn is the final answer.
    if (reply.toolCalls.length === 0) {
      finalText = reply.content
      yield { type: 'assistant', text: finalText, streaming: false }
      return terminal(finalText, turn + 1, 'completed')
    }

    conversation.push({ role: 'assistant', content: reply.content || '(using tools…)' })
    yield { type: 'assistant', text: reply.content || '(running tools…)', streaming: true }

    const toolResults: string[] = []
    for (const call of reply.toolCalls) {
      if (config.signal.aborted) break
      const args = parseArgs(call.arguments)
      // MCP tools are named `<server>__<tool>`; classify on the bare name.
      const bareName = call.name.includes('__')
        ? call.name.slice(call.name.indexOf('__') + 2)
        : call.name
      const kind = classifyTool(bareName)
      const event: ToolEvent = {
        id: call.id || `${call.name}-t${turn}-${conversation.length}`,
        name: call.name,
        kind,
        title: toolTitle(kind, bareName, args),
        status: 'running'
      }
      yield { type: 'tool', event }
      yield { type: 'status', status: `${event.title}…` }
      yield debug(turn, 'tool', `→ ${call.name}`, { args })
      const dispatched = await config.registry.dispatch(call.name, args, ctx)
      yield {
        type: 'tool',
        event: finishToolEvent(
          event,
          args,
          dispatched.isError ? { error: dispatched.content } : dispatched.content
        )
      }
      yield debug(turn, 'tool', `← ${call.name}`, {
        isError: dispatched.isError ?? false,
        chars: dispatched.content.length
      })
      toolResults.push(`[Tool ${call.name} → ${dispatched.content.slice(0, 2000)}]`)
    }
    conversation.push({ role: 'user', content: buildToolResultMessage(toolResults, pendingImages) })
    pendingImages.length = 0
    yield { type: 'status', status: null }

    const nextTurn = turn + 1
    if (nextTurn >= maxTurns) {
      yield debug(nextTurn, 'terminal', 'Reached the turn limit')
      return terminal(
        finalText || '(reached the turn limit without a final response)',
        nextTurn,
        'max_turns'
      )
    }
    state = { conversation, turn: nextTurn, recoveries }
  }
}

// #endregion -- State machine ----------------------------

// #region -- Public driver -------------------------------

/**
 * Drive {@link queryLoop} to completion, mapping its events onto callbacks.
 * Provider-agnostic and reused for sub-agents (see spawn.ts).
 */
export async function runQuery(config: QueryConfig, cb: QueryCallbacks = {}): Promise<QueryResult> {
  // Images a tool attaches (e.g. CameraCapture) ride along on the next
  // tool-result message so the model can see them.
  const pendingImages: string[] = []
  const ctx: ToolContext = {
    scopes: config.scopes,
    settings: config.settings,
    signal: config.signal,
    confirm: config.confirm ?? (async () => true),
    addImage: dataUrl => pendingImages.push(dataUrl)
  }

  let firstToken = false
  const onStreamText = (textSoFar: string): void => {
    if (!firstToken) {
      firstToken = true
      cb.onFirstToken?.()
    }
    cb.onAssistantText?.(textSoFar, true)
  }

  const loop = queryLoop(config, ctx, pendingImages, onStreamText)
  let step = await loop.next()
  while (!step.done) {
    applyEvent(step.value, cb)
    step = await loop.next()
  }
  return step.value
}

function applyEvent(event: QueryEvent, cb: QueryCallbacks): void {
  switch (event.type) {
    case 'assistant':
      cb.onAssistantText?.(event.text, event.streaming)
      break
    case 'tool':
      cb.onToolEvent?.(event.event)
      break
    case 'status':
      cb.onStatus?.(event.status)
      break
    case 'debug':
      cb.onDebug?.(event.entry)
      break
  }
}

// #endregion -- Public driver ----------------------------

// #region -- Model calls ---------------------------------

/** Call the model for one turn, retrying transient failures with backoff. */
async function callModel(
  conversation: ReadonlyArray<ChatMessage>,
  tools: ReadonlyArray<ToolDefinition>,
  config: QueryConfig,
  maxTokens: number | undefined,
  onText: (textSoFar: string) => void
): Promise<ChatToolResponse> {
  let attempt = 0
  while (true) {
    try {
      return await callModelOnce(conversation, tools, config, maxTokens, onText)
    } catch (err) {
      attempt++
      if (attempt >= MAX_RETRIES || !isTransient(err)) throw err
      await delay(800 * 2 ** (attempt - 1))
    }
  }
}

/** One model request. Anthropic streams text deltas via `onText`. */
async function callModelOnce(
  conversation: ReadonlyArray<ChatMessage>,
  tools: ReadonlyArray<ToolDefinition>,
  config: QueryConfig,
  maxTokens: number | undefined,
  onText: (textSoFar: string) => void
): Promise<ChatToolResponse> {
  const { settings, signal } = config
  if (settings.provider === 'anthropic') {
    let acc = ''
    return chatStreamWithToolsAnthropic(
      { apiKey: settings.apiKey, model: settings.model, messages: conversation, tools, signal, maxTokens },
      delta => {
        acc += delta
        onText(acc)
      }
    )
  }
  if (settings.provider === 'ollama') {
    return chatOllama({
      baseUrl: settings.ollamaUrl,
      model: settings.model,
      messages: conversation,
      signal,
      maxTokens
    })
  }
  return chatWithTools({
    apiKey: settings.apiKey,
    model: settings.model,
    messages: conversation,
    tools,
    signal,
    maxTokens
  })
}

function isTransient(err: unknown): boolean {
  const status = (err as { status?: number }).status
  if (typeof status === 'number') return status === 0 || status >= 500
  // Browser fetch surfaces network failures as a TypeError.
  return err instanceof TypeError
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// #endregion -- Model calls ------------------------------

// #region -- Helpers -------------------------------------

function terminal(text: string, turns: number, stopReason: StopReason): QueryResult {
  return { text, turns, stopReason }
}

function debug(
  turn: number,
  kind: DebugEntry['kind'],
  message: string,
  detail?: Record<string, unknown>
): QueryEvent {
  return { type: 'debug', entry: { time: Date.now(), turn, kind, message, detail } }
}

/** Bundle tool-result text with any images a tool attached this turn. */
function buildToolResultMessage(
  toolResults: ReadonlyArray<string>,
  images: ReadonlyArray<string>
): string | Array<TextPart | ImagePart> {
  const text = toolResults.join('\n\n')
  if (images.length === 0) return text
  const parts: Array<TextPart | ImagePart> = [{ type: 'text', text }]
  for (const url of images) parts.push({ type: 'image_url', image_url: { url } })
  return parts
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || '{}')
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

// #endregion -- Helpers ----------------------------------
