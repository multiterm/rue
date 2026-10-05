import { expect, test } from 'vitest'
import { formatDictation, startsDictatedSentence } from '../packages/apps/webapp/src/dictation-format'
const format = (text: string, finish = true) => formatDictation(text, { language: 'en-US', sentenceStart: true, finish })
test('local formatting preserves words, repeated words, and recognizer punctuation', () => {
  expect(format('hello , world')).toBe('Hello, world.')
  expect(format('very very clear')).toBe('Very very clear.')
  expect(format('is this ready?')).toBe('Is this ready?')
  expect(format('hello there. next sentence')).toBe('Hello there. Next sentence.')
  expect(format('ask Dr. smith')).toBe('Ask Dr. smith.')
  expect(format('one thought and another')).toBe('One thought and another.')
  expect(format('hello!', false)).toBe('Hello!')
  expect(format('hello', false)).toBe('Hello')
  expect(format('first,then next')).toBe('First, then next.')
  expect(format('hello,')).toBe('Hello,')
  expect(format('hello:')).toBe('Hello:')
  expect(format('version 1.2')).toBe('Version 1.2')
  expect(format('')).toBe('')
})
test('does not rewrite structured text or unsupported languages', () => {
  for (const text of ['visit https://example.com', '/src/index.ts', 'use `myFunction()`', 'first\nsecond', '# heading', 'const x = {}']) expect(format(text)).toBe(text)
  expect(formatDictation('bonjour , monde', { language: 'fr-FR', sentenceStart: true, finish: true })).toBe('bonjour , monde')
})
test('recognizer restarts do not invent sentence boundaries', () => {
  expect(startsDictatedSentence('')).toBe(true)
  expect(startsDictatedSentence('First sentence. ')).toBe(true)
  expect(startsDictatedSentence('Draft:')).toBe(false)
  expect(startsDictatedSentence('we want to')).toBe(false)
  expect(formatDictation('continue speaking', { language: 'en', sentenceStart: false })).toBe('continue speaking')
})
