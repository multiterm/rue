/**
 * Simple in-process pub/sub bus.
 *
 * Used by the server SSE endpoint to forward domain events (message
 * streaming, tool-call state changes, permission asks, schedule fires) to
 * connected clients (web UI, TUI, desktop renderer).
 *
 * Events carry a string type + arbitrary payload. Subscribers can filter by
 * type prefix.
 */

export interface BusEvent<P = unknown> {
  type: string
  payload: P
  /** Server-side wall-clock timestamp; useful for replay/ordering. */
  time: number
}

export type Listener = (event: BusEvent) => void

export class Bus {
  #listeners = new Set<Listener>()

  publish<P>(type: string, payload: P): BusEvent<P> {
    const event: BusEvent<P> = { type, payload, time: Date.now() }
    for (const fn of this.#listeners) {
      try {
        fn(event)
      } catch (err) {
        // A bad listener must not poison the rest.
        console.error('[bus] listener threw:', err)
      }
    }
    return event
  }

  /** Subscribe to every event. Returns an unsubscribe function. */
  subscribe(fn: Listener): () => void {
    this.#listeners.add(fn)
    return () => {
      this.#listeners.delete(fn)
    }
  }

  /** Subscribe to events whose type starts with the given prefix. */
  subscribePrefix(prefix: string, fn: Listener): () => void {
    return this.subscribe((event) => {
      if (event.type.startsWith(prefix)) fn(event)
    })
  }

  /** Subscribe to events with an exact type match. */
  on<P = unknown>(type: string, fn: (event: BusEvent<P>) => void): () => void {
    return this.subscribe((event) => {
      if (event.type === type) fn(event as BusEvent<P>)
    })
  }

  listenerCount(): number {
    return this.#listeners.size
  }
}

/** Process-wide default bus instance. */
export const bus = new Bus()
