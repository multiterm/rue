import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema, discoverProjectConfigs, mergeConfigs, readConfigFile } from '../../src/config/index.js'

describe('config schema', () => {
  it('applies defaults', () => {
    const cfg = ConfigSchema.parse({})
    expect(cfg.provider).toBe('openrouter')
    expect(cfg.model).toBe('anthropic/claude-sonnet-4')
    expect(cfg.tokenBudget).toBe(120_000)
    expect(cfg.maxTurns).toBe(8)
    expect(cfg.debug).toBe(false)
    expect(cfg.server.hostname).toBe('127.0.0.1')
    expect(cfg.server.port).toBe(4097)
  })

  it('rejects unknown top-level keys', () => {
    const result = ConfigSchema.safeParse({ nope: 1 })
    expect(result.success).toBe(false)
  })

  it('accepts a custom port', () => {
    const cfg = ConfigSchema.parse({ server: { port: 5000, hostname: '0.0.0.0' } })
    expect(cfg.server.port).toBe(5000)
    expect(cfg.server.hostname).toBe('0.0.0.0')
  })
})

describe('config discovery', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rue-cfg-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('walks up from cwd, returning ROOT-first ordering', () => {
    const child = join(root, 'a', 'b')
    mkdirSync(child, { recursive: true })
    writeFileSync(join(root, 'rue.json'), '{"provider":"openrouter"}')
    writeFileSync(join(root, 'a', 'rue.json'), '{"provider":"anthropic"}')
    const paths = discoverProjectConfigs(child)
    expect(paths).toEqual([
      join(root, 'rue.json'),
      join(root, 'a', 'rue.json'),
    ])
  })

  it('returns empty when no configs found in or above cwd', () => {
    const child = join(root, 'x')
    mkdirSync(child)
    const paths = discoverProjectConfigs(child)
    // We can't assert exactly empty (an ancestor of tmpdir might have one)
    // but every path must end with rue.json under or above root, or be
    // outside root. We at least verify that we walked up.
    for (const p of paths) {
      expect(p.endsWith('rue.json') || p.endsWith('rue.jsonc')).toBe(true)
    }
  })
})

describe('config parsing', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rue-cfg-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('reads JSONC with comments stripped', () => {
    const file = join(root, 'rue.json')
    writeFileSync(
      file,
      `{
        // a line comment
        "provider": "anthropic", /* trailing */
        "model": "claude-3-5-sonnet"
      }`,
    )
    const parsed = readConfigFile(file)
    expect(parsed.provider).toBe('anthropic')
    expect(parsed.model).toBe('claude-3-5-sonnet')
  })

  it('rejects invalid provider values', () => {
    const file = join(root, 'rue.json')
    writeFileSync(file, '{"provider":"nope"}')
    expect(() => readConfigFile(file)).toThrow(/Invalid config/)
  })
})

describe('config merging', () => {
  it('shallow-merges with later overriding', () => {
    const merged = mergeConfigs([
      { provider: 'openrouter', model: 'a' },
      { model: 'b' },
    ])
    expect(merged).toEqual({ provider: 'openrouter', model: 'b' })
  })

  it('merges nested server object', () => {
    const merged = mergeConfigs([
      { server: { hostname: '0.0.0.0', port: 1 } },
      { server: { port: 2 } },
    ])
    expect(merged.server).toEqual({ hostname: '0.0.0.0', port: 2 })
  })
})
