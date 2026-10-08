# Feature readiness and deployment review

**Status: not feature-complete.** Passing the permutation coverage gate or rendering
all four public services does not establish remote-agent or cross-platform readiness.

## Current evidence and gaps

| Capability | Evidence / remaining work |
| --- | --- |
| API CRUD and ownership | Unit tests and isolated local HTTP lifecycle tests. The API fixture uses temporary data/config directories, never the user's database or an already-running server. Dedicated live identities still required. |
| Web bot workspace | Responsive Chromium browser tests; authenticated fixtures are mocked, not live provider execution. |
| SSE reconnect | SDK retry, refreshed credentials, cursor, frame-size bounds, cancellation, and parser tests, plus a real-HTTP two-client disconnected-write/replay test. Web reconciles snapshots on connection. API orders replay/live writes and accepts cross-origin cursors. |
| Durable event/context synchronization | **Missing.** Event history and IDs remain process-local. Reconciliation repairs snapshots; it does not provide durable event delivery or command deduplication. |
| Mobile snapshots | Identity/conversation scope guards, single-flight polling, sign-out cleanup, and a delayed-conversation Expo-web regression. Not native background/resume proof. |
| Pairing | One-time/expiry/ownership tests. Device registration and revocation records do **not** constitute revocable device-bound authorization. |
| Durable storage | Canonical development now binds `/tmp/.local/share/rue` to a private host directory outside the source workspace; the database and encryption key persist across container restart. Full redeployment still requires operator reattachment of that mount; a startup guard rejects tmpfs fallback. Declarative volume lifecycle, backup scheduling, and other environments remain **blocking**. |
| Agent settings / chat | [Account-scoped Pi/OpenAI settings](agent-settings.md), encrypted write-only API keys, model/system prompt controls, owner/CAS isolation and Pi-core streaming tests. Live provider access still needs the user's key. Master key and database require matching protected backups. |
| Agent execution | Pi agent core is wired for text chat, without shell/file tools or resource discovery. A remotely privileged coding-agent runner and approvals remain **missing**. |
| Run lifecycle | Require durable run records, per-session exclusivity, idempotent command acceptance, cancellation, restart reconciliation and bounded tool execution. Process-local active-run limits alone are insufficient. |
| Sandblocks tools | **Missing:** scoped server-side deployment proposals, policy enforcement, approvals, audit, operation reconciliation and rollback. Never give mobile/web clients the control-plane service key. |
| Self-update | **Missing:** signed immutable release evidence, external approval/executor, readiness checks and rollback. An agent must not grant itself update authority or replace its own approval verifier. |
| iOS / Android | OAuth redirects, secure-store failures/rotation, camera, backgrounding, offline/resume and native distribution require simulator/device testing. Expo-web screenshots are not equivalent evidence. |
| Desktop / TUI | Existing shared contracts need execution, reconnect and packaging tests on their actual runtimes. |

## Repeatable live checks

From this repository, using the existing protected `.sandblocks` state records:

```sh
node scripts/deployment/sync-development.mjs --api-url https://api.sandblocks.dev
node scripts/review/check-deployment.mjs development --smoke
node scripts/review/check-deployment.mjs preview --smoke
pnpm exec rune review-development
pnpm exec rune review-preview
```

The runner permits only development and preview, never production. Reports live in
ignored, owner-only `.sandblocks/reports/` files; lease tokens, bearer tokens, pairing
codes and response bodies are not printed. Exit codes: `0` selected smoke checks
passed; `1` a check failed; `2` prerequisites or features remain blocked.
`featureComplete` stays false while the gaps above exist.

Authenticated scenarios require a **dedicated, disposable test identity** through
`RUE_TEST_TOKEN` and explicit `RUE_TEST_ALLOW_MUTATIONS=1`. Supply a second distinct
owner through `RUE_OTHER_TEST_TOKEN` for cross-owner checks. Inject credentials from
an approved secret store, not command-line arguments or committed files. Only
runner-created sessions/devices are cleaned up, including after failures. Run IDs
in their names identify any leftovers if the process is interrupted. Device cleanup
is revocation, not deletion of audit/tombstone records.

These scenarios validate session create/read/update, same-owner access through a
second HTTP client, one-time pairing and cross-owner isolation. They do not yet
validate real model/tool runs, native device behavior or durable replay.

The audit checker fails closed on registry/process/format errors. Two new xmldom
advisories were fixed with compatible patch updates; the existing three uuid/image-size
exceptions (including two high advisories) still expire on 2026-09-30. No new
exceptions or coverage/complexity allowances were added.

## Iteration order

1. Test source, then use `sync-development.mjs`: sync source without premature
   checks, install frozen dependencies, rebuild shared-library `dist` outputs, and
   only then run full service checks and the readiness report. The development
   post-commit hook uses this sequence. Plain source sync alone left the old SDK
   running despite healthy pages; verify the served implementation, not just health.
   The native build operation is operator-only and worker-bound: the CLI's legacy
   exec path rejected this standalone-worker workspace. This workaround is not a
   Rue agent execution adapter and must not expose operator credentials to clients.
2. Fix persistent storage, device-bound authorization and durable command/event state.
3. Add real execution adapters with mock-provider conformance tests and dedicated
   live provider tests. Make permissions, cancellation and restart behavior explicit.
4. Build a new immutable preview candidate. Promoted sandboxes are immutable:
   do not remove that fence or destroy the old workspace to force redeployment.
5. Preview uses direct sandbox URLs only; do not promote preview aliases. Only production builds receive promotion URLs. Retain rollback and storage backup.
6. Add scoped deployment tools and externally approved self-update workflows.
7. Complete native-device and desktop/TUI evidence. Mark missing prerequisites as
   blocked, never silently skipped or replaced with screenshots.

During the current recovery, direct Tailscale source uploads stalled while the
public TLS API accepted the same operation path. Use the verified public API for
that deployment path while investigating the direct transport independently;
no SSH trust or TLS verification bypass is warranted.
