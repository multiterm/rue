import { WebSocketServer, WebSocket } from 'ws'
import { z } from 'zod'
import type { ServerContext } from './context.js'
import type { SocketRouter } from './socket-router.js'
import {refreshWorkerProject} from './project-authority.js'
import { connectWorker, heartbeatWorker, validateWorker, WorkerError, workerHealthSchema } from '../storage/workers.js'

const authSchema = z.object({ type: z.literal('authenticate'), protocol: z.literal(1), id: z.string().uuid(), token: z.string().regex(/^rue_worker_[A-Za-z0-9_-]{43}$/), instance: z.string().uuid() }).strict()
const heartbeatSchema = z.object({ type: z.literal('heartbeat'), requestId: z.string().uuid(), generation: z.number().int().positive(), health: workerHealthSchema }).strict()
export function installWorkerSocket(router: SocketRouter, ctx: ServerContext) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false })
  const unregister = router.register('/worker-client/socket', (request, socket, head) => {
    if (sockets.clients.size >= 128) { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return }
    sockets.handleUpgrade(request, socket, head, ws => sockets.emit('connection', ws))
  })
  sockets.on('connection', ws => {
    let authority: z.infer<typeof authSchema> & { generation: number; owner: string } | undefined
    let unsubscribe: (() => void) | undefined
    let processing=false
    let closing = false, frames = 0, windowStart = Date.now()
    let termination: ReturnType<typeof setTimeout> | undefined
    const send = (value: unknown) => {
      if (ws.readyState !== WebSocket.OPEN || closing) return
      if (ws.bufferedAmount > 65536) { ws.terminate(); return }
      ws.send(JSON.stringify(value))
    }
    const fail = (error: unknown) => {
      if (closing) return
      const invalid = error === undefined || error instanceof z.ZodError || error instanceof SyntaxError
      send({ type: 'error', status: error instanceof WorkerError ? error.status : invalid ? 400 : 503, code: error instanceof WorkerError ? error.code : invalid ? 'invalid_worker_frame' : 'worker_unavailable' })
      closing = true; ws.close(1008)
      if(authority){ctx.bus.publish('worker.updated',{ownerSubject:authority.owner,workerId:authority.id})}
      termination = setTimeout(() => ws.terminate(), 1000); termination.unref()
    }
    const deadline = setTimeout(() => ws.terminate(), 10000)
    const watchdog = setInterval(() => {
      if (!authority || closing) return
      try { validateWorker(ctx.db, authority.id, authority.token, authority.instance, authority.generation) } catch (e) { fail(e) }
    }, 5000)
    ws.on('error', () => {})
    ws.on('close', () => { clearTimeout(deadline); clearTimeout(termination); clearInterval(watchdog); unsubscribe?.(); authority = undefined })
    ws.on('message', (raw, binary) => {
      if (closing) return
      if(processing){fail(undefined);return}
      if (Date.now() - windowStart >= 1000) { frames = 0; windowStart = Date.now() }
      if (binary || ++frames > 20) { fail(undefined); return }
      processing=true
      void (async()=>{try {
        const frame: unknown = JSON.parse(raw.toString())
        if (!authority) {
          const auth = authSchema.parse(frame)
          await refreshWorkerProject(ctx.db,ctx.projectAuthority,auth.id,auth.token)
          if(closing||ws.readyState!==WebSocket.OPEN)return
          const lease = connectWorker(ctx.db, auth.id, auth.token, auth.instance)
          authority = { ...auth, generation: lease.generation, owner: lease.worker.ownerSubject }
          clearTimeout(deadline)
          unsubscribe = ctx.bus.on<{ workerId: string }>('worker.control.changed', event => {
            if (!authority || event.payload.workerId !== authority.id) return
            try { validateWorker(ctx.db, authority.id, authority.token, authority.instance, authority.generation); send({ type: 'changed' }) } catch (e) { fail(e) }
          })
          send({ type: 'ready', lease })
          ctx.bus.publish('worker.updated', { ownerSubject: authority.owner, workerId: authority.id })
          return
        }
        const request = heartbeatSchema.parse(frame)
        if (request.generation !== authority.generation) throw new WorkerError(409, 'worker_session_fenced')
        await refreshWorkerProject(ctx.db,ctx.projectAuthority,authority.id,authority.token)
        if(closing||ws.readyState!==WebSocket.OPEN||!authority)return
        const lease = heartbeatWorker(ctx.db, authority.id, authority.token, authority.instance, authority.generation, request.health)
        send({ type: 'heartbeat_ack', requestId: request.requestId, lease })
        ctx.bus.publish('worker.updated', { ownerSubject: authority.owner, workerId: authority.id })
      } catch (e) { fail(e) }finally{processing=false}})()
    })
  })
  return () => { unregister(); for (const ws of sockets.clients) ws.terminate(); sockets.close() }
}
