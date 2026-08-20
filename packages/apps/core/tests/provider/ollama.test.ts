import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatOllamaStream } from '../../src/provider/index.js'

function jsonlBody(lines: Array<Record<string, unknown>>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const l of lines) controller.enqueue(enc.encode(JSON.stringify(l) + '\n'))
      controller.close()
    },
  })
}

describe('provider/ollama: chatOllamaStream', () => {
  afterEach(() => vi.restoreAllMocks())

  it('accumulates content from JSONL frames', async () => {
    const body = jsonlBody([
      { message: { content: 'hel' }, done: false },
      { message: { content: 'lo' }, done: false },
      { message: { content: '' }, done: true, done_reason: 'stop' },
    ])
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }))
    const deltas: string[] = []
    const result = await chatOllamaStream(
      {
        apiKey: 'http://localhost:11434',
        model: 'llama',
        messages: [{ role: 'user', content: 'hi' }],
      },
      (d) => deltas.push(d),
    )
    expect(deltas).toEqual(['hel', 'lo'])
    expect(result.content).toBe('hello')
    expect(result.truncated).toBe(false)
  })

  it('reports truncated=true on done_reason=length', async () => {
    const body = jsonlBody([
      { message: { content: 'partial' } },
      { done: true, done_reason: 'length' },
    ])
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }))
    const result = await chatOllamaStream(
      {
        apiKey: 'http://localhost:11434',
        model: 'l',
        messages: [],
      },
      () => {},
    )
    expect(result.truncated).toBe(true)
    expect(result.content).toBe('partial')
  })

  it('surfaces 500 errors with the provider id', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }))
    await expect(
      chatOllamaStream(
        { apiKey: 'http://x', model: 'm', messages: [] },
        () => {},
      ),
    ).rejects.toMatchObject({ status: 500, providerId: 'ollama' })
  })
})
