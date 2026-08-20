import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  anthropicChatStreamWithTools,
  classifyAnthropicToken,
} from '../../src/provider/index.js'

describe('provider/anthropic: classifyAnthropicToken', () => {
  it.each([
    ['sk-ant-oat01-abc', 'oauth'],
    ['sk-ant-oat-old', 'oauth'],
    ['sk-ant-api03-xyz', 'api-key'],
    ['custom-key', 'api-key'],
  ] as const)('%s → %s', (token, expected) => {
    expect(classifyAnthropicToken(token)).toBe(expected)
  })
})

/**
 * Build an SSE-formatted response body from a list of event payload objects.
 * Each event becomes a `data: {...}\n` line followed by a blank line.
 */
function sseBody(events: Array<Record<string, unknown>>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const e of events) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`))
      }
      controller.close()
    },
  })
}

describe('provider/anthropic: chatStreamWithTools', () => {
  afterEach(() => vi.restoreAllMocks())

  it('accumulates text_delta events and reports stop_reason', async () => {
    const body = sseBody([
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hel' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    ])
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }))

    const deltas: string[] = []
    const result = await anthropicChatStreamWithTools(
      {
        apiKey: 'sk-ant-api03-x',
        model: 'claude-x',
        messages: [{ role: 'user', content: 'hi' }],
      },
      (d) => deltas.push(d),
    )
    expect(deltas).toEqual(['hel', 'lo'])
    expect(result.content).toBe('hello')
    expect(result.truncated).toBe(false)
    expect(result.toolCalls).toEqual([])
  })

  it('reassembles tool_use blocks from input_json_delta events', async () => {
    const body = sseBody([
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tu_1', name: 'foo' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"x":' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '1}' },
      },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
    ])
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }))
    const result = await anthropicChatStreamWithTools(
      { apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'go' }] },
      () => {},
    )
    expect(result.toolCalls).toEqual([{ id: 'tu_1', name: 'foo', arguments: '{"x":1}' }])
  })

  it('reports truncated=true on max_tokens stop_reason', async () => {
    const body = sseBody([
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'a' } },
      { type: 'message_delta', delta: { stop_reason: 'max_tokens' } },
    ])
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }))
    const result = await anthropicChatStreamWithTools(
      { apiKey: 'k', model: 'm', messages: [] },
      () => {},
    )
    expect(result.truncated).toBe(true)
  })

  it('translates 401 into a useful error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 401 }))
    await expect(
      anthropicChatStreamWithTools(
        { apiKey: 'k', model: 'm', messages: [] },
        () => {},
      ),
    ).rejects.toMatchObject({ status: 401 })
  })
})
