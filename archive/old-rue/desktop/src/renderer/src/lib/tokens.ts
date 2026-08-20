/**
 * Rough token estimation for the live conversation counter.
 *
 * ~4 characters per token is the well-known heuristic for English text — it
 * is close enough for a UI indicator and avoids bundling a full BPE
 * tokenizer (which would differ per model anyway).
 */
export function estimateTokens(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return Math.ceil(trimmed.length / 4)
}

/** Sum the estimated tokens across a set of message texts. */
export function estimateConversationTokens(texts: ReadonlyArray<string>): number {
  return texts.reduce((sum, t) => sum + estimateTokens(t), 0)
}

/** Compact human label: 0 → "0", 940 → "940", 1280 → "1.3k", 23000 → "23k". */
export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`
  return `${Math.round(n / 1000)}k`
}
