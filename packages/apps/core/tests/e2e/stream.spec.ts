import { expect, test } from '@playwright/test'
import { createRueClient } from '../../../../libs/sdk/src/index.js'

test('real HTTP clients reconcile writes made while the SSE connection is down', async ({ baseURL }) => {
  let connections = 0
  let disconnect: () => Promise<void> = async () => {}
  const transport: typeof fetch = async (input, init) => {
    const response = await fetch(input, init)
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (new URL(url).pathname !== '/event' || ++connections !== 1) return response
    const reader = response.body!.getReader()
    disconnect = () => reader.cancel()
    return new Response(new ReadableStream({
      async pull(controller) {
        const chunk = await reader.read()
        if (chunk.done) controller.close()
        else controller.enqueue(chunk.value)
      },
      cancel: () => reader.cancel(),
    }), { status: response.status, headers: response.headers })
  }
  const writer = createRueClient({ baseUrl: baseURL! })
  const subscriber = createRueClient({ baseUrl: baseURL!, fetch: transport, eventRetryMs: 1 })
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 20_000)
  const stream = subscriber.events(abort.signal)
  let sessionId: string | undefined
  async function until(type: string) {
    for (;;) {
      const next = await stream.next()
      if (next.done) throw new Error('Stream ended before the expected event')
      if (next.value.type === type && (type === 'sync.connected' || next.value.payload.sessionId === sessionId)) return next.value
    }
  }
  try {
    await until('sync.connected')
    const session = await writer.createSession({ title: 'isolated reconnect fixture' })
    sessionId = session.id
    const created = await until('session.created')
    await disconnect()
    await writer.updateSession(session.id, { title: 'updated while disconnected' })
    await until('sync.connected')
    const changed = await until('session.updated')
    expect(changed.id).toBeGreaterThan(created.id)
    expect(connections).toBe(2)
    expect((await subscriber.session(session.id)).title).toBe('updated while disconnected')
  } finally {
    clearTimeout(timer)
    abort.abort()
    await stream.return(undefined)
    if (sessionId) await writer.deleteSession(sessionId)
  }
})
