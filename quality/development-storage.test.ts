import { expect, test } from 'vitest'
import { hasPersistentMount,requiresSqliteMount } from '../scripts/deployment/require-development-storage.mjs'

test('PostgreSQL requires an explicit URL and original key, never a SQLite mount fallback',()=>{
  expect(requiresSqliteMount({})).toBe(true)
  expect(requiresSqliteMount({RUE_STORAGE_BACKEND:'postgres',RUE_DATABASE_URL:'postgres://fixture:secret@database.test/rue',RUE_SETTINGS_ENCRYPTION_KEY:'fixture'})).toBe(false)
  for(const env of [{RUE_STORAGE_BACKEND:'unknown'},{RUE_STORAGE_BACKEND:'postgres'},{RUE_STORAGE_BACKEND:'postgres',RUE_DATABASE_URL:'postgres://database.test/rue'},{RUE_DATABASE_URL:'postgres://database.test/rue'}])expect(()=>requiresSqliteMount(env)).toThrow()
})
test('development storage guard requires an explicit persistent data mount', () => {
  expect(hasPersistentMount('42 20 8:1 /rue /tmp/.local/share/rue rw - xfs /dev/nvme0 rw')).toBe(true)
  for (const fs of ['tmpfs', 'ramfs', 'overlay', 'devtmpfs']) {
    expect(hasPersistentMount(`42 20 0:1 / /tmp/.local/share/rue rw - ${fs} none rw`)).toBe(false)
  }
  expect(hasPersistentMount('42 20 8:1 / /tmp rw - xfs /dev/nvme0 rw')).toBe(false)
  expect(hasPersistentMount('')).toBe(false)
})
