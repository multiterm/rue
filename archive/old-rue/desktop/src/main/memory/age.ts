/**
 * The temporal layer of the memory system. Memories don't decay or get
 * deleted by age — instead, an aging memory is recalled with an explicit
 * caveat so the model treats it as a dated observation, not live truth.
 */

const DAY_MS = 86_400_000

/** Whole days between `mtimeMs` and now (never negative). */
export function memoryAgeDays(mtimeMs: number): number {
  return Math.max(0, Math.floor((Date.now() - mtimeMs) / DAY_MS))
}

/** Human-readable age, e.g. `today`, `yesterday`, `12 days ago`. */
export function memoryAgeLabel(ageDays: number): string {
  if (ageDays === 0) return 'today'
  if (ageDays === 1) return 'yesterday'
  return `${ageDays} days ago`
}

/**
 * The staleness caveat attached to an aging memory on recall. Fresh memories
 * (<= 1 day) get none — recent observations are trustworthy enough.
 */
export function memoryFreshnessText(ageDays: number): string {
  if (ageDays <= 1) return ''
  return (
    `[This memory is ${ageDays} days old — a point-in-time note, not live state. ` +
    `Verify it against the current code/state before relying on it as fact.]`
  )
}
