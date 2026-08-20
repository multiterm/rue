import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineTool } from '../../../../src/renderer/src/lib/tools/define.js'
import { ToolRegistry } from '../../../../src/renderer/src/lib/tools/registry.js'
import { loadMcpTools, mcpToolName, splitMcpToolName } from '../../../../src/renderer/src/lib/tools/mcpTools.js'
import type { ToolContext } from '../../../../src/renderer/src/lib/tools/types.js'
import type { RueSettings } from '../../../../src/preload/index.js'

const ctx: ToolContext = {
  scopes: [],
  settings: {} as unknown as RueSettings,
  signal: new AbortController().signal,
  confirm: async () => true
}

const echo = defineTool({
  name: 'echo',
  description: 'Echo text back',
  schema: z.object({ text: z.string() }),
  call: async input => ({ content: input.text })
})

describe('defineTool', () => {
  it('derives a JSON Schema from the Zod schema', () => {
    expect(echo.name).toBe('echo')
    expect(echo.parameters).toMatchObject({
      type: 'object',
      properties: { text: { type: 'string' } }
    })
  })

  it('parseInput rejects invalid arguments', () => {
    expect(() => echo.parseInput({})).toThrow()
    expect(echo.parseInput({ text: 'hi' })).toEqual({ text: 'hi' })
  })
})

describe('ToolRegistry', () => {
  function deferredTool(name: string) {
    return defineTool({
      name,
      description: `deferred ${name}`,
      schema: z.object({}),
      defer: true,
      call: async () => ({ content: name })
    })
  }

  it('excludes deferred tools from apiTools until revealed', () => {
    const reg = new ToolRegistry()
    reg.registerAll([echo, deferredTool('hidden')])
    expect(reg.apiTools().map(t => t.function.name)).toEqual(['echo'])
    reg.reveal(['hidden'])
    expect(reg.apiTools().map(t => t.function.name).sort()).toEqual(['echo', 'hidden'])
  })

  it('search resolves select: and keyword queries against deferred tools', () => {
    const reg = new ToolRegistry()
    reg.registerAll([deferredTool('alpha'), deferredTool('beta')])
    expect(reg.search('select:beta', 5).map(t => t.function.name)).toEqual(['beta'])
    expect(reg.search('alpha', 5).map(t => t.function.name)).toEqual(['alpha'])
    expect(reg.search('nothing-here', 5)).toEqual([])
  })

  it('dispatch runs a tool and surfaces unknown / invalid calls as errors', async () => {
    const reg = new ToolRegistry()
    reg.register(echo)
    expect(await reg.dispatch('echo', { text: 'hi' }, ctx)).toEqual({ content: 'hi' })
    expect((await reg.dispatch('missing', {}, ctx)).isError).toBe(true)
    expect((await reg.dispatch('echo', {}, ctx)).isError).toBe(true)
  })

  it('dispatch honors deny and ask permission decisions', async () => {
    const reg = new ToolRegistry()
    reg.register(
      defineTool({
        name: 'guarded',
        description: 'needs confirmation',
        schema: z.object({}),
        checkPermissions: () => ({ behavior: 'ask', reason: 'are you sure?' }),
        call: async () => ({ content: 'ran' })
      })
    )
    const declined = await reg.dispatch('guarded', {}, { ...ctx, confirm: async () => false })
    expect(declined.isError).toBe(true)
    const approved = await reg.dispatch('guarded', {}, { ...ctx, confirm: async () => true })
    expect(approved.content).toBe('ran')
  })
})

describe('mcp tool naming', () => {
  it('joins and splits server-qualified names', () => {
    expect(mcpToolName('gmail', 'send')).toBe('gmail__send')
    expect(splitMcpToolName('gmail__send')).toEqual({ serverName: 'gmail', name: 'send' })
    expect(splitMcpToolName('fs__read__file')).toEqual({ serverName: 'fs', name: 'read__file' })
    expect(splitMcpToolName('local')).toEqual({ serverName: '', name: 'local' })
  })

  it('defers a server\'s tools only once the count crosses the threshold', () => {
    const make = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        serverName: 's',
        name: `t${i}`,
        description: '',
        inputSchema: {}
      }))
    expect(loadMcpTools(make(5)).every(t => !t.defer)).toBe(true)
    expect(loadMcpTools(make(20)).every(t => t.defer)).toBe(true)
  })
})
