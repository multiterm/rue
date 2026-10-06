import type { Server } from 'node:http'
import type { SocketRouter } from './socket-router.js'
import { WebSocketServer, WebSocket } from 'ws'
import type { ServerContext } from './context.js'
import {sessionServices} from './session-services.js'

/** Agent-only socket. No query-string credentials, browser origins or account RPCs. */
export function installTerminalSocket(server: Server, ctx: ServerContext, dispatch: (request: Request) => Response | Promise<Response>, router?: SocketRouter) {
  const store=sessionServices(ctx).terminal.relay
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
    let frames = 0, windowStart = Date.now(),authenticating=false,closing=false
    const deadline = setTimeout(() => ws.terminate(), 5000)
    const close = () => { if(closing)return;closing=true;ws.close(1008); const timer = setTimeout(() => ws.terminate(), 1000); timer.unref(); ws.once('close', () => clearTimeout(timer)) }
    let checking=false,recheck=false,notifyChange=false
    const checkAuthority=(changed=false)=>{
      recheck=true;notifyChange ||= changed
      if(checking)return
      checking=true
      void (async()=>{try{
        while(recheck&&auth&&!closing&&ws.readyState===WebSocket.OPEN){
          recheck=false;const current=auth
          await store.validateSocket(current.token,current.id,current.instance)
          if(current!==auth||closing||ws.readyState!==WebSocket.OPEN)return
          if(!recheck&&notifyChange){notifyChange=false;send({type:'changed'})}
        }
      }catch{close()}finally{checking=false}})()
    }
    const leaseWatch = setInterval(() => checkAuthority(), 15000)
    const send = (value: unknown) => {
      if (closing||ws.readyState !== WebSocket.OPEN) return
      if (ws.bufferedAmount > 1_048_576) { ws.terminate(); return }
      const text = JSON.stringify(value)
      if (Buffer.byteLength(text) > 8_388_608) { ws.terminate(); return }
      ws.send(text)
    }
    ws.on('error', () => {}) // Transport errors never log frame contents or credentials.
    ws.on('close', () => { clearTimeout(deadline); clearInterval(leaseWatch); unsubscribe?.(); auth = undefined })
    ws.on('message', async (raw, binary) => {
      if(closing)return
      if(!auth&&authenticating){close();return}
      if (Date.now() - windowStart >= 1000) { frames = 0; windowStart = Date.now() }
      if (binary || (!auth && raw.toString().length > 4096) || ++frames > 100) { close(); return }
      let frame: any
      try { frame = JSON.parse(raw.toString()) } catch { close(); return }
      if (!auth) {
        if (frame?.type !== 'authenticate' || typeof frame.token !== 'string' || !/^rue_terminal_[A-Za-z0-9_-]{43}$/.test(frame.token) || !/^term_[A-Za-z0-9_-]{32}$/.test(frame.id) || !/^[0-9a-f-]{36}$/i.test(frame.instance)) { close(); return }
        try {
          authenticating=true
          const connection = await store.validateSocket(frame.token, frame.id, frame.instance)
          if(closing||ws.readyState!==WebSocket.OPEN)return
          auth = { token: frame.token, id: frame.id, instance: frame.instance, sessionId: connection.sessionId }
        } catch { close(); return } finally {authenticating=false}
        clearTimeout(deadline)
        unsubscribe = ctx.bus.subscribe(event => {
          if (!auth || !['terminal.command.queued', 'terminal.control.changed'].includes(event.type) || (event.payload as { sessionId?: string }).sessionId !== auth.sessionId) return
          checkAuthority(true)
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
