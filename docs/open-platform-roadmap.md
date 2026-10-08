# Rue open-platform design direction

## Product direction

Rue is an open, adaptable platform for people to run and maintain agents in their own environments. Our infrastructure deployment is a use case, not the product's required topology. Features must be configurable through reusable dashboard workflows rather than hard-coded accounts, hostnames, paths, credentials or agent names.

**Status: standing design direction, not a separate active delivery agenda or an implemented SSH credential service.** Apply this direction to all new features. The agent/SSH examples below record requested capabilities and design constraints; they are not an automatic next milestone or authorization to provision remote access. Existing OpenSSH tooling or filesystem mounts do not constitute a managed remote-access feature.

## Required API / CLI / SDK / dashboard parity

- Every new feature must have API, CLI, SDK and dashboard parity. Plan all four surfaces together rather than delivering dashboard-only capabilities or relying on operator scripts as a substitute for a public interface.
- Use shared typed contracts and the same application services for mutations, validation, authorization, ownership, consent, revisions, idempotency, errors and status. SDK/CLI/dashboard clients must not implement alternate authority rules or bypass the API through direct database access.
- Parity means equivalent supported operations and observable outcomes, not identical interactions. For example, a dashboard upload, an SDK binary/file input and a CLI file/stdin input should use the same protected API operation. Do not require secrets in CLI arguments or chat.
- Expose lifecycle, configuration, inspection, cancellation/revocation and recovery operations consistently where the feature supports them. Document deliberately unavailable operations and their security constraints on every surface.
- Verify the API contract, SDK types and behavior, CLI workflows, and desktop/mobile dashboard flows. Include equivalent authorization failures and concurrency behavior—not only happy-path UI screenshots.
- Keep deployment/authentication/storage integration points explicit, documented and replaceable where supported. Use configuration and capability discovery rather than our hostnames, filesystem layout, account IDs or vendor-specific assumptions.
- Our infrastructure-agent deployment is an example configuration of ordinary features, not a privileged product identity or a mandatory platform dependency.

## Current implementation priority

Complete the PostgreSQL stores and async HTTP/socket/job integration, preserve existing data and keys, transition directly, verify application/recovery behavior, then remove obsolete transition paths. The application is not live; no staged rollout or observation period is required. Apply the parity and portability requirements throughout this work, without expanding it into a separate platform-rewrite milestone.

Track implementation evidence in [cutover progress](postgres-cutover-progress.md). Do not describe database schema coverage or a test fixture as a completed application transition.

## Agent configuration design

- Create, configure, inspect, stop, resume, upgrade and remove agents through the dashboard, with explicit ownership and revision checks.
- Make instructions/role, provider/model, execution host, workspace permissions, tools, MCP connections, sharing and credential grants configurable per agent.
- Offer reusable, editable agent templates. An **infrastructure agent** is a template with instructions and selected capabilities—not a privileged agent type, hard-coded account, or automatic fleet-access grant.
- Keep execution hosts (where the agent runs) distinct from remote target hosts (where it may connect).
- Surface unsupported runtime/worker capabilities and missing setup in the dashboard before execution; never silently broaden access to make a configuration work.
- Document configurable deployment and authentication integrations. Our Sandblocks/Keyname/Mason/Abby setup can remain an example or adapter, but must not be a requirement imposed on every installation. Alternative integrations must retain verified principals and owner isolation.

## SSH and remote-host feature design (reference requirements)

### Profiles and credentials

- Account settings: create reusable **Remote host** and **SSH credential** profiles.
- Remote host fields: display name, alias, hostname/address, port, remote username, verified host-key fingerprints/known-hosts entries, and optional explicitly configured jump-host relationships.
- Support uploading SSH configuration files and SSH authentication keys, as requested. Show an import preview, normalized supported settings, key type/public fingerprint, validation errors and any unsupported directives before saving.
- Private-key uploads are write-only secrets. Ordinary responses, edit forms, logs, events and audit records must not return private key bytes. List only safe metadata such as fingerprint, label, revision and grant status. No default private-key download endpoint.
- Define supported key formats, algorithms and size limits, including an explicit workflow for passphrase-protected keys. Do not silently persist a passphrase alongside a key; any stored unlock secret needs its own documented protection and consent.
- Optionally support dedicated generated agent identities and short-lived SSH certificates. These complement, rather than replace, users' ability to bring their own keys.

### Per-agent approval

- Agent settings: select individual remote hosts, the corresponding SSH identity, and expiry. Display the remote username and effective scope before approval.
- Only an authorized human/operator may approve or expand access. Agent instructions, uploaded config and ordinary agent credentials cannot approve themselves.
- Bind grants to the owner, agent and authorized runtime/host binding, with revision checks. A replacement binding must not silently inherit another agent's approval.
- Provider credentials, local filesystem permission, remote SSH permission and Rue host-control delegation are separate grants.
- Default access is none. Do not copy a personal `.ssh` directory, mount a general-purpose operator SSH-agent socket, enable broad sudo, or authorize every discovered host implicitly.

### Safe config import and host verification

- Treat uploaded SSH configuration as untrusted input. Parse a bounded, documented subset into structured profiles; do not execute the uploaded file or invoke `ssh -G` on it in the API process (`Match exec` can execute commands).
- Reject or separately design/review executable and external-reference directives such as `ProxyCommand`, `LocalCommand`, `Match exec`, arbitrary `Include`, identity/agent socket paths and filesystem references. Import identities as managed credentials, not arbitrary paths copied from the uploader's machine.
- Do not enable agent, local, remote or dynamic forwarding implicitly. Support jump hosts through explicit profiles and grants, not unrestricted shell commands.
- Pin verified server host keys. A scanned key is a candidate for out-of-band verification, not proof of host identity. Show mismatches as a hard failure; do not solve them with `StrictHostKeyChecking=no`.
- Run connection tests from the selected execution environment with bounded timeouts and explicit consent. They must not mutate remote hosts or install `authorized_keys` automatically.

### Delivery, revocation and security limits

- Store credential ciphertext and grant/audit metadata in PostgreSQL using the installation's managed encryption key. Keep that encryption key outside the database and application uploads, with documented backup/recovery handling.
- Deliver only explicitly granted credentials to a currently authorized runtime. Recheck owner, grant revision/expiry and runtime lease at delivery. No private key material in model prompts, normal workspace files, image layers or shared caches.
- Prefer a scoped credential broker/agent or short-lived certificates. If file delivery is necessary, use a dedicated isolated runtime secret location with restrictive directory/file permissions and deterministic cleanup.
- Revoke future delivery and terminate/recreate affected managed execution contexts as needed to close sessions and remove mounted material. Do not claim this erases already copied credentials or reverses remote changes.
- A reusable private key may remain valid remotely after Rue revocation. Expose rotation/removal of the corresponding remote authorization as a separate operator task; certificates can bound this exposure.
- Host selection in the dashboard is not by itself a network sandbox. Document/enforce the intended boundary through the broker, runtime egress controls and remote SSH authorization where needed. Do not advertise a host allowlist as preventing use of a copied key elsewhere.
- Remote privileges come from the remote account, `authorized_keys`/certificate restrictions and reviewed sudo policy—not an “administrator” label in Rue.
- Credential delivery and control actions have owner-scoped, value-free audit events. Host inventory/config metadata is also owner-scoped even when it is not secret key material.

## Acceptance criteria when implementing these features

- A new installation can configure a normal agent and an infrastructure-style agent through documented API, CLI, SDK and dashboard workflows without editing source or using our hostnames/accounts.
- Import valid SSH configs/keys; reject oversized, malformed, unsupported and executable config inputs without executing them or leaking their contents.
- Verify explicit host-key approval, mismatch refusal, successful authorized connection, jump-host scoping and useful secret-free failure diagnostics.
- Prove cross-owner isolation, human-only approval, revision conflict handling, binding changes, expiration, rotation and revocation under concurrent requests.
- Verify stale runtimes cannot fetch credentials and ungranted agents cannot read or use another agent's secret mount/socket.
- Demonstrate database/key backup and restore without logging plaintext; test the documented limits of remote credential revocation.
- Cover API authorization and contracts, SDK usage, CLI workflows, desktop/mobile dashboard flows and real SSH behavior against disposable target hosts, not production fleet changes.

## Related work

- [Workspace permissions](workspace-permissions.md): existing local directory grants; not a substitute for SSH credential delivery.
- [Infrastructure bot setup](infrastructure-bot-postgres.md): deployment-specific history and example requirements, not platform defaults.
- [Provider key loading](provider-key-loading.md): existing consent/credential patterns to reuse where applicable.
- [Managed workers](managed-workers.md): execution lifecycle and runtime capability checks.
