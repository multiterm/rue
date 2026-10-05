export type SocketFactory = (url: string) => WebSocket

/** One authenticated socket, correlated bounded RPCs; never auto-replays a request. */
export class RelaySocket {
  private socket: WebSocket | undefined
  private sequence = 0
  private pending = new Map<string, { resolve(value: any): void; reject(error: unknown): void; timer: ReturnType<typeof setTimeout> }>()
  private ready = false
  private disposed = false
  constructor(private factory: SocketFactory, private changed: () => void, private lost: (error: unknown) => void) {}
  get connected() { return this.ready && this.socket?.readyState === 1 }
  connect(origin: string, credentials: { token: string; id: string; instance: string }, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = this.socket = this.factory(origin.replace(/^https:/, 'wss:') + '/terminal-client/socket')
      let settled = false
      const deadline = setTimeout(() => fail(new TypeError('Rue socket handshake timed out')), 10000)
      const abort = () => fail(new TypeError('Rue socket aborted'))
      const fail = (error: unknown) => {
        clearTimeout(deadline); this.ready = false
        for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error) }
        this.pending.clear()
        if (!settled) { settled = true; reject(error) }
        else if (!this.disposed) this.lost(error)
        this.disposed = true
        signal.removeEventListener('abort', abort)
        try { socket.close() } catch {}
      }
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) { abort(); return }
      socket.addEventListener('open', () => {
        if (this.disposed) return
        socket.send(JSON.stringify({ type: 'authenticate', ...credentials }))
      })
      socket.addEventListener('message', event => {
        if (this.disposed) return
        let frame: any
        try {
          if (typeof event.data !== 'string' || Buffer.byteLength(event.data) > 8_388_608) throw Error()
          frame = JSON.parse(event.data)
        } catch { fail(Object.assign(Error('Invalid Rue socket frame'), { status: 400 })); return }
        if (!this.ready) {
          if (frame?.type !== 'ready' || frame.protocol !== 1) { fail(Object.assign(Error('Rue socket protocol mismatch'), { status: 409 })); return }
          clearTimeout(deadline); settled = true; this.ready = true; resolve(); return
        }
        if (frame?.type === 'changed') { this.changed(); return }
        if (frame?.type !== 'response' || typeof frame.id !== 'string' || !Number.isInteger(frame.status)) { fail(Object.assign(Error('Invalid Rue socket response'), { status: 400 })); return }
        const request = this.pending.get(frame.id)
        if (!request) return // A late acknowledgement after a deadline is not a new execution.
        clearTimeout(request.timer); this.pending.delete(frame.id)
        if (frame.status >= 200 && frame.status < 300) request.resolve(frame.body)
        else request.reject(Object.assign(Error('Rue connection request failed'), { status: frame.status }))
      })
      socket.addEventListener('error', () => fail(new TypeError('Rue socket transport failed')))
      socket.addEventListener('close', event => fail(event.code === 1008 ? Object.assign(Error('Rue socket authority rejected'), { status: 403 }) : new TypeError('Rue socket disconnected')))
    })
  }
  request(path: string, body: unknown): Promise<any> {
    if (!this.connected || this.pending.size >= 8 || this.socket!.bufferedAmount > 1_048_576) return Promise.reject(new TypeError('Rue socket unavailable'))
    const id = String(++this.sequence), frame = JSON.stringify({ type: 'request', id, path, body })
    if (Buffer.byteLength(frame) > 1_048_576) return Promise.reject(Object.assign(Error('Rue socket request too large'), { status: 413 }))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new TypeError('Rue socket acknowledgement timed out')); this.socket?.close() }, 10000)
      this.pending.set(id, { resolve, reject, timer })
      try { this.socket!.send(frame) } catch { clearTimeout(timer); this.pending.delete(id); reject(new TypeError('Rue socket send failed')) }
    })
  }
  close() {
    this.disposed = true; this.ready = false
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new TypeError('Rue socket stopped')) }
    this.pending.clear()
    try { this.socket?.close() } catch {}
  }
}
