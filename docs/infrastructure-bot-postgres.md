# Infrastructure bot and PostgreSQL rollout

> **2026-10-01 update:** see [bot-recovery-status.md](bot-recovery-status.md) for the completed development recovery. The API is healthy and Mason, Honeycluster and Keyname have fresh live connections after a CLI syntax correction and expansion of Rue's disk-starved VM. This native session can use the controller SSH identity; the access limitations below describe the earlier managed container. The latest requested scope is the whole fleet, but no bot-specific fleet grant has been installed. PostgreSQL schema/migrations now cover all application tables; repository/API migration and cutover remain unfinished.

## Requested target

- Account: `r@honeycluster.io`, resolved through authenticated identity, not inferred
  from the email string or a newly manufactured session.
- Bot: **Rue Infrastructure**, a dedicated managed infrastructure operator.
- Initial SSH targets: **Stratus** (Sandblocks control plane) and **Abby** (Rue
  services and database infrastructure). Do not automatically include other hosts.
- Rue API and application releases remain **Sandblocks-managed**. SSH access is
  not permission to replace the API outside its deployment workflow.
- PostgreSQL runs independently on **Abby**. Development, preview and production
  get separate databases and least-privilege runtime identities.

## Actual implementation state

The agent image source now installs OpenSSH client and rsync and checks their
versions during image build. The `io.rue.ssh-client=1` label describes tooling,
not an SSH grant. No SSH identity, operator home directory, Docker socket or extra
container privilege was added. The new image has not been built or deployed by
this change.

**The bot has not been created. No SSH authorization or PostgreSQL cutover has
been performed.** This execution environment currently has neither an authenticated
Rue owner session/control credential nor an existing fleet SSH bootstrap identity.
A Sandblocks project key does not authenticate as this Rue account.

### Prepared bootstrap identity

A dedicated Ed25519 identity has now been generated in the executing agent's
private workspace (directory 0700, key 0600), outside the shared repository. Its
public/private signing pair was verified, and a second preparation invocation
reused the same identity rather than rotating it.

Public-only operator handoff:
`.sandblocks/recovery/infrastructure-ssh-public-49799108-4633-4772-9e5b-7d007ce14ffd.json`.
Fingerprint: `SHA256:CunhryJ9v4Lyc2CfHT+7dM0ZcKQ4U2azAM8l+UY3kbM`.
This is a pending identity, not an installed host grant or a created bot.

A no-authentication probe reached SSH key exchange on Stratus at
`100.78.201.50:22`; the presented host key was deliberately rejected rather than
trusted on first use. Abby's recorded **service address**, `100.114.99.85`, refused
port 22. This does not establish Abby's correct SSH entrypoint or mean its services
are offline: the Sandblocks build and deployment workers both reported online.
The provisioning inventory subsequently confirmed Abby's SSH port is **2220**;
Abby, Stratus and Mason all reached SSH key exchange at their documented endpoints.
Mason's private keys and `known_hosts` are outside this container's filesystem grants.

A scoped, tested Mason-side helper is now available:
[scripts and instructions](operator-ssh-bootstrap.md). It uses the existing
controller identity in place and can authorize only the prepared public key on
Abby and Stratus, with explicit acknowledgement and expiry. It does not copy a
personal SSH directory, change sudoers, or create a Rue bot. Running its read-only
preflight here correctly refused the unavailable controller identity before any
SSH authentication or mutation. An authenticated Rue owner context is still
needed separately. No public-key enrollment or host change has occurred.

## Bot provisioning

1. Authenticate through the normal Rue/Keyname flow for the requested account, or
   obtain an appropriately delegated self-owned Rue/Tenancy control key. Use a
   private secret file, not chat, command arguments or committed configuration.
   Do not use direct identity-database session minting as a shortcut.
2. Verify the account's stable subject and inspect its owned workers, readiness,
   capacity, available runtimes and model configuration. Do not manufacture an
   owner subject, pick another owner's worker, or assume an email is a subject ID.
3. Provision exactly one bot with a persisted request ID. Reconcile an uncertain
   response before retrying. Do not grant it credentials while ownership or
   deployment state is unresolved. Provider credentials require their own explicit
   grant; SSH permission is not an inference-provider grant.
4. Approve the reviewed runtime for this bot without upgrading unrelated agents
   or changing an existing host capacity policy. Keep it idle until access and
   instruction checks pass.

Existing scoped control permissions for provisioning/inspection are
`rue:hosts:read`, `rue:agents:read`, `rue:agents:write` and `rue:agents:execute`.
These do **not** themselves grant SSH or permit creating new SSH approvals.

## SSH administration implementation and bootstrap

A Bot Settings fleet-access grant needs a real credential-delivery and host-side
trust path; adding an image label or an admin checkbox is not enough.

- Use a dedicated bot identity, not the operator's personal SSH key/agent.
- Prefer short-lived certificates or a bot-specific credential broker/SSH agent.
  Do not expose a general-purpose personal SSH-agent socket to the container.
- Bind approval to owner, bot, worker/connection, explicit hosts, SSH account,
  approved privilege level and expiry. Only authorized owner/operator actions may
  issue or expand it; ordinary agents must not grant themselves access.
- Keep long-lived private keys outside model-visible workspace/configuration where
  possible. A credential readable by an administrative bot can be copied; local
  permission checks alone are not a revocation mechanism.
- Bootstrap the public identity/trusted CA and intended sudo policy through an
  existing authorized fleet operator. Verify host keys using trusted fleet
  inventory. Never use blind TOFU or `StrictHostKeyChecking=no`.
- Disable agent forwarding, tunneling and reusable multiplexed connections unless
  separately authorized. Account for expiry/revocation and in-flight sessions.
- Treat Docker access or unrestricted sudo as host-root authority. Expiry blocks
  future authorization; it does not undo changes or persistence made as root.
- Record actor, target, request ID, approval, timing and outcome without retaining
  private keys or secret-bearing command arguments/output. A disconnected or timed
  out SSH command has an uncertain outcome: inspect before retrying.

This grant/broker/UI path is not yet implemented. Current runtime-update approval
is narrower and must not be relabeled as fleet administration.

## PostgreSQL migration and deployment sequence

1. Inventory all current SQLite tables and filesystem-backed state. Preserve the
   existing database, settings-encryption key, VAPID identity and attachments.
2. Finish async PostgreSQL repositories and API/socket integration for **all**
   domains, including managed work, provider/OAuth grants, queues, notifications,
   usage, permissions and any new infrastructure grants. The current API still
   uses SQLite; a database URL change alone is not a migration.
3. Provision a private, persistent PostgreSQL service on Abby with a reviewed
   image, network restrictions, separate migration/runtime roles, credentials
   supplied through the approved secret mechanism, and backup/restore testing.
4. Build a consistent-backup importer and rehearse it against a disposable target.
   Check table/row inventory, relationships, encrypted bytes, IDs, timestamps and
   attachment content. Do not revive imported execution leases or replay uncertain
   commands. Preserve the original encryption key in API-only managed secrets.
5. Review a final maintenance window: drain managed work, pause writes, refresh
   the backup, import and verify. Start with one API replica. Do not introduce an
   unreviewed dual-write or split-database mode.
6. Deploy the reviewed PostgreSQL-capable API **through Sandblocks**, retaining
   its private filesystem-backed state where still required. Retain SQLite and
   its backup as rollback evidence; do not restore old SQLite over new PostgreSQL
   writes without reconciliation.
7. Validate account isolation, login, conversations, attachments, provider grants,
   command/notification leases and managed execution. Then verify authenticated
   Web Push readiness and actual device delivery using the existing VAPID pair.

See [postgres-migration.md](postgres-migration.md), [agent-control.md](agent-control.md)
and [web-push.md](web-push.md). This plan supersedes treating SQLite adoption as the
final architecture, but does not authorize removing the current mount before a
verified PostgreSQL cutover and filesystem-state migration.
