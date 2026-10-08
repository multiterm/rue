import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { afterEach, expect, test } from 'vitest'
import { openDatabase, listMessages, listSessionParts, deleteSession } from '../../src/storage/index.js'
import { requestTerminalPairing, approveTerminalPairing, exchangeTerminalPairing, activateTerminalConnection, revokeTerminalConnection } from '../../src/storage/terminal-pairing.js'
import { attachComputer, configureComputer, enqueueTerminalPrompt, mirrorTerminalText, pollComputer, publishCommand, remoteComputers, computerQueue, transitionCommand } from '../../src/storage/terminal-relay.js'
const databases: ReturnType<typeof openDatabase>[] = []
afterEach(() => databases.splice(0).forEach(db => db.close()))
function fixture(protocol = 1) {
  const db = openDatabase(':memory:'); databases.push(db)
  const verifier = randomBytes(32).toString('base64url'), now = Date.now()
  const { requestId } = requestTerminalPairing(db, createHash('sha256').update(verifier).digest('hex'), 'pi-session', now)
  const { code } = approveTerminalPairing(db, requestId, 'alice', 'Laptop', now)
  const grant = exchangeTerminalPairing(db, requestId, verifier, code, now)
  activateTerminalConnection(db, grant.token, now, 'alice')
  const instance = randomUUID()
  attachComputer(db, grant.token, grant.id, instance, now, protocol)
  configureComputer(db, 'alice', grant.id, 'Laptop', true, 0)
  const queue = (id = randomUUID(), text = 'Hello', time = now) => enqueueTerminalPrompt(db, 'alice', grant.sessionId, id, text, time)
  return { db, grant, instance, now, queue }
}
test('v2 renews execution beyond ten minutes, but expired leases cannot revive or publish', () => {
  const { db, grant: g, instance, now, queue } = fixture(2)
  const run = queue()
  transitionCommand(db, g.token, g.id, instance, run.id, 'claim', now)
  transitionCommand(db, g.token, g.id, instance, run.id, 'start', now)
  for (let elapsed = 20_000; elapsed <= 720_000; elapsed += 20_000) {
    const response = pollComputer(db, g.token, g.id, instance, now + elapsed, 2)
    expect(response.commands[0]).toMatchObject({ id: run.id, status: 'running', started_at: now, lease_expires_at: now + elapsed + 60000 })
  }
  const expiredAt = now + 780_000
  expect(() => pollComputer(db, g.token, g.id, instance, expiredAt, 2)).toThrow('computer_lease_expired')
  expect(() => publishCommand(db, g.token, g.id, instance, run.id, 1, 'late', 'completed', expiredAt)).toThrow('computer_lease_expired')
  expect(() => mirrorTerminalText(db, g.token, g.id, instance, randomUUID(), 'user', 'late', expiredAt)).toThrow('computer_lease_expired')
  attachComputer(db, g.token, g.id, instance, expiredAt, 2)
  expect(pollComputer(db, g.token, g.id, instance, expiredAt, 2).commands).toEqual([])
  expect(() => transitionCommand(db, g.token, g.id, instance, run.id, 'start', expiredAt)).toThrow('command_unavailable')
})

test('v2 separates approval age from queue age, rejects clock rollback and protocol downgrade', () => {
  const { db, grant: g, instance, now, queue } = fixture(2)
  const run = queue()
  for (let elapsed = 20000; elapsed <= 240000; elapsed += 20000) pollComputer(db, g.token, g.id, instance, now + elapsed, 2)
  transitionCommand(db, g.token, g.id, instance, run.id, 'claim', now + 240000)
  for (let elapsed = 260000; elapsed <= 360000; elapsed += 20000) pollComputer(db, g.token, g.id, instance, now + elapsed, 2)
  expect(transitionCommand(db, g.token, g.id, instance, run.id, 'start', now + 360000)).toMatchObject({ status: 'running', started_at: now + 360000 })
  expect(() => pollComputer(db, g.token, g.id, instance, now + 360000, 1)).toThrow('relay_protocol_mismatch')
  expect(() => pollComputer(db, g.token, g.id, instance, now + 350000, 2)).toThrow('computer_lease_expired')
})

test('v2 health is owner scoped and long-run maximum is independent of healthy leases', () => {
  const { db, grant: g, instance, now, queue } = fixture(2)
  const run = queue()
  transitionCommand(db, g.token, g.id, instance, run.id, 'claim', now)
  transitionCommand(db, g.token, g.id, instance, run.id, 'start', now)
  const health = { uploadFailures: 2, retries: 3, lastUploadAt: now, pendingCount: 1, pendingBytes: 200, pollLatencyMs: 5 }
  pollComputer(db, g.token, g.id, instance, now, 2, health)
  expect(remoteComputers(db, 'alice', now)[0]).toMatchObject({ relayProtocol: 2, leaseExpiresAt: now + 60000, health })
  expect(remoteComputers(db, 'bob', now)).toEqual([])
  db.prepare('UPDATE terminal_commands SET started_at=? WHERE id=?').run(now - 24 * 60 * 60000, run.id)
  expect(pollComputer(db, g.token, g.id, instance, now, 2).commands).toEqual([])
})

test('the active queue is not truncated by newer finished history and is owner-scoped', () => {
  const { db, grant: g, now, queue } = fixture()
  const active = queue()
  for (let i = 0; i < 12; i++) {
    const historical = queue(randomUUID(), `Historical ${i}`, now + i + 1)
    db.prepare("UPDATE terminal_commands SET status='expired' WHERE id=?").run(historical.id)
  }
  expect(remoteComputers(db, 'alice', now + 20)[0]!.runs).toHaveLength(10)
  expect(computerQueue(db, 'alice', g.id, now + 20)?.map(row => row.id)).toEqual([active.id])
  expect(computerQueue(db, 'bob', g.id, now + 20)).toBeUndefined()
  expect(computerQueue(db, 'alice', g.id, now + 300_001)?.map(row=>row.id)).toEqual([active.id])
})

test('durable commands deduplicate, stream text monotonically and never execute in the cloud', () => {
  const { db, grant: g, instance, now, queue } = fixture()
  const id = randomUUID(), run = queue(id)
  expect(queue(id).id).toBe(run.id)
  expect(() => queue(id, 'Different')).toThrow('request_id_conflict')
  expect(listMessages(db, g.sessionId)).toHaveLength(2)
  expect(() => publishCommand(db, g.token, g.id, instance, run.id, 1, 'No', 'completed', now)).toThrow()
  transitionCommand(db, g.token, g.id, instance, run.id, 'claim', now)
  transitionCommand(db, g.token, g.id, instance, run.id, 'start', now)
  expect(transitionCommand(db, g.token, g.id, instance, run.id, 'start', now).status).toBe('running')
  publishCommand(db, g.token, g.id, instance, run.id, 1, 'Hi', 'running', now)
  expect(() => publishCommand(db, g.token, g.id, instance, run.id, 1, 'Changed', 'running', now)).toThrow('command_revision_conflict')
  publishCommand(db, g.token, g.id, instance, run.id, 2, 'Hi there', 'completed', now)
  expect(publishCommand(db, g.token, g.id, instance, run.id, 2, 'Hi there', 'completed', now).status).toBe('completed')
  expect(() => publishCommand(db, g.token, g.id, instance, run.id, 3, 'Overwrite', 'completed', now)).toThrow()
  expect(listSessionParts(db, g.sessionId).at(-1)?.payload.text).toBe('Hi there')
  expect(pollComputer(db, g.token, g.id, instance, now).commands).toHaveLength(0)
})
test('offline, disabled, revoked, foreign-owner and old-instance requests fail closed', () => {
  const { db, grant: g, instance, now, queue } = fixture()
  expect(() => enqueueTerminalPrompt(db, 'bob', g.sessionId, randomUUID(), 'Hello', now)).toThrow()
  expect(() => configureComputer(db, 'bob', g.id, 'Other', true, 1)).toThrow()
  expect(remoteComputers(db, 'bob')).toEqual([])
  expect(() => queue(randomUUID(), 'Late', now + 31000)).toThrow('computer_not_ready')
  configureComputer(db, 'alice', g.id, 'Laptop', false, 1)
  expect(() => queue()).toThrow('computer_not_ready')
  expect(() => configureComputer(db, 'alice', g.id, 'Laptop', true, 1)).toThrow('computer_settings_conflict')
  configureComputer(db, 'alice', g.id, 'Laptop', true, 2)
  attachComputer(db, g.token, g.id, randomUUID(), now)
  expect(() => pollComputer(db, g.token, g.id, instance, now)).toThrow('computer_instance_changed')
  revokeTerminalConnection(db, 'alice', g.id, now)
  expect(() => queue()).toThrow('computer_not_ready')
  expect(() => mirrorTerminalText(db, g.token, g.id, instance, randomUUID(), 'user', 'secret', now)).toThrow()
})
test('restart, expiry, disabled prompting and missing heartbeats cannot replay ambiguous runs', () => {
  const { db, grant: g, instance, now, queue } = fixture()
  const first = queue(); transitionCommand(db, g.token, g.id, instance, first.id, 'claim', now)
  const another = queue()
  expect(() => transitionCommand(db, g.token, g.id, instance, another.id, 'claim', now)).toThrow('computer_busy')
  const replacement = randomUUID(); attachComputer(db, g.token, g.id, replacement, now)
  expect(remoteComputers(db, 'alice', now)[0]!.runs.find((r: any) => r.id === first.id)).toMatchObject({ status: 'interrupted' })
  expect(() => transitionCommand(db, g.token, g.id, replacement, first.id, 'start', now)).toThrow()
  transitionCommand(db, g.token, g.id, replacement, another.id, 'claim', now)
  transitionCommand(db, g.token, g.id, replacement, another.id, 'start', now)
  expect(pollComputer(db, g.token, g.id, replacement, now + 31000).commands).toEqual([])
  expect(() => publishCommand(db, g.token, g.id, replacement, another.id, 1, 'Late output', 'completed', now + 31000)).toThrow()
})
test('local mirroring is idempotent and never creates a runnable command; deleting the bot removes credentials', () => {
  const { db, grant: g, instance, now } = fixture()
  const event = randomUUID()
  const first = mirrorTerminalText(db, g.token, g.id, instance, event, 'user', 'Local message', now)
  expect(mirrorTerminalText(db, g.token, g.id, instance, event, 'user', 'Local message', now)).toEqual(first)
  expect(() => mirrorTerminalText(db, g.token, g.id, instance, event, 'assistant', 'Different', now)).toThrow('mirror_conflict')
  expect(listMessages(db, g.sessionId)).toHaveLength(1)
  expect(pollComputer(db, g.token, g.id, instance, now).commands).toEqual([])
  deleteSession(db, g.sessionId, 'alice')
  expect(() => pollComputer(db, g.token, g.id, instance, now)).toThrow()
})
test('mirror snapshots update one message monotonically, finalize, and reject cross-role rewrites', () => {
  const { db, grant: g, instance, now } = fixture(), event = randomUUID()
  const publish = (text: string, version: number, final = false, role: 'user' | 'assistant' = 'assistant') => mirrorTerminalText(db, g.token, g.id, instance, event, role, text, now, { version, final })
  const first = publish('Checking', 1)
  expect(publish('Checking files', 2)).toEqual(first)
  expect(publish('Checking', 1)).toEqual(first) // delayed update cannot revert newer text
  expect(listSessionParts(db, g.sessionId)[0]?.payload).toMatchObject({ text: 'Checking files', remoteStatus: 'running' })
  expect(() => publish('Changed same revision', 2)).toThrow('mirror_conflict')
  expect(() => publish('Changed role', 3, false, 'user')).toThrow('mirror_conflict')
  publish('Done', 3, true); expect(publish('Done', 3, true)).toEqual(first)
  expect(() => publish('Overwrite final', 4)).toThrow('mirror_conflict')
  expect(() => mirrorTerminalText(db, g.token, g.id, instance, event, 'assistant', 'Done', now)).toThrow('mirror_conflict')
  expect(listMessages(db, g.sessionId)).toHaveLength(1)
  expect(listSessionParts(db, g.sessionId)[0]?.payload).toMatchObject({ text: 'Done', remoteStatus: 'completed' })
  expect(pollComputer(db, g.token, g.id, instance, now).commands).toEqual([])
})

test('failed mirror delivery stays failed and its finalized outcome cannot be rewritten',()=>{
 const {db,grant:g,instance,now}=fixture(),event=randomUUID()
 const snapshot={version:1,final:true,outcome:'failed' as const}
 mirrorTerminalText(db,g.token,g.id,instance,event,'assistant','Safe runtime failure',now,snapshot)
 expect(listSessionParts(db,g.sessionId)[0]?.payload).toMatchObject({remoteStatus:'failed',mirrorFinal:true,mirrorOutcome:'failed'})
 expect(()=>mirrorTerminalText(db,g.token,g.id,instance,event,'assistant','Safe runtime failure',now,{version:1,final:true})).toThrow('mirror_conflict')
 expect(()=>mirrorTerminalText(db,g.token,g.id,instance,randomUUID(),'assistant','Failure',now,{...snapshot,final:false})).toThrow('mirror_conflict')
})
test('queue is bounded and never-started prompts survive age without becoming execution authority', () => {
  const { db, grant: g, instance, now, queue } = fixture()
  const queued = Array.from({ length: 10 }, () => queue())
  expect(() => queue()).toThrow('computer_queue_full')
  const retained = pollComputer(db, g.token, g.id, instance, now + 300001).commands
  expect(retained.map(command => command.id)).toEqual(queued.map(command => command.id))
  for (const command of retained) expect(command).toMatchObject({ status: 'queued', instance_id: null, claimed_at: null, started_at: null, version: 0 })
})
