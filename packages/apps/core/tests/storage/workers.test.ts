import { randomUUID } from 'node:crypto'
import { afterEach, expect, test } from 'vitest'
import { openDatabase } from '../../src/storage/db.js'
import { changeWorker, connectWorker, createWorker, heartbeatWorker, listWorkers, validateWorker, workerHealthSchema } from '../../src/storage/workers.js'

const databases: ReturnType<typeof openDatabase>[] = []
const health = { version: '0.1.0', platform: 'linux', architecture: 'x64', dockerAvailable: true, acceptingWork: true, freeMemoryBytes: 1000, cpus: 2, capabilities: ['host-health-v1'] }
function setup() {
  const db = openDatabase(':memory:'); databases.push(db)
  const grant = createWorker(db, 'alice', 'Mason', randomUUID(), 1000)
  return { db, id: grant.worker.id, secret: grant.secret!, instance: randomUUID() }
}
afterEach(() => databases.splice(0).forEach(db => db.close()))

test('enrollment is owner scoped, stores only a hash, and does not duplicate ambiguous requests', () => {
  const { db } = setup(), request = randomUUID()
  const first = createWorker(db, 'alice', 'Other host', request, 2000)
  expect(first.secret).toMatch(/^rue_worker_[A-Za-z0-9_-]{43}$/)
  expect(JSON.stringify(db.prepare('SELECT * FROM workers').all())).not.toContain(first.secret)
  const again = createWorker(db, 'alice', 'Other host', request, 2001)
  expect(again.worker.id).toBe(first.worker.id); expect(again).not.toHaveProperty('secret')
  expect(() => createWorker(db, 'alice', 'Changed intent', request)).toThrow('worker_request_conflict')
  const bob = createWorker(db, 'bob', 'Other host', request)
  expect(bob.worker.id).not.toBe(first.worker.id)
  expect(listWorkers(db, 'bob')).toHaveLength(1)
  expect(JSON.stringify(listWorkers(db, 'alice'))).not.toMatch(/token_hash|enrollment_request_id|rue_worker_/)
})
test('concurrent instances cannot displace a valid lease; expired authority cannot be renewed', () => {
  const { db, id, secret, instance } = setup()
  const first = connectWorker(db, id, secret, instance, 2000)
  expect(first.generation).toBe(1)
  expect(connectWorker(db, id, secret, instance, 3000).generation).toBe(1)
  expect(() => connectWorker(db, id, secret, randomUUID(), 4000)).toThrow('worker_already_connected')
  expect(() => heartbeatWorker(db, id, secret, instance, 2, health, 4000)).toThrow('worker_session_fenced')
  expect(() => heartbeatWorker(db, id, secret, instance, 1, health, 63000)).toThrow('worker_session_fenced')
  const replacement = randomUUID(), next = connectWorker(db, id, secret, replacement, 63000)
  expect(next.generation).toBe(2)
  expect(() => validateWorker(db, id, secret, instance, 1, 63001)).toThrow('worker_session_fenced')
  expect(() => validateWorker(db, id, secret, replacement, 2, 62000)).toThrow('worker_session_fenced')
})
test('draining, revision conflicts, rotation and revocation are durable and audited', () => {
  const { db, id, secret, instance } = setup()
  connectWorker(db, id, secret, instance, 2000)
  expect(() => changeWorker(db, 'bob', id, 'drain', 0)).toThrow('worker_not_found')
  changeWorker(db, 'alice', id, 'drain', 0, 2100)
  expect(() => changeWorker(db, 'alice', id, 'activate', 0)).toThrow('worker_revision_conflict')
  const heartbeat = heartbeatWorker(db, id, secret, instance, 1, health, 2200)
  expect(heartbeat.worker.desired).toBe('draining')
  expect(heartbeat.worker.health?.acceptingWork).toBe(false)
  const rotated = changeWorker(db, 'alice', id, 'rotate', 1, 2300)
  expect(rotated.secret).not.toBe(secret)
  expect(() => validateWorker(db, id, secret, instance, 1, 2400)).toThrow('invalid_worker_credential')
  const fresh = connectWorker(db, id, rotated.secret!, instance, 2400)
  expect(fresh.generation).toBeGreaterThan(1)
  changeWorker(db, 'alice', id, 'revoke', 2, 2500)
  expect(() => connectWorker(db, id, rotated.secret!, instance, 2600)).toThrow('invalid_worker_credential')
  expect(listWorkers(db, 'alice', 2600)[0].status).toBe('revoked')
  expect(db.prepare('SELECT action FROM worker_audit ORDER BY rowid').all()).toEqual(['enroll','drain','rotate','revoke'].map(action => ({ action })))
})
test('health accepts only bounded metadata and does not claim readiness without Docker', () => {
  const { db, id, secret, instance } = setup(); connectWorker(db, id, secret, instance, 2000)
  expect(workerHealthSchema.safeParse({ ...health, environment: { SECRET: 'no' } }).success).toBe(false)
  expect(workerHealthSchema.safeParse({ ...health, capabilities: ['execute-arbitrary-shell'] }).success).toBe(false)
  expect(workerHealthSchema.safeParse({ ...health, cpus: Infinity }).success).toBe(false)
  expect(heartbeatWorker(db, id, secret, instance, 1, { ...health, dockerAvailable: false }, 3000).worker.health?.acceptingWork).toBe(false)
  expect(listWorkers(db, 'alice', 63000)[0].status).toBe('offline')
})
test('credentials cannot target a different worker and enrollment is bounded', () => {
  const { db, id, secret, instance } = setup()
  expect(() => connectWorker(db, randomUUID(), secret, instance)).toThrow('invalid_worker_credential')
  expect(() => connectWorker(db, id, 'alice', instance)).toThrow('invalid_worker_credential')
  for (let i = 1; i < 100; i++) createWorker(db, 'alice', `host ${i}`, randomUUID())
  expect(() => createWorker(db, 'alice', 'overflow', randomUUID())).toThrow('worker_limit')
})
