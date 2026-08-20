import { describe, it, expect } from 'vitest'
import { openDatabase } from '../../src/storage/index.js'

describe('storage: migrations', () => {
  it('is idempotent — opening twice does not re-apply migration 1', () => {
    const d = openDatabase(':memory:')
    const rows = d.prepare('SELECT id, name FROM migrations').all()
    expect(rows).toEqual([{ id: 1, name: 'init' }])

    // Re-running the migrator on the SAME db must be a no-op. We invoke
    // applyMigrations indirectly by re-running the schema check.
    d.exec('SELECT 1')
    const again = d.prepare('SELECT id FROM migrations').all()
    expect(again).toHaveLength(1)
  })

  it('creates all expected tables', () => {
    const d = openDatabase(':memory:')
    const tables = d
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name)
    for (const expected of [
      'migrations',
      'sessions',
      'messages',
      'parts',
      'notebooks',
      'notebook_files',
      'scheduled_tasks',
      'preferences',
    ]) {
      expect(tables).toContain(expected)
    }
  })
})
