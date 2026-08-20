import { describe, it, expect } from 'vitest'
import { applySlash, parseSlash, SLASH_COMMANDS } from '../../../src/renderer/src/lib/slash.js'

describe('parseSlash', () => {
  it('returns no command for plain text', () => {
    expect(parseSlash('hello world')).toEqual({ command: null, body: 'hello world' })
  })

  it('recognizes a bare slash command with no body', () => {
    const { command, body } = parseSlash('/tldr')
    expect(command?.name).toBe('tldr')
    expect(body).toBe('')
  })

  it('splits command from body on the first space', () => {
    const { command, body } = parseSlash('/translate Hola mundo')
    expect(command?.name).toBe('translate')
    expect(body).toBe('Hola mundo')
  })

  it('preserves spaces after the first one', () => {
    const { body } = parseSlash('/translate   spaced   out')
    expect(body).toBe('  spaced   out')
  })

  it('is case-insensitive on the command name', () => {
    expect(parseSlash('/TLDR foo').command?.name).toBe('tldr')
  })

  it('treats unknown commands as null command', () => {
    const { command, body } = parseSlash('/nonsense hi')
    expect(command).toBeNull()
    expect(body).toBe('hi')
  })

  it('ignores leading whitespace before the slash', () => {
    expect(parseSlash('   /think foo').command?.name).toBe('think')
  })
})

describe('applySlash', () => {
  it('returns input unchanged when no command matches', () => {
    expect(applySlash('hello')).toBe('hello')
    expect(applySlash('/notreal hi')).toBe('/notreal hi')
  })

  it('transforms /tldr input', () => {
    const out = applySlash('/tldr the article body')
    expect(out).toMatch(/TL;DR/i)
    expect(out).toMatch(/the article body/)
  })

  it('transforms /bullets input', () => {
    const out = applySlash('/bullets a, b, c')
    expect(out).toMatch(/bulleted list/i)
    expect(out).toMatch(/a, b, c/)
  })
})

describe('SLASH_COMMANDS registry', () => {
  it('exposes the expected core commands', () => {
    const names = SLASH_COMMANDS.map(c => c.name)
    for (const expected of ['tldr', 'explain', 'translate', 'rewrite', 'refine', 'bullets', 'todos', 'think']) {
      expect(names).toContain(expected)
    }
  })

  it('every command has a non-empty description', () => {
    for (const cmd of SLASH_COMMANDS) {
      expect(cmd.description.length).toBeGreaterThan(0)
    }
  })

  it('every transform is idempotent on empty body', () => {
    for (const cmd of SLASH_COMMANDS) {
      const out = cmd.transform('')
      expect(typeof out).toBe('string')
      expect(out.length).toBeGreaterThan(0)
    }
  })
})
