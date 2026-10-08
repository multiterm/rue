# @multiterm/rue-docs

Documentation and implementation notes for Rue.

- [Settings & support](../packages/apps/docs/src/content/settings.md): the public `/settings` guide, including shared keys, remote agents, hosts, and capability limits.

- [Development onboarding and shared controls](./development-onboarding.md): `/rue-dev`, web buttons, public layouts, and host API keys.

- [CLI authentication](./cli-auth.md): browser approval, origin-bound OS credential storage, and revocation limits.
- [PostgreSQL migration](./postgres-migration.md): verified copy rehearsal and remaining application transition work.
- [Open-platform design direction](./open-platform-roadmap.md): required API/CLI/SDK/dashboard parity and flexibility for open-source/self-hosted environments; agent/SSH design reference, not a separate active milestone.
- [Transition progress](./postgres-cutover-progress.md): current PostgreSQL implementation, verification evidence and direct-transition plan.

## Design notes

- [Settings implementation](./settings.md): responsive modal, encrypted provider-key broker, consent, and runtime limits.

- [Automatic Pi provider keys](./provider-key-loading.md): explicit grants, literal in-memory auth and runtime limits.
- [Codex OAuth integration](./codex-oauth.md): provider-aware web sign-in, encrypted vault/refresh fencing, and remaining runtime work.
- [Mason deployment](../deploy/worker/MASON.md): verified VM boundary, image smoke tests and protected enrollment.
- [Workspace & permissions](./workspace-permissions.md): enforced directory grants, inode proofs, administrative-cache protection and container-scoped revocation.
- [Pi agent status](./agent-status.md): observed directory/model/context/usage, independent sharing consent and freshness.
- [Managed-agent compaction](./managed-compaction.md): durable command fencing, runtime executor safety, and remaining transport/rollout work.
- [Managed hosts and agents](./managed-workers.md): Sandblocks review, implemented worker enrollment/control milestone, and remaining managed-agent lifecycle roadmap.
