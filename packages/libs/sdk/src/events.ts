import type { RueClientOptions, RueEvent } from './index.js'
import { RueApiError } from './errors.js'

interface StreamOptions { retryMs?: number; maxRetryMs?: number }

function retryDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve() }
    const timer = setTimeout(finish, ms)
    signal?.addEventListener('abort', finish, { once: true })
    if (signal?.aborted) finish()
  })
}

function parseEvent(block: string): { cursor?: string; event?: RueEvent } {
  const lines = block.split(/\r?\n/)
  const cursor = lines.find((line) => line.startsWith('id:'))?.slice(3).trim()
  const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).replace(/^ /, '')).join('\n')
  try {
    const event: unknown = JSON.parse(data)
    if (event && typeof event === 'object' && 'type' in event && typeof event.type === 'string') {
      return { cursor, event: event as RueEvent }
    }
  } catch { /* Heartbeats and unknown frames do not update application state. */ }
  return { cursor }
}

async function* connection(response: Response, onCursor: (cursor: string) => void, signal?: AbortSignal): AsyncGenerator<RueEvent> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  const abort = () => { void reader.cancel().catch(() => undefined) }
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  let buffer = ''
  try {
    // A reconnect always requires an authoritative snapshot: process-local replay
    // cannot prove completeness after a server restart or a full replay buffer.
    yield { id: 0, type: 'sync.connected', time: Date.now(), payload: {} }
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      let separator: RegExpExecArray | null
      while ((separator = /\r?\n\r?\n/.exec(buffer))) {
        if (separator.index > 1_048_576) throw new Error('Rue event frame exceeds the size limit')
        const frame = parseEvent(buffer.slice(0, separator.index))
        buffer = buffer.slice(separator.index + separator[0].length)
        if (frame.cursor && /^\d+$/.test(frame.cursor) && Number.isSafeInteger(Number(frame.cursor))) onCursor(frame.cursor)
        if (frame.event) yield frame.event
      }
      if (buffer.length > 1_048_576) throw new Error('Rue event frame exceeds the size limit')
    }
  } finally {
    signal?.removeEventListener('abort', abort)
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

/** Reconnect on transport loss, re-resolve credentials, and preserve the SSE cursor. */
export async function* createRueEventStream(
  url: string,
  token: RueClientOptions['token'],
  requestFetch: typeof globalThis.fetch,
  signal?: AbortSignal,
  options: StreamOptions = {},
): AsyncGenerator<RueEvent> {
  const retryMs = Math.max(1, options.retryMs ?? 1000)
  const maxRetryMs = Math.max(retryMs, options.maxRetryMs ?? 15_000)
  let cursor = ''
  let delay = retryMs
  while (!signal?.aborted) {
    try {
      const supplied = typeof token === 'function' ? await token() : token
      const headers = new Headers({ accept: 'text/event-stream' })
      if (supplied) headers.set('authorization', `Bearer ${supplied}`)
      if (cursor) headers.set('last-event-id', cursor)
      const response = await requestFetch(url, { headers, signal })
      if (!response.ok || !response.body) throw new RueApiError(response.status, await response.text())
      for await (const event of connection(response, (value) => { cursor = value }, signal)) {
        yield event
        if (event.type !== 'sync.connected') delay = retryMs
      }
    } catch (error) {
      if (signal?.aborted) return
      const retryable = error instanceof TypeError || (error instanceof RueApiError && (error.status === 429 || error.status >= 500))
      if (!retryable) throw error
    }
    await retryDelay(delay, signal)
    delay = Math.min(maxRetryMs, delay * 2)
  }
}
