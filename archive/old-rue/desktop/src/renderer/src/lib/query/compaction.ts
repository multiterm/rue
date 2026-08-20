import type { ChatMessage } from '../openrouter.js'
import { estimateConversationTokens } from '../tokens.js'

/** Marker left in place of conversation history dropped by compaction. */
const TRUNCATION_NOTE = '[Earlier conversation was truncated to fit the context window.]'

/** Rough token estimate for a conversation. Counts plain-text content only. */
export function estimateTokens(conversation: ReadonlyArray<ChatMessage>): number {
  return estimateConversationTokens(
    conversation.map(m => (typeof m.content === 'string' ? m.content : ''))
  )
}

/**
 * Shrink a conversation that no longer fits the context window: keep the
 * leading framing message and the most recent `keepRecent` messages, and drop
 * the middle behind a single truncation marker. Returns `null` when the
 * conversation is already small enough that nothing more can be dropped — the
 * caller should then stop retrying.
 */
export function compactConversation(
  conversation: ReadonlyArray<ChatMessage>,
  keepRecent = 6
): ChatMessage[] | null {
  if (conversation.length <= keepRecent + 2) return null
  const lead = conversation.slice(0, 1)
  const recent = conversation.slice(-keepRecent)
  return [...lead, { role: 'user', content: TRUNCATION_NOTE }, ...recent]
}

/** True when a provider error means the prompt exceeded the context window. */
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
