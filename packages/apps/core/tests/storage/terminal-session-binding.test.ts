import { createHash, randomBytes } from 'node:crypto'
import { expect, test } from 'vitest'
import { openDatabase, getSession, updateSession } from '../../src/storage/index.js'
import { requestTerminalPairing, approveTerminalPairing, exchangeTerminalPairing, revokeTerminalConnection, activateTerminalConnection, authenticateTerminalConnection } from '../../src/storage/terminal-pairing.js'
import { attachComputer, configureComputer, enqueueTerminalPrompt } from '../../src/storage/terminal-relay.js'

test('duplicate exchanges cannot create a second bot; revoked/expired links renew the original binding', () => {
  const db = openDatabase(':memory:')
  try {
    function pair(session = 'same-pi-session', owner = 'alice', now = Date.now()) {
      const verifier = randomBytes(32).toString('base64url')
      const p = requestTerminalPairing(db, createHash('sha256').update(verifier).digest('hex'), session, now)
      const a = approveTerminalPairing(db, p.requestId, owner, 'Laptop', now)
      return () => exchangeTerminalPairing(db, p.requestId, verifier, a.code, now)
    }
    const first = pair()()
    activateTerminalConnection(db, first.token)
    attachComputer(db, first.token, first.id, 'instance')
    configureComputer(db, 'alice', first.id, 'Laptop', true, 0)
    enqueueTerminalPrompt(db, 'alice', first.sessionId, 'queued-id', 'Do not replay me')
    const competing = pair()
    expect(competing).toThrow('already_linked')
    expect(db.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 1 })
    updateSession(db, first.sessionId, { agent: 'pi', meta: {} }, 'alice')
    expect(getSession(db, first.sessionId, 'alice')?.terminalConnectionId).toBe(first.id)
    expect(getSession(db, first.sessionId, 'bob')).toBeUndefined()
    revokeTerminalConnection(db, 'alice', first.id)
    const renewed = competing()
    expect(renewed.id).toBe(first.id); expect(renewed.sessionId).toBe(first.sessionId)
    expect(renewed.token).not.toBe(first.token)
    expect(() => authenticateTerminalConnection(db, first.token, first.id)).toThrow()
    expect(db.prepare('SELECT remote_enabled,activated_at,instance_id FROM terminal_connections WHERE id=?').get(first.id)).toEqual({ remote_enabled: 0, activated_at: null, instance_id: null })
    expect(db.prepare('SELECT status FROM terminal_commands WHERE connection_id=?').get(first.id)).toEqual({ status: 'cancelled' })
    const afterExpiry = pair('same-pi-session', 'alice', renewed.expiresAt + 1)()
    expect(afterExpiry.sessionId).toBe(first.sessionId)
    expect(db.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 1 })
    const different = pair('different-pi-session')()
    expect(different.sessionId).not.toBe(first.sessionId)
    expect(() => db.prepare('UPDATE terminal_connections SET pi_session_id=? WHERE id=?').run('same-pi-session', different.id)).toThrow('UNIQUE')
    // A foreign account cannot reserve or discover this owner's session UUID.
    expect(pair('same-pi-session', 'bob')().sessionId).not.toBe(first.sessionId)
  } finally { db.close() }
})
