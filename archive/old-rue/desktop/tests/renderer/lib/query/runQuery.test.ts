import { describe, it, expect, beforeEach, vi } from 'vitest'
import { z } from 'zod'
import { runQuery } from '../../../../src/renderer/src/lib/query/runQuery.js'
import { ToolRegistry } from '../../../../src/renderer/src/lib/tools/registry.js'
import { defineTool } from '../../../../src/renderer/src/lib/tools/define.js'
import type { ChatToolResponse } from '../../../../src/renderer/src/lib/openrouter.js'
import type { RueSettings } from '../../../../src/preload/index.js'

// Mock the OpenRouter client so the loop never touches the network.
const { mockChat } = vi.hoisted(() => ({ mockChat: vi.fn<() => Promise<ChatToolResponse>>() }))
vi.mock('../../../../src/renderer/src/lib/openrouter.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../src/renderer/src/lib/openrouter.js')>()
  return { ...actual, chatWithTools: mockChat }
})

const settings = { provider: 'openrouter', apiKey: 'k', model: 'm' } as unknown as RueSettings

function registryWithEcho(): ToolRegistry {
  const registry = new ToolRegistry()
  registry.register(
    defineTool({
      name: 'echo',
      description: 'Echo text back',
      schema: z.object({ text: z.string() }),
      call: async input => ({ content: input.text })
    })
  )
  return registry
}

function baseConfig() {
  return {
    messages: [{ role: 'user' as const, content: 'hi' }],
    registry: registryWithEcho(),
    settings,
    scopes: [],
    signal: new AbortController().signal
  }
}

beforeEach(() => mockChat.mockReset())

describe('runQuery', () => {
  it('completes when the model returns plain text', async () => {
    mockChat.mockResolvedValueOnce({ content: 'hello there', toolCalls: [] })
    const result = await runQuery(baseConfig())
    expect(result.stopReason).toBe('completed')
    expect(result.text).toBe('hello there')
    expect(result.turns).toBe(1)
  })

  it('dispatches a tool call, feeds the result back, then completes', async () => {
    mockChat
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: '1', name: 'echo', arguments: '{"text":"pong"}' }]
      })
      .mockResolvedValueOnce({ content: 'done', toolCalls: [] })

    const events: string[] = []
    const result = await runQuery(baseConfig(), {
      onToolEvent: event => events.push(event.status)
    })

    expect(result.text).toBe('done')
    expect(result.stopReason).toBe('completed')
    expect(events).toContain('running')
    expect(events).toContain('done')
  })

  it('stops at maxTurns when the model never finishes', async () => {
    mockChat.mockResolvedValue({
      content: '',
      toolCalls: [{ id: 'x', name: 'echo', arguments: '{"text":"again"}' }]
    })
    const result = await runQuery({ ...baseConfig(), maxTurns: 3 })
    expect(result.stopReason).toBe('max_turns')
    expect(result.turns).toBe(3)
  })

  it('returns the aborted stop reason when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await runQuery({ ...baseConfig(), signal: controller.signal })
    expect(result.stopReason).toBe('aborted')
  })
})
