#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDevelopmentLibraries } from './build-development-libraries.mjs'
import { assertDevelopmentSyntax } from './check-development-syntax.mjs'

export function assertDevelopmentQualityState(state) {
  const quality = state?.quality
  if (state?.environment !== 'development' || state.runtimeMode !== 'development' ||
      typeof state.sourceRevision !== 'string' || !state.sourceRevision ||
      quality?.sourceRevision !== state.sourceRevision || quality.status !== 'passed' ||
      !Array.isArray(quality.checks) || !quality.checks.length ||
      quality.checks.some(check => !check || check.sourceRevision !== state.sourceRevision ||
        (check.required !== false && !['passed', 'reused'].includes(check.status)))) {
    throw new Error('Development checks did not pass for the current source revision')
  }
}

async function assertDevelopmentQuality(root) {
  let state
  try { state = JSON.parse(await readFile(join(root, '.sandblocks/sandbox-development.json'), 'utf8')) }
  catch { throw new Error('Development quality state is missing or invalid') }
  assertDevelopmentQualityState(state)
}

export async function syncDevelopment(run, root, apiUrl, build = buildDevelopmentLibraries, preflight = assertDevelopmentSyntax, verify = assertDevelopmentQuality) {
  await preflight(root)
  const common = [root, '--environment', 'development', ...(apiUrl ? ['--api-url', apiUrl] : [])]
  await run(['sandbox', 'sync', ...common, '--checks', 'none'])
  // Source synchronization alone does not refresh installed packages or SDK dist.
  await build(root, apiUrl)
  await run(['sandbox', 'check', ...common, '--profile', 'full'])
  // The CLI can exit zero even when its recorded browser checks failed.
  await verify(root)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(import.meta.dirname, '../..')
  const args = process.argv.slice(2)
  if (args.length && (args.length !== 2 || args[0] !== '--api-url')) throw new Error('Only --api-url <url> is supported; this runner is development-only')
  if (args[1]) {
    const url = new URL(args[1])
    if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)) throw new Error('API URL must not contain credentials')
  }
  const run = (command) => new Promise((resolve, reject) => {
    const child = spawn(join(root, 'node_modules/.bin/sandblocks'), command, { cwd: root, env: process.env, stdio: 'inherit' })
    child.once('error', () => reject(new Error('Could not start development sync command')))
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Development sync stopped (exit ${code})`)))
  })
  await syncDevelopment(run, root, args[1])
}
