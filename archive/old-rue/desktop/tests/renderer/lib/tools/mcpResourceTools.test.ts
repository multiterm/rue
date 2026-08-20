import { describe, it, expect, afterEach } from 'vitest'
import { createMcpResourceTools } from '../../../../src/renderer/src/lib/tools/mcpResourceTools.js'
import { createSkillTool } from '../../../../src/renderer/src/lib/skills/skillTool.js'
import type { ToolContext } from '../../../../src/renderer/src/lib/tools/types.js'
import type { RueSettings, Skill } from '../../../../src/preload/index.js'

const ctx: ToolContext = {
  scopes: [],
  settings: {} as unknown as RueSettings,
  signal: new AbortController().signal,
  confirm: async () => true
}

/** Install a stub `window.rue.mcp` for tools that proxy over IPC. */
function installMcp(mcp: Record<string, unknown>): void {
  ;(globalThis as { window?: unknown }).window = { rue: { mcp } }
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

describe('mcp resource tools', () => {
  it('exposes ListMcpResources + ReadMcpResource as deferred read-only tools', () => {
    const tools = createMcpResourceTools()
    expect(tools.map(t => t.name)).toEqual(['ListMcpResources', 'ReadMcpResource'])
    expect(tools.every(t => t.defer && t.readOnly)).toBe(true)
  })

  it('ListMcpResources formats the resource list', async () => {
    installMcp({
      listResources: async () => [
        { serverName: 'fs', uri: 'file:///a.txt', name: 'a.txt', description: 'A file' }
      ]
    })
    const [list] = createMcpResourceTools()
    const result = await list.call(list.parseInput({}), ctx)
    expect(result.content).toContain('[fs] file:///a.txt')
    expect(result.content).toContain('A file')
  })

  it('ReadMcpResource returns content and surfaces errors', async () => {
    installMcp({ readResource: async () => 'hello' })
    const [, read] = createMcpResourceTools()
    const ok = await read.call(read.parseInput({ server: 'fs', uri: 'file:///a' }), ctx)
    expect(ok.content).toBe('hello')

    installMcp({
      readResource: async () => {
        throw new Error('nope')
      }
    })
    const [, read2] = createMcpResourceTools()
    const bad = await read2.call(read2.parseInput({ server: 'fs', uri: 'x' }), ctx)
    expect(bad.isError).toBe(true)
  })
})

describe('createSkillTool — MCP prompt skills', () => {
  it('fetches the rendered prompt from the originating server', async () => {
    installMcp({ getPrompt: async () => 'rendered prompt' })
    const skill: Skill = {
      name: 'fs:greet',
      description: 'Greet',
      body: '',
      source: 'mcp',
      userInvocable: true,
      modelInvocable: true,
      mcp: { server: 'fs', prompt: 'greet' }
    }
    const tool = createSkillTool([skill])
    const result = await tool.call(tool.parseInput({ name: 'fs:greet', arguments: 'hi' }), ctx)
    expect(result.content).toBe('rendered prompt')
  })
})
