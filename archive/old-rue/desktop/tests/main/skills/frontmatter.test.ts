import { describe, it, expect } from 'vitest'
import { parseFrontmatter } from '../../../src/main/skills/frontmatter.js'

describe('parseFrontmatter', () => {
  it('parses scalar fields and the body', () => {
    const result = parseFrontmatter('---\nname: greet\ndescription: Say hi\n---\nHello $ARGUMENTS')
    expect(result.fields.name).toBe('greet')
    expect(result.fields.description).toBe('Say hi')
    expect(result.body).toBe('Hello $ARGUMENTS')
  })

  it('parses inline arrays and strips quotes', () => {
    const result = parseFrontmatter('---\nallowed-tools: [Bash, "Read"]\ntitle: "Quoted"\n---\nbody')
    expect(result.fields['allowed-tools']).toEqual(['Bash', 'Read'])
    expect(result.fields.title).toBe('Quoted')
  })

  it('treats the whole input as body when there is no frontmatter', () => {
    const result = parseFrontmatter('just text')
    expect(result.fields).toEqual({})
    expect(result.body).toBe('just text')
  })

  it('handles CRLF line endings', () => {
    const result = parseFrontmatter('---\r\nname: x\r\n---\r\nbody')
    expect(result.fields.name).toBe('x')
    expect(result.body).toBe('body')
  })
})
