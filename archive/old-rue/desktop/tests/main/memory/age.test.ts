import { describe, it, expect } from 'vitest'
import { memoryAgeDays, memoryAgeLabel, memoryFreshnessText } from '../../../src/main/memory/age.js'

const DAY = 86_400_000

describe('memoryAgeDays', () => {
  it('is 0 for a just-written memory', () => {
    expect(memoryAgeDays(Date.now())).toBe(0)
  })

  it('counts whole elapsed days', () => {
    expect(memoryAgeDays(Date.now() - 3 * DAY - 1000)).toBe(3)
  })

  it('never goes negative for a future timestamp', () => {
    expect(memoryAgeDays(Date.now() + DAY)).toBe(0)
  })
})

describe('memoryAgeLabel', () => {
  it('labels recent ages in words', () => {
    expect(memoryAgeLabel(0)).toBe('today')
    expect(memoryAgeLabel(1)).toBe('yesterday')
    expect(memoryAgeLabel(9)).toBe('9 days ago')
  })
})

describe('memoryFreshnessText', () => {
  it('is empty for fresh memories', () => {
    expect(memoryFreshnessText(0)).toBe('')
    expect(memoryFreshnessText(1)).toBe('')
  })

  it('warns once a memory has aged', () => {
    expect(memoryFreshnessText(10)).toContain('10 days old')
  })
})
