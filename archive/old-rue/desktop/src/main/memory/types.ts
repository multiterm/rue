/**
 * Temporal memory — durable `.md` notes that persist across sessions. Each
 * memory is a point-in-time observation; recency is tracked via the file's
 * mtime, and stale memories carry a freshness caveat when recalled.
 */

/** The closed taxonomy of memory kinds (mirrors the reference's memdir). */
export const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const
export type MemoryType = (typeof MEMORY_TYPES)[number]

/** Lightweight memory record — what the index and scan return. */
export interface MemoryHeader {
  readonly name: string
  readonly description: string
  readonly type: MemoryType
  /** File mtime in epoch ms — the "temporal" anchor. */
  readonly mtimeMs: number
  /** Whole days since the memory was last written. */
  readonly ageDays: number
}

/** A full memory, including its content body and a freshness caveat. */
export interface Memory extends MemoryHeader {
  readonly content: string
  /** Staleness warning shown on recall; empty for fresh memories. */
  readonly freshness: string
}

/** Arguments accepted by the memory-write IPC call. */
export interface MemoryWriteInput {
  readonly name: string
  readonly description: string
  readonly type: MemoryType
  readonly content: string
}
