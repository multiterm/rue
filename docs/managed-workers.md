# Managed hosts and agents

Status: incremental implementation. **Worker 0.2.0, dashboard lifecycle, recovery, explicit purge and stdio MCP are running in development on Mason.** Explicit MOTHERSHIP directory grants are enabled in development with native inode verification and protected administrative-cache masking; see [workspace permissions](workspace-permissions.md). Production rollout remains separate. [Generic Tenancy API keys](project-authorization.md) replace the retired project-binding APIs; live verifier provisioning and cross-service acceptance remain separate work. No provider inference is claimed.

## Implemented milestone: worker 0.1.0

- `packages/apps/worker`: Node CLI and standalone Bun-compiled binary, private bootstrap/saved credentials, read-only Docker diagnostics, sanitized local status, bounded reconnect and lease watchdogs.
- `deploy/worker`: buildable Linux image, narrowly scoped build context, root Compose service with Docker socket, kernel-held lock, persistent private state and resource/log limits.
- Core migration 9: enrolled workers and audit records. Keyname-owner APIs support create/list/drain/activate/revoke/rotate with revision checks and non-duplicating enrollment retries.
- Separate first-frame-authenticated worker WSS protocol behind `RUE_MANAGED_WORKERS=true`; the shared upgrade dispatcher preserves the existing terminal socket. A competing instance cannot take over a valid lease.
- SDK worker types/methods and Settings → Hosts, with explicit root-access consent and ephemeral one-time secret display. SSE updates and a one-shot expiry reconciliation avoid per-second status rendering.
- Rotation is currently immediate and fences existing authority, not the planned overlap mechanism. Native installs need supervisor/locking configuration; Compose supplies these.

Worker 0.1 advertises **only `host-health-v1`**, with `acceptingWork: false`. Worker 0.2 adds the pinned-image reconciler; configured runtimes advertise managed execution, purge and, when supported by the image, MCP capabilities. No automatic updater is enabled. Filesystem-capable images and operator opt-in enable explicit approved-root directory grants. Drain does not stop unrelated interactive Pi processes. See [installation instructions](../deploy/worker/README.md).

Validation for this milestone: 120 core tests (including real local worker-client sockets), 11 worker tests, 13 SDK tests, 34 manual-bridge regressions, and 122 desktop/mobile browser tests passed. Core/worker/webapp/SDK/database typechecks passed. The native executable compiled and its CLI ran. The Linux image built and ran `--version` on the configured Docker engine **Abby**, not Mason; that smoke test used no network or host bind mounts. Compose configuration was validated with non-secret placeholders using the installed `docker-compose` executable. This is not a live authenticated Compose/Pi or Mason deployment test. Worker APIs remain explicitly feature-gated; no live deployment configuration was enabled by this milestone.

## Settings and credential-broker follow-up

Settings now lists host connection status and managed-agent count (zero for worker 0.1). Migration 10 adds encrypted provider keys and explicit host/terminal grants with live-lease-fenced delivery. Enrollment does not grant keys. Manual Pi Bridge API 8 now [consumes explicit grants](provider-key-loading.md) without persisting keys. The deployed worker can run managed agents. Their runtime resolves explicit provider grants on its own terminal identity; actual provider inference remains untested without an approved key. See [settings implementation](./settings.md).

## Managed runtime (development enabled)

Migrations 11–13 add owner-scoped agents, stable history, durable operations, revision/generation/boot fencing and separately authorized purge. Stop/resume cannot revive an old grant; reload drains accepted work. Destroy retains history and private volumes; purge removes only validated owned volumes and then cloud history, retaining an audit tombstone. Configuration changes stop the agent and require fresh execution consent. Core requires both managed-worker and `RUE_MANAGED_AGENTS=true` enablement; development is enabled, production unchanged. SDK/dashboard controls and the serialized worker reconciler are implemented. Migrations 14–15 add encrypted, explicitly selected [MCP connections](mcp.md).

The preview `packages/apps/agent-runtime` uses Pi SDK 0.85.1 and the existing typed relay, with persistent Pi history from the first user message, in-memory provider-key resolution, and no automatic extension discovery or ambiguous prompt replay. A separate root guardian validates current worker and relay authority, with one bounded bootstrap window; the Pi/tools process runs as UID 1000. Bootstrap control state is per-agent, root-only, and never the supervisor's private volume. The image must be launched with the documented capability restrictions; its default entry point alone is not a security policy.

Authenticated disposable Mason canaries verified startup, reload, abrupt runtime recovery, stop/resume, supervisor restart, retained workspace/history, destroy and explicit purge. A separate MCP canary verified synthetic-credential delivery, UID-1000 tool execution, frozen-Pi guardian fencing/recovery, revocation and bootstrap scrubbing. Disposable hosts were revoked and resources cleaned up. Mason is online at generation 3 with pinned images, unchanged enrollment and zero managed agents; active Docker context remains Abby. Unit/HTTP, actual SDK and mocked desktop/mobile checks are separate evidence. **No provider inference, physical-device behavior or complete failure matrix is claimed.** See [runtime details](../packages/apps/agent-runtime/README.md).

The rest of this document describes the target design and remaining acceptance gates, not completed capabilities.

## Goal

Install one `rue-worker` daemon on Mason, normally through Docker Compose. Enroll it once with Rue, then create, stop, resume, reload, and destroy managed Pi agents from the dashboard. The daemon owns process/container recovery and connection maintenance. Existing interactive `/rue` pairing remains supported, with its current consent and sharing rules unchanged.

The dashboard calls the resource a **Host**. Internally it is one enrolled **worker**, not a machine record plus a separately credentialed worker record. One worker manages many agents; an existing Rue "remote computer" is currently a single Pi session and must not be repurposed as the host identity.

## Sandblocks review

Reviewed in the sibling Sandblocks repository:

- `docs/adrs/0006-worker-first-control-plane.md`: current accepted design; supersedes the older host-agent model.
- `deploy/worker/{README.md,docker-compose.yml}`: daemon/Compose packaging, direct enrollment, Docker socket, persistent worker state, resource limits, approved-update supervisor.
- `packages/apps/worker/src/{bin,grpc-worker,worker}.ts`: outbound control stream, reconnect backoff, configuration revisions, resource admission, operation execution and renewal.
- `packages/apps/api-server/src/sandblocks/worker-grpc.ts`: stream authentication, session fencing, task offers, lease renewal, results, cleanup.
- Earlier runtime-stabilization and worker-role-separation documents provide incident context, but their separate-host model is not the current architecture.

Reuse the architectural patterns, not Sandblocks' build/deployment domain or its legacy polling implementation. In particular:

1. Durable desired state, rather than a stream of unrecoverable shell commands.
2. A narrowly scoped, individually revocable credential per worker.
3. Fenced sessions, idempotent operations, leases, and reconciliation after restart.
4. Local resource ceilings that remote configuration cannot weaken.
5. A supervisor boundary for updating the worker itself.

Rue should keep its existing HTTPS/WebSocket ingress and browser SSE rather than introducing gRPC just for workers. Sandblocks' cross-replica PostgreSQL coordination is not present in Rue: initial support remains single-core-instance, with SQLite-backed durable state. Do not imply horizontal HA from an in-memory socket registry.

## Deployment and privilege boundary

```text
Rue dashboard -- Keyname --> Rue core
                               ^
                               | outbound authenticated WSS
                               |
                     rue-worker on Mason
                       | local Docker API
                       +-- managed Pi container A -- agent-scoped WSS --> Rue
                       +-- managed Pi container B -- agent-scoped WSS --> Rue
                       +-- managed Pi container C -- agent-scoped WSS --> Rue
```

The supervisor container runs as root and controls Mason's Docker engine. Docker socket access is effectively host-administrator access, even with `no-new-privileges`; describe it accordingly, not as a sandbox.

Each agent uses a **separate sibling container**, with its own persistent Pi state and explicitly assigned filesystem mounts. The preview guardian runs as root but launches Pi/tools as UID 1000, so tools cannot suspend the authority watchdog. Agent containers do not receive the Docker socket, worker credential, supervisor state, host PID namespace, or privileged mode. Assigned filesystem permissions must be verified for the tools UID; no host ownership changes are implicit.

Do not put all agents in the root supervisor container: then any coding tool could read the supervisor's credential and manage every other agent. Separate containers reduce that exposure, but shared writable mounts still permit agents to affect each other's data. These are trusted owner-controlled coding agents, not a hostile multi-tenant execution service.

### Filesystems

- Named persistent volumes hold each agent's Pi session, outbox, and private runtime state.
- The implemented filesystem policy accepts bounded literal directories under the operator-approved MOTHERSHIP root, with read-only/read-write access. Legacy `mounts` aliases remain unsupported.
- Dashboard requests cannot choose arbitrary roots, Docker options or mount propagation. Sources are descriptor-pinned and verified before Pi starts; administrative cache assets are always excluded.
- Mounting an alias exposes that entire root to the agent, not just its selected working directory. Make this visible in the create-agent form.
- Reject mounts that expose the supervisor's credential/state, Docker socket/storage, host control interfaces, or an unrestricted `/`. Broad host-root access is a separate security decision, not implied by running as UID 0.
- Resolve mount sources on the **Docker daemon's host**, not by assuming paths inside the worker container are host paths.
- Missing mounts fail closed. Do not auto-create an absent external-volume directory and silently write onto the host's root disk instead. Verify required external filesystems before starting agents and report loss during operation.
- If hot-mounted external volumes are needed, configure and verify host-to-container propagation deliberately; do not enable propagation back to the host.
- Destroying an agent never recursively removes a host bind-mounted directory. Workspace-data purge is a separate, explicitly confirmed operation and initially applies only to worker-owned agent volumes.

Mason's SSH/Docker inventory and approved MOTHERSHIP root are now verified. A dedicated `rue` Colima VM and worker image exist; authenticated enrollment, agent execution and explicit directory grants are running in development. See the [Mason deployment record](../deploy/worker/MASON.md) for the verified MOTHERSHIP-only host-share boundary, bootstrap steps and remaining per-agent mount/ownership policy. Other pathnames in this design remain examples, not assigned mounts.

## Packages and distribution

Proposed layout:

```text
packages/apps/worker/             @multiterm/rue-worker; rue-worker executable
  src/cli.ts                     enroll/status/doctor/run
  src/control.ts                 outbound worker transport and authority
  src/reconcile.ts               desired/observed state reconciliation
  src/docker.ts                  constrained local Docker adapter
  src/state.ts                   durable journal and local process lock
  src/policy.ts                  mounts, capacity, image/version policy
  tests/
packages/apps/agent-runtime/      headless Pi runner, no worker credential
packages/libs/terminal-bridge/   shared tested relay implementation
  # extracted from extensions/rue without changing manual pairing policy
deploy/worker/                   Compose packaging and installation
  Dockerfile
  agent.Dockerfile
  compose.yaml
  worker.env.example
  mounts.example.json
  README.md
```

The native worker binary contains the supervisor/control client, not an embedded copy of Docker or every Pi/model-provider dependency. A pinned agent runtime image supplies Pi and its runtime dependencies. Build native Linux x64 and arm64 artifacts, plus the Compose image, from the same worker source. Validate the intended compiler/runtime before committing to a distribution format.

Useful CLI surface:

- `rue-worker enroll-key`: generic Tenancy-key authorization, HTTPS origin, explicit host-control acknowledgement, durable idempotency, and private transport-identity storage. No separate project or enrollment API-key type.
- `rue-worker doctor`: validate Docker, state permissions, declared mounts, resource ceilings, runtime image, and API compatibility; redact secrets.
- `rue-worker run`: supervised foreground daemon, graceful signal handling.
- `rue-worker status`: sanitized local status, versions, authority, agents, and pressure.

Compose should use `init: true`, root supervisor identity, restart-on-failure/unless-stopped policy, persistent state, bounded logs, CPU/memory/PID limits, and no exposed inbound ports. Secrets come from protected files, not committed environment values, CLI arguments, or image layers. Per-agent containers need their own resource limits: the supervisor container's cgroup does **not** constrain sibling containers.

Do not ship a manifest pointing at an unpublished image or a daemon stub that only crash-loops. Compose validation and a real image build are release gates.

## Enrollment, credentials, and authorization

The authenticated owner creates a worker in Rue, names it `Mason`, and explicitly grants managed-agent execution. The bootstrap exposes a worker credential once; the server stores only its hash. The worker is bound to that owner and exact Rue HTTPS origin. Browser JWTs and account-wide API credentials are not installed on Mason.

Worker credentials authenticate only the worker-control namespace. They cannot use owner dashboard routes, access unrelated sessions, or impersonate a manually paired terminal. Browser/account credentials do not silently bypass worker protocol authentication.

An active worker lease can obtain an agent-scoped grant only for a managed agent assigned to that worker and desired to run. That grant preserves the managed agent's Rue session ID and local Pi session identity. It is not a generic pairing bypass. A lost grant acknowledgement must reconcile or replace that grant safely, not create another bot.

Credential renewal for managed agents is automatic while the worker remains authorized. Revocation, deletion, or owner mismatch is terminal until explicit operator action; reconnect logic must never silently re-enroll a revoked worker. Credential rotation requires bounded overlap, audit evidence, and tests for active runs/outbox delivery. Manual terminal credential and approval behavior stays unchanged.

Provider authentication stays on Mason, exposed only to the selected runtime/profile. Do not upload provider stores to Rue or indiscriminately mount the operator's entire home/Pi directory. OAuth refresh-token sharing and file locking need validation before one profile is used concurrently by multiple agents. An external provider may still require occasional user reauthentication; the daemon cannot bypass it.

## Durable model and control protocol

Add new migrations, not edits to already-applied migrations:

- `workers`: owner, credential hash/revocation, name, desired configuration/revision, lifecycle.
- `worker_sessions`: instance/generation, authority expiry, heartbeat/observed configuration.
- `managed_agents`: owner, worker, Rue session, stable Pi identity, desired state/revision, runtime revision, approved mount/profile selections.
- `worker_operations`: operation ID, target, requested revision, lease/fence, status, bounded result/error, timestamps.
- Audit records for enrollment, rotation, configuration, lifecycle, force-stop, and purge.

Owner APIs live under `/workers`; worker-only APIs/transport under `/worker-client`. Schemas are strict, messages bounded, owner taken from authenticated identity, and ownership checked on every lookup. Lifecycle mutations require idempotency keys and optimistic revisions. The browser receives persisted operation state and SSE invalidations, not fire-and-forget success.

The worker opens one persistent WSS control connection. Authenticate in the first frame, never the URL. Use heartbeat/lease renewal, correlated acknowledgements, bounded buffers, separate renewal/execution lanes, and jittered reconnect only after failure. Reconcile durable desired state after reconnect; push notifications are hints, not the source of truth.

**Existing socket integration trap:** `installTerminalSocket()` currently rejects every upgrade path except `/terminal-client/socket`. Adding another independent rejecting `upgrade` handler would break one or both transports. Introduce one upgrade dispatcher that selects the terminal or worker protocol before either authenticates. Preserve browser-origin rejection and keep credentials/scopes separate.

One live supervisor owns a worker generation. Local locking, server fencing, and Docker ownership labels prevent duplicate management. A fenced process stops rather than competing in an automatic takeover/reconnect loop. Every operation and runtime start is checked against worker and agent generations, not just a container name.

On loss of authority, stop accepting new lifecycle operations and prompts immediately. Existing execution is bounded by its still-valid lease; after expiry abort/stop owned work. An independent agent-side watchdog is required because sibling containers can outlive a crashed supervisor. Reconcile them before granting new authority. Never kill unowned host processes or containers.

## Agent execution and lifecycle

The current manual extension explicitly returns when there is no interactive UI and only connects after `/rue`. Do not script its prompts or change its default into unattended auto-pairing. Add a separate headless runner using Pi's supported SDK/RPC integration, with a managed grant and explicit local execution policy. Verify the Pi lifecycle/session APIs before implementation.

Extract/reuse the relay's ordered message/tool/thinking transport and durable outbox. Keep independent tool-output and exposed-thinking consent; thinking remains off unless explicitly enabled. Preserve existing permission policies rather than inheriting unlimited tool trust just because the worker is root. Hands-off remote execution is an explicit managed-agent policy selected at creation.

| Dashboard action | Required behavior |
| --- | --- |
| Create | Persist agent/session and desired revision; admit capacity; create one owned runtime; report readiness. |
| Stop | Stop accepting prompts; drain or explicitly interrupt; preserve history, workspace, credentials, and outbox. |
| Resume | Start the same agent/session/workspace under fresh valid authority; never silently create a new conversation. |
| Reload | Drain to a safe boundary, flush outbox, and replace runtime with approved revision; expose pending reload during a long run. |
| Reconnect | Recover transport automatically without restarting a healthy Pi runtime or replaying a prompt. |
| Restart after crash | Reconcile durable execution state first; mark ambiguous in-flight work interrupted, not queued for rerun. |
| Destroy | Persist a tombstone, revoke grants, stop/remove owned runtime; preserve history and data by default. |
| Purge retained data | Separate destructive confirmation and retention policy; never delete host bind sources. |

An offline host receives pending desired state when it returns. The dashboard must show `destroy pending`, not pretend a disconnected container has already stopped. Tombstones remain durable so reconnection cannot resurrect destroyed agents.

"Existing agents" has two meanings:

1. Previously worker-managed agents: automatic resume/adoption by verified ownership and durable session identity.
2. Arbitrary interactive Pi sessions: explicit handoff/import after the original process releases the session. No host-wide scan, PID takeover, implicit re-pairing, or concurrent writers to a Pi session file. An already manually paired live agent stays manual unless intentionally migrated, with history retained.

## Dashboard

Keep **Pair an existing Pi session** as one connection option. Add **Connect a managed host** as the other.

The Hosts view shows enrollment/connection health, version, capacity, declared volume aliases, profile availability, draining state, and agents. The create-agent flow chooses host, name, workspace/mount aliases, local model/profile, and execution/sharing policies. The chat header identifies a managed agent's host and offers relevant lifecycle actions with operation progress and errors.

Keep worker connectivity, agent process readiness, and agent relay connectivity distinct. A healthy worker does not prove its Pi process is ready. Use server observation timestamps and event-driven cache invalidation; do not reintroduce flashing reconnect controls or per-second full-view polling.

## Updates and resource safety

- Bounded concurrent agents and starts; local memory/load/disk admission immediately before creation.
- Per-agent Docker CPU/memory/PID limits, bounded log rotation, and aggregate worker reservations.
- Cleanup/stop must remain possible when capacity admission rejects starts.
- Crash-loop backoff and a visible failure budget; no unbounded restart/log/outbox growth.
- Approved, digest-pinned runtime releases; no unattended mutable `latest` pulls.
- Agent reloads and worker-binary upgrades are different operations. Worker replacement belongs to Docker/systemd or an explicitly installed updater, with draining, readiness, and rollback. Do not have a running binary overwrite itself.

## Implementation sequence and acceptance gates

1. **Contracts and storage:** owner scoping, enrollment/revocation/rotation, desired state, tombstones, idempotency and generation tests. SDK types follow the validated API contract.
2. **Worker executable and transport:** shared upgrade dispatcher, fenced WSS, durable journal, local lock, Docker adapter, capacity policy and sanitized diagnostics. Test with a fake Docker engine and real local sockets.
3. **Headless Pi vertical slice:** create → prompt/tool streaming → stop → resume using the same history; validate independent runtime watchdog, outbox recovery, credential renewal and no ambiguous replay. Keep manual-extension/Jiti reload regressions passing.
4. **Dashboard:** host enrollment and agent lifecycle, pending/offline operations, account isolation, accessible desktop/mobile controls, push-first status.
5. **Packaging:** native build artifacts, worker/runtime images, Compose validation, persistent-volume and upgrade/restart tests using a real local Docker engine.
6. **Mason canary:** inventory and explicitly configure real mounts/provider profiles; start one resource-limited agent in a disposable workspace before authorizing broader writable volumes.

Mandatory failure cases: duplicate supervisors, stale/fenced acknowledgements, disconnect mid-start, API/worker/container restart, supervisor death with surviving sibling containers, lease expiry, denied credentials, provider failure, disk full, resource pressure, missing/external mounts, rapid stop/resume/destroy races, symlink/path traversal, unauthorized Docker options, lost operation results, and worker removal while offline. Destroy/purge tests must prove host-mounted data survives.

Do not describe mocked Docker calls or socket-only tests as live Mason/Pi verification. The enrollment implementation above does not establish agent-runtime or Mason readiness. Remaining roadmap sections require their own implementation and live verification.
