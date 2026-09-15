import { expect, test } from 'vitest'
import { hasPersistentMount } from '../scripts/deployment/require-development-storage.mjs'

test('development storage guard requires an explicit persistent data mount', () => {
  expect(hasPersistentMount('42 20 8:1 /rue /tmp/.local/share/rue rw - xfs /dev/nvme0 rw')).toBe(true)
  for (const fs of ['tmpfs', 'ramfs', 'overlay', 'devtmpfs']) {
    expect(hasPersistentMount(`42 20 0:1 / /tmp/.local/share/rue rw - ${fs} none rw`)).toBe(false)
  }
  expect(hasPersistentMount('42 20 8:1 / /tmp rw - xfs /dev/nvme0 rw')).toBe(false)
  expect(hasPersistentMount('')).toBe(false)
})
