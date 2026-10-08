import { expect, test, vi } from 'vitest'
import { createJiti } from 'jiti'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Match Pi's loader, not Vitest's mocked bridge or module cache. Native .mjs
// dependencies stayed cached under these settings; TypeScript must reload too.
test('Pi-style reload replaces the bridge implementation and fails early on incompatible modules', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rue-extension-reload-'))
  try {
    const entry = join(dir, 'index.ts'), bridge = join(dir, 'bridge.ts')
    const source = new URL('../extensions/rue/', import.meta.url)
    // Copy the complete source dependency graph, including newly added helpers.
    for (const name of readdirSync(source).filter(name => name.endsWith('.ts'))) {
      writeFileSync(join(dir, name), readFileSync(new URL(name, source), 'utf8'))
    }
    writeFileSync(bridge, 'export class Bridge { static apiVersion = 2 }')
    const loader = () => createJiti(import.meta.url, { moduleCache: false, tryNative: false })
    const pi = { on: vi.fn(), registerCommand: vi.fn() }
    const stale = await loader().import<(api: unknown) => void>(entry, { default: true })
    expect(() => stale(pi)).toThrow('Rue bridge version mismatch')
    expect(pi.on).not.toHaveBeenCalled()
    writeFileSync(bridge, readFileSync(new URL('../extensions/rue/bridge.ts', import.meta.url), 'utf8'))
    writeFileSync(join(dir, 'socket.ts'), readFileSync(new URL('../extensions/rue/socket.ts', import.meta.url), 'utf8'))
    const fresh = await loader().import<(api: unknown) => void>(entry, { default: true })
    expect(() => fresh(pi)).not.toThrow()
    expect(pi.on.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining(['message_start', 'tool_execution_start', 'tool_execution_update', 'tool_execution_end']))
    const module = await loader().import<typeof import('../extensions/rue/bridge.ts')>(bridge)
    const state = { id: 'fixture', token: 'fixture', origin: 'https://rue.test', piSessionId: 'test', shareToolOutput: true, outbox: [] }
    const runtime = new module.Bridge(state, { save: vi.fn() }, { idle: () => false, confirm: async () => false, send: vi.fn(), cancel: vi.fn(), notify: vi.fn() })
    runtime.beginMessage({ role: 'assistant' })
    runtime.message({ role: 'assistant', content: 'Checking files' }, true)
    runtime.message({ role: 'assistant', content: 'Checking files now.' })
    runtime.tool({ toolCallId: 'read-1', toolName: 'read', args: { path: 'README.md' } }, 'start')
    runtime.message({ role: 'toolResult', toolCallId: 'read-1', toolName: 'read', content: [{ type: 'text', text: 'File contents' }] })
    expect(state.outbox).toHaveLength(2)
    expect(state.outbox[1]).toMatchObject({ kind: 'mirror', snapshot: { final: true }, text: expect.stringContaining('README.md') })
    expect(state.outbox[1]).toMatchObject({ text: expect.stringContaining('File contents') })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
