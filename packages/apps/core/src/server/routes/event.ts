import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { getSession } from '../../storage/index.js'
import type { ServerContext } from '../context.js'

/**
 * Server-Sent Events stream of bus events.
 *
 * Hono's streamSSE plays well with the Node adapter. We bridge our Bus to
 * the SSE stream; on disconnect the Bus subscription is torn down.
 *
 * This route is intentionally NOT defined via @hono/zod-openapi because SSE
 * responses don't fit the OpenAPI 3.0 response model cleanly. The OpenAPI
 * spec instead documents it as text/event-stream in a hand-written addition.
 */
export function eventRoutes(): Hono<{ Variables: { ctx: ServerContext } }> {
  const app = new Hono<{ Variables: { ctx: ServerContext } }>()
  app.get('/event', (c) =>
    streamSSE(c, async (stream) => {
      const principalSubject = c.get('principal').subject
      const visible = (event: { payload: unknown }) => {
        const payload = event.payload as { sessionId?: string }
        return !payload.sessionId || Boolean(getSession(c.var.ctx.db, payload.sessionId, principalSubject))
      }
      const write = (event: { id: number; type: string; time: number; payload: unknown }) => stream.writeSSE({
        id: String(event.id),
        event: event.type,
        data: JSON.stringify({ id: event.id, type: event.type, time: event.time, payload: event.payload }),
      })
      const lastEventId = Number(c.req.header('last-event-id') ?? 0)
      if (Number.isSafeInteger(lastEventId) && lastEventId > 0) {
        for (const event of c.var.ctx.bus.historySince(lastEventId)) if (visible(event)) await write(event)
      }
      const unsubscribe = c.var.ctx.bus.subscribe((event) => {
        if (!visible(event)) return
        // Fire-and-forget; SSE writes are buffered.
        void write(event)
      })
      // Initial hello event so clients know the stream is alive.
      await stream.writeSSE({
        event: 'hello',
        data: JSON.stringify({ time: Date.now() }),
      })
      // Keep the handler alive until the client disconnects.
      stream.onAbort(() => unsubscribe())
      // Heartbeat every 25s to keep proxies/middleboxes happy.
      while (!stream.aborted) {
        await stream.sleep(25_000)
        if (stream.aborted) break
        await stream.writeSSE({ event: 'ping', data: String(Date.now()) })
      }
    }),
  )
  return app
}
