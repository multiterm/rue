# Rue stack review and implementation plan

Status: active remediation plan  
Last reviewed: 2026-08-25

## Executive summary

Rue has a functioning core scaffold, authentication integration, SQLite storage, provider adapters, deployment contract, and surface prototypes. It is not yet a production-ready multisurface agent workspace. The highest risks are authorization isolation, deployment persistence, missing agent capabilities, incomplete clients, and quality checks that currently overstate end-to-end coverage.

## Findings

### Critical

1. **Authentication does not provide tenant isolation.** Keyname claims are verified but discarded, sessions have no owner, REST and tRPC return global sessions, and SSE broadcasts every event. A valid principal can potentially read or mutate other users' data and spend shared provider credentials.
2. **Deployed SQLite persistence is not guaranteed.** Rue writes to the service filesystem, while the Sandblocks contract declares no durable storage or backup/restore lifecycle.

### High

3. **The web application does not run conversations.** Its composer displays a fixed status rather than creating sessions, sending messages, streaming events, or rendering history.
4. **The agent loop ignores tool calls.** Providers parse tool calls, but `runQuery` returns before dispatch and `maxTurns` is effectively unused.
5. **Output-token retries can duplicate responses.** A truncated part is persisted before the same prompt is retried.
6. **Desktop packaging and runtime are incomplete.** The renderer path is not package-safe, no core sidecar is supervised, and the E2E contract does not launch Electron.
7. **Production dependencies contain known advisories.** The audit identified Drizzle identifier injection plus transitive `image-size` and `uuid` issues.
8. **No abuse or workload controls exist.** There are no principal rate limits, concurrent-run limits, body limits, quotas, cancellation endpoints, or queue backpressure.

### Medium

9. The public SDK is incomplete, handwritten, weakly typed, and version-inconsistent.
10. TUI and mobile are onboarding prototypes rather than Rue clients.
11. Passing Playwright tests overstate readiness because several tests inspect static content or source instead of actual runtimes.
12. The approved Solid/OpenTUI architecture conflicts with the active React/TanStack implementation.
13. Handwritten SQL and partial Drizzle schemas can drift.
14. SSE has no event IDs, replay, reconnect cursor, tenant filter, or multi-instance transport.
15. Static services lack production security headers and robust path containment.

## Required capabilities

### Security and data

- Keyname audience and scope enforcement
- Principal/tenant ownership on all persistent entities
- REST, tRPC, and event authorization
- Durable storage, backup, restore, and migration gates
- Rate, body, concurrency, token, and spend limits
- Security headers, audit events, and dependency scanning

### Core agent

- Typed tool registry and permission protocol
- Filesystem, search, shell, verification, and git tools
- Tool result persistence and model continuation
- Cancellation, idempotency, timeout, and run state
- Provider/model discovery and usage accounting
- MCP, memory, notebooks, scopes, schedules, and skills
- Reliable event replay and state reconciliation

### Product surfaces

- Functional session and conversation web UI
- Generated typed SDK used by every surface
- Packaged desktop with a supervised core sidecar
- Real TUI and mobile conversation clients
- Attachments, tool/reasoning cards, Markdown/code/diff rendering
- Search, rename, archive, fork, delete, settings, and command palette

### Operations and quality

- Reserved `develop`, `pre`, and `prod` Sandblocks branches
- HMR development deployments
- Local/Sandblocks-owned quality gates independent of GitHub
- Coverage and CRAP thresholds
- App/theme/viewport/locale permutation contracts
- Runtime Playwright checks against deployed services
- Canary, smoke, rollback, backup-restore, SBOM, and release checks

## Delivery plan

### Phase 0 — Architecture and delivery foundation

- Treat React/TanStack/tRPC as the current implementation baseline unless a separate ADR reverses it.
- Configure reserved Sandblocks branches: `develop` → `develop`, `pre` → `preview`, and `prod` → `production`.
- Add HMR service commands for `develop`.
- Move quality lifecycle gates to local hooks and Sandblocks.
- Keep GitHub optional and non-gating.

### Phase 1 — Security and persistence

- Propagate verified principals through request context.
- Add owner/tenant migrations and scope every data/event path.
- Require production audience/scopes.
- Add durable database path configuration, backup, restore, and migration checks.
- Add request/run limits and resolve production advisories.

### Phase 2 — Core reliability

- Establish one authoritative schema/migration mechanism.
- Add run records, cancellation, idempotency, timeout, and concurrency control.
- Correct truncated response retries.
- Add event IDs, replay, reconnect, and structured errors/telemetry.

### Phase 3 — Agent functionality

- Implement tools and permission gates.
- Enforce scopes in core tool execution.
- Add MCP, memory, notebooks, schedules, and skills incrementally.
- Add deterministic provider and tool integration tests.

### Phase 4 — SDK and web product

- Generate typed API bindings and realtime helpers.
- Build complete session navigation, streaming chat, history, retries, cancellation, tool rendering, settings, and responsive behavior.
- Add true browser workflows with isolated principals and deterministic providers.

### Phase 5 — Desktop, TUI, and mobile

- Package assets and core sidecar correctly for desktop.
- Implement native deep links, tray, shortcut, overlay, and capture.
- Implement real TUI and mobile API clients and token lifecycles.
- Add packaged Electron, PTY, and device E2E tests.

### Phase 6 — Production readiness

- Add vulnerability, license, secret, and SBOM gates.
- Add deployed smoke/canary tests, backups, restore drills, rollback, signing, monitoring, and incident procedures.

## Release gates

A production promotion must require all of the following outside GitHub:

1. Frozen install and Sandblocks manifest validation
2. Formatting, typecheck, unit tests, and build
3. Coverage threshold and CRAP threshold
4. Complete app permutation contract
5. Runtime Playwright checks for every deployed service
6. Dependency audit with an explicit, expiring allowlist
7. Database migration and backup verification
8. Sandblocks deployment health and routed smoke checks
