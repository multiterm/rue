import { describe, expect, it, vi } from 'vitest'
import { createRueClient, RueApiError } from '../src/index.js'

const event = (id: number) => `id: ${id}\r\nevent: part.delta\r\ndata: ${JSON.stringify({ id, type: 'part.delta', time: 1, payload: { text: 'hello' } })}\r\n\r\n`
const response = (text: string) => new Response(text, { headers: { 'content-type': 'text/event-stream' } })

describe('reliable event stream', () => {
  it('reconciles transcripts with uncached reads, never a prompt mutation', async () => {
    const fetch = vi.fn(async () => Response.json([]))
    const client = createRueClient({baseUrl:'https://rue.test',fetch})
    await client.messages('session'); await client.parts('session')
    expect(fetch).toHaveBeenCalledTimes(2)
    for (const call of fetch.mock.calls as unknown as [string,RequestInit][]) {
      expect(call[1].cache).toBe('no-store')
      expect(call[1].method ?? 'GET').toBe('GET')
      expect(call[1].body).toBeUndefined()
    }
  })
  it('reconciles after a silent open stream stalls instead of remaining falsely connected', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn(), fetch = vi.fn(async () => new Response(new ReadableStream({ cancel })))
    const stream = createRueClient({ baseUrl: 'https://rue.test', fetch, eventRetryMs: 1 }).events()
    try {
      expect((await stream.next()).value?.type).toBe('sync.connected')
      const pending = stream.next()
      await vi.advanceTimersByTimeAsync(75_000)
      expect((await pending).value?.type).toBe('sync.disconnected')
      expect(cancel).toHaveBeenCalledTimes(1)
      const reconnect = stream.next()
      await vi.advanceTimersByTimeAsync(1)
      expect((await reconnect).value?.type).toBe('sync.connected')
      expect(fetch).toHaveBeenCalledTimes(2)
    } finally { await stream.return(undefined); expect(vi.getTimerCount()).toBe(0); vi.useRealTimers() }
  })

  it('server heartbeat frames keep an otherwise idle healthy stream open', async () => {
    vi.useFakeTimers()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const fetch = vi.fn(async () => new Response(new ReadableStream({ start(value) { controller = value } })))
    const stream = createRueClient({ baseUrl: 'https://rue.test', fetch }).events()
    try {
      await stream.next()
      const pending = stream.next()
      for (let i = 0; i < 6; i++) {
        await vi.advanceTimersByTimeAsync(25_000)
        controller.enqueue(new TextEncoder().encode('event: ping\ndata: 123\n\n'))
      }
      controller.enqueue(new TextEncoder().encode(event(42)))
      expect((await pending).value?.id).toBe(42)
      expect(fetch).toHaveBeenCalledTimes(1)
    } finally { await stream.return(undefined); expect(vi.getTimerCount()).toBe(0); vi.useRealTimers() }
  })

  it('reconnects with a cursor, refreshes credentials, and asks clients to reconcile', async () => {
    let credential = 'first'
    const fetch = vi.fn(async () => response(event(1)))
    const client = createRueClient({ baseUrl: 'https://rue.test', token: () => credential, fetch, eventRetryMs: 1 })
    const stream = client.events()
    expect((await stream.next()).value?.type).toBe('sync.connected')
    expect((await stream.next()).value?.id).toBe(1)
    credential = 'second'
    expect((await stream.next()).value?.type).toBe('sync.disconnected')
    expect((await stream.next()).value?.type).toBe('sync.connected')
    const init = (fetch.mock.calls as unknown as Array<[string, RequestInit]>)[1]![1]
    expect(new Headers(init.headers).get('last-event-id')).toBe('1')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer second')
    await stream.return(undefined)
  })

  it('does not retry rejected credentials', async () => {
    const fetch = vi.fn(async () => new Response('unauthorized', { status: 401 }))
    const stream = createRueClient({ baseUrl: 'https://rue.test', fetch, eventRetryMs: 1 }).events()
    expect((await stream.next()).value?.type).toBe('sync.disconnected')
    await expect(stream.next()).rejects.toBeInstanceOf(RueApiError)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('retries service failures and stops promptly during backoff', async () => {
    const abort = new AbortController()
    const fetch = vi.fn(async () => {
      if (fetch.mock.calls.length === 2) abort.abort()
      return new Response('unavailable', { status: 503 })
    })
    const stream = createRueClient({ baseUrl: 'https://rue.test', fetch, eventRetryMs: 1 }).events(abort.signal)
    expect((await stream.next()).value?.type).toBe('sync.disconnected')
    expect((await stream.next()).done).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('cancels an open response when the consumer stops', async () => {
    const cancel = vi.fn()
    const fetch = vi.fn(async () => new Response(new ReadableStream({ cancel })))
    const stream = createRueClient({ baseUrl: 'https://rue.test', fetch }).events()
    await stream.next()
    await stream.return(undefined)
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('aborts a pending read without leaking the response', async () => {
    const abort = new AbortController()
    const cancel = vi.fn()
    const fetch = vi.fn(async () => new Response(new ReadableStream({ cancel })))
    const stream = createRueClient({ baseUrl: 'https://rue.test', fetch }).events(abort.signal)
    await stream.next()
    const next = stream.next()
    abort.abort()
    expect((await next).done).toBe(true)
    expect(cancel).toHaveBeenCalled()
  })

  it.each(['\n\n', ''])('rejects oversized frames, including complete frames (%j)', async (ending) => {
    const fetch = vi.fn(async () => response('data: ' + 'x'.repeat(1_048_577) + ending))
    const stream = createRueClient({ baseUrl: 'https://rue.test', fetch }).events()
    await stream.next()
    expect((await stream.next()).value?.type).toBe('sync.disconnected')
    await expect(stream.next()).rejects.toThrow('size limit')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('decodes chunked multiline SSE and ignores malformed frames', async () => {
    const payload = ': comment\r\n\r\ndata: broken\r\n\r\nid: 8\r\ndata: {"id":8,"type":"part.delta",\r\ndata: "time":1,"payload":{}}\r\n\r\n'
    const bytes = new TextEncoder().encode(payload)
    const fetch = vi.fn(async () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(bytes.slice(0, 17)); controller.enqueue(bytes.slice(17)); controller.close()
    } })))
    const stream = createRueClient({ baseUrl: 'https://rue.test', fetch }).events()
    await stream.next()
    expect((await stream.next()).value).toMatchObject({ id: 8, type: 'part.delta' })
    await stream.return(undefined)
  })
})
