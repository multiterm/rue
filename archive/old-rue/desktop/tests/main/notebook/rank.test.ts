import { describe, it, expect } from 'vitest'
import { chunkFile, rank, tokenize } from '../../../src/main/notebook/rank.js'

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumerics', () => {
    expect(tokenize('Hello, World!')).toEqual(['hello', 'world'])
  })

  it('drops stopwords', () => {
    expect(tokenize('the cat sat on the mat')).toEqual(['cat', 'sat', 'mat'])
  })

  it('drops single-char tokens', () => {
    expect(tokenize('I a quick test')).toEqual(['quick', 'test'])
  })

  it('keeps underscores in identifiers', () => {
    expect(tokenize('snake_case_var')).toEqual(['snake_case_var'])
  })

  it('handles empty input', () => {
    expect(tokenize('')).toEqual([])
  })
})

describe('chunkFile', () => {
  it('returns a single chunk for small files', () => {
    const file = { filePath: 'a.md', text: 'one\ntwo\nthree' }
    expect(chunkFile(file)).toEqual([file])
  })

  it('splits long files into ~30-line chunks', () => {
    const text = Array.from({ length: 65 }, (_, i) => `line ${i + 1}`).join('\n')
    const chunks = chunkFile({ filePath: 'a.md', text })
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every(c => c.text.split('\n').length <= 30)).toBe(true)
  })

  it('every chunk preserves the file path', () => {
    const text = Array.from({ length: 100 }, () => 'x').join('\n')
    const chunks = chunkFile({ filePath: 'big.txt', text })
    expect(chunks.every(c => c.filePath === 'big.txt')).toBe(true)
  })
})

describe('rank', () => {
  const files = [
    { filePath: 'auth.ts', text: 'authentication login session token user' },
    { filePath: 'utils.ts', text: 'helpers utility functions strings dates' },
    { filePath: 'auth-test.ts', text: 'login session test helper auth' }
  ]

  it('returns top-K most relevant chunks', () => {
    const results = rank('login session', files, 2)
    expect(results).toHaveLength(2)
    expect(results[0].filePath).toMatch(/auth/)
  })

  it('returns empty array for queries with no tokens', () => {
    expect(rank('the a an', files)).toEqual([])
  })

  it('skips chunks with zero overlap', () => {
    const results = rank('completely unrelated zarquon', files)
    expect(results).toEqual([])
  })

  it('scores documents with multiple query-term hits higher', () => {
    const results = rank('login session', files)
    const authScore = results.find(r => r.filePath === 'auth.ts')?.score ?? 0
    const utilsScore = results.find(r => r.filePath === 'utils.ts')?.score ?? 0
    expect(authScore).toBeGreaterThan(utilsScore)
  })

  it('respects the topK limit', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ filePath: `f${i}.ts`, text: 'login session token' }))
    expect(rank('login', many, 3)).toHaveLength(3)
  })
})
