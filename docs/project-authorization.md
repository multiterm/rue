# Tenancy API keys and enrollment

Tenancy issues one API-key type with self or project ownership, an application audience, and opaque `grants: string[]`. Rue checks ownership and an explicit permission catalog; it never treats successful verification as unrestricted human authentication.

## Status

Generic issuance, Rue management authorization, CLI enrollment, bounded runtime authority and the settings modal are implemented locally. PostgreSQL, browser mocks and local HTTP/socket tests are separate evidence. **The live Tenancy verifier is not provisioned.** The development `/api-keys` endpoint currently fails closed with 503. Tenancy's deployment policy requires a reviewed committed candidate; no unrequested commit or production rollout was made.

Mason's existing enrollment is preserved. It was checked online, accepting work, with managed-agent, purge and MCP capabilities. No provider inference was exercised.

## User flow

In **Settings → API keys → Create API key**:

1. Enter a name and choose Personal or an authorized project.
2. Choose All, Restricted, Read only, or Enrollment; adjust the shared UI checkboxes.
3. Choose expiry and create. Save the masked one-time secret privately.

Grant strings are interpreted by Rue, not Tenancy. The supported catalog is exported as `RUE_KEY_PERMISSIONS` in the Rue SDK. The current key API covers hosts, managed bots and MCP configuration; it does not grant browser login, provider-vault access or unrestricted chat/history access. Unknown/wildcard grants convey no implicit privileges. There are no configurable domain restrictions.

The same key can call the allowed management endpoints and `POST /workers`. Enrollment requires `rue:hosts:enroll`, `rue:agents:execute`, an idempotency request ID and explicit host-control acknowledgement. Project-owned keys operate on a project resource owner, not the issuing user's personal resources. Human dashboard project-resource switching is not implemented; use the project key API for those resources.

## Supervisor enrollment

Save the key in a mode-0600 file outside agent workspaces, then configure:

```sh
export RUE_WORKER_API_URL=https://your-rue-api.example
export RUE_API_KEY_FILE=/private/path/rue-key
export RUE_WORKER_NAME=My-host
export RUE_ACKNOWLEDGE_HOST_CONTROL=true
rue-worker enroll-key
```

The private state directory must be owned by the supervisor user. Enrollment persists a secret-free idempotency intent and an internal worker transport identity, not the Tenancy key. Do not retry under a new intent after an uncertain result. A lost one-time transport response requires explicit operator recovery. A stale enrollment lock requires operator review.

Configure the pinned, local agent image and resource policy using the managed-worker deployment guide, then run the supervisor. Docker access is VM-administrator authority. Bots must not receive the socket, supervisor credentials, or its private state.

## Runtime authority

Rue encrypts the enrollment proof in its private ledger. Every worker connect/heartbeat verifies the Tenancy key again. Execution deadlines are capped by request-start plus 45 seconds and key expiry. API/verifier failures do not extend authority; definitive invalidation scrubs the encrypted proof and fences descendants. Startup fences cached authority. Revocation does not delete bot history/workspaces or recall credentials already delivered to processes.

The transport identity is private protocol state, not a separately managed API-key product. Rotation/recovery of that identity never bypasses the enrolling key's authority.

## Server provisioning

Register an independent `rue` verifier in Tenancy's private platform-service registry. Configure Rue with `RUE_TENANCY_ORIGIN` (exact HTTPS origin) and `RUE_TENANCY_VERIFIER_FILE` (absolute, current-owner, mode-0600 regular file; no symlinks/hardlinks). Preserve the existing database encryption key. Never put verifier credentials in source, arguments, browser storage or agent workspaces.

## Removed model

There are no public project-binding endpoints, project-only verifier, project-key SDK methods, or `enroll-project`/raw `enroll` commands. New enrollment requires a generic Tenancy key; a human login alone cannot create a host. Migration 19 deletes obsolete project bindings, revokes their dependent host identities and removes their provider grants. It preserves unbound Mason, generic authorities, history and workspaces. Old binding-related column names in historical SQLite migrations are not a compatibility API.

## Add a bot managed by Mason

Mason is already enrolled; do not enroll it again.

1. Open **Settings → Remote agents → Create managed agent**.
2. Name the bot and select **Mason** as **Execution host**.
3. Choose provider/model and read-only or coding tools. Leave MCP and sharing off unless needed.
4. Confirm unattended execution and click **Start managed agent**.
5. Wait for the observed state to be running, then select its conversation in the bot list.

For inference, first save the approved provider key in **Settings → AI keys** and explicitly grant it to Mason. A provider key is not a Tenancy key. The bot gets a private persistent workspace; host filesystem mounts are not enabled by this flow. Starting a runtime does not prove successful provider inference.
