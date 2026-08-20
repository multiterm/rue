import { z } from 'zod'

/**
 * Part discriminated union — the wire format for one segment inside a
 * message. Modeled on opencode's `message-v2.ts` Part union but stripped to
 * what rue actually emits.
 *
 * Storage layer stores `(type, payload)` pairs with `type` matching the
 * discriminator and `payload` matching the rest of the variant. The
 * canonical wire shape merges those back together.
 *
 * Tool/file/patch/snapshot/compaction variants are added in later phases as
 * the corresponding features land. Phase 2 ships:
 *   text, reasoning, step-start, step-finish, error
 */

const Base = {
  id: z.string(),
  sessionId: z.string(),
  messageId: z.string(),
}

export const TextPartSchema = z.object({
  ...Base,
  type: z.literal('text'),
  text: z.string(),
  /** True while the model is still streaming into this part. */
  streaming: z.boolean().optional(),
})
export type TextPart = z.infer<typeof TextPartSchema>

export const ReasoningPartSchema = z.object({
  ...Base,
  type: z.literal('reasoning'),
  text: z.string(),
})
export type ReasoningPart = z.infer<typeof ReasoningPartSchema>

export const StepStartPartSchema = z.object({
  ...Base,
  type: z.literal('step-start'),
  /** Provider that ran this step. */
  provider: z.string(),
  model: z.string(),
})
export type StepStartPart = z.infer<typeof StepStartPartSchema>

export const StepFinishPartSchema = z.object({
  ...Base,
  type: z.literal('step-finish'),
  /** 'end_turn' | 'max_tokens' | 'tool_use' | 'error' | 'aborted' | 'max_turns' */
  reason: z.string(),
  /** Optional usage attached to the step. */
  usage: z
    .object({
      inputTokens: z.number().int().nonnegative().optional(),
      outputTokens: z.number().int().nonnegative().optional(),
    })
    .partial()
    .optional(),
})
export type StepFinishPart = z.infer<typeof StepFinishPartSchema>

export const ErrorPartSchema = z.object({
  ...Base,
  type: z.literal('error'),
  message: z.string(),
  /** Best-effort upstream status when the error came from a provider. */
  status: z.number().int().optional(),
})
export type ErrorPart = z.infer<typeof ErrorPartSchema>

export const PartSchema = z.discriminatedUnion('type', [
  TextPartSchema,
  ReasoningPartSchema,
  StepStartPartSchema,
  StepFinishPartSchema,
  ErrorPartSchema,
])
export type Part = z.infer<typeof PartSchema>

/** Persisted payload — the part minus the storage-managed fields. */
export type PartPayload<T extends Part = Part> = Omit<T, 'id' | 'sessionId' | 'messageId' | 'type'> & {
  type: T['type']
}

/** Reconstruct a wire Part from its storage row's payload + storage row keys. */
export function reconstructPart(row: {
  id: string
  sessionId: string
  messageId: string
  type: string
  payload: Record<string, unknown>
}): Part | null {
  const candidate = {
    ...row.payload,
    id: row.id,
    sessionId: row.sessionId,
    messageId: row.messageId,
    type: row.type,
  }
  const parsed = PartSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}
