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
]
