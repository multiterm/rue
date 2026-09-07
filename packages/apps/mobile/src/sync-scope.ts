/** Invalidates async results when identity or selected conversation changes. */
export class SyncScope {
  private key: string | undefined
  private generation = 0
  private guard = () => false

  select(key: string): () => boolean {
    if (key !== this.key) {
      this.key = key
      const generation = ++this.generation
      this.guard = () => generation === this.generation
    }
    return this.guard
  }

  invalidate(): void {
    this.generation++
    this.key = undefined
  }
}
