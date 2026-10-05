# Recovery follow-up — 2026-10-01

The owner confirmed all three bots are visible again and authorized reliability, PostgreSQL and infrastructure-bot work. Existing bot IDs, data and access boundaries remain unchanged.

## Reliability safeguards

- **Active local guard:** both Rue development-sync entry points parse runtime JS/TS before upload. The watcher was restarted and completed a guarded synchronization. This catches the CLI missing-delimiter outage without executing code; it does not replace typechecks or make a live source upload atomic.
- **Source ready, manager rollout pending:** worker admission now uses one shared disk/memory probe for decisions and diagnostics. Reports expose available disk, its 1-GiB threshold and bounded reason codes; no paths or credentials. The webapp displays low-disk/memory warnings. New managers send telemetry only when the API advertises `resourceHealthVersion: 1`, preserving compatibility with old strict APIs. Existing managers need a reviewed build/drain/restart to emit this telemetry; no manager/image rollout was performed in this follow-up.
- **Sandblocks source ready, platform release pending:** app restart/disable resolves only successful, project/stack-scoped deployment records, supports direct worker identities, and preserves the original worker role. It does not guess an owner if deployment history has been renamed or removed. Legacy records without HTTP metadata must pass the actual Docker healthcheck; missing/unhealthy checks cannot return `healthy: true`. API/worker changes have not been deployed to Sandblocks.

Tests: Rue syntax/sync tests, resource admission/schema tests, five CLI tests, and Sandblocks restart/workspace tests passed. Sandblocks' live Docker-workspace test and four Linux-only SSH-bootstrap filesystem fixtures were skipped on macOS. Narrow TypeScript checks passed using the current SDK source (installed declaration files were stale). The focused Vitest sync tests passed with coverage disabled; their first isolated run failed the unrelated whole-suite coverage threshold, not assertions.

## PostgreSQL progress — no cutover

The device/pairing/preferences repository is now async PostgreSQL code with tenant filtering, one-winner pairing claims, and atomic preference version updates. Real PostgreSQL 17 integration tests exercised concurrent claims, competing create/update operations, unconditional version increments, expiry and owner isolation.

The backup-audit command checks a standalone private SQLite backup, inventory, integrity, relationships and execution-state counts without returning data contents. Fixture tests verify no database-byte changes, stale-schema rejection, privacy and foreign-key failures. It has now also passed against a fresh on-host backup (details below). It is not an importer and does not prove PostgreSQL restore or attachment recovery.

Seven PostgreSQL/schema/tRPC checks passed against disposable local PostgreSQL 17; five backup-audit fixtures passed. The temporary server/database were removed. No live database URL or storage mount changed.

### Notification/delivery continuation and real-data checkpoint

`packages/libs/db/src/postgres/notifications.ts` adds atomic task-notification/fanout recording, owner-filtered inbox pagination/read state, nonblocking PostgreSQL delivery claims, and lease-fenced acknowledgements. The recording helper accepts the caller's completion transaction so task state and notifications can roll back together. Network sending is deliberately outside the database transaction. It remains at-least-once: expired/uncertain sends may be retried. Subscription encryption/lifecycle, retry/retirement policy and API/dispatcher wiring still need porting; no active dispatcher was switched to PostgreSQL.

18 combined PostgreSQL/schema/backup/tRPC tests passed with no skips on a disposable local PostgreSQL 17 server. Strict TypeScript and development-source syntax checks passed. The test container and its test databases were removed; no real push messages were sent.

A consistent SQLite/key checkpoint was created privately on Abby:

`/vol/nvme/docker/rue/development/data/operator-backups/postgres-preflight-20261001T223022Z`

The directory contains `rue.db`, `rue.db.agent-key` and a value-free `audit.json`, under private permissions. The audited source/schema checksums matched the reviewed local code. The audit ran as the authorized operator against this copy, never against the live database file. All 38 table/column and migration inventories matched; integrity passed, foreign-key and bot/session/worker ownership mismatches were zero. Counts: 4 sessions, 8,576 messages, 5 managed-agent records (including purged canaries), 3 workers. Database bytes were unchanged by the audit and the copied encryption-key bytes matched the source.

Execution preflight found one worker and four terminal records retaining lease/instance fields (not a claim that all four leases are live). No pending terminal commands, pending managed operations, active compactions, unfinished rollouts, refreshing OAuth credentials or sending push deliveries were present in this snapshot. The report correctly remains `cutoverReady: false`: stored execution authority must not survive import unchanged. The application stayed online; this is not the final drained snapshot or a restore rehearsal. Keep the private backup out of source uploads and commits.

Remaining at that checkpoint: other async repositories and API/socket integration, import-state reconciliation, filesystem/attachment preservation, PostgreSQL provisioning, restore verification and maintenance-window cutover. The subsequent isolated reset/restore milestone is recorded below; live cutover remains blocked. Do not introduce a split database by wiring just the new repository into the running API.

### Subsequent execution reset, durable restore and worker-store checks

The normalized checkpoint at `/vol/nvme/docker/rue/development/data/operator-backups/postgres-copy-rehearsal-20261002T010756Z` passed both rollback-only copy verification and a subsequent committed, execution-held import. All 37 application tables / 28,517 source rows were preserved. Policy v1 reset cloned worker/agent/terminal authority and transient approvals, preserved saved credentials/history, and refused unresolved work rather than replaying it.

A private custom-format PostgreSQL archive was fsynced under that checkpoint directory. The original imported database was dropped **before** restoration into another disposable database. All row fingerprints, migration history and identity sequence state matched; reapplying the hold changed zero rows. `held-restore-<nonce>.dump` and `.json` retain the private archive and verification receipt. Temporary database infrastructure was removed; live SQLite and running bots were untouched. See [postgres-migration.md](postgres-migration.md) for limitations and the remaining cutover gates.

The async worker repository now has concurrent enrollment/quota/CAS/lease tests, owner isolation, secret rotation/revocation with grant removal, and project-expiry fencing after row-lock waits. It is **not** wired into the SQLite API. All 31 combined PostgreSQL/schema/backup/tRPC checks passed without skips, plus narrow strict TypeScript and development syntax checks. The stored-project-proof check is not a port of live Tenancy proof verification or the socket/runtime handlers.

A further restore verified that both retained encrypted values decrypt with the checkpoint's original key (one legacy provider key and one OAuth credential). No plaintext was exposed or provider request made; database/key bytes were unchanged. New read-only verification tests cover all six persistent credential families, wrong keys, owner-bound authenticated data, and sanitized failures. The seven focused worker/credential tests passed, followed by all 32 combined PostgreSQL/schema/backup/tRPC checks with no skips. Strict targeted TypeScript and development syntax checks also passed. Production secret delivery and provider-token validity are separate, still-unverified gates.

## Fleet and infrastructure bot

Run:

```sh
node scripts/deployment/inventory-infrastructure-fleet.mjs \
  --provision-dir ../../WRLD/honeycluster/provision
```

The local inventory resolved **21** host records with explicit SSH endpoints/users. All 21 have existing entries in the controller's trusted-host file. This proves neither network reachability nor current authorization. Active inventory membership and desired privileges need review before a fleet grant. Templates, inherited/missing values, duplicates, symlinks, revoked keys and nested checkouts are not silently trusted. The tool makes no SSH connections, reads no private keys and changes no hosts.

**No infrastructure bot or new fleet grants were created.** This operator session has the Sandblocks project credential and controller SSH access, but no configured Rue owner control-token file. Neither is a substitute for an authenticated Rue account credential.

Next account step: issue a short-lived self-owned Rue/Tenancy control key through the normal API Keys flow, stored mode 0600 outside agent workspaces. Inspection needs `rue:hosts:read` and `rue:agents:read`. Provisioning currently also needs `rue:agents:write` and `rue:agents:execute` because the create API starts the bot. Provide only the private file path, never its value. Verify the returned stable subject and owned host/readiness before any idempotent provisioning request; do not mint sessions in an identity database or reuse a worker transport secret as account authority.

Then provision exactly one dedicated operator with a persisted request ID and explicit model authorization. Fleet access still requires the owner/bot/worker-bound approval and credential-delivery/revocation implementation; the existing SSH helper only enrolls Abby/Stratus. Do not extend its two-host bootstrap by copying the controller key or mounting its SSH agent into a bot. Review host accounts and privilege levels (Docker/unrestricted sudo is root), trusted pins, expiry and audit before enrollment. Begin with read-only checks.
