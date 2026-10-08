# Managed Pi runtime

Connected to worker 0.2.0 and enabled in the authenticated development deployment. Production rollout remains separate.

Implemented:
- Pi SDK 0.85.1, fixed session identity and durable first-user-message history.
- Existing Rue relay/outbox, independent tool/thinking sharing, explicit provider-key grants, no plaintext provider-key persistence.
- In-memory model/auth configuration; no discovered extensions, skills or prompt templates.
- Separate root authority guardian; Pi/tools run as UID/GID 1000 with a minimal environment. The guardian checks server authority before startup and every ten seconds, with a 250 ms independent monotonic/wall-clock watchdog.
- Model-call retries disabled; loading saved history does not submit a prompt.
- Explicit stdio MCP tools with encrypted profile delivery, minimal child environment, bounded framing/timeouts and no automatic retry. See [MCP](../../../docs/mcp.md).
- Revision/generation/boot fencing, interrupted-outbox recovery without replay, and retained history across lifecycle operations.

Required deployment contract (enforced and inspected by the supervisor):
- Local immutable image identity; no automatic pulls.
- Read-only root filesystem; no privileged mode, host PID/network namespace, Docker socket, or supervisor credentials/volume.
- Drop **all** capabilities, add only **SETUID/SETGID** for the guardian; `no-new-privileges` must be enabled. The tools process has no capabilities.
- Per-agent root-owned mode-0700 `/control` volume with a mode-0600 `grant.json`; separate UID-1000 `/state` and `/workspace` volumes. The image initializes directory ownership for new local volumes. Verify existing volumes and never silently repair arbitrary mounts.
- Bounded CPU, memory/swap, PIDs, logs, and tmpfs; no published ports. No host mounts by default.
- Preserve volumes on stop/destroy and replace stopped bootstrap credentials with a revoked marker. Purge requires separate authorization and must never remove a bind source.
- One kernel-held lock per agent; reconcile stale generations and lost acknowledgements before restarting. A process exit alone does not authorize replay.

The guardian passes the narrowly scoped terminal grant to its child over stdin. It never passes the worker credential. Already delivered provider plaintext cannot be recalled; revoke the grant to stop future retrieval.

Build from repository root:

```sh
docker --context colima-rue buildx build --builder colima-rue --load \
  -f deploy/worker/agent.Dockerfile -t rue-agent-runtime:mason .
```

The Dockerfile allowlist excludes deployment state, credentials, worktrees and unrelated source. ARM64 images passed offline SDK and UID/capability checks. Separate authenticated Mason canaries verified lifecycle/restart recovery, preserved history/workspaces, explicit purge, MCP synthetic-credential delivery/execution, frozen-Pi guardian fencing and revocation. Unit/HTTP and mocked browser checks remain distinct evidence.

Explicit MOTHERSHIP directory grants are deployed in development with native descriptor proofs and a protected administrative-cache mask; see [Workspace & permissions](../../../docs/workspace-permissions.md). Remaining: broader failure-matrix coverage, generic Tenancy verifier rollout, production rollout and physical-device evidence. Filesystem verification does not issue model inference. MCP currently supports stdio tools, not HTTP/OAuth or resource/prompt browsing.
