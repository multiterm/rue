import { describe, it, expect } from 'vitest'
import { formatSummary } from '../../../src/main/agents/format.js'

describe('formatSummary', () => {
  it('opens with a [Web search: query] banner', () => {
    const out = formatSummary('typescript', [])
    expect(out.startsWith('[Web search: typescript]')).toBe(true)
  })

  it('formats each hit as a numbered markdown section', () => {
    const out = formatSummary('foo', [
      { title: 'Result A', url: 'https://a.test', snippet: 'snippet A body' },
      { title: 'Result B', url: 'https://b.test', snippet: 'snippet B body' }
    ])
    expect(out).toMatch(/## \[1\] Result A/)
    expect(out).toMatch(/## \[2\] Result B/)
    expect(out).toMatch(/https:\/\/a\.test/)
    expect(out).toMatch(/snippet A body/)
  })

  it('returns just the banner when no hits', () => {
    const out = formatSummary('empty', [])
    expect(out.trim()).toBe('[Web search: empty]')
  })
})
