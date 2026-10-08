import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'

test('fail-closed Docker context includes only the deployed browser-check sources', () => {
  const rules = readFileSync(new URL('../.dockerignore', import.meta.url), 'utf8')
    .split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'))
  expect(rules[0]).toBe('**')
  expect(rules.filter(line => line.startsWith('!quality'))).toEqual([
    '!quality/', '!quality/app-contract.ts', '!quality/app-playwright.ts',
    '!quality/api.app.playwright.ts', '!quality/webapp.app.playwright.ts',
    '!quality/site.app.playwright.ts', '!quality/docs.app.playwright.ts',
    '!quality/playwright.config.ts',
  ])
  const dockerfile = readFileSync(new URL('../docker/images/Dockerfile.sandblocks-e2e', import.meta.url), 'utf8')
  expect(dockerfile).toContain('COPY quality ./quality')
})
