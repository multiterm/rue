import type { Server } from 'node:http'
import type { SocketRouter } from './socket-router.js'
import { WebSocketServer, WebSocket } from 'ws'
import type { ServerContext } from './context.js'
import { validateRelaySocket } from '../storage/terminal-relay.js'

/** Agent-only socket. No query-string credentials, browser origins or account RPCs. */
export function installTerminalSocket(server: Server, ctx: ServerContext, dispatch: (request: Request) => Response | Promise<Response>, router?: SocketRouter) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1_048_576, perMessageDeflate: false })
  const upgrade: Parameters<Server['on']>[1] = (request: any, socket: any, head: any) => {
    if (request.url !== '/terminal-client/socket' || request.headers.origin || sockets.clients.size >= 256) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return
    }
    sockets.handleUpgrade(request, socket, head, ws => sockets.emit('connection', ws))
  }
  const unregister = router ? router.register('/terminal-client/socket', upgrade) : (() => { server.on('upgrade', upgrade); return () => { server.removeListener('upgrade', upgrade) } })()
  sockets.on('connection', ws => {
    let auth: { token: string; id: string; instance: string; sessionId: string } | undefined
    let unsubscribe: (() => void) | undefined
    const pending = new Set<string>()
    let frames = 0, windowStart = Date.now()
    const deadline = setTimeout(() => ws.terminate(), 5000)
    const close = () => { ws.close(1008); const timer = setTimeout(() => ws.terminate(), 1000); timer.unref(); ws.once('close', () => clearTimeout(timer)) }
    const leaseWatch = setInterval(() => {
      if (!auth) return
      try { validateRelaySocket(ctx.db, auth.token, auth.id, auth.instance) } catch { close() }
    }, 15000)
    const send = (value: unknown) => {
      if (ws.readyState !== WebSocket.OPEN) return
      if (ws.bufferedAmount > 1_048_576) { ws.terminate(); return }
      const text = JSON.stringify(value)
      if (Buffer.byteLength(text) > 8_388_608) { ws.terminate(); return }
      ws.send(text)
    }
    ws.on('error', () => {}) // Transport errors never log frame contents or credentials.
    ws.on('close', () => { clearTimeout(deadline); clearInterval(leaseWatch); unsubscribe?.(); auth = undefined })
    ws.on('message', async (raw, binary) => {
      if (Date.now() - windowStart >= 1000) { frames = 0; windowStart = Date.now() }
      if (binary || (!auth && raw.toString().length > 4096) || ++frames > 100) { close(); return }
      let frame: any
      try { frame = JSON.parse(raw.toString()) } catch { close(); return }
      if (!auth) {
        if (frame?.type !== 'authenticate' || typeof frame.token !== 'string' || !/^rue_terminal_[A-Za-z0-9_-]{43}$/.test(frame.token) || !/^term_[A-Za-z0-9_-]{32}$/.test(frame.id) || !/^[0-9a-f-]{36}$/i.test(frame.instance)) { close(); return }
        try {
          const connection = validateRelaySocket(ctx.db, frame.token, frame.id, frame.instance)
          auth = { token: frame.token, id: frame.id, instance: frame.instance, sessionId: connection.sessionId }
        } catch { close(); return }
        clearTimeout(deadline)
        unsubscribe = ctx.bus.subscribe(event => {
          if (!auth || !['terminal.command.queued', 'terminal.control.changed'].includes(event.type) || (event.payload as { sessionId?: string }).sessionId !== auth.sessionId) return
          try { validateRelaySocket(ctx.db, auth.token, auth.id, auth.instance); send({ type: 'changed' }) }
          catch { close() }
        })
        send({ type: 'ready', protocol: 1 })
        return
      }
      if (frame?.type !== 'request' || typeof frame.id !== 'string' || !/^[0-9]{1,12}$/.test(frame.id) || pending.has(frame.id) || pending.size >= 8 || typeof frame.path !== 'string' || !/^(poll|heartbeat|mirror|commands\/[0-9a-f-]{36}\/(claim|start|reject|output))$/i.test(frame.path) || frame.body?.instance !== auth.instance) { close(); return }
      const credentials = auth
      pending.add(frame.id)
      try {
        // Reuse the HTTP schemas, credential scope, fencing, leases and durable
        // operations. A socket cannot invent a second, less restrictive API.
        const response = await dispatch(new Request(`http://rue.internal/terminal-client/connections/${credentials.id}/relay/${frame.path}`, { method: 'POST', headers: { authorization: `Bearer ${credentials.token}`, 'content-type': 'application/json' }, body: JSON.stringify(frame.body) }))
        const body = await response.json()
        send({ type: 'response', id: frame.id, status: response.status, body })
      } catch { send({ type: 'response', id: frame.id, status: 503, body: { error: 'relay_unavailable' } }) }
      finally { pending.delete(frame.id) }
    })
  })
  return () => {
    unregister()
    for (const ws of sockets.clients) ws.terminate()
    sockets.close()
  }
}
