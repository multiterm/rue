# PostgreSQL / Drizzle / tRPC migration

## Target and reference review

- PostgreSQL lives independently on **vb-abby**, with separate development/preview/production databases and least-privilege runtime roles.
- Sandblocks owns the Rue API, webapp, site and docs deployments. No manual API-container database mount should remain after cutover.
- Keypost's `packages/libs/db/src/client.ts` uses `postgres.js` + Drizzle's `postgres-js` adapter, typed schema, and explicit pool closure. Its tRPC client uses `createTRPCClient<AppRouter>` and `httpBatchLink`.
- Portal's DB package separates typed clients/schema/stores, and its browser tRPC entry point exports router types without importing server implementation. Rue follows that separation rather than copying either app's credentials or tenant model.

## Implemented foundation — NOT a live database cutover

- `@multiterm/rue-db/postgres`: bounded postgres.js pool, Drizzle schema and explicit migration runner.
- Additive migration `0003_lossless_conversation_json.sql` changes conversation JSONB columns to PostgreSQL **JSON**. A real backup contained escaped Unicode JSONB cannot represent; JSON preserves the original serialized content, including escaped NUL/unpaired surrogates, without discarding rows or rewriting transcripts. SDK-facing values remain parsed JSON.
- Drizzle migrations for **all 37 application tables** (the SQLite migration ledger is replaced by Drizzle's ledger), including the conversation foundation and additive `0002_domain_parity.sql`. The domain schema now includes runtime control/rollouts, queue recovery, single-agent runtime fields and usage accounting.
- Domain generation preserves serialized JSON/encrypted strings, maps SQLite REAL to PostgreSQL double precision, and supplies generated identities for notebook IDs. An importer must still reseed identities after importing explicit IDs; generated queue ordinals must not be treated as restored execution authority.
- Schema-parity tests check every canonical SQLite table/column; `generate-domain-schema.mjs --check` detects stale generated output without writing files.
- Shared asynchronous session-repository contract; PostgreSQL and temporary SQLite implementations use owner filtering and stable cursor pagination.
- Async notification inbox and server-internal push-delivery repositories (`src/postgres/notifications.ts`). Task notification + subscription fanout is one atomic statement and can use the caller's PostgreSQL completion transaction. Inbox pages/unread totals are owner-filtered and snapshot-consistent. Delivery claims use `FOR UPDATE SKIP LOCKED`; acknowledgements require the current, unexpired lease and matching owner/subscription ciphertext. This is at-least-once delivery, not exactly-once sending. No decrypted endpoints or subscription/lease fields appear in inbox results.
- Async PostgreSQL device/pairing/preferences repository (`src/postgres/pairing.ts`). Registration cannot steal another owner's device; pairing claims are single-winner updates; preference creation/replacement uses atomic compare-and-set instead of SELECT-then-UPDATE. These methods are not wired into the SQLite API yet.
- Read-only, private-file SQLite backup preflight (`scripts/audit-sqlite-backup.mjs`) checks table/column and migration inventory, database integrity, foreign keys, bot/session/worker ownership and execution-state counts. Backups must have standalone DELETE-journal headers, not merely lack sidecars: read-only SQLite access to a WAL-mode header can create sidecars. Normalize a **new destination** to `journal_mode=DELETE` when creating the consistent backup; never alter an existing checkpoint or live database during audit. Reports omit row contents and always say `cutoverReady: false`; this is not an importer or a lease-reset policy.
- The CLI and `rehearseSqliteBackup` entry point in `scripts/rehearse-sqlite-backup.ts` validate a complete copy into an explicitly named, empty disposable database and **always roll back**. It enforces foreign keys, verifies every copied value/row count (JSON comparison stays in PostgreSQL to avoid JavaScript precision loss), preserves source rowids as provisional ordinals without consuming identity sequences, checks unchanged source bytes, and confirms empty target tables afterward. It refuses unknown/nonempty targets. Diagnostic output contains only fixed codes and whitelisted table/column/SQLSTATE metadata, never SQL parameters or row contents.
- Separate operator-only `createHeldImportFixture` commits a disposable clone only after policy v1 execution reset and transactional identity reseeding. `import-execution-reset.ts` requires a matching `rue_rehearsal_<nonce>`/`rue_restore_<nonce>` database name, holds table locks, and refuses unresolved work. It cannot reset an ordinary live database. Reapplying the hold is idempotent; saved provider/project credentials and history are preserved, not reissued. This is not a production importer or physical worker drain.
- Async PostgreSQL worker repository (`src/postgres/workers.ts`) covers enrollment deduplication/quota, owner-filtered views, revision CAS, rotation/revocation, provider-grant removal/audit, and project-bounded connection/heartbeat leases. Owner advisory locks plus row locks serialize authority changes; lease admission rechecks time after lock waits. `withAuthority` keeps dependent SQL mutations inside the fenced transaction; a prior `validate` result is not durable authority. The API must supply its strict health parser. Runtime/API handlers and project-proof verification remain unported; do not wire this domain alone into production.
- tRPC `sessionsPage` and `session` procedures with validated inputs and inferred output types. The webapp's session list uses the typed client and follows every page rather than silently limiting users to 100 bots.
- The API deliberately continues to use the SQLite repository adapter while its other stores are ported. There is no dual-write/split-database mode.
- Real PostgreSQL integration checks cover migration replay, tenant isolation, >100-row pagination, JSON/timestamp preservation, rollback and foreign-key cascades. Separate tests exercise the actual tRPC HTTP/SuperJSON boundary.

## Remaining domains

As verified on 2026-10-01, the canonical SQLite schema and live development database have 38 tables including the migration ledger. PostgreSQL now has schema coverage, **not repository/API coverage**, for every application table. An earlier audit found 262 `.prepare()` calls across 30 core files; the subsequent control-plane continuation found 332 `.prepare(` occurrences across 36 core source files. Replacing synchronous storage calls remains an asynchronous migration, not a connection-string change. The live cutover has not been performed.

Remaining work includes API integration for devices/pairing/preferences and notifications/delivery leases; subscription validation/encryption/lifecycle, retry/retirement policy and dispatcher integration; async repositories and integration for provider keys/grants/audit and OAuth; worker API/socket integration and project-authority verification/persistence; managed agents/operations/compaction; terminal pairing/leases/commands/mirroring; MCP; notebooks and scheduling.

Preserve transactional boundaries and replace SQLite-specific concurrency with PostgreSQL transactions/row locks and constraints. Command claims, credential refresh and delivery leases need concurrent-worker tests. Do not wrap network queries in a blocking SQLite compatibility shim. Do not run SQLite `.transaction()` callbacks with async functions.

## Cutover gates

1. Finish schemas and async repositories for every persistent domain and adapt API/socket handlers. Keep protocol endpoints for workers, streams and attachments; migrate browser account queries/mutations to tRPC without weakening authorization or idempotency.
2. Add a migration utility operating on a consistent SQLite backup. Validate IDs, relationships, row counts, JSON conversion, encrypted credential bytes and attachment content. Do not import active leases as live execution authority or replay commands.
3. Preserve the **existing settings-encryption key** in API-only secrets. Moving encrypted rows without their original key makes credentials unreadable. VAPID keys must also remain stable; their pending Sandblocks setup is separate from the database move.
4. Audit filesystem-backed memory/skills/logs and choose durable storage where required. PostgreSQL alone does not migrate those files.
5. Provision PostgreSQL on vb-abby with network restrictions, authenticated connections/TLS as applicable, separate environment roles, and tested backups/restore. Use a migration role separately from the runtime role. No other project's database credentials are to be reused.
6. Rehearse migration and restore against a disposable database. Drain managed work and pause writes for the final snapshot/cutover. Confirm migrations, schema inventory and checksums before switching the API.
7. Deploy one API replica first. Socket ownership/event coordination are currently process-local; adding PostgreSQL does not itself make Rue horizontally safe.
8. Verify login, conversations/attachments, provider grants, leases, managed tasks and Web Push before reopening writes. A rollback to old SQLite after new PostgreSQL writes requires reconciliation; it must not silently discard post-cutover data.

## Development commands

From the repository root, run `node packages/libs/db/scripts/generate-domain-schema.mjs` to regenerate the domain schema from an empty canonical SQLite schema, or append `--check` for a read-only drift check. Run `node --import tsx --test packages/libs/db/tests/schema-parity.node.ts` for table/column parity.

From `packages/libs/db`, `pnpm db:generate` generates migrations from `src/postgres/schema.ts`. The explicit `migratePostgresDatabase(db)` runner applies checked-in SQL; never use destructive schema push on deployed data.

`createPostgresDatabase` reads `RUE_DATABASE_URL` (or `DATABASE_URL`) and has no default credentials. This client is not yet the running API's primary store: **do not switch deployed connection variables or remove the existing storage mount yet**.

Tests (Node 22.13+ and platform-correct dependencies):

```sh
RUE_PG_TEST_ADMIN_URL='postgres://TEST_USER@127.0.0.1:TEST_PORT/postgres' \
  node --import tsx --test packages/libs/db/tests/postgres.node.ts
node --import tsx --test packages/libs/trpc/tests/sessions.node.ts
# With the same disposable RUE_PG_TEST_ADMIN_URL:
node --import tsx --test packages/libs/db/tests/pairing-postgres.node.ts
node --import tsx --test packages/libs/db/tests/notifications-postgres.node.ts
node --import tsx --test packages/libs/db/tests/workers-postgres.node.ts
node --import tsx --test packages/libs/db/tests/restored-credentials.node.ts
node --import tsx --test packages/libs/db/tests/backup-audit.node.ts
node --import tsx --test packages/libs/db/tests/rehearsal-postgres.node.ts
# For the local disk-backed pg_dump/pg_restore test, also set
# RUE_PG_TEST_CONTAINER to that disposable PostgreSQL Docker container name.
# The test currently uses Docker context colima-rue; otherwise it is explicitly skipped.
# Set RUE_PG_REHEARSAL_ADMIN_URL privately to a disposable PostgreSQL server.
# This creates/drops its own database and has no commit mode:
node --import tsx packages/libs/db/scripts/rehearse-sqlite-backup.ts /private/backup/rue.db
# Use an operator-owned mode-0600 consistent backup, never a live database/WAL:
node --import tsx packages/libs/db/scripts/audit-sqlite-backup.mjs /private/backup/rue.db
```

On 2026-10-01, all six PostgreSQL/schema-parity/tRPC tests passed against a disposable local PostgreSQL 17 container, including applying all three migrations twice, full table/column inventory, encrypted-string preservation, generated notebook IDs, fractional usage cost and cascades. The container was removed afterward; no deployed database was migrated. The local pnpm launcher attempted a dependency repair and the Drizzle CLI hit an esbuild version mismatch; migration 0002 was generated through the installed `drizzle-kit/api` instead, without changing dependencies or the lockfile.

Subsequent verification: **18 tests passed, none skipped**, across the conversation, pairing, notification/delivery, schema-parity, backup-audit and tRPC suites against disposable PostgreSQL 17. Notification tests cover concurrent event deduplication, transaction rollback, delivery contention, locked-row skipping, expiry/reclaim, stale acknowledgements, subscription refresh and owner-isolated pagination. Narrow strict TypeScript and development syntax checks passed. There is still no live PostgreSQL cutover.

A fresh on-host consistent SQLite backup passed the real-data audit at `2026-10-01T22:30:22Z`: 38 tables, 4 sessions, 8,576 messages, no foreign-key/ownership mismatches. Its encryption-key copy matched, and auditing did not change database bytes. Saved worker/terminal lease state remains and must be invalidated/reconciled by the future importer. This is not a PostgreSQL import, restore rehearsal or attachment verification. See [recovery-follow-up.md](recovery-follow-up.md) for the private checkpoint location.

### Real-data copy rehearsal, 2026-10-02

The normalized private checkpoint at `/vol/nvme/docker/rue/development/data/operator-backups/postgres-copy-rehearsal-20261002T010756Z` passed a complete PostgreSQL copy rehearsal on Abby: **28,517 rows across 37 application tables**. Every copied row was verified, the transaction rolled back, and the disposable target was empty afterward. The checkpoint's bytes remained unchanged and no SQLite sidecars were created. The encryption-key copy was verified when creating the checkpoint; this was not credential decryption or attachment verification.

The temporary PostgreSQL 17 container used password authentication, only loopback inside the API network namespace, bounded resources, and no published port. It and its temporary database/credential delivery file were removed. Rue's live SQLite store, encryption key, leases and running bots were not switched or reset.

This exercise found and fixed two real issues: WAL-mode backup headers and JSONB-incompatible conversation Unicode. The earlier failed checkpoints were retained, not silently rewritten. All **23** PostgreSQL/schema/backup/tRPC tests subsequently passed with no skips, including the Unicode regression and migration replay. At that point `cutoverReady: false` also reflected unfinished execution reset, identity reseeding and committed restore verification. Those disposable-clone checks subsequently passed below; async API/domain integration and filesystem/attachment verification remain unfinished. A rollback-only copy is not a live cutover or proof of operational recovery.

### Execution-held import and durable restore, 2026-10-02

The same private Abby checkpoint subsequently passed **committed import + disk-backed restore**. All 28,517 source rows were copied and verified, followed by explicit reset audit records. Policy v1 held 3 workers, reset 5 agents' execution/grant metadata, expired 4 terminal connections, revoked 1 runtime delegation, and expired 1 terminal pairing and 1 OAuth login intent. It did not issue credentials or replay commands. The policy refuses unfinished terminal commands, managed operations/compactions, rollouts/updates/purges, OAuth refreshes, push deliveries, or any scheduled tasks; it does not guess how to cancel/recover them.

The operator wrote and fsynced a private PostgreSQL custom-format archive under the checkpoint directory, **dropped the original imported database**, restored into a different disposable database, then compared all application-row fingerprints, the Drizzle migration ledger and identity sequence state. Reapplying the execution hold changed zero rows. Private `held-restore-<nonce>.dump` and `.json` files retain the archive, SHA-256 and value-free verification receipt; temporary PostgreSQL infrastructure was removed. Original SQLite bytes were unchanged and no sidecars were created. The archive contains sensitive encrypted application data and must not enter source uploads or commits.

All **31** PostgreSQL/schema/backup/tRPC checks passed locally, with no skips, including the disk-backed restore and concurrent worker controls. Narrow strict TypeScript and development syntax checks passed. The worker tests also verify that a connection waiting for a row lock cannot acquire a lease after its project proof expires.

A subsequent restore also authenticated **both retained encrypted values** (one legacy provider key and one OAuth credential) using the checkpoint's original key file. The isolated verifier explicitly ignored the live API's environment-key override. No plaintext was logged, returned, persisted, or sent to a provider; SQLite and key-file hashes stayed unchanged. `verify-restored-credentials.ts` uses a read-only snapshot, restricts database identity to disposable clones, checks the encrypted-column inventory, refuses remaining transient grants, and reports only counts. Six credential families, wrong-key/wrong-owner failures and error redaction are covered by fixtures. This proves decryption, not provider validity, token freshness, or production secret delivery. The full combined suite now passes **32 tests, none skipped**, with strict targeted TypeScript and development syntax checks also passing.

**Still no cutover.** The running API remains SQLite-backed and the live workers/bots were not drained or reset. This isolated database restore is not attachment/filesystem restoration, production encryption-key delivery, final authenticated PostgreSQL provisioning, API/socket integration, or a maintenance-window deployment. The final snapshot must be fresh and physically quiescent; the older checkpoint is not a live cutover source.

The PostgreSQL test creates and drops only its own uniquely named temporary database. Point it at a disposable test server, never a production administrator connection. If the variable is absent, the integration test is explicitly skipped rather than reported as a database verification.
