import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp } from '../../src/server/index.js'
import { Bus } from '../../src/bus/index.js'
import { ConfigSchema } from '../../src/config/index.js'
import { openDatabase } from '../../src/storage/index.js'
import type { ServerContext } from '../../src/server/index.js'

let ctx: ServerContext
beforeEach(() => { ctx = { db: openDatabase(':memory:'), config: ConfigSchema.parse({}), bus: new Bus() } })
afterEach(() => { vi.restoreAllMocks(); ctx.db.close() })

it('delivers events published during replay without leaking another owner', async () => {
  ctx.bus.publish('device.paired', { ownerSubject: 'local', marker: 'already-seen' })
  ctx.bus.publish('device.paired', { ownerSubject: 'local', marker: 'replayed' })
  ctx.bus.publish('device.paired', { ownerSubject: 'another-owner', marker: 'private' })
  const history = ctx.bus.historySince.bind(ctx.bus)
  vi.spyOn(ctx.bus, 'historySince').mockImplementation((cursor) => {
    const snapshot = history(cursor)
    queueMicrotask(() => ctx.bus.publish('device.paired', { ownerSubject: 'local', marker: 'during-replay' }))
    return snapshot
  })
  const response = await createApp({ ctx }).request('/event', { headers: { 'last-event-id': '1' } })
  const reader = response.body!.getReader()
  let text = ''
  try {
    while (!text.includes('during-replay')) {
      const result = await reader.read()
      if (result.done) break
      text += new TextDecoder().decode(result.value)
    }
    expect(text).toContain('replayed')
    expect(text).toContain('during-replay')
    expect(text).not.toContain('private')
    expect(text).not.toContain('already-seen')
    expect(text.indexOf('replayed')).toBeLessThan(text.indexOf('during-replay'))
  } finally { await reader.cancel() }
  expect(ctx.bus.listenerCount()).toBe(0)
})

it('permits authenticated browser SSE cursor preflights', async () => {
  const response = await createApp({ ctx }).request('/event', {
    method: 'OPTIONS', headers: { origin: 'https://rue.test', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization,last-event-id' },
  })
  expect(response.status).toBe(204)
  expect(response.headers.get('access-control-allow-headers')).toContain('last-event-id')
})
