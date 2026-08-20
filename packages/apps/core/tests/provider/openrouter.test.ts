import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  openrouterProvider,
  parseOpenRouterSseLine,
  openrouterChatWithTools,
} from '../../src/provider/index.js'

describe('provider/openrouter: parseOpenRouterSseLine', () => {
  it('extracts content deltas', () => {
    expect(
      parseOpenRouterSseLine('data: {"choices":[{"delta":{"content":"hi"}}]}'),
    ).toBe('hi')
  })
  it('returns null for [DONE]', () => {
    expect(parseOpenRouterSseLine('data: [DONE]')).toBeNull()
  })
  it('returns null for non-data lines', () => {
    expect(parseOpenRouterSseLine('event: ping')).toBeNull()
    expect(parseOpenRouterSseLine('')).toBeNull()
  })
  it('returns null for malformed JSON payloads', () => {
    expect(parseOpenRouterSseLine('data: {oops')).toBeNull()
  })
})

describe('provider/openrouter: chat (non-streaming)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('throws when apiKey is missing', async () => {
    await expect(
      openrouterProvider.chat(
        { apiKey: '', model: 'm', messages: [] },
        () => {},
      ),
    ).rejects.toMatchObject({ status: 0 })
  })

  it('round-trips content + finish_reason=length truncation', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'length',
              message: { content: 'sup', tool_calls: [] },
            },
          ],
        }),
        { status: 200 },
      ),
    )
    const result = await openrouterChatWithTools({
      apiKey: 'k',
      model: 'gpt-x',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(result.content).toBe('sup')
    expect(result.truncated).toBe(true)
    expect(result.toolCalls).toEqual([])
  })

  it('translates tool_calls into our shape', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                content: '',
                tool_calls: [
                  {
                    id: 'call_1',
                    function: { name: 'foo', arguments: '{"x":1}' },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    )
    const result = await openrouterChatWithTools({
      apiKey: 'k',
      model: 'm',
      messages: [],
    })
    expect(result.toolCalls).toEqual([
      { id: 'call_1', name: 'foo', arguments: '{"x":1}' },
    ])
  })

  it('surfaces upstream errors with status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('rate limit', { status: 429 }),
    )
    await expect(
      openrouterChatWithTools({ apiKey: 'k', model: 'm', messages: [] }),
    ).rejects.toMatchObject({ status: 429 })
  })
})
