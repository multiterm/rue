import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
export type UpgradeHandler = (request: IncomingMessage, socket: Duplex, head: Buffer) => void

/** Exactly one upgrade listener chooses a protocol before either authenticates. */
export class SocketRouter {
  private routes = new Map<string, UpgradeHandler>()
  private upgrade: UpgradeHandler = (request, socket, head) => {
    const handler = this.routes.get(request.url ?? '')
    if (!handler || request.headers.origin) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return }
    handler(request, socket, head)
  }
  constructor(private server: Server) { server.on('upgrade', this.upgrade) }
  register(path: string, handler: UpgradeHandler) {
    if (this.routes.has(path)) throw Error('Duplicate socket route')
    this.routes.set(path, handler)
    return () => { this.routes.delete(path) }
  }
  close() { this.server.removeListener('upgrade', this.upgrade); this.routes.clear() }
}
