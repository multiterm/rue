import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
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
      const unsubscribe = c.var.ctx.bus.subscribe((event) => {
        // Fire-and-forget; SSE writes are buffered.
        void stream.writeSSE({
          event: event.type,
          data: JSON.stringify({ type: event.type, time: event.time, payload: event.payload }),
        })
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
