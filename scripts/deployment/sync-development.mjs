#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDevelopmentLibraries } from './build-development-libraries.mjs'

export async function syncDevelopment(run, root, apiUrl, build = buildDevelopmentLibraries) {
  const common = [root, '--environment', 'develop', ...(apiUrl ? ['--api-url', apiUrl] : [])]
  await run(['sandbox', 'sync', ...common, '--checks', 'none'])
  // Source synchronization alone does not refresh installed packages or SDK dist.
  await build(root, apiUrl)
  await run(['sandbox', 'check', ...common, '--profile', 'full'])
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
