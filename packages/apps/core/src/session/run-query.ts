import type { Database } from 'better-sqlite3'
import { randomBytes } from 'node:crypto'
import type { Bus } from '../bus/index.js'
import {
  type ChatMessage,
  type ChatToolResponse,
  type Provider,
  isContextOverflow,
} from '../provider/index.js'
import { appendPart, listMessages, listSessionParts, updatePart } from '../storage/index.js'
import type { PartRow } from '../storage/index.js'
import { compactConversation, estimateTokensForConversation } from './compaction.js'

/**
 * Run one round of the agentic loop for a given session.
 *
 * Inputs: a session with at least one user message already persisted.
 * Outputs: an assistant message with one or more parts, persisted as we go.
 *
 * Phase 2: text-only. Tool dispatch lands in Phase 3 — the recovery and
 * compaction sub-loops, the abort signal plumbing, the bus events, and the
 * persistence shape are all chosen so adding tools later is a non-event.
 *
 * Bus events published (all carry `{ sessionId, messageId, ... }`):
 *   message.created  — at the very start
 *   step.start       — before each model call
 *   part.created     — every time a new part is appended
 *   part.delta       — every text-delta during streaming
 *   part.completed   — when a streaming part finalizes
 *   step.finish      — after each model call
 *   message.completed — once the assistant message is fully done
 *   message.error    — on unrecoverable error (also written as an `error` part)
 *   message.aborted  — when AbortSignal fires
 */

/** Default ceiling on model turns — Phase 2 stays at 1 (text-only). */
const DEFAULT_MAX_TURNS = 1

/** Soft context cap before proactive compaction. */
const TOKEN_BUDGET = 120_000

/** Attempts for transient/context-overflow recovery. */
const MAX_RECOVERIES = 3

/** Raised output-token cap used when a turn is truncated by the default cap. */
const ESCALATED_MAX_OUTPUT_TOKENS = 32_768

export interface RunQueryArgs {
  db: Database
  bus: Bus
  /** The assistant message that this run will populate. Must already exist. */
  messageId: string
  sessionId: string
  /** Provider implementation chosen by the dispatcher. */
  provider: Provider
  /** Model slug passed to the provider. */
  model: string
  /** Credential or base URL — provider-specific. */
  apiKey: string
  /** Hard cap on tool-use turns. Phase 2 stays at 1. */
  maxTurns?: number
  /** Token budget for proactive compaction. */
  tokenBudget?: number
  /** Optional abort signal. */
  signal?: AbortSignal
  /** Optional system prompt prepended to the conversation. */
  systemPrompt?: string
}

export interface RunQueryResult {
  text: string
  turns: number
  stopReason: 'completed' | 'aborted' | 'max_turns' | 'token_budget' | 'error'
}

export async function runQuery(args: RunQueryArgs): Promise<RunQueryResult> {
  const {
    db,
    bus,
    messageId,
    sessionId,
    provider,
    model,
    apiKey,
    maxTurns = DEFAULT_MAX_TURNS,
    tokenBudget = TOKEN_BUDGET,
    signal,
    systemPrompt,
  } = args

  bus.publish('message.created', { sessionId, messageId, provider: provider.id, model })

  let conversation = buildConversationFromHistory(db, sessionId, systemPrompt)
  let turn = 0
  let recoveries = 0
  let maxTokensOverride: number | undefined
  let finalText = ''

  try {
    while (true) {
      if (signal?.aborted) {
        bus.publish('message.aborted', { sessionId, messageId, turn })
        return finalize(finalText, turn, 'aborted')
      }

      // Proactive context recovery.
      if (estimateTokensForConversation(conversation) > tokenBudget) {
        const compacted = compactConversation(conversation)
        if (!compacted) {
          bus.publish('message.error', {
            sessionId,
            messageId,
            error: 'Conversation already minimal but still over token budget',
          })
          await appendErrorPart(db, bus, sessionId, messageId, 'token_budget_exceeded')
          return finalize(finalText, turn, 'token_budget')
        }
        conversation = compacted
        recoveries++
      }

      // Emit step-start part + bus event.
      const stepStartPartId = randomPartId('stp')
      appendPart(db, {
        id: stepStartPartId,
        sessionId,
        messageId,
        type: 'step-start',
        payload: { provider: provider.id, model },
      })
      bus.publish('part.created', {
        sessionId,
        messageId,
        partId: stepStartPartId,
        type: 'step-start',
        payload: { provider: provider.id, model },
      })
      bus.publish('step.start', { sessionId, messageId, turn, provider: provider.id, model })

      // Create a streaming text part — we patch its payload as deltas arrive.
      const textPartId = randomPartId('txt')
      let accumulated = ''
      appendPart(db, {
        id: textPartId,
        sessionId,
        messageId,
        type: 'text',
        payload: { text: '', streaming: true },
      })
      bus.publish('part.created', {
        sessionId,
        messageId,
        partId: textPartId,
        type: 'text',
        payload: { text: '', streaming: true },
      })

      let reply: ChatToolResponse
      try {
        reply = await provider.chat(
          {
            apiKey,
            model,
            messages: conversation,
            signal,
            maxTokens: maxTokensOverride,
          },
          (delta) => {
            accumulated += delta
            // Stream-write the running text into the part so reconnecting
            // clients can fetch the current value without replaying SSE.
            updatePart(db, textPartId, { text: accumulated, streaming: true })
            bus.publish('part.delta', {
              sessionId,
              messageId,
              partId: textPartId,
              delta,
              text: accumulated,
            })
          },
        )
      } catch (err) {
        // Reactive context recovery — try compaction once before bailing.
        if (isContextOverflow(err) && recoveries < MAX_RECOVERIES) {
          const compacted = compactConversation(conversation)
          if (compacted) {
            conversation = compacted
            recoveries++
            // Mark the streaming part completed with whatever we have, and
            // do another turn (without bumping `turn` since the request
            // failed before producing meaningful work).
            updatePart(db, textPartId, { text: accumulated, streaming: false })
            bus.publish('part.completed', {
              sessionId,
              messageId,
              partId: textPartId,
              text: accumulated,
            })
            continue
          }
        }
        // Record the error as an error part and finalize.
        await appendErrorPart(
          db,
          bus,
          sessionId,
          messageId,
          err instanceof Error ? err.message : String(err),
          (err as { status?: number }).status,
        )
        // Finalize the half-filled text part too.
        updatePart(db, textPartId, { text: accumulated, streaming: false })
        bus.publish('part.completed', {
          sessionId,
          messageId,
          partId: textPartId,
          text: accumulated,
        })
        bus.publish('message.error', {
          sessionId,
          messageId,
          error: err instanceof Error ? err.message : String(err),
        })
        return finalize(finalText || accumulated, turn, 'error')
      }

      // Finalize streaming part with the full text.
      finalText = reply.content || accumulated
      updatePart(db, textPartId, { text: finalText, streaming: false })
      bus.publish('part.completed', {
        sessionId,
        messageId,
        partId: textPartId,
        text: finalText,
      })

      // Output-token recovery — retry the same turn with a raised cap, but
      // only once (we track this via maxTokensOverride being set).
      if (reply.truncated && maxTokensOverride === undefined && recoveries < MAX_RECOVERIES) {
        // The retry asks the model for a complete replacement. Supersede the
        // partial text so clients never concatenate a truncated answer with
        // the replacement response.
        updatePart(db, textPartId, { text: '', streaming: false, superseded: true })
        bus.publish('part.completed', {
          sessionId,
          messageId,
          partId: textPartId,
          text: '',
          superseded: true,
        })
        maxTokensOverride = ESCALATED_MAX_OUTPUT_TOKENS
        recoveries++
        const stepFinishId = randomPartId('stp')
        appendPart(db, {
          id: stepFinishId,
          sessionId,
          messageId,
          type: 'step-finish',
          payload: { reason: 'max_tokens-retry' },
        })
        bus.publish('part.created', {
          sessionId,
          messageId,
          partId: stepFinishId,
          type: 'step-finish',
          payload: { reason: 'max_tokens-retry' },
        })
        bus.publish('step.finish', { sessionId, messageId, turn, reason: 'max_tokens-retry' })
        // Re-run the same logical turn.
        continue
      }

      const stepFinishId = randomPartId('stp')
      appendPart(db, {
        id: stepFinishId,
        sessionId,
        messageId,
        type: 'step-finish',
        payload: { reason: reply.truncated ? 'max_tokens' : 'end_turn' },
      })
      bus.publish('part.created', {
        sessionId,
        messageId,
        partId: stepFinishId,
        type: 'step-finish',
        payload: { reason: reply.truncated ? 'max_tokens' : 'end_turn' },
      })
      bus.publish('step.finish', {
        sessionId,
        messageId,
        turn,
        reason: reply.truncated ? 'max_tokens' : 'end_turn',
      })

      turn++

      // No tools (Phase 2). Whatever we got is the final answer.
      bus.publish('message.completed', {
        sessionId,
        messageId,
        turns: turn,
        text: finalText,
      })
      return finalize(finalText, turn, 'completed')

      // Phase 3 will dispatch reply.toolCalls here, append a user message
      // with tool results, and `continue` the loop while turn < maxTurns.
    }
  } catch (err) {
    await appendErrorPart(
      db,
      bus,
      sessionId,
      messageId,
      err instanceof Error ? err.message : String(err),
    )
    bus.publish('message.error', {
      sessionId,
      messageId,
      error: err instanceof Error ? err.message : String(err),
    })
    return finalize(finalText, turn, 'error')
  }
}

function finalize(text: string, turns: number, stopReason: RunQueryResult['stopReason']): RunQueryResult {
  return { text, turns, stopReason }
}

async function appendErrorPart(
  db: Database,
  bus: Bus,
  sessionId: string,
  messageId: string,
  message: string,
  status?: number,
): Promise<void> {
  const id = randomPartId('err')
  appendPart(db, {
    id,
    sessionId,
    messageId,
    type: 'error',
    payload: status !== undefined ? { message, status } : { message },
  })
  bus.publish('part.created', {
    sessionId,
    messageId,
    partId: id,
    type: 'error',
    payload: status !== undefined ? { message, status } : { message },
  })
}

/**
 * Reconstruct the OpenAI-style conversation array from the persisted
 * messages + parts. We flatten each message's text parts and ignore
 * non-text parts (tool/file/etc) for the Phase-2 prompt. Phase 3 will
 * thread tool messages back into the conversation.
 */
function buildConversationFromHistory(
  db: Database,
  sessionId: string,
  systemPrompt?: string,
): ChatMessage[] {
  const messages = listMessages(db, sessionId)
  const parts = listSessionParts(db, sessionId)
  const partsByMessage = groupBy(parts, (p) => p.messageId)
  const out: ChatMessage[] = []
  if (systemPrompt) out.push({ role: 'system', content: systemPrompt })
  for (const m of messages) {
    if (m.role === 'system') {
      // Conversation already contains the system prompt; skip stored ones
      // for now (Phase 4 introduces explicit conversation-system prompts).
      continue
    }
    const mp = partsByMessage.get(m.id) ?? []
    const text = mp
      .filter((p) => p.type === 'text')
      .map((p) => (p.payload.text as string | undefined) ?? '')
      .join('')
    if (!text) continue
    out.push({ role: m.role, content: text })
  }
  return out
}

function groupBy<T, K>(items: ReadonlyArray<T>, key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>()
  for (const it of items) {
    const k = key(it)
    let arr = m.get(k)
    if (!arr) {
      arr = []
      m.set(k, arr)
    }
    arr.push(it)
  }
  return m
}

function randomPartId(prefix: string): string {
  return `${prefix}_${randomBytes(18).toString('base64url')}`
}

/** Exported for tests. */
export const __internal = {
  buildConversationFromHistory,
  randomPartId,
}

// Suppress "PartRow not used" tsc warning when only its type-import shape is needed.
export type { PartRow }
