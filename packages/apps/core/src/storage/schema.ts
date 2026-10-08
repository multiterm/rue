/**
 * Rue SQLite schema.
 *
 * Numbered migrations are applied in order on every open. The `migrations`
 * table tracks which have been applied.
 *
 * Design notes:
 *  - sessions/messages/parts mirror opencode's domain model so we can serve
 *    a Part-discriminated union over the wire.
 *  - notebooks/notebook_files preserve the existing rue NotebookLM-style
 *    feature.
 *  - schedule, memory_index, scope_links cover the remaining persistent
 *    rue subsystems lifted from the old main process.
 *
 * `parts.json` holds the typed Part payload (Text/Tool/File/Reasoning/...).
 * The discriminator is duplicated into `parts.type` for index efficiency.
 */

export const MIGRATIONS: ReadonlyArray<{ id: number; name: string; sql: string }> = [
  {
    id: 1,
    name: 'init',
    sql: `
      CREATE TABLE migrations (
        id          INTEGER PRIMARY KEY,
        name        TEXT NOT NULL,
        applied_at  INTEGER NOT NULL
      );

      CREATE TABLE sessions (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL DEFAULT '',
        agent       TEXT,
        provider    TEXT,
        model       TEXT,
        directory   TEXT,
        scopes      TEXT NOT NULL DEFAULT '[]',  -- JSON array of absolute paths
        parent_id   TEXT,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        meta        TEXT NOT NULL DEFAULT '{}'   -- JSON: cost/tokens/share/revert/etc
      );
      CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC);
      CREATE INDEX idx_sessions_parent  ON sessions(parent_id);

      CREATE TABLE messages (
        id          TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role        TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
        time        INTEGER NOT NULL,
        provider    TEXT,
        model       TEXT,
        agent       TEXT,
        meta        TEXT NOT NULL DEFAULT '{}',   -- JSON: usage/finish-reason/error/rating
        seq         INTEGER NOT NULL              -- monotonic per-session ordering
      );
      CREATE INDEX idx_messages_session ON messages(session_id, seq);

      CREATE TABLE parts (
        id          TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        type        TEXT NOT NULL,                -- 'text' | 'reasoning' | 'tool' | 'file' | 'step-start' | 'step-finish' | 'patch' | 'snapshot' | 'compaction' | 'agent' | 'subtask' | 'retry'
        seq         INTEGER NOT NULL,             -- monotonic per-message ordering
        payload     TEXT NOT NULL                 -- JSON: full part body
      );
      CREATE INDEX idx_parts_message ON parts(message_id, seq);
      CREATE INDEX idx_parts_session_seq ON parts(session_id, seq);

      CREATE TABLE notebooks (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        path        TEXT NOT NULL UNIQUE,
        updated_at  INTEGER NOT NULL
      );
      CREATE TABLE notebook_files (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        notebook_id   INTEGER NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
        relative_path TEXT NOT NULL,
        text          TEXT NOT NULL
      );
      CREATE INDEX idx_notebook_files_notebook ON notebook_files(notebook_id);

      CREATE TABLE scheduled_tasks (
        id           TEXT PRIMARY KEY,
        prompt       TEXT NOT NULL,
        when_ms      INTEGER NOT NULL,
        recurring_ms INTEGER,                     -- null = one-shot
        session_id   TEXT,                        -- optional session anchor
        meta         TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX idx_schedule_when ON scheduled_tasks(when_ms);

      CREATE TABLE preferences (
        message_id  TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
        rating      INTEGER NOT NULL CHECK (rating IN (-1, 0, 1))
      );
    `,
  },
  {
    id: 2,
    name: 'session_ownership',
    sql: `
      ALTER TABLE sessions ADD COLUMN owner_subject TEXT NOT NULL DEFAULT 'local';
      CREATE INDEX idx_sessions_owner_updated ON sessions(owner_subject, updated_at DESC);
    `,
  },
  {
    id: 3,
    name: 'device_pairing_and_sync',
    sql: `
      CREATE TABLE devices (
        id             TEXT PRIMARY KEY,
        owner_subject  TEXT NOT NULL,
        name           TEXT NOT NULL,
        platform       TEXT NOT NULL,
        created_at     INTEGER NOT NULL,
        last_seen_at   INTEGER NOT NULL,
        revoked_at     INTEGER
      );
      CREATE INDEX idx_devices_owner_seen ON devices(owner_subject, last_seen_at DESC);

      CREATE TABLE device_pairings (
        id                 TEXT PRIMARY KEY,
        owner_subject      TEXT NOT NULL,
        token_hash         TEXT NOT NULL UNIQUE,
        code_hash          TEXT NOT NULL,
        created_device_id  TEXT,
        claimed_device_id  TEXT,
        created_at         INTEGER NOT NULL,
        expires_at         INTEGER NOT NULL,
        claimed_at         INTEGER
      );
      CREATE INDEX idx_device_pairings_owner ON device_pairings(owner_subject, created_at DESC);
      CREATE INDEX idx_device_pairings_code ON device_pairings(owner_subject, code_hash);

      CREATE TABLE synced_preferences (
        owner_subject       TEXT NOT NULL,
        key                 TEXT NOT NULL,
        value               TEXT NOT NULL,
        version             INTEGER NOT NULL,
        updated_at          INTEGER NOT NULL,
        updated_by_device   TEXT,
        PRIMARY KEY (owner_subject, key)
      );
    `,
  },
  {
    id: 4,
    name: 'owner_agent_settings',
    sql: `CREATE TABLE agent_settings (
      owner_subject TEXT PRIMARY KEY,
      settings TEXT NOT NULL,
      encrypted_key TEXT,
      revision INTEGER NOT NULL
    );`,
  },
  {
    id: 5,
    name: 'terminal_pairing_credentials',
    sql: `
      CREATE TABLE terminal_pairing_requests (
        id TEXT PRIMARY KEY,
        verifier_hash TEXT NOT NULL,
        pi_session_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        owner_subject TEXT,
        bot_name TEXT,
        code_hash TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        consumed_at INTEGER
      );
      CREATE TABLE terminal_connections (
        id TEXT PRIMARY KEY,
        owner_subject TEXT NOT NULL,
        session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
        pi_session_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at INTEGER NOT NULL,
        activated_at INTEGER,
        revoked_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX terminal_connections_owner ON terminal_connections(owner_subject);
      CREATE INDEX terminal_pairing_expiry ON terminal_pairing_requests(expires_at);
    `,
  },
  {
    id: 6,
    name: 'terminal_relay',
    sql: `
      ALTER TABLE terminal_connections ADD COLUMN name TEXT NOT NULL DEFAULT '';
      ALTER TABLE terminal_connections ADD COLUMN remote_enabled INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE terminal_connections ADD COLUMN settings_revision INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE terminal_connections ADD COLUMN instance_id TEXT;
      ALTER TABLE terminal_connections ADD COLUMN last_seen_at INTEGER;
      CREATE TABLE terminal_commands (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL REFERENCES terminal_connections(id) ON DELETE CASCADE,
        request_id TEXT NOT NULL,
        text TEXT NOT NULL,
        user_message_id TEXT NOT NULL,
        assistant_message_id TEXT NOT NULL,
        status TEXT NOT NULL,
        instance_id TEXT,
        version INTEGER NOT NULL DEFAULT 0,
        result TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(connection_id, request_id)
      );
      CREATE INDEX terminal_commands_queue ON terminal_commands(connection_id, status, created_at);
      CREATE TABLE terminal_mirrors (
        connection_id TEXT NOT NULL REFERENCES terminal_connections(id) ON DELETE CASCADE,
        event_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        PRIMARY KEY(connection_id, event_id)
      );
    `,
  },
  {
    id: 7,
    name: 'one_bot_per_remote_session',
    sql: `CREATE UNIQUE INDEX terminal_session_owner ON terminal_connections(owner_subject, pi_session_id);`,
  },
  {
    id: 8,
    name: 'terminal_execution_leases',
    sql: `
      ALTER TABLE terminal_connections ADD COLUMN relay_protocol INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE terminal_connections ADD COLUMN lease_expires_at INTEGER;
      ALTER TABLE terminal_connections ADD COLUMN relay_health TEXT;
      ALTER TABLE terminal_commands ADD COLUMN claimed_at INTEGER;
      ALTER TABLE terminal_commands ADD COLUMN started_at INTEGER;
      ALTER TABLE terminal_commands ADD COLUMN lease_expires_at INTEGER;
    `,
  },
  {
    id: 9,
    name: 'managed_worker_enrollment',
    sql: `
      CREATE TABLE workers (
        id TEXT PRIMARY KEY,
        owner_subject TEXT NOT NULL,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        enrollment_request_id TEXT NOT NULL,
        desired TEXT NOT NULL DEFAULT 'active' CHECK(desired IN ('active','draining')),
        revision INTEGER NOT NULL DEFAULT 0,
        generation INTEGER NOT NULL DEFAULT 0,
        instance_id TEXT,
        lease_expires_at INTEGER,
        last_seen_at INTEGER,
        health TEXT,
        revoked_at INTEGER,
        created_at INTEGER NOT NULL,
        UNIQUE(owner_subject,enrollment_request_id)
      );
      CREATE INDEX workers_owner ON workers(owner_subject);
      CREATE TABLE worker_audit (
        id TEXT PRIMARY KEY,
        worker_id TEXT NOT NULL REFERENCES workers(id),
        action TEXT NOT NULL,
        revision INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
    `,
  },
  {
    id: 10, name: 'provider_key_vault',
    sql: `
      CREATE TABLE provider_keys (
        owner_subject TEXT NOT NULL, provider TEXT NOT NULL, encrypted_key TEXT,
        revision INTEGER NOT NULL, PRIMARY KEY(owner_subject,provider)
      );
      CREATE TABLE provider_key_grants (
        owner_subject TEXT NOT NULL, provider TEXT NOT NULL,
        target_type TEXT NOT NULL CHECK(target_type IN ('terminal','worker')), target_id TEXT NOT NULL,
        PRIMARY KEY(owner_subject,provider,target_type,target_id)
      );
      CREATE TABLE provider_key_audit (
        id TEXT PRIMARY KEY, owner_subject TEXT NOT NULL, provider TEXT NOT NULL,
        action TEXT NOT NULL, target_type TEXT, target_id TEXT, created_at INTEGER NOT NULL
      );
    `,
  },
  {
    id: 11, name: 'managed_agent_lifecycle',
    sql: `
      CREATE TABLE managed_agents (
        id TEXT PRIMARY KEY, owner_subject TEXT NOT NULL,
        worker_id TEXT NOT NULL REFERENCES workers(id),
        session_id TEXT UNIQUE REFERENCES sessions(id) ON DELETE SET NULL,
        connection_id TEXT UNIQUE REFERENCES terminal_connections(id) ON DELETE SET NULL,
        name TEXT NOT NULL, config TEXT NOT NULL,
        desired TEXT NOT NULL CHECK(desired IN ('running','stopped','destroyed')),
        revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL,
        grant_revision INTEGER, grant_generation INTEGER, encrypted_grant TEXT,
        observed TEXT NOT NULL DEFAULT 'pending', observed_revision INTEGER,
        observed_generation INTEGER, observed_at INTEGER, error TEXT
      );
      CREATE INDEX managed_agents_worker ON managed_agents(worker_id);
      CREATE INDEX managed_agents_owner ON managed_agents(owner_subject);
      CREATE TABLE managed_operations (
        id TEXT PRIMARY KEY, owner_subject TEXT NOT NULL, request_id TEXT NOT NULL,
        intent TEXT NOT NULL, agent_id TEXT NOT NULL REFERENCES managed_agents(id),
        revision INTEGER NOT NULL, action TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','succeeded','superseded')),
        created_at INTEGER NOT NULL, completed_at INTEGER,
        UNIQUE(owner_subject,request_id)
      );
    `,
  },
  {
    id: 12, name: 'managed_agent_boot_fencing',
    sql: `ALTER TABLE managed_agents ADD COLUMN grant_boot INTEGER;`,
  },
  {
    id: 13, name: 'managed_agent_explicit_purge',
    sql: `ALTER TABLE managed_agents ADD COLUMN purge_requested_at INTEGER;
          ALTER TABLE managed_agents ADD COLUMN purged_at INTEGER;`,
  },
  {
    id: 14, name: 'managed_mcp_profiles',
    sql: `CREATE TABLE mcp_profiles (
      id TEXT PRIMARY KEY, owner_subject TEXT NOT NULL, name TEXT NOT NULL,
      command TEXT NOT NULL, args TEXT NOT NULL, encrypted_env TEXT,
      revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, revoked_at INTEGER
    ); CREATE INDEX mcp_profiles_owner ON mcp_profiles(owner_subject);`,
  },
  {
    id: 15, name: 'mcp_secret_free_metadata',
    sql: `ALTER TABLE mcp_profiles ADD COLUMN environment_names TEXT NOT NULL DEFAULT '[]';`,
  },
  {
    id:16,name:'tenancy_project_bindings',
    sql:`CREATE TABLE project_bindings (
      id TEXT PRIMARY KEY, owner_subject TEXT NOT NULL, tenancy_origin TEXT NOT NULL,
      organization_id TEXT NOT NULL, project_id TEXT NOT NULL, key_id TEXT NOT NULL,
      key_hash TEXT NOT NULL, encrypted_key TEXT, scopes TEXT NOT NULL, expires_at INTEGER NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, revoked_at INTEGER,
      verified_at INTEGER NOT NULL, authorized_until INTEGER NOT NULL
    ); CREATE INDEX project_bindings_owner ON project_bindings(owner_subject);
    ALTER TABLE workers ADD COLUMN project_binding_id TEXT REFERENCES project_bindings(id);`,
  },
  {id:17,name:'project_binding_key_rotation',sql:`ALTER TABLE project_bindings ADD COLUMN key_update_id TEXT;
    ALTER TABLE project_bindings ADD COLUMN key_update_revision INTEGER;`},
  {id:18,name:'generic_tenancy_authority',sql:`ALTER TABLE project_bindings ADD COLUMN authority_kind TEXT NOT NULL DEFAULT 'project' CHECK(authority_kind IN ('project','generic'));`},
  {id:19,name:'retire_project_key_bindings',sql:`
    DELETE FROM provider_key_grants WHERE target_type='worker' AND target_id IN
      (SELECT id FROM workers WHERE project_binding_id IN (SELECT id FROM project_bindings WHERE authority_kind='project'));
    UPDATE workers SET revoked_at=COALESCE(revoked_at,CAST(strftime('%s','now') AS INTEGER)*1000),
      lease_expires_at=NULL,instance_id=NULL,health=NULL,generation=generation+1,revision=revision+1,project_binding_id=NULL
      WHERE project_binding_id IN (SELECT id FROM project_bindings WHERE authority_kind='project');
    DELETE FROM project_bindings WHERE authority_kind='project';
    ALTER TABLE project_bindings DROP COLUMN authority_kind;
    ALTER TABLE project_bindings DROP COLUMN key_update_id;
    ALTER TABLE project_bindings DROP COLUMN key_update_revision;
  `},
  {id:20,name:'provider_model_preferences',sql:`CREATE TABLE provider_model_preferences(owner_subject TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,PRIMARY KEY(owner_subject,provider));`},
  {id:21,name:'provider_oauth_vault',sql:`
    CREATE TABLE provider_oauth_credentials (
      owner_subject TEXT NOT NULL,
      provider TEXT NOT NULL CHECK(provider='openai-codex'),
      encrypted_credential TEXT,
      revision INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER,
      state TEXT NOT NULL CHECK(state IN ('ready','refreshing','reauthorize','removed')),
      refresh_nonce TEXT,
      refresh_started_at INTEGER,
      PRIMARY KEY(owner_subject,provider)
    );
  `},
  {id:22,name:'oauth_login_intents',sql:`
    CREATE TABLE oauth_login_intents (
      owner_subject TEXT NOT NULL, id TEXT NOT NULL, expected_revision INTEGER NOT NULL,
      status TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      PRIMARY KEY(owner_subject,id)
    );
    CREATE INDEX idx_oauth_login_expiry ON oauth_login_intents(expires_at);
  `},
  {id:23,name:'managed_compaction_commands',sql:`
    CREATE TABLE managed_compactions (
      id TEXT PRIMARY KEY, owner_subject TEXT NOT NULL,
      request_id TEXT NOT NULL, agent_id TEXT NOT NULL REFERENCES managed_agents(id),
      revision INTEGER NOT NULL, generation INTEGER NOT NULL, boot INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued','assigned','running','succeeded','failed','cancelled','uncertain')),
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      started_at INTEGER, completed_at INTEGER, runtime_instance TEXT, nonce_hash TEXT,
      UNIQUE(owner_subject,request_id)
    );
    CREATE UNIQUE INDEX managed_compaction_active ON managed_compactions(agent_id)
      WHERE status IN ('queued','assigned','running');
    CREATE INDEX managed_compaction_history ON managed_compactions(agent_id,created_at);
  `},
  {id:24,name:'notification_inbox',sql:`
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY, owner_subject TEXT NOT NULL,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      event_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK(kind IN ('task_completed','task_failed')),
      created_at INTEGER NOT NULL, read_at INTEGER
    );
    CREATE INDEX notifications_owner_time ON notifications(owner_subject,created_at DESC,id);
    CREATE INDEX notifications_unread ON notifications(owner_subject) WHERE read_at IS NULL;
  `},
  {id:25,name:'web_push_delivery',sql:`
    CREATE TABLE push_subscriptions (
      id TEXT PRIMARY KEY, owner_subject TEXT NOT NULL, device_id TEXT NOT NULL,
      endpoint_hash TEXT NOT NULL UNIQUE, encrypted_subscription TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      UNIQUE(owner_subject,device_id)
    );
    CREATE TABLE push_deliveries (
      notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
      subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
      state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','failed')),
      attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, lease_id TEXT, lease_until INTEGER,
      PRIMARY KEY(notification_id,subscription_id)
    );
    CREATE INDEX push_delivery_due ON push_deliveries(state,next_at,lease_until);
  `},
  {id:26,name:'push_test_rate_limit',sql:`ALTER TABLE push_subscriptions ADD COLUMN last_test_at INTEGER;`},
  {id:27,name:'runtime_rollout_jobs',sql:`
    CREATE TABLE runtime_rollouts (
      id TEXT PRIMARY KEY, owner_subject TEXT NOT NULL, worker_id TEXT NOT NULL REFERENCES workers(id),
      request_id TEXT NOT NULL, intent TEXT NOT NULL, phase TEXT NOT NULL CHECK(phase IN ('preflight','draining','stopping','installing','verifying','rollback_stopping','rollback_installing','rollback_verifying','succeeded','failed','uncertain')),
      image TEXT NOT NULL, previous_image TEXT NOT NULL, worker_revision INTEGER NOT NULL,
      agents TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL, phase_at INTEGER NOT NULL, error TEXT,
      UNIQUE(owner_subject,request_id)
    );
    CREATE UNIQUE INDEX runtime_rollout_active ON runtime_rollouts(worker_id) WHERE phase NOT IN ('succeeded','failed');
    CREATE INDEX runtime_rollout_history ON runtime_rollouts(owner_subject,created_at DESC);
  `},
  {id:28,name:'agent_runtime_control_grants',sql:`
    CREATE TABLE runtime_control_grants (
      agent_id TEXT PRIMARY KEY REFERENCES managed_agents(id) ON DELETE CASCADE,
      owner_subject TEXT NOT NULL, worker_id TEXT NOT NULL REFERENCES workers(id),
      connection_id TEXT NOT NULL REFERENCES terminal_connections(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
      expires_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE runtime_control_requests (
      rollout_id TEXT PRIMARY KEY REFERENCES runtime_rollouts(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES managed_agents(id), grant_revision INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX runtime_control_requests_agent ON runtime_control_requests(agent_id);
    CREATE TABLE runtime_control_audit (
      id TEXT PRIMARY KEY, owner_subject TEXT NOT NULL, agent_id TEXT NOT NULL,
      worker_id TEXT NOT NULL, grant_revision INTEGER NOT NULL, action TEXT NOT NULL,
      rollout_id TEXT, created_at INTEGER NOT NULL
    );
    CREATE INDEX runtime_control_audit_owner ON runtime_control_audit(owner_subject,created_at DESC);
  `},
  {id:29,name:'durable_queue_order_and_recovery',sql:`
    ALTER TABLE terminal_commands ADD COLUMN queue_position INTEGER;
    ALTER TABLE terminal_commands ADD COLUMN queue_restored_at INTEGER;
    WITH ordered AS (SELECT id,ROW_NUMBER() OVER(PARTITION BY connection_id ORDER BY created_at,rowid) AS position FROM terminal_commands)
      UPDATE terminal_commands SET queue_position=(SELECT position FROM ordered WHERE ordered.id=terminal_commands.id);
    CREATE INDEX terminal_commands_position ON terminal_commands(connection_id,status,queue_position);
  `},
  {id:30,name:'single_agent_runtime_updates',sql:`
    ALTER TABLE managed_agents ADD COLUMN runtime_image TEXT;
    ALTER TABLE managed_agents ADD COLUMN previous_runtime_image TEXT;
    ALTER TABLE managed_agents ADD COLUMN runtime_update_state TEXT;
    ALTER TABLE managed_agents ADD COLUMN runtime_update_version TEXT;
    ALTER TABLE managed_agents ADD COLUMN runtime_update_boot_at INTEGER;
  `},
  {id:31,name:'agent_usage_ledger',sql:`
    CREATE TABLE usage_credentials(id TEXT PRIMARY KEY,owner_subject TEXT NOT NULL,provider TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE agent_usage_events(owner_subject TEXT NOT NULL,session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,connection_id TEXT NOT NULL,event_id TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,credential_id TEXT REFERENCES usage_credentials(id),time INTEGER NOT NULL,input_tokens INTEGER NOT NULL,output_tokens INTEGER NOT NULL,cache_read_tokens INTEGER NOT NULL,cache_write_tokens INTEGER NOT NULL,cost_usd REAL,PRIMARY KEY(connection_id,event_id));
    CREATE INDEX agent_usage_owner_session_time ON agent_usage_events(owner_subject,session_id,time);
  `},
]
