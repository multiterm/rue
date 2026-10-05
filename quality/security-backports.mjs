import { readFileSync, realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const backports = JSON.parse(readFileSync(new URL('./security-backports.json', import.meta.url), 'utf8'))
const root = fileURLToPath(new URL('../', import.meta.url))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

export function assertBackportEvidence(spec, advisory, evidence, today = new Date().toISOString().slice(0, 10)) {
  if (!spec || spec.expires < today || advisory.module_name !== spec.module ||
      advisory.url !== `https://github.com/advisories/${spec.ghsa}` ||
      !Array.isArray(advisory.findings) || !advisory.findings.length ||
      advisory.findings.some(f => f.version !== spec.version) ||
      hash(evidence.patch) !== spec.sha256 || !evidence.packages.length) {
    throw new Error('Security backport evidence is missing, changed, or expired')
  }
  for (const pkg of evidence.packages) {
    if (pkg.name !== spec.module || pkg.version !== spec.version || pkg.patchHash !== spec.sha256 ||
        Object.entries(spec.files).some(([file, digest]) => !pkg.files[file] || hash(pkg.files[file]) !== digest)) {
      throw new Error('Installed security backport does not match reviewed code')
    }
  }
}

export function installedBackports(directory = root) {
  const result = spawnSync('pnpm', ['list', '-r', 'node-forge', 'braces', '--depth', 'Infinity', '--json'], {
    cwd: directory, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30_000,
  })
  if (result.error || result.status !== 0) throw new Error('Cannot verify installed security backports')
  let tree
  try { tree = JSON.parse(result.stdout) } catch { throw new Error('Invalid installed dependency evidence') }
  if (!Array.isArray(tree) || !tree.length) throw new Error('Missing installed dependency evidence')
  const found = new Map()
  function walk(node) {
    if (!node || typeof node !== 'object') return
    for (const [name, value] of Object.entries(node)) {
      if (['node-forge', 'braces'].includes(name) && value && typeof value === 'object') {
        if (typeof value.path !== 'string') throw new Error('Installed dependency path is missing')
        const path = realpathSync(value.path)
        found.set(path, { name, path })
      }
      walk(value)
    }
  }
  walk(tree)
  return [...found.values()]
}

export function verifySecurityBackport(id, advisory, installed, directory = root) {
  const spec = backports[id]
  if (!spec) throw new Error('No reviewed security backport')
  const packages = installed.filter(pkg => pkg.name === spec.module).map(({ path }) => {
    const manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'))
    const patchHash = path.replaceAll('\\', '/').match(/_patch_hash=([a-f0-9]{64})\/node_modules\//)?.[1]
    return { ...manifest, path, patchHash, files: Object.fromEntries(Object.keys(spec.files).map(file => [file, readFileSync(join(path, file))])) }
  })
  assertBackportEvidence(spec, advisory, { patch: readFileSync(resolve(directory, spec.patch)), packages })
  for (const pkg of packages) {
    // A separate process bounds hangs/stack failures, even if a future patch regresses.
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./security-backport-regressions.mjs', import.meta.url)), '--check', spec.module, pkg.path], {
      cwd: directory, encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024,
    })
    if (result.error || result.status !== 0) throw new Error(`Security backport regressions failed: ${spec.module}`)
  }
  return spec
}
