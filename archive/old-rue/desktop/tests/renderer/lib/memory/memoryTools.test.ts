import { describe, it, expect, afterEach } from 'vitest'
import { createMemoryTools } from '../../../../src/renderer/src/lib/memory/memoryTools.js'
import type { ToolContext } from '../../../../src/renderer/src/lib/tools/types.js'
import type { RueSettings } from '../../../../src/preload/index.js'

const ctx: ToolContext = {
  scopes: [],
  settings: {} as unknown as RueSettings,
  signal: new AbortController().signal,
  confirm: async () => true
}

function installMemory(memory: Record<string, unknown>): void {
  ;(globalThis as { window?: unknown }).window = { rue: { memory } }
}
afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

const [memoryWrite, memoryRead] = createMemoryTools()

describe('MemoryWrite', () => {
  it('persists a memory and confirms by name', async () => {
    installMemory({
      write: async (input: { name: string; type: string }) => ({
        name: input.name,
        description: 'd',
        type: input.type,
        content: 'c',
        mtimeMs: Date.now(),
        ageDays: 0,
        freshness: ''
      })
    })
    const result = await memoryWrite.call(
      memoryWrite.parseInput({ name: 'deploy-process', description: 'how we deploy', type: 'project', content: 'c' }),
      ctx
    )
    expect(result.content).toContain('Saved memory "deploy-process"')
  })
})

describe('MemoryRead', () => {
  it('prepends the freshness caveat for an aged memory', async () => {
    installMemory({
      read: async () => ({
        name: 'x',
        description: 'd',
        type: 'project',
        content: 'the memory body',
        mtimeMs: 0,
        ageDays: 30,
        freshness: '[stale: 30 days old]'
      })
    })
    const result = await memoryRead.call(memoryRead.parseInput({ name: 'x' }), ctx)
    expect(result.content).toContain('[stale: 30 days old]')
    expect(result.content).toContain('the memory body')
  })

  it('errors when the memory does not exist', async () => {
    installMemory({ read: async () => null })
    const result = await memoryRead.call(memoryRead.parseInput({ name: 'missing' }), ctx)
    expect(result.isError).toBe(true)
  })
})
