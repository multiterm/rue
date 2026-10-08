import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import {sessionServices} from '../session-services.js'
import type { BusEvent } from '../../bus/bus.js'
import type { ServerContext } from '../context.js'

/** Owner-scoped replay and live delivery share a single ordered writer. */
export function eventRoutes(): Hono<{ Variables: { ctx: ServerContext } }> {
  const app = new Hono<{ Variables: { ctx: ServerContext } }>()
  app.get('/event', (c) => streamSSE(c, async (stream) => {
    const subject = c.get('principal').subject
    const visible = async (event: BusEvent) => {
      const payload = event.payload as { sessionId?: string; ownerSubject?: string }
      if(!payload||typeof payload!=='object')return false
      if (payload.ownerSubject) return payload.ownerSubject === subject
      return !payload.sessionId || Boolean(await sessionServices(c.var.ctx).conversations.get(subject,payload.sessionId))
    }
    const cursor = Number(c.req.header('last-event-id') ?? 0)
    const replay = Number.isSafeInteger(cursor) && cursor > 0 ? c.var.ctx.bus.historySince(cursor) : []
    let writes = Promise.resolve()
    let queued = 0, queuedBytes = 0
    let failed = false
    let wake:(()=>void)|undefined
    const stop=()=>{failed=true;unsubscribe();wake?.();void stream.close().catch(()=>{})}
    const send = (event: BusEvent) => {
      if (failed) return
      const owner=(event.payload as {ownerSubject?:string}|null)?.ownerSubject
      if(owner&&owner!==subject)return
      // Bound per-client buffering. Reconnecting clients reconcile persisted state.
      const data=JSON.stringify(event),bytes=Buffer.byteLength(data)
      if (queued >= 1024 || queuedBytes+bytes>2*1024*1024) { stop(); return }
      queued++;queuedBytes+=bytes
      writes = writes.then(async () => {
        if(!failed&&await visible(event)&&!failed)await stream.writeSSE({id:String(event.id),event:event.type,data})
      }).finally(() => { queued--;queuedBytes-=bytes })
      void writes.catch(stop)
    }
    // No await between taking the replay snapshot and subscribing: live events
    // cannot fall into the old replay/subscription gap.
    const unsubscribe = c.var.ctx.bus.subscribe(send)
    stream.onAbort(()=>{failed=true;unsubscribe();wake?.()})
    try {
      for (const event of replay) send(event)
      await writes
      await stream.writeSSE({ event: 'hello', data: JSON.stringify({ time: Date.now() }) })
      while (!stream.aborted && !failed) {
        await new Promise<void>(resolve=>{
          const timer=setTimeout(()=>{wake=undefined;resolve()},25_000)
          wake=()=>{clearTimeout(timer);wake=undefined;resolve()}
        })
        if (stream.aborted || failed) break
        await stream.writeSSE({ event: 'ping', data: String(Date.now()) })
      }
    } catch { stop() } finally { wake?.();unsubscribe() }
  }))
  return app
}
