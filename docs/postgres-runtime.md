# PostgreSQL runtime and direct cutover

## Status

The asynchronous API, OAuth login state machine, push dispatcher, worker/terminal sockets and PostgreSQL startup are implemented and locally verified. **This is not yet a completed deployment cutover. Existing Rue APIs still use SQLite.**

A dedicated PostgreSQL 17 service, `rue-postgres17`, is now healthy on Abby. It has no published host port, uses the application Docker network, and persists independently at `/vol/nvme/docker/rue/postgres/data`. The pinned image is `postgres@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193`. Separate, initially empty `rue_development`, `rue_preview` and `rue_production` databases and runtime/migration/backup roles have been provisioned. Runtime DDL denial and cross-environment connection denial were verified. Private administrator/role credentials are under the sibling `secrets/` directory, not in source or application images. No application data has been imported yet.

The declarative service is in `deploy/postgres/compose.yml`. Provide its explicit image/network/data/password-file variables. Do not delete its data directory or regenerate the administrator/role credentials on retry. `provision-roles.mjs` refuses existing Rue roles/databases; it is a one-time operator initialization step, not an API entrypoint. For a remote operator container, feed the script on stdin to Node with the DB package as working directory so its `postgres` dependency resolves; mount `/operator-secrets` read-only. Public service deployments remain owned by Sandblocks, not manually recreated Docker containers.

## Single-backend startup

Set **API-only** configuration together:

- `RUE_STORAGE_BACKEND=postgres`
- `RUE_DATABASE_URL`: the environment's least-privilege runtime connection URL
- `RUE_SETTINGS_ENCRYPTION_KEY`: the original 32-byte SQLite settings key, base64 encoded; alternatively `RUE_SETTINGS_ENCRYPTION_KEY_FILE` points to an absolute, private, service-owned raw 32-byte file

Never generate a replacement settings key while migrating ciphertext. Preserve VAPID keys unchanged as well. The API-only encrypted-runtime bootstrap accepts the complete PostgreSQL tuple above, rejects partial/conflicting values, and continues stripping deployment bootstrap credentials before starting the API. Sandblocks API-scoped deployment secrets can also supply the tuple without exposing it to frontend builds.

PostgreSQL startup does not open SQLite or run migrations. It validates all mapped columns, acquires the per-database single-core coordinator, and installs only PostgreSQL services. Missing credentials/schema, another coordinator, or a failed database connection fail closed. A lost coordinator stops admission and shuts down the listener/pool; this is not an HA or multi-replica design. `/health` includes `storage: "postgres"` for an owned PostgreSQL context. Pools are closed on failed binds and normal shutdown.

The temporary SQLite compatibility default remains for existing installations until explicitly switched. A PostgreSQL URL with a SQLite/unspecified backend is rejected. The SQLite opener itself refuses PostgreSQL configuration, including legacy CLI utilities, so there is no silent fallback. `rue db info` reports PostgreSQL database/role metadata; `rue db migrate-postgres` is an explicit operator-role command and refuses a running coordinator. Use `pg_dump --format=custom` with the separate backup role rather than `rue db backup` in PostgreSQL mode.

After migration, the development launcher no longer requires a SQLite mount when PostgreSQL and the original key are explicitly configured. This does not authorize deleting source backups or unrelated worker filesystem volumes. The inspected development API data directory contained only SQLite files, its key and operator backups; conversation attachments are stored in `parts`. Worker filesystem state remains separate and must be preserved.

## Remaining direct-transition procedure

1. Reconcile the implementation worktree into the owning checkout using the recorded async-integration baseline; preserve newer security/build work. Pause the existing development source watcher before changing the canonical tree. Do not deploy the stale worktree dependency lockfile.
2. Verify the managed environment/revision mapping and every SQLite writer. Currently the active durable writers are development `96dec235`, preview `e724acaa` and production `cb80b165`. Older preview API containers `92328e81` and `e44a0e33` also exist without durable data mounts; archive their data before retiring them. Do not assume stopping one API stops every SQLite database. A newer preview candidate also exists; reconcile pending deployment operations so it cannot restart a SQLite writer during cutover.
3. Prepare migration-role schemas and backup-role access, and stage the API-only original keys/URLs without restarting an incompletely configured API. Stop the relevant API/background/worker writers and verify they remain stopped. Preserve worker volumes and workspaces.
4. Create **fresh** consistent, private SQLite backups and original-key copies. Normalize new backup destinations to DELETE journal mode. Audit schema/foreign keys/ownership and record independent SHA-256 values. Keep earlier checkpoints intact.
5. `importCutoverBackup` is the separate operator entrypoint in `packages/libs/db/scripts/rehearse-sqlite-backup.ts`. It requires the exact `rue_*` target identity, recorded source hash, stopped-writer acknowledgement and execution-hold acknowledgement. It refuses a running coordinator, nonempty/mismatched targets, stale/changed source bytes and unresolved work. It copies/verifies every row and serialized JSON value, applies the existing conservative execution hold and reseeds identities transactionally. Its receipt deliberately still says `cutoverReady: false`: source/writer checks, credential/file recovery and deployment acceptance are separate operator responsibilities. The older rehearsal entrypoints retain their disposable-name restrictions.
6. Verify a private disk-backed PostgreSQL dump/restore, row/sequence fingerprints, attachments and original-key decryption before starting the replacement API. Grant the backup role read access to the Drizzle migration ledger as well as application tables; runtime roles must not gain DDL privileges.
7. Start one API per environment through Sandblocks with the complete PostgreSQL configuration. Verify health backend, authenticated ownership/protocols, and that no SQLite writer restarted. Preserve source snapshots and all worker filesystem state. Execution remains held until explicitly reconciled; do not replay uncertain commands or automatically revive old leases.
8. Only retire obsolete primary-storage paths after acceptance. Once PostgreSQL has accepted new application writes, never return to the old SQLite snapshot without reconciling those writes.

## Verification

- Combined PostgreSQL/schema/backup/typed-client/HTTP/WebSocket suites: 150 passed, zero skipped before the new production-import gate; its expanded rehearsal/restore suite subsequently passed all 7 tests.
- Core Vitest: 213 passed.
- API secret bootstrap: 7 passed; development storage guard: 2 passed.
- DB, tRPC and core TypeScript builds passed.
- Real startup tests cover HTTP persistence, refusal of SQLite/mixed configuration, duplicate coordinators, bind-failure cleanup and coordinator-loss shutdown.

Operator note: an unscoped `/v1/sandboxes/:id` probe returned 401; that was the wrong route, not evidence of an expired credential. Current Sandblocks CLI `whoami` and sandbox status succeeded. Use project-scoped API routes and filter status output rather than dumping private local state/manifests. The locally installed CLI runs with Bun; invoking its current bundle with Node fails before authentication.
