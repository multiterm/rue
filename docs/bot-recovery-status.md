# Rue bot recovery status — 2026-10-01

## Recovered — verified around 19:14 UTC

The user confirmed the missing bots were on the Sandblocks **development** deployment. The development API now returns HTTP 200 and its container is healthy. **Mason, Honeycluster and Keyname are running**, each observed at the current manager generation (25), with valid terminal leases and fresh heartbeats. The manager is connected and accepting work. Browser/account visibility still needs the user's normal signed-in confirmation; no account session was manufactured.

### Causes and recovery

1. The stopped API could not boot after restart because `packages/apps/core/src/cli/control.ts` was missing the command object's closing `})` after `agent-operations`. The same parser failure was reproduced locally. The one-line fix passed all five CLI tests.
2. The app-restart shortcut returned HTTP 409 despite the owning worker being online. Its source looks up legacy deployment/host information. The worker's private deployment record and container mount were verified independently. A durable `workspace.service.restart` operation pinned to the existing worker with `requiredWorkerRole: development` restored the existing container; no replacement deployment was used.
3. The manager reconnected but could not start agents because its dedicated 20-GiB Colima disk had only 712,572 KiB available, below the 1-GiB admission threshold. Restarting the manager alone did not solve that. The stopped VM's data/root disks were cloned into a private backup, then **only `colima-rue`** was expanded to 40 GiB. Available disk became 20,513,292 KiB. No images, histories or named volumes were pruned.
4. The manager reconciled the three existing logical bots into new-generation runtime containers. Bot/session IDs, runtime image policy, enrollment and named volumes were retained. Recovery submitted no prompts and did not re-enroll the manager.

### Preservation and verification

- Consistent SQLite/key backup: `/vol/nvme/docker/rue/development/backups/api-recovery-1790880027`; backup `integrity_check` passed and key-copy bytes matched.
- Stopped-VM backups and preservation receipts: `~/.local/state/rue/disk-recovery-20261001T191026Z/`. Contains private data; never upload or commit it. Retain pending an agreed backup retention policy.
- API container ID, image, configuration hash, mounts, published ports and encryption-key hash matched before/after recovery.
- Before restarting the manager after disk expansion, Docker engine ID, image IDs, container IDs and volume names matched; enrollment and runtime-policy checksums matched. Default Docker context remained `abby`; Rue's boundary check passed. Normal reconciliation subsequently replaced only the stopped agent runtime containers.
- Final database inventory: 4 sessions, 8,576 messages, 5 managed-agent records, 3 workers; zero foreign-key violations. No ownership rewrite occurred.
- Local CLI regression tests: 5 passed. The remote source patch was checksum-guarded and its deployed SHA-256 matched the tested local file. Its following Node/tsx test step failed because that workspace's `node` resolves to Bun, which could not load `./cjs/index.cjs`; this was not claimed as a passing remote test.

### Sandblocks operation receipts

- `23298261-6c02-49f7-ac4b-9d1af6cfcb28`: remained queued without the development role; explicitly cancelled and confirmed before replacing its intent.
- `6a177f2a-99a5-4f3e-b1bd-14dc1a8f9b1a`: initial existing-container restart succeeded, exposing the syntax error. The legacy worker reported `healthy: true` without a real health check because its old deployment record lacks port/health metadata; public HTTP and Docker health remained failing. Do not use that operation flag alone as readiness evidence.
- `35fe0bbe-18b2-4ce2-adf0-087cdb581648`: guarded source correction applied; operation failed on the subsequent remote test-tool mismatch. File checksum was reconciled before proceeding.
- `d855686c-6a31-478e-b108-f87653a7545f`: restart after the syntax correction succeeded; public HTTP 200, Docker health and fresh bot leases were then verified separately.

Follow-ups: improve Sandblocks restart placement/legacy health verification and expose disk-admission diagnostics in Rue. PostgreSQL cutover and dedicated fleet-wide infrastructure-bot authorization remain separate unfinished work.

## Initial observations (before recovery)

Read-only inspection used the existing controller identity, strict host-key checking and Abby's documented SSH port 2220. No SSH grants, user ownership, deployment databases or container configuration were changed.

- Development API: `sandblocks-multiterm-rue-96dec235-api`, stopped with exit 0, not OOM-killed; finished at `2026-09-30T17:26:57.431932973Z`.
- Development API health (`https://3668e4ec-138a8a71.sandblocks.dev/health`): HTTP 502. Development webapp (`https://3668e4ec-b31185d9.sandblocks.dev`): HTTP 200.
- The existing API mount remains `/vol/nvme/docker/rue/development/data` → `/tmp/.local/share/rue`. The database remains present (~49.6 MB main file; this is not a backup or a count of WAL contents).
- A read-only SQLite transaction found 38 tables, 4 sessions, 8,575 messages, 5 managed-agent records and 3 worker records. Three non-purged bots remain: **Mason, Honeycluster and Keyname**. The other two agents/workers are revoked/purged test canaries.
- All three retained bots and their sessions have matching owner subjects. SQLite `quick_check` passed, `foreign_key_check` returned zero violations, and no agent/session owner mismatches were found. This does **not** verify the subject's mapping to `r@honeycluster.io`; that still requires normal verified identity.
- In the dedicated local `colima-rue` context, the manager is running but all three agent containers are exited (75). Persisted API observations saying “running” are stale, not live readiness evidence.
- Preview and production have independent mounts and older 12-table schemas. Production has no sessions; preview has one. Do not “recover” development ownership by copying its data into another environment.

The stopped API is a confirmed availability failure. The inspected database does not show deletion of the three retained bots. The cause of the API stop and the account/browser environment the user was using remain unverified.

## Initial recovery attempt (superseded by successful recovery above)

A development-only Sandblocks restart was requested for deployment `96dec235-076a-413a-be21-b8bc1a91ff3a`, stack `rue`, app `api`, using the stable idempotency key `rue-api-recovery-96dec235-2026-10-01`. The route returned HTTP 409, **“deployment worker is unavailable”**, before returning an operation ID. This is a control-plane lookup/availability blocker, not proof that Abby is offline. The current sandbox routing still names this deployment and stack.

At this initial stage no raw Docker API restart, replacement deployment, ownership rewrite or bot recreation had been performed. Recovery was subsequently completed as described above.

### Initial recovery actions (completed except signed-in account confirmation)

1. In Sandblocks, reconcile this existing development deployment's owning worker/operation metadata and availability. Preserve its exact private data mount and matching encryption key; do not deploy a fresh empty API as a shortcut.
2. Retry the scoped managed restart only after resolving the 409. Confirm API health, database inventory and a fresh manager heartbeat. Reconcile pending/uncertain work before resuming bots; never blindly replay old commands.
3. Sign in normally as `r@honeycluster.io` on the development webapp and verify its stable subject and owned bot listing. If the missing-bot report concerns another URL/environment, inspect that environment separately.
4. Preserve the bot IDs, histories, grants, worker enrollment and private agent volumes. Do not re-enroll the manager to fix API availability.

## PostgreSQL continuation

See [postgres-migration.md](postgres-migration.md). The schema generator, additive domain migration and regression checks now cover all 37 application tables, including the six tables absent from the earlier generated schema. Six tests passed against disposable PostgreSQL 17 plus the actual tRPC HTTP boundary. Narrow strict TypeScript checks passed.

This is schema groundwork only. Async repositories/API integration, a consistent-backup importer, lease reconciliation, filesystem-state preservation, backup/restore rehearsal and an approved deployment window remain required. No live PostgreSQL service or cutover was performed.

## Infrastructure bot continuation

The latest request expands the intended target from Abby/Stratus to the whole fleet. This is not an implemented fleet-access grant. The API and existing bot runtimes are now recovered; next verify the signed-in owner before provisioning. Do not create a duplicate operator or assume Honeycluster already has administrative access.

The existing controller identity can inspect Abby from this native session; prior notes about inaccessible Mason SSH files describe the earlier managed container, not this session. This identity must not be copied into a bot. The previous pending bot-specific key has not been re-enrolled or assumed available.

Build the fleet allowlist from provisioning inventory, verify each host's trust/SSH endpoint, and bind dedicated bot authorization to the verified owner, bot, worker, account, privileges and expiry. Stage read-only checks before maintenance. The existing bootstrap helper deliberately covers only Abby and Stratus; it is not a fleet-wide credential broker or UI approval path. Six bootstrap tests passed here; four Linux-only filesystem tests were skipped on macOS. No new SSH access was installed.
