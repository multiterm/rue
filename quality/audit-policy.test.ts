import { expect, test } from 'vitest'
import { parseAuditResult } from './audit-policy.mjs'

const empty = { advisories: {}, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } } }
test('accepts a complete successful zero-advisory report', () => {
  expect(parseAuditResult({ status: 0, stdout: JSON.stringify(empty) })).toEqual([])
})
test('accepts the pnpm 11 report without an optional aggregate total', () => {
  expect(parseAuditResult({ status: 0, stdout: JSON.stringify({ advisories: {}, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } } }) })).toEqual([])
})
test('returns advisories for the unchanged explicit exception policy', () => {
  const advisory = { module_name: 'fixture', severity: 'high', title: 'Fixture advisory' }
  expect(parseAuditResult({ status: 1, stdout: JSON.stringify({ advisories: { '123': advisory }, metadata: { vulnerabilities: { ...empty.metadata.vulnerabilities, high: 1, total: 1 } } }) })).toEqual([['123', advisory]])
})
test.each([
  { status: 0, stdout: '{}' },
  { status: 1, stdout: JSON.stringify({ error: { message: 'Registry unavailable' } }) },
  { status: 0, stdout: 'invalid registry output' },
  { status: null, stdout: JSON.stringify(empty) },
  { status: 2, stdout: JSON.stringify(empty) },
  { status: 0, stdout: JSON.stringify(empty), error: new Error('Spawn failed') },
  { status: 1, stdout: JSON.stringify(empty) },
  { status: 0, stdout: JSON.stringify({ ...empty, metadata: {} }) },
  { status: 1, stdout: JSON.stringify({ ...empty, advisories: { '123': {} } }) },
])('fails closed for incomplete or contradictory audit evidence (%#)', (result) => {
  expect(() => parseAuditResult(result)).toThrow()
})
test('does not echo potentially secret-bearing registry diagnostics', () => {
  expect(() => parseAuditResult({ status: 1, stdout: 'Bearer fixture-secret' })).toThrow(/^Dependency audit returned invalid JSON$/)
})
