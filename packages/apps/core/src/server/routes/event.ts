import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { getSession } from '../../storage/index.js'
import type { BusEvent } from '../../bus/bus.js'
import type { ServerContext } from '../context.js'

/** Owner-scoped replay and live delivery share a single ordered writer. */
export function eventRoutes(): Hono<{ Variables: { ctx: ServerContext } }> {
  const app = new Hono<{ Variables: { ctx: ServerContext } }>()
  app.get('/event', (c) => streamSSE(c, async (stream) => {
    const subject = c.get('principal').subject
    const visible = (event: BusEvent) => {
      const payload = event.payload as { sessionId?: string; ownerSubject?: string }
      if (payload.ownerSubject) return payload.ownerSubject === subject
      return !payload.sessionId || Boolean(getSession(c.var.ctx.db, payload.sessionId, subject))
    }
    const cursor = Number(c.req.header('last-event-id') ?? 0)
    const replay = Number.isSafeInteger(cursor) && cursor > 0 ? c.var.ctx.bus.historySince(cursor) : []
    let writes = Promise.resolve()
    let queued = 0
    let failed = false
    const send = (event: BusEvent) => {
      if (!visible(event) || failed) return
      // Bound per-client buffering. Reconnecting clients reconcile persisted state.
      if (queued >= 1024) { failed = true; unsubscribe(); void stream.close(); return }
      queued++
      writes = writes.then(() => stream.writeSSE({
        id: String(event.id), event: event.type,
        data: JSON.stringify(event),
      })).finally(() => { queued-- })
      void writes.catch(() => { failed = true; unsubscribe(); void stream.close() })
    }
    // No await between taking the replay snapshot and subscribing: live events
    // cannot fall into the old replay/subscription gap.
    const unsubscribe = c.var.ctx.bus.subscribe(send)
    stream.onAbort(unsubscribe)
    try {
      for (const event of replay) send(event)
      await writes
      await stream.writeSSE({ event: 'hello', data: JSON.stringify({ time: Date.now() }) })
      while (!stream.aborted && !failed) {
        await stream.sleep(25_000)
        if (stream.aborted || failed) break
        await stream.writeSSE({ event: 'ping', data: String(Date.now()) })
      }
    } finally { unsubscribe() }
  }))
  return app
}
