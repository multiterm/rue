import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

test('agent build uses an installed compiler pinned to its Docker build, not a global Bun', () => {
  const manifestURL = new URL('../packages/apps/agent-runtime/package.json', import.meta.url)
  const manifest = JSON.parse(readFileSync(manifestURL, 'utf8'))
  const dockerfile = readFileSync(new URL('../deploy/worker/agent.Dockerfile', import.meta.url), 'utf8')
  expect(dockerfile).toContain(`FROM oven/bun:${manifest.devDependencies.bun} AS build`)
  const require = createRequire(manifestURL)
  const path = require.resolve('bun/package.json')
  const compiler = JSON.parse(readFileSync(path, 'utf8'))
  expect(compiler.version).toBe(manifest.devDependencies.bun)
  const result = spawnSync(join(dirname(path), compiler.bin.bun), ['--version'], { encoding: 'utf8', timeout: 10_000 })
  expect(result.status).toBe(0)
  expect(result.stdout.trim()).toBe(manifest.devDependencies.bun)
})
