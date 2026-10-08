import { describe, it, expect } from 'vitest'
import { openDatabase } from '../../src/storage/index.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('storage: migrations', () => {
  it('is idempotent — opening twice does not re-apply migrations', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rue-migrations-'))
    const path = join(directory, 'test.sqlite')
    const d = openDatabase(path)
    try {
    const rows = d.prepare('SELECT id, name FROM migrations ORDER BY id').all()
    expect(rows).toEqual([{ id: 1, name: 'init' }, { id: 2, name: 'session_ownership' }, { id: 3, name: 'device_pairing_and_sync' }, { id: 4, name: 'owner_agent_settings' }, { id: 5, name: 'terminal_pairing_credentials' }, { id: 6, name: 'terminal_relay' }, { id: 7, name: 'one_bot_per_remote_session' }, { id: 8, name: 'terminal_execution_leases' }, { id: 9, name: 'managed_worker_enrollment' }, { id: 10, name: 'provider_key_vault' }, { id: 11, name: 'managed_agent_lifecycle' }, { id: 12, name: 'managed_agent_boot_fencing' }, { id: 13, name: 'managed_agent_explicit_purge' }, {id:14,name:'managed_mcp_profiles'}, {id:15,name:'mcp_secret_free_metadata'}, {id:16,name:'tenancy_project_bindings'}, {id:17,name:'project_binding_key_rotation'}, {id:18,name:'generic_tenancy_authority'}, {id:19,name:'retire_project_key_bindings'}, {id:20,name:'provider_model_preferences'}, {id:21,name:'provider_oauth_vault'}, {id:22,name:'oauth_login_intents'}, {id:23,name:'managed_compaction_commands'}, {id:24,name:'notification_inbox'}, {id:25,name:'web_push_delivery'}, {id:26,name:'push_test_rate_limit'}, {id:27,name:'runtime_rollout_jobs'}, {id:28,name:'agent_runtime_control_grants'}, {id:29,name:'durable_queue_order_and_recovery'}, {id:30,name:'single_agent_runtime_updates'}, {id:31,name:'agent_usage_ledger'}])

    // Opening the same file really reruns the migrator, unlike SELECT 1.
    const reopened = openDatabase(path)
    try {
      expect(reopened.prepare('SELECT id, name FROM migrations ORDER BY id').all()).toEqual(rows)
    } finally { reopened.close() }
    } finally {
      d.close()
      rmSync(directory, { recursive: true, force: true })
    }
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
      'devices',
      'device_pairings',
      'synced_preferences',
      'agent_settings',
      'terminal_pairing_requests',
      'terminal_connections',
      'terminal_commands',
      'terminal_mirrors',
      'workers',
      'worker_audit',
      'provider_keys',
      'provider_key_grants',
      'provider_key_audit',
      'mcp_profiles',
      'project_bindings',
    ]) {
      expect(tables).toContain(expected)
    }
  })
})
