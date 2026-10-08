import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import WebSocket from 'ws'
import { atomicState, config, readPrivate } from '../src/config.js'
import { controlSession } from '../src/control.js'
import { dockerInfo } from '../src/docker.js'

const dirs: string[] = []
const directory = () => { const path = mkdtempSync(join(tmpdir(), 'rue-worker-test-')); dirs.push(path); return path }
afterEach(() => { dirs.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); vi.useRealTimers() })
const id = randomUUID(), secret = 'rue_worker_' + 'a'.repeat(43)
const health = { version: '0.1.0', platform: 'linux', architecture: 'x64', dockerAvailable: true, acceptingWork: false, freeMemoryBytes: 1, cpus: 1, capabilities: ['host-health-v1'] }

test('enrollment is private and origin-bound; partial bootstrap does not mix saved credentials', () => {
  const stateDir = directory(), file = join(stateDir, 'credential')
  writeFileSync(file, secret, { mode: 0o600 })
  const env = { RUE_WORKER_STATE_DIR: stateDir, RUE_WORKER_API_URL: 'https://rue.test', RUE_WORKER_ID: id, RUE_WORKER_SECRET_FILE: file }
  const value = config(env)
  expect(value.secret).toBe(secret)
  atomicState(stateDir, 'link.json', { origin: value.origin, id, secret })
  expect(statSync(join(stateDir, 'link.json')).mode & 0o777).toBe(0o600)
  expect(config({ RUE_WORKER_STATE_DIR: stateDir }).secret).toBe(secret)
  expect(() => config({ RUE_WORKER_STATE_DIR: stateDir, RUE_WORKER_API_URL: 'https://different.test' })).toThrow('configuration_missing')
  for (const origin of ['http://rue.test', 'https://user:password@rue.test', 'https://rue.test/path', 'https://rue.test?token=bad']) expect(() => config({ ...env, RUE_WORKER_API_URL: origin })).toThrow('https_origin_required')
  chmodSync(file, 0o644); expect(() => config(env)).toThrow('credential_not_private')
})
test('state and credential symlinks are rejected and status contains only supplied metadata', () => {
  const root = directory(), target = join(root, 'private')
  writeFileSync(target, secret, { mode: 0o600 }); symlinkSync(target, join(root, 'link'))
  expect(() => readPrivate(join(root, 'link'))).toThrow()
  const linkedDir = join(directory(), 'state'); symlinkSync(root, linkedDir)
  expect(() => atomicState(linkedDir, 'status.json', {})).toThrow('state_not_private')
  atomicState(root, 'status.json', { state: 'connected', workerId: id })
  expect(readFileSync(join(root, 'status.json'), 'utf8')).not.toContain(secret)
})

function transport() {
  const socket = Object.assign(new EventEmitter(), { readyState: WebSocket.OPEN, bufferedAmount: 0, send: vi.fn(), terminate: vi.fn() })
  const abort = new AbortController(), observed = vi.fn()
  const run = controlSession({ config: { origin: 'https://rue.test', id, secret, stateDir: '/unused', dockerSocket: '/unused' }, instance: randomUUID(), signal: abort.signal, health: () => health, observed, socket: () => socket as unknown as WebSocket }).catch(error => error)
  const emit = (frame: unknown) => socket.emit('message', Buffer.from(JSON.stringify(frame)), false)
  const lease = () => ({ protocol: 1, generation: 1, serverNow: Date.now(), expiresAt: Date.now() + 60000, worker: { id, desired: 'active' } })
  const ack = () => emit({ type: 'heartbeat_ack', requestId: JSON.parse(socket.send.mock.calls.at(-1)![0]).requestId, lease: lease() })
  socket.emit('open')
  return { socket, abort, observed, run, emit, lease, ack }
}
test('healthy lease heartbeats keep one connection open and clean up all timers on shutdown', async () => {
  vi.useFakeTimers()
  const t = transport(); t.emit({ type: 'ready', lease: t.lease() }); t.ack()
  for (let i = 0; i < 6; i++) { await vi.advanceTimersByTimeAsync(15000); t.ack() }
  expect(t.observed).toHaveBeenCalledTimes(8)
  expect(t.socket.terminate).not.toHaveBeenCalled()
  t.abort.abort(); expect(await t.run).toBeUndefined()
  expect(vi.getTimerCount()).toBe(0); expect(t.socket.listenerCount('message')).toBe(0)
})
test('missing acknowledgements close the socket; late messages cannot restore authority', async () => {
  vi.useFakeTimers()
  const t = transport(); t.emit({ type: 'ready', lease: t.lease() })
  await vi.advanceTimersByTimeAsync(10000)
  expect(await t.run).toMatchObject({ code: 'worker_ack_timeout', fatal: false })
  t.ack(); expect(t.observed).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})
test.each(['wrong-worker', 'long-lease', 'wrong-generation', 'bad-protocol'])('invalid authority fails closed (%s)', async mode => {
  vi.useFakeTimers()
  const t = transport(), lease = t.lease()
  if (mode === 'wrong-worker') lease.worker.id = randomUUID()
  if (mode === 'long-lease') lease.expiresAt++
  if (mode === 'wrong-generation') lease.generation = 0
  if (mode === 'bad-protocol') lease.protocol = 5
  t.emit({ type: 'ready', lease })
  expect(await t.run).toMatchObject({ code: 'worker_protocol_invalid', fatal: true })
  expect(vi.getTimerCount()).toBe(0)
})
test('temporary server failures remain retryable without reflecting response details', async () => {
  vi.useFakeTimers()
  const t = transport(); t.emit({ type: 'error', status: 503, code: secret })
  expect(await t.run).toMatchObject({ code: 'worker_session_unavailable', fatal: false })
  expect(vi.getTimerCount()).toBe(0)
})
test('server rejection is sanitized, and wall-clock rollback terminates existing authority', async () => {
  vi.useFakeTimers()
  const rejected = transport(); rejected.emit({ type: 'error', status: 401, code: secret })
  expect(await rejected.run).toMatchObject({ code: 'worker_authority_rejected', fatal: true })
  const t = transport(); t.emit({ type: 'ready', lease: t.lease() }); t.ack()
  vi.setSystemTime(Date.now() - 10000); await vi.advanceTimersByTimeAsync(250)
  expect(await t.run).toMatchObject({ code: 'worker_lease_expired' })
  expect(vi.getTimerCount()).toBe(0)
})
test('Docker probe is read-only, bounded and returns no engine paths or configuration', async () => {
  const socket = join(directory(), 'docker.sock'), paths: string[] = []
  const server = createServer((request, response) => { paths.push(`${request.method} ${request.url}`); response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ ServerVersion: '29.5.3', NCPU: 8, MemTotal: 123456, DockerRootDir: '/private', secret })) })
  await new Promise<void>(resolve => server.listen(socket, resolve))
  try {
    expect(await dockerInfo(socket)).toEqual({ version: '29.5.3', cpus: 8, totalMemoryBytes: 123456 })
    expect(paths).toEqual(['GET /info'])
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})
