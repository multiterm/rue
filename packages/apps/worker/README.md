# @multiterm/rue-worker

Rue's managed-host supervisor runs isolated Pi agents, reconciles lifecycle operations, and maintains fenced WebSocket authority. It supports private persistent workspaces, explicit purge, MCP, provider grants, pinned local images and resource limits. Host filesystem mounts are not enabled by default.

New enrollment uses `rue-worker enroll-key` with a generic Tenancy API key in a private file. There are no raw `enroll` or project-specific enrollment commands. The exchanged transport identity is private supervisor state, not another user-facing API key. Every connection/heartbeat revalidates its Tenancy authority; expiry or revocation cannot be bypassed by rotating the transport identity.

Existing Mason state is preserved. The Docker socket conveys VM-administrator authority and must never be given to an agent.

- [Installation and Compose](../../../deploy/worker/README.md)
- [Tenancy keys, enrollment and adding a Mason bot](../../../docs/project-authorization.md)
- [Managed-worker architecture](../../../docs/managed-workers.md)

Native daemon installations should use a supervisor and a kernel-held process lock. The supplied Linux Compose image provides both. No inbound listener is started by the worker.
