import { createHash, randomBytes } from 'node:crypto'
import { afterEach, expect, test } from 'vitest'
import { openDatabase } from '../../src/storage/index.js'
import { requestTerminalPairing, approveTerminalPairing, exchangeTerminalPairing, activateTerminalConnection, authenticateTerminalConnection, listTerminalConnections, revokeTerminalConnection } from '../../src/storage/terminal-pairing.js'

const databases: ReturnType<typeof openDatabase>[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })
function fixture() {
  const db = openDatabase(':memory:'); databases.push(db)
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('hex')
  const request = requestTerminalPairing(db, challenge, 'pi-session-one', 1_000)
  return { db, verifier, request }
}
test('code exchange is bound to terminal proof and requires activation; no credential disclosure', () => {
  const { db, verifier, request } = fixture()
  const approval = approveTerminalPairing(db, request.requestId, 'alice', 'Local Pi', 2_000)
  const storedRequest = JSON.stringify(db.prepare('SELECT * FROM terminal_pairing_requests').all())
  expect(storedRequest).not.toContain(verifier); expect(storedRequest).not.toContain(approval.code)
  expect(() => exchangeTerminalPairing(db, request.requestId, randomBytes(32).toString('base64url'), approval.code, 3_000)).toThrow('invalid_pairing')
  expect(db.prepare('SELECT attempts FROM terminal_pairing_requests').get()).toEqual({ attempts: 0 })
  const grant = exchangeTerminalPairing(db, request.requestId, verifier, approval.code, 3_000)
  expect(() => authenticateTerminalConnection(db, grant.token, grant.id, 4_000)).toThrow('invalid_terminal_credential')
  activateTerminalConnection(db, grant.token, 4_000)
  expect(authenticateTerminalConnection(db, grant.token, grant.id, 4_001)).toMatchObject({ ownerSubject: 'alice', sessionId: grant.sessionId, piSessionId: 'pi-session-one' })
  expect(listTerminalConnections(db, 'bob')).toEqual([])
  expect(JSON.stringify(listTerminalConnections(db, 'alice'))).not.toContain(grant.token)
  expect(JSON.stringify(db.prepare('SELECT * FROM terminal_connections').all())).not.toContain(grant.token)
  expect(() => authenticateTerminalConnection(db, grant.token, 'another-connection', 4_002)).toThrow('invalid_terminal_credential')
  expect(() => exchangeTerminalPairing(db, request.requestId, verifier, approval.code, 4_003)).toThrow('invalid_pairing')
  expect(db.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 1 })
})
test('approval cannot be stolen or regenerated after an owner approves', () => {
  const { db, request } = fixture()
  approveTerminalPairing(db, request.requestId, 'alice', 'Local Pi', 2_000)
  expect(() => approveTerminalPairing(db, request.requestId, 'bob', 'Other Pi', 2_001)).toThrow('already_approved')
  expect(() => approveTerminalPairing(db, request.requestId, 'alice', 'Local Pi', 2_001)).toThrow('already_approved')
})
test('failed OTP attempts persist and eventually lock the request', () => {
  const { db, verifier, request } = fixture()
  const { code } = approveTerminalPairing(db, request.requestId, 'alice', 'Local Pi', 2_000)
  const wrongCode = code === '000000000000' ? '111111111111' : '000000000000'
  for (let attempt = 1; attempt <= 5; attempt++) {
    expect(() => exchangeTerminalPairing(db, request.requestId, verifier, wrongCode, 3_000)).toThrow('invalid_pairing')
    expect(db.prepare('SELECT attempts FROM terminal_pairing_requests').get()).toEqual({ attempts: attempt })
  }
  expect(() => exchangeTerminalPairing(db, request.requestId, verifier, code, 3_001)).toThrow('invalid_pairing')
})
test('pair requests expire without creating a bot', () => {
  const { db, verifier, request } = fixture()
  const { code } = approveTerminalPairing(db, request.requestId, 'alice', 'Local Pi', 2_000)
  expect(() => exchangeTerminalPairing(db, request.requestId, verifier, code, request.expiresAt)).toThrow('invalid_pairing')
  expect(db.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 0 })
})
test('owner revocation, expiry, and bot deletion invalidate a credential', () => {
  const { db, verifier, request } = fixture()
  const { code } = approveTerminalPairing(db, request.requestId, 'alice', 'Local Pi', 2_000)
  const grant = exchangeTerminalPairing(db, request.requestId, verifier, code, 3_000)
  activateTerminalConnection(db, grant.token, 3_001)
  expect(revokeTerminalConnection(db, 'bob', grant.id, 4_000)).toBe(false)
  expect(() => authenticateTerminalConnection(db, grant.token, grant.id, grant.expiresAt)).toThrow('invalid_terminal_credential')
  expect(revokeTerminalConnection(db, 'alice', grant.id, 4_001)).toBe(true)
  expect(() => authenticateTerminalConnection(db, grant.token, grant.id, 4_002)).toThrow('invalid_terminal_credential')
  expect(() => activateTerminalConnection(db, grant.token, 4_003)).toThrow('invalid_terminal_credential')
  db.prepare('DELETE FROM sessions WHERE id=?').run(grant.sessionId)
  expect(listTerminalConnections(db, 'alice')).toEqual([])
})
test('credentials cannot follow a bot across an ownership change', () => {
  const { db, verifier, request } = fixture()
  const { code } = approveTerminalPairing(db, request.requestId, 'alice', 'Local Pi', 2_000)
  const grant = exchangeTerminalPairing(db, request.requestId, verifier, code, 3_000)
  activateTerminalConnection(db, grant.token, 3_001)
  db.prepare('UPDATE sessions SET owner_subject=? WHERE id=?').run('bob', grant.sessionId)
  expect(() => authenticateTerminalConnection(db, grant.token, grant.id, 4_000)).toThrow('invalid_terminal_credential')
})
test('pending storage is bounded and expired requests are collected', () => {
  const { db, request } = fixture()
  const challenge = createHash('sha256').update(randomBytes(32)).digest('hex')
  for (let i = 1; i < 100; i++) requestTerminalPairing(db, challenge, 'pi-session-two', 1_000)
  expect(() => requestTerminalPairing(db, challenge, 'pi-session-two', 1_000)).toThrow('pairing_unavailable')
  requestTerminalPairing(db, challenge, 'pi-session-two', request.expiresAt)
  expect(db.prepare('SELECT count(*) AS n FROM terminal_pairing_requests').get()).toEqual({ n: 1 })
})
