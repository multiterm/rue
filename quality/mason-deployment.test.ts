import { expect, test } from 'vitest'
import { chmodSync, linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { enrollment, verifyMounts, verifyVolumeMetadata } from '../scripts/deployment/mason-worker.mjs'

test('Mason enrollment requires a private, unaliased file outside the shared workspace', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rue-mason-enrollment-')), workspace = join(dir, 'workspace'), secret = join(dir, 'credential')
  mkdirSync(workspace)
  const key = `rue_worker_${'x'.repeat(43)}`, id = '00000000-0000-4000-8000-000000000001'
  try {
    writeFileSync(secret, key, { mode: 0o600 })
    expect(JSON.parse(enrollment(secret, 'https://rue.test', id, workspace))).toEqual({ origin: 'https://rue.test', id, secret: key })
    chmodSync(secret, 0o644); expect(() => enrollment(secret, 'https://rue.test', id, workspace)).toThrow()
    chmodSync(secret, 0o600)
    expect(() => enrollment(secret, 'http://rue.test', id, workspace)).toThrow()
    expect(() => enrollment(secret, 'https://rue.test/path', id, workspace)).toThrow()
    expect(() => enrollment(secret, 'https://rue.test', 'invalid-id', workspace)).toThrow()
    const alias = join(dir, 'alias'); symlinkSync(secret, alias)
    expect(() => enrollment(alias, 'https://rue.test', id, workspace)).toThrow()
    const hardlink = join(dir, 'hardlink'); linkSync(secret, hardlink)
    expect(() => enrollment(secret, 'https://rue.test', id, workspace)).toThrow()
    const exposed = join(workspace, 'exposed'); writeFileSync(exposed, key, { mode: 0o600 })
    expect(() => enrollment(exposed, 'https://rue.test', id, workspace)).toThrow()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
test('Mason private state cannot use a host bind or volume plugin disguised by its label', () => {
  const info = { Name: 'rue-mason-worker-private', Driver: 'local', Scope: 'local', Labels: { 'dev.rue.role': 'worker-private' }, Options: null, Mountpoint: '/var/lib/docker/volumes/rue-mason-worker-private/_data' }
  expect(() => verifyVolumeMetadata(info)).not.toThrow()
  for (const patch of [{ Driver: 'plugin' }, { Scope: 'global' }, { Name: 'other' }, { Labels: {} }, { Options: { type: 'none', o: 'bind', device: '/Volumes/MOTHERSHIP' } }, { Mountpoint: '' }])
    expect(() => verifyVolumeMetadata({ ...info, ...patch })).toThrow()
})
test('Mason rejects every share outside MOTHERSHIP, even a read-only runtime cache', () => {
  const root = { target: '/Volumes/MOTHERSHIP', options: 'rw,relatime' }, cache = { target: '/Users/test/Library/Caches/colima', options: 'ro,relatime' }
  expect(() => verifyMounts([root])).not.toThrow()
  for (const mounts of [[], [root, cache], [root, cache, { target: '/Users', options: 'ro' }], [root, { ...cache, options: 'rw' }], [root, { target: '/', options: 'ro' }], [root, root], [{ ...root, children: [cache] }]])
    expect(() => verifyMounts(mounts)).toThrow()
})
