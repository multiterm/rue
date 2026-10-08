import type { SessionServices } from '../server/session-services.js'
import { createCoalescingWriter } from './coalescing-writer.js'
import { randomBytes,randomUUID } from 'node:crypto'
import type { Bus } from '../bus/index.js'
import {
  type ChatMessage,
  type ChatToolResponse,
  type Provider,
  isContextOverflow,
} from '../provider/index.js'
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
  services: Pick<SessionServices,'conversations'|'usage'>
  ownerSubject: string
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
    services,
    ownerSubject,
    bus: rawBus,
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

  const bus:Pick<Bus,'publish'>={publish:(type,payload)=>rawBus.publish(type,{...payload,ownerSubject})}
  bus.publish('message.created', { sessionId, messageId, provider: provider.id, model })

  const store=protectedConversationStore(services.conversations)
  let conversation = await buildConversationFromHistory(store, ownerSubject, sessionId, systemPrompt, messageId)
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
          await appendErrorPart(store, ownerSubject, bus, sessionId, messageId, 'token_budget_exceeded')
          return finalize(finalText, turn, 'token_budget')
        }
        conversation = compacted
        recoveries++
      }

      // Emit step-start part + bus event.
      const stepStartPartId = randomPartId('stp')
      await store.appendPart(ownerSubject, {
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
      await store.appendPart(ownerSubject, {
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

      let persisted=''
      const telemetry:Promise<unknown>[]=[]
      const stream=createCoalescingWriter(async(text:string)=>{
        await store.updatePart(ownerSubject,textPartId,{text,streaming:true})
        bus.publish('part.delta',{ownerSubject,sessionId,messageId,partId:textPartId,delta:text.slice(persisted.length),text})
        persisted=text
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
            onUsage:raw=>{
              telemetry.push((async()=>{
                const message=raw as {provider:string;model:string;usage?:{input:number;output:number;cacheRead:number;cacheWrite:number;cost?:{total:number}}}
                if(!message?.usage)return
                const u=message.usage
                const credentialId=await services.usage.credential(ownerSubject,message.provider,apiKey)
                await services.usage.recordCloud(ownerSubject,sessionId,{eventId:randomUUID(),provider:message.provider,model:message.model,credentialId,time:Date.now(),input:u.input,output:u.output,cacheRead:u.cacheRead??0,cacheWrite:u.cacheWrite??0,costUsd:u.cost?.total??null})
              })().catch(()=>{/* Telemetry failure must never retry or interrupt inference. */}))
            },
          },
          (delta) => {
            accumulated += delta
            stream.enqueue(accumulated)
          },
        )
        await stream.close()
      } catch (caught) {
        let err=caught
        // Fence queued writes before any final state, including provider failures.
        // A persistence failure must not trigger another inference request.
        try{await stream.close()}catch(storageError){err=storageError}
        // Reactive context recovery — try compaction once before bailing.
        if (isContextOverflow(err) && recoveries < MAX_RECOVERIES) {
          const compacted = compactConversation(conversation)
          if (compacted) {
            conversation = compacted
            recoveries++
            // Mark the streaming part completed with whatever we have, and
            // do another turn (without bumping `turn` since the request
            // failed before producing meaningful work).
            await store.updatePart(ownerSubject, textPartId, { text: accumulated, streaming: false })
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
          store,
          ownerSubject,
          bus,
          sessionId,
          messageId,
          err instanceof Error ? err.message : String(err),
          (err as { status?: number }).status,
        )
        // Finalize the half-filled text part too.
        await store.updatePart(ownerSubject, textPartId, { text: accumulated, streaming: false })
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
      } finally {
        await Promise.all(telemetry)
      }

      // Finalize streaming part with the full text.
      finalText = reply.content || accumulated
      await store.updatePart(ownerSubject, textPartId, { text: finalText, streaming: false })
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
        await store.updatePart(ownerSubject, textPartId, { text: '', streaming: false, superseded: true })
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
        await store.appendPart(ownerSubject, {
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
      await store.appendPart(ownerSubject, {
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
      store,
      ownerSubject,
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

type ConversationStore=Pick<SessionServices['conversations'],'appendPart'|'updatePart'|'snapshot'>
function protectedConversationStore(source:SessionServices['conversations']):ConversationStore {
  async function safe<T>(call:()=>Promise<T>):Promise<T>{
    try{return await call()}catch{throw new Error('conversation_storage_unavailable')}
  }
  return {
    appendPart:(...args)=>safe(()=>source.appendPart(...args)),
    updatePart:(...args)=>safe(async()=>{const row=await source.updatePart(...args);if(!row)throw new Error('missing_part');return row}),
    snapshot:(...args)=>safe(()=>source.snapshot(...args)),
  }
}

function finalize(text: string, turns: number, stopReason: RunQueryResult['stopReason']): RunQueryResult {
  return { text, turns, stopReason }
}

async function appendErrorPart(
  store: ConversationStore,
  ownerSubject: string,
  bus: Pick<Bus,'publish'>,
  sessionId: string,
  messageId: string,
  message: string,
  status?: number,
): Promise<void> {
  const id = randomPartId('err')
  await store.appendPart(ownerSubject, {
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
async function buildConversationFromHistory(
  store: ConversationStore,
  ownerSubject: string,
  sessionId: string,
  systemPrompt?: string,
  beforeMessageId?: string,
): Promise<ChatMessage[]> {
  const {messages,parts} = await store.snapshot(ownerSubject,sessionId)
  const boundary=beforeMessageId?messages.find(message=>message.id===beforeMessageId):undefined
  if(beforeMessageId&&!boundary)throw new Error('conversation_storage_unavailable')
  const partsByMessage = groupBy(parts, (p) => p.messageId)
  const out: ChatMessage[] = []
  if (systemPrompt) out.push({ role: 'system', content: systemPrompt })
  for (const m of messages) {
    // A later concurrently admitted turn must not enter this turn's prompt.
    if(boundary&&m.seq>=boundary.seq)continue
    if (m.role === 'system') {
      // Conversation already contains the system prompt; skip stored ones
      // for now (Phase 4 introduces explicit conversation-system prompts).
      continue
    }
    const mp = partsByMessage.get(m.id) ?? []
    if (m.role === 'user' && mp.some(p => p.type === 'file')) {
      const content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = []
      for (const p of mp) {
        if (p.type === 'text') content.push({ type: 'text', text: String(p.payload.text ?? '') })
        else if (p.type === 'file') {
          const { name, mimeType, data } = p.payload
          if (typeof data !== 'string') continue
          if (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(String(mimeType))) content.push({ type: 'image_url', image_url: { url: `data:${mimeType};base64,${data}` } })
          else content.push({ type: 'text', text: `[User attachment: ${String(name)}]\n${mimeType === 'text/plain' ? Buffer.from(data, 'base64').toString('utf8').slice(0, 100_000) + (Number(p.payload.size) > 100_000 ? '\n[Attachment truncated to 100,000 characters]' : '') : '[Binary attachment saved in the conversation. This cloud agent cannot inspect its contents; do not claim to have read it.]'}` })
        }
      }
      out.push({ role: m.role, content })
    } else {
      const text = mp.filter(p => p.type === 'text').map(p => String(p.payload.text ?? '')).join('')
      if (text) out.push({ role: m.role, content: text })
    }
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
