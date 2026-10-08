import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import type { RueWorkerHealth, RueWorkerLease } from '@multiterm/rue-sdk'
import type { WorkerConfig } from './config.js'

export class ControlError extends Error {
  constructor(readonly code: string, readonly fatal = false) { super(code) }
}
export interface ControlOptions {
  config: WorkerConfig
  instance: string
  signal: AbortSignal
  health(): RueWorkerHealth
  observed(lease: RueWorkerLease, deadline: { mono: number; wall: number }): void
  socket?(url: string): WebSocket
}
/** One stream per attempt. Socket close never silently extends execution authority. */
export function controlSession(options: ControlOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const { config, signal } = options
    if (signal.aborted) { resolve(); return }
    const socket = options.socket?.(config.origin.replace(/^https:/, 'wss:') + '/worker-client/socket') ?? new WebSocket(config.origin.replace(/^https:/, 'wss:') + '/worker-client/socket', { handshakeTimeout: 10000, maxPayload: 65536, perMessageDeflate: false })
    let finished = false, generation: number | undefined, pending: { id: string; started: number; wall: number } | undefined
    let leaseDeadline = 0, leaseWall = 0, lastWall = Date.now(), again = false
    const connectedAt = performance.now(), connectedWall = Date.now()
    let deadline: ReturnType<typeof setTimeout> | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let watchdog: ReturnType<typeof setInterval> | undefined
    const finish = (error?: Error) => {
      if (finished) return
      finished = true; clearTimeout(deadline); clearInterval(heartbeat); clearInterval(watchdog)
      signal.removeEventListener('abort', abort)
      socket.removeAllListeners('open'); socket.removeAllListeners('message'); socket.removeAllListeners('close')
      // Keep the harmless error listener while termination completes.
      socket.terminate()
      if (signal.aborted) resolve(); else reject(error ?? new ControlError('worker_transport_lost'))
    }
    const abort = () => finish()
    const arm = () => { clearTimeout(deadline); deadline = setTimeout(() => finish(new ControlError('worker_ack_timeout')), 10000) }
    const send = (frame: unknown) => {
      if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 65536) throw new ControlError('worker_transport_unavailable')
      socket.send(JSON.stringify(frame))
    }
    const requestHeartbeat = () => {
      if (finished || generation === undefined) return
      if (pending) { again = true; return }
      try {
        pending = { id: randomUUID(), started: performance.now(), wall: Date.now() }
        arm(); send({ type: 'heartbeat', requestId: pending.id, generation, health: options.health() })
      } catch { finish(new ControlError('worker_heartbeat_failed')) }
    }
    const renew = (value: unknown, started: number, wall: number) => {
      const lease = value as RueWorkerLease
      const ttl = lease?.expiresAt - lease?.serverNow
      if (lease?.protocol !== 1 || !Number.isSafeInteger(lease.generation) || lease.generation < 1 || !Number.isSafeInteger(lease.serverNow) || !Number.isSafeInteger(lease.expiresAt) || !Number.isFinite(ttl) || ttl <= 1000 || ttl > 60000 || lease.worker?.id !== config.id || !['active','draining'].includes(lease.worker.desired) || (generation !== undefined && generation !== lease.generation)) throw new ControlError('worker_protocol_invalid', true)
      generation = lease.generation
      leaseDeadline = started + ttl - 1000; leaseWall = wall + ttl - 1000
      if (performance.now() >= leaseDeadline || Date.now() >= leaseWall || Date.now() < wall - 1000) throw new ControlError('worker_lease_expired')
      options.observed(lease, { mono: leaseDeadline, wall: leaseWall })
    }
    signal.addEventListener('abort', abort, { once: true })
    arm()
    socket.on('error', () => finish(new ControlError('worker_transport_lost')))
    socket.on('close', () => finish(new ControlError('worker_transport_lost')))
    socket.on('open', () => {
      try { send({ type: 'authenticate', protocol: 1, id: config.id, token: config.secret, instance: options.instance }) }
      catch { finish(new ControlError('worker_transport_lost')) }
    })
    socket.on('message', (raw, binary) => {
      if (finished) return
      try {
        if (binary) throw Error()
        const frame = JSON.parse(raw.toString())
        if (frame.type === 'error') {
          // Never log server-supplied strings. Authorization/protocol errors fail closed.
          const retryable = frame.status === 409 || frame.status === 429 || (Number.isInteger(frame.status) && frame.status >= 500 && frame.status <= 599)
          finish(new ControlError(frame.status === 401 ? 'worker_authority_rejected' : retryable ? 'worker_session_unavailable' : 'worker_protocol_rejected', !retryable)); return
        }
        if (frame.type === 'ready' && generation === undefined) {
          renew(frame.lease, connectedAt, connectedWall); clearTimeout(deadline)
          heartbeat = setInterval(requestHeartbeat, 15000)
          watchdog = setInterval(() => {
            const wall = Date.now()
            if (performance.now() >= leaseDeadline || wall >= leaseWall || wall < lastWall - 1000) finish(new ControlError('worker_lease_expired'))
            lastWall = wall
          }, 250)
          requestHeartbeat(); return
        }
        if (frame.type === 'changed' && generation !== undefined) { requestHeartbeat(); return }
        if (frame.type !== 'heartbeat_ack' || !pending || frame.requestId !== pending.id) throw Error()
        renew(frame.lease, pending.started, pending.wall); pending = undefined; clearTimeout(deadline)
        if (again) { again = false; requestHeartbeat() }
      } catch (error) { finish(error instanceof ControlError ? error : new ControlError('worker_protocol_invalid', true)) }
    })
    if (signal.aborted) abort()
  })
}

export function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>(resolve => {
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
    const timer = setTimeout(done, ms); signal.addEventListener('abort', done, { once: true }); if (signal.aborted) done()
  })
}
