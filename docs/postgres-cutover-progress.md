# Full cutover continuation — work in progress

The owner requested the complete PostgreSQL transition and cleanup, not stopping at rehearsal milestones. **Latest owner clarification: the application is not live; transition directly without a staged rollout or observation period.** Preserve a recoverable copy of existing data and verify functional integration, but do not require a live-traffic maintenance window. No transition has occurred yet. Do not switch database variables while handlers still require synchronous SQLite.

## Release reconciliation — 2026-10-05

The 55 continuation paths were reconciled into the owning `develop` checkout after checking both checkouts against the saved baseline: no conflicts or intervening canonical changes. The pre-integration source and patch are preserved under ignored `.sandblocks/recovery/commit-integration-20261005T171758Z/`. The cutover worktree and original baseline remain intact.

Local verification passed: all 211 core Vitest tests, the workspace test command, workspace typechecks/builds, 102 quality tests, CRAP, development syntax and the Sandblocks manifest. Fixed stale reload-fixture dependencies and the SQLite migration expectation; the latter now really reopens a temporary database to verify idempotence. Local pnpm commands used `pnpm_config_verify_deps_before_run=warn` to avoid automatically replacing the existing dependency installation; no dependency versions or lockfiles were changed by reconciliation.

The owner subsequently approved dependency remediation. Scoped updates to undici, fast-uri, brace-expansion, xcode's UUID dependency and Metro reduced the production audit from 21 findings to two. Metro was upgraded to its corrected parser instead of forcing an incompatible image-size major version. A frozen install, fresh-namespace workspace typechecks/tests/builds, 107 quality tests (including xcode UUID and Metro asset compatibility), and Expo's mobile web export passed.

Preview remains blocked by **GHSA-86w9-cpqp-85rv** (`node-forge`) and **GHSA-vfj7-8cjw-p6xm** (`braces`). The audit names fixed versions 1.4.1 and 3.0.4 respectively, but both returned HTTP 404 from the public npm registry on 2026-10-05; latest published versions were still 1.4.0 and 3.0.3. No audit exceptions were extended or added. Recheck publication, or separately review upstream backports and their audit treatment; do not label this a clean release. Passing local builds is not preview deployment acceptance. The application remains SQLite-backed; the PostgreSQL handler integration and direct database transition below are still pending.

The owner subsequently approved reviewed backports. Exact-version pnpm patches now apply the Forge nested-DigestAlgorithm check and the braces bounded-depth proposal, with hash-bound installed-code checks, bounded regression tests, and conditional audit treatment expiring 2026-10-19. The raw findings remain visible. Neither proposal is an official fixed release; braces PR 72 was closed unmerged. See [security backports](security-backports.md) for provenance, limitations and removal requirements. This supersedes the dependency-only blocker above, not the outstanding PostgreSQL integration or deployment acceptance checks.

## Isolation and preservation

- Owning repository: `/Volumes/MOTHERSHIP/dev/Projects/multiterm/rue`.
- Implementation branch/worktree: `.worktrees/postgres-cutover`, branch `postgres-cutover`, based on `6758f8ae80f4c61db20f95f1433393579e6b5a00` plus an exact snapshot of the existing dirty working tree.
- Private baseline: canonical `.sandblocks/recovery/cutover-baseline-20261002T161308Z/{manifest.json,tracked.patch,source.tar}`. 987 Git-visible paths were checksum-verified. Preserve this baseline for reviewing/reconciling only continuation changes; do not overwrite subsequent canonical/user work.
- The canonical checkout is live-synchronized. Keep incomplete API/runtime changes in the worktree. Root watcher/syntax checks exclude `.worktrees`; Docker context is allowlisted.
- Dependency overlays are local symlinks, with workspace packages pointing to this worktree. Dependency versions and lockfile were not changed. SDK was built locally with `node_modules/.bin/tsc -p packages/libs/sdk/tsconfig.json`.
- Use `node --conditions=development --import tsx` for worktree tests; `NODE_OPTIONS=--conditions=development` for Vitest. The new DB package exports are source-only until library builds run.

## Implemented in this continuation

- Shared project-authority async contract, SQLite adapter and PostgreSQL repository.
- Server `ProjectAuthority` now awaits the repository, deduplicates refreshes and performs verifier I/O outside transactions. Startup awaits fencing; boot increments binding revisions so pre-boot verification cannot restore authority.
- Shared owner advisory-lock namespace across worker/project/provider stores.
- PostgreSQL provider-key metadata, CAS, grants, removal, leased delegated access and transactional audit. OpenAI's existing settings/encryption scope are preserved. Worker revocation uses the same grant-cleanup helper.
- PostgreSQL OAuth vault: local singleflight, durable cross-process refresh claim/nonce, bounded refresh, no automatic reuse of uncertain rotating tokens, removal fencing and post-refresh authority/grant checks. Refresh secrets are never returned.
- Shared provider/project errors preserve existing API error handling.
- PostgreSQL terminal pairing/activation/authentication/revocation. Single-winner approval/exchange, durable failed-code counters, serialized pending quota, same-owner re-pairing preserves history/IDs while cancelling old work and removing consent. Managed terminal credentials are bounded by worker/project authority.
- Shared terminal errors/types and PostgreSQL managed-authority primitive. Operational database failures are not disguised as invalid transport credentials.

- PostgreSQL terminal-relay repository and transactional conversation-write helpers: queue admission/idempotency/FIFO, leases, transitions, publication/notifications, attachment retrieval, mirror snapshots/receipts and explicit queue recovery. Owner-list views and narrowed queue/recovery DTOs now preserve API projections. Attachment types/quota errors are shared with the SQLite implementation. Broader parity and handler integration remain.
- PostgreSQL managed-compaction repository: owner-scoped request deduplication/limits, worker assignment within worker-authority transactions, runtime claims within socket-authority transactions, single-use nonce acknowledgements, and uncertain-outcome execution holds. Shared worker errors now preserve API `instanceof` handling across engines. Added managed-busy query primitive for compaction and future lifecycle integration.

- PostgreSQL runtime-rollout state machine and delegated host-control repository: owner-scoped request deduplication, snapshot/revision fencing, drain/stop/install/verify/rollback transitions, uncertain outcomes and explicit resolution; grant CAS, atomic preflight cancellation on revocation, and runtime-authorized delegated requests. A runtime cannot adopt a human-created request by guessing its ID. Shared runtime-control errors preserve handler compatibility.

- PostgreSQL managed-agent repository now covers account creation/change/list/operations, worker snapshots, encrypted grants with monotonic boot fencing, reports, single-agent upgrade verification/rollback and consented purge. Stop/resume cannot resurrect old credentials; snapshots/grants clamp their returned authority deadline to the current project proof.
- PostgreSQL MCP repository covers encrypted environment storage, metadata-only listings, canonical idempotency, concurrent quotas, and atomic revocation using the managed lifecycle's same-transaction stop callback. A failed stop rolls back profile deletion, grant changes, configuration changes and operation records together.

- PostgreSQL usage accounting preserves legacy HMAC credential IDs, validates owner/provider/connection attribution, deduplicates concurrent events and reports UTC buckets with fractional costs and unpriced counts. Runtime recording accepts the caller's authority transaction; cloud recording derives its own connection identifier.
- PostgreSQL cloud-history reset uses owner/session locking and last-message CAS, cascades message parts/ratings, preserves usage/session identity, and refuses remote mirrors. Application integration must additionally serialize reset with starting/active cloud runs.
- PostgreSQL push-subscription lifecycle validates through the API's existing endpoint/key validator, encrypts with the original credential scope, serializes endpoint ownership across accounts, enforces device quotas and preserves delivery cancellation/refresh fencing. Dispatcher integration remains pending.

These stores are **not yet a complete PostgreSQL-backed API**. Terminal relay, compaction, runtime control/rollouts, managed lifecycle and MCP need handler integration; supporting stores and remaining handlers still need porting. PostgreSQL terminal pairing is also not wired into live handlers yet.

## Verification so far

- All 48 database/schema/backup/tRPC checks passed against disposable PostgreSQL 17 after the authority/provider/OAuth changes; no skips, including disk-backed restore.
- Six additional terminal-pairing PostgreSQL checks subsequently passed, along with targeted strict TypeScript.
- The focused core run initially had 43 passes and three provider-route failures. The same three failures reproduced in the untouched canonical checkout: outdated tests rejected valid custom provider names and omitted the existing `credentialId` response field. Updated only the worktree tests to assert current custom-provider validation and receipt shape; all 11 provider-route tests then passed. Do not remove these existing product capabilities to satisfy stale tests.
- Earlier focused core project/worker/verifier run: 15 passed.
- The 12-file focused core run had 90 passes and one queue-retention test failure. That failure reproduced in the untouched canonical checkout: the test expected never-started queued prompts to expire, contrary to current retention behavior. Updated the worktree assertion to verify retained IDs remain unclaimed/unstarted; all 11 terminal-relay tests then passed. Re-run the combined suite after further changes.
- Initial PostgreSQL relay suite: six checks passed, zero skips, against a dedicated disposable PostgreSQL 17 container in `colima-rue`. Covered concurrent idempotency/capacity, transactional message counts, FIFO/takeover/lease fencing, binary attachments and immutable mirror receipts. Container was stopped and removed afterward; no live database was used.
- Focused strict relay TypeScript passed with `--types node --customConditions development`; the first invocation without Node types failed because those ambient types were omitted.

## Latest verification after direct-transition instruction

- Full database/schema/backup/tRPC suite: **63 passed, zero skipped**, including disk-backed restore and expanded relay recovery/projection tests. Initial full run used a disposable container name outside the restore test's `rue-pg-*` allowlist; corrected the test invocation, not the safety check, and reran successfully.
- Subsequent new compaction suite: **5 passed, zero skipped** against disposable PostgreSQL 17. Covers concurrent single-winner request/claim, nonce fencing and idempotent acknowledgements, uncertain outcomes blocking prompts, owner isolation, revision changes and runtime takeover.
- PostgreSQL public exports passed focused strict TypeScript with Node types and development conditions.
- Eight focused core files: **76 tests passed**. The initial run exposed a pre-existing test requiring a pinned Codex model catalog; reproduced the failure in the untouched canonical checkout. Updated the worktree test to preserve current runtime-selected model IDs while continuing to reject control characters and require host capability at configuration/bootstrap.
- Latest combined database/schema/backup/tRPC run: **77 passed, zero skipped**, including compaction and nine runtime-control/rollout checks plus disk-backed restore. The runtime suite covers candidate success/rollback, preserved queue intent, uncertain-state resolution, concurrent grant/request deduplication, owner/lease checks, expired approvals and refusal to adopt human-created requests.
- Existing core runtime-control and rollout Node suites: **13 passed**. PostgreSQL public exports passed focused strict TypeScript.
- Dedicated test containers were stopped/removed. No application database or deployment was switched. The subsequent managed-agent/MCP implementation is exported and tested but not wired into application handlers. Latest full database/schema/backup/tRPC run: **89 passed, zero skipped**, including twelve managed/MCP checks and disk-backed restore. Focused strict TypeScript of all PostgreSQL public exports also passed. Tests exercise concurrent creation/grants/revision conflicts, boot rotation, stop/resume, shortened project deadlines, upgrade rollback, authorized purge, metadata secrecy, MCP quota and rollback of partially applied revocations. No application data/deployment was switched.

## Latest supporting-store verification

- Full database/schema/backup/tRPC suite: **100 passed, zero skipped**, including disk-backed restore. Added coverage for usage identifier compatibility, concurrent deduplication, UTC/null/fractional pricing, attribution failures, caller-transaction rollback, history CAS/cascades/remote refusal, endpoint enrollment races, device quotas and stale push acknowledgements after refresh.
- PostgreSQL public exports passed focused strict TypeScript. Core history storage/HTTP regressions: **3 passed**.
- Disposable test infrastructure was removed. No application database or deployment was switched. Remaining work includes conversation/settings operations, inventory of any other active persistence paths, full application/dispatcher integration and the direct transition.

## Standing product direction — not an active milestone

The owner clarified that open-platform support is a design direction, not a separate delivery agenda. **All new features require API / CLI / SDK / dashboard parity** and flexibility for open-source, self-hosted deployments in other environments. Shared services/contracts must preserve equivalent authorization, consent, revisions and behavior across all four surfaces. Avoid hard-coded infrastructure identities or deployment assumptions. See [open-platform design direction](open-platform-roadmap.md). The SSH/config-upload requirements remain design reference material, not an automatically scheduled post-migration project or implemented capability.

## Remaining execution plan

1. Finish remaining stores, especially terminal relay/queue and managed execution; preserve atomic state/history/notification updates and owner/lease fencing.
2. Replace synchronous API/socket paths with the unified async backend. No mixed PostgreSQL/SQLite primary mode and no blocking network shim.
3. Complete filesystem/attachment inventory, provision environment-separated PostgreSQL roles/network/secrets on Abby, preserve original encryption/VAPID keys, and stage one API replica.
4. Reconcile reviewed worktree changes into the owning checkout without replacing unrelated user work. Verify full build and end-to-end protocols before deployment.
5. Stop existing app/background processes for a consistent **fresh** backup, import existing data with obsolete execution authority reset, switch directly to PostgreSQL, and verify data/credentials/files and application behavior. No staged rollout or observation period is required.
6. Remove obsolete compatibility/cutover paths after functional and recovery checks pass. Keep permanent migrations, backup/restore verification, and the recoverable source backup. Do not fall back to old SQLite after PostgreSQL accepts writes without reconciling new data.
Apply `open-platform-roadmap.md` throughout these steps: API/CLI/SDK/dashboard parity and self-hosting flexibility are cross-cutting design requirements, not an additional queued milestone.

The older private Abby checkpoint already passed held import, original-clone deletion, disk-backed restore, sequence/row fingerprints and original-key decryption of its two retained encrypted credentials. It is historical evidence, not the final cutover snapshot. Canonical documentation has those receipts and remaining infrastructure/account-authority constraints.
