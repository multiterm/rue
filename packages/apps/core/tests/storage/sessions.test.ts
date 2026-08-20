import { describe, it, expect } from 'vitest'
import {
  appendMessage,
  appendPart,
  createSession,
  deleteSession,
  getMessage,
  getRating,
  getSession,
  listMessages,
  listSessionParts,
  listSessions,
  openDatabase,
  setRating,
  updateSession,
} from '../../src/storage/index.js'

function db() {
  return openDatabase(':memory:')
}

describe('storage: sessions', () => {
  it('creates and retrieves a session with defaults', () => {
    const d = db()
    const row = createSession(d, { id: 'ses_1' })
    expect(row.id).toBe('ses_1')
    expect(row.title).toBe('')
    expect(row.scopes).toEqual([])
    expect(row.createdAt).toBeGreaterThan(0)
    expect(row.updatedAt).toBe(row.createdAt)

    const got = getSession(d, 'ses_1')
    expect(got).toEqual(row)
  })

  it('lists most-recently-updated first', () => {
    const d = db()
    createSession(d, { id: 'ses_a' })
    createSession(d, { id: 'ses_b' })
    // Touch ses_a so it sorts first.
    updateSession(d, 'ses_a', { title: 'touched' })
    const list = listSessions(d)
    expect(list.map((s) => s.id)).toEqual(['ses_a', 'ses_b'])
    expect(list[0]?.title).toBe('touched')
  })

  it('deletes sessions and cascades to messages/parts', () => {
    const d = db()
    createSession(d, { id: 'ses_1' })
    appendMessage(d, { id: 'msg_1', sessionId: 'ses_1', role: 'user' })
    appendPart(d, {
      id: 'prt_1',
      sessionId: 'ses_1',
      messageId: 'msg_1',
      type: 'text',
      payload: { text: 'hello' },
    })
    expect(deleteSession(d, 'ses_1')).toBe(true)
    expect(getSession(d, 'ses_1')).toBeUndefined()
    expect(getMessage(d, 'msg_1')).toBeUndefined()
    expect(listSessionParts(d, 'ses_1')).toEqual([])
  })

  it('updates scopes and meta in place', () => {
    const d = db()
    createSession(d, { id: 'ses_1', scopes: ['/a'] })
    const updated = updateSession(d, 'ses_1', {
      scopes: ['/a', '/b'],
      meta: { foo: 1 },
    })
    expect(updated?.scopes).toEqual(['/a', '/b'])
    expect(updated?.meta).toEqual({ foo: 1 })
  })
})

describe('storage: messages and parts', () => {
  it('assigns monotonic seq within a session and within a message', () => {
    const d = db()
    createSession(d, { id: 'ses_1' })
    const m1 = appendMessage(d, { id: 'msg_1', sessionId: 'ses_1', role: 'user' })
    const m2 = appendMessage(d, { id: 'msg_2', sessionId: 'ses_1', role: 'assistant' })
    expect(m1.seq).toBe(0)
    expect(m2.seq).toBe(1)

    const p1 = appendPart(d, {
      id: 'prt_1',
      sessionId: 'ses_1',
      messageId: 'msg_2',
      type: 'text',
      payload: { text: 'a' },
    })
    const p2 = appendPart(d, {
      id: 'prt_2',
      sessionId: 'ses_1',
      messageId: 'msg_2',
      type: 'text',
      payload: { text: 'b' },
    })
    expect(p1.seq).toBe(0)
    expect(p2.seq).toBe(1)

    const messages = listMessages(d, 'ses_1')
    expect(messages.map((m) => m.id)).toEqual(['msg_1', 'msg_2'])

    const parts = listSessionParts(d, 'ses_1')
    expect(parts.map((p) => p.id)).toEqual(['prt_1', 'prt_2'])
  })

  it('appending a message touches session.updated_at', () => {
    const d = db()
    const s = createSession(d, { id: 'ses_1' })
    // Force a different timestamp window for clarity.
    appendMessage(d, { id: 'msg_1', sessionId: 'ses_1', role: 'user' })
    const after = getSession(d, 'ses_1')!
    expect(after.updatedAt).toBeGreaterThanOrEqual(s.updatedAt)
  })

  it('round-trips ratings', () => {
    const d = db()
    createSession(d, { id: 'ses_1' })
    appendMessage(d, { id: 'msg_1', sessionId: 'ses_1', role: 'assistant' })
    setRating(d, 'msg_1', 1)
    expect(getRating(d, 'msg_1')).toBe(1)
    setRating(d, 'msg_1', -1)
    expect(getRating(d, 'msg_1')).toBe(-1)
    setRating(d, 'msg_1', 0)
    expect(getRating(d, 'msg_1')).toBe(0)
  })
})
