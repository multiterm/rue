import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chat, chatStream, chatWithTools, OpenRouterError, parseSseLine, type ToolDefinition } from '../../../src/renderer/src/lib/openrouter.js'

const originalFetch = globalThis.fetch

function mockFetch(impl: typeof fetch): void {
  globalThis.fetch = vi.fn(impl) as unknown as typeof fetch
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function sseResponse(chunks: ReadonlyArray<string>): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder()
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    }
  })
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

describe('chat', () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('throws OpenRouterError when no API key is provided', async () => {
    await expect(
      chat({ apiKey: '', model: 'm', messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toBeInstanceOf(OpenRouterError)
  })

  it('posts to the OpenRouter completions endpoint with Bearer auth', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    mockFetch(async (input, init) => {
      capturedUrl = input as string
      capturedInit = init
      return jsonResponse({ choices: [{ message: { content: 'hello back' } }] })
    })

    const reply = await chat({
      apiKey: 'sk-or-test',
      model: 'anthropic/claude-sonnet-4.5',
      messages: [{ role: 'user', content: 'hi' }]
    })

    expect(reply).toBe('hello back')
    expect(capturedUrl).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(capturedInit?.method).toBe('POST')
    const headers = capturedInit?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-or-test')
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('serializes model + messages into the request body', async () => {
    let body: unknown
    mockFetch(async (_url, init) => {
      body = JSON.parse(init?.body as string)
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] })
    })

    await chat({
      apiKey: 'k',
      model: 'mistralai/mistral-large',
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hi' }
      ]
    })

    expect(body).toEqual({
      model: 'mistralai/mistral-large',
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hi' }
      ]
    })
  })

  it('throws OpenRouterError with status when the API returns non-2xx', async () => {
    mockFetch(async () => new Response('rate limited', { status: 429 }))

    let caught: unknown = null
    try {
      await chat({ apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'x' }] })
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(OpenRouterError)
    const err = caught as OpenRouterError
    expect(err.status).toBe(429)
    expect(err.message).toMatch(/429/)
  })

  it('throws OpenRouterError when the response shape is missing the assistant message', async () => {
    mockFetch(async () => jsonResponse({ choices: [] }))

    await expect(
      chat({ apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'x' }] })
    ).rejects.toBeInstanceOf(OpenRouterError)
  })
})

describe('parseSseLine', () => {
  it('returns null for non-data lines', () => {
    expect(parseSseLine('event: message')).toBeNull()
    expect(parseSseLine(': comment')).toBeNull()
    expect(parseSseLine('')).toBeNull()
  })

  it('returns null for the [DONE] sentinel', () => {
    expect(parseSseLine('data: [DONE]')).toBeNull()
  })

  it('returns null when JSON is malformed', () => {
    expect(parseSseLine('data: {not-json')).toBeNull()
  })

  it('extracts delta content from a well-formed SSE chunk', () => {
    const line = 'data: {"choices":[{"delta":{"content":"Hello"}}]}'
    expect(parseSseLine(line)).toBe('Hello')
  })

  it('returns null when the delta has no content', () => {
    const line = 'data: {"choices":[{"delta":{}}]}'
    expect(parseSseLine(line)).toBeNull()
  })

  it('tolerates extra whitespace after the data: prefix', () => {
    const line = 'data:    {"choices":[{"delta":{"content":"hi"}}]}'
    expect(parseSseLine(line)).toBe('hi')
  })
})

describe('chatStream', () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('yields tokens as they arrive over SSE', async () => {
    mockFetch(async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
        'data: {"choices":[{"delta":{"content":"lo "}}]}\n',
        'data: {"choices":[{"delta":{"content":"world"}}]}\n',
        'data: [DONE]\n'
      ])
    )

    const tokens: string[] = []
    for await (const t of chatStream({
      apiKey: 'k',
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }]
    })) {
      tokens.push(t)
    }

    expect(tokens.join('')).toBe('Hello world')
  })

  it('throws when stream returns non-2xx', async () => {
    mockFetch(async () => new Response('boom', { status: 500 }))

    const gen = chatStream({ apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'x' }] })
    await expect(gen.next()).rejects.toBeInstanceOf(OpenRouterError)
  })

  it('throws when API key is missing', async () => {
    const gen = chatStream({ apiKey: '', model: 'm', messages: [{ role: 'user', content: 'x' }] })
    await expect(gen.next()).rejects.toBeInstanceOf(OpenRouterError)
  })

  it('handles tokens that span chunk boundaries', async () => {
    mockFetch(async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"part1"}}]}',
        '\ndata: {"choices":[{"delta":{"content":"part2"}}]}\n'
      ])
    )

    const tokens: string[] = []
    for await (const t of chatStream({ apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'x' }] })) {
      tokens.push(t)
    }
    expect(tokens.join('')).toBe('part1part2')
  })
})

describe('chatWithTools', () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('throws OpenRouterError when API key is missing', async () => {
    await expect(
      chatWithTools({ apiKey: '', model: 'm', messages: [{ role: 'user', content: 'x' }] })
    ).rejects.toBeInstanceOf(OpenRouterError)
  })

  it('returns plain content when the model emits no tool calls', async () => {
    mockFetch(async () => jsonResponse({ choices: [{ message: { content: 'final answer' } }] }))

    const result = await chatWithTools({ apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'x' }] })
    expect(result.content).toBe('final answer')
    expect(result.toolCalls).toEqual([])
  })

  it('extracts tool_calls when present', async () => {
    mockFetch(async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                { id: 'call_1', function: { name: 'fs__read', arguments: '{"path":"/etc/hosts"}' } }
              ]
            }
          }
        ]
      })
    )

    const result = await chatWithTools({ apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'x' }] })
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0]).toEqual({
      id: 'call_1',
      name: 'fs__read',
      arguments: '{"path":"/etc/hosts"}'
    })
  })

  it('includes tools in the request body when provided', async () => {
    let body: { tools?: unknown } = {}
    mockFetch(async (_url, init) => {
      body = JSON.parse(init?.body as string)
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] })
    })

    const tools: ToolDefinition[] = [
      { type: 'function', function: { name: 'a__b', description: 'd', parameters: { type: 'object', properties: {} } } }
    ]
    await chatWithTools({ apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'x' }], tools })
    expect(body.tools).toEqual(tools)
  })

  it('omits tools from the request when the array is empty', async () => {
    let body: { tools?: unknown } = {}
    mockFetch(async (_url, init) => {
      body = JSON.parse(init?.body as string)
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] })
    })

    await chatWithTools({ apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'x' }], tools: [] })
    expect(body.tools).toBeUndefined()
  })

  it('throws OpenRouterError on non-2xx responses', async () => {
    mockFetch(async () => new Response('forbidden', { status: 403 }))
    await expect(
      chatWithTools({ apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'x' }] })
    ).rejects.toBeInstanceOf(OpenRouterError)
  })
})
