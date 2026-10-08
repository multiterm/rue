# API-key platform administration

## Request and current status

The requested outcome is an infrastructure agent that can administer Rue fully,
including its own host access and Rue releases, without requiring a browser for
each operation. The user has authorized this work. Technical access, not additional
user consent, is the present blocker.

**Not completed:** `/Users/calvin` has not been attached, no administrator key has
been issued/delivered, no native controller has been enrolled, and no release has
been deployed by this change. This session has no readable `/Users/calvin`, Docker
socket, SSH agent, or Rue control-token file. Changing an SDK validator cannot add
a missing Colima share or a bind mount to a running container.

A whole-home grant is not an ordinary workspace grant: it includes SSH/cloud
credentials, Colima control state and potentially VM disks. It needs a distinct,
explicit administrator trust profile. Do not remove ordinary-agent protections to
make it appear supported. Root-capable administration cannot promise containment
or complete revocation of already-running sessions and created persistence.

## Implemented source increment

- Authenticated `GET /platform/access`: reports the verified key's owner, resource
  owner, expiry, exact supported permissions, feature-disabled operations and
  missing platform-controller integrations. It verifies the key on each request,
  uses no-store responses, and never returns its token.
- SDK: `platformAccess()`, `configureManagedAgent()` and `upgradeManagedAgent()`.
  Configuration and upgrade use the existing revision-fenced, owner-scoped API,
  with explicit execution/filesystem acknowledgements and caller request IDs.
- CLI: `control access`, `agent-create`, `agent-configure`, `agent-upgrade`, `agent-operations`,
  and `host-action` (drain/activate/revoke only). Complete configuration comes from
  an owned, private, non-symlink JSON file, bounded to 64 KiB and schema-validated.
  Configuration stops the selected agent; it does not automatically resume it.
  Upgrades target one agent and require an already-built approved local image.
  Host actions require a separate acknowledgement because they can affect peers.
- Failed/ambiguous mutation submissions are reported as unconfirmed; the CLI never
  automatically retries them or prints credential material from errors. Host
  rotation/enrollment secrets are not exposed by the new host-action command.

These are **source changes**, not live acceptance or full platform administration.
The current `All` preset means all supported scopes within the key's resource
owner, not global administration. Neither `rue:admin`, `rue:platform:admin` nor `*`
currently bypasses ownership, adds host mounts, or authorizes arbitrary execution.
`fullPlatformAdministration` is therefore explicitly false in this API version.

### Browser login (no manually supplied key-file path)

`rue auth login --api-url https://YOUR-RUE-API --web-url https://YOUR-RUE-WEBAPP` now supports explicit browser approval on the same computer and OS credential storage. `rue control` automatically uses the saved, origin-bound key unless a token file is explicitly configured. The one-hour login key supports host reads and agent management, not platform/root authority. The development approval page is deployed; successful owner approval remains a live acceptance gate. See [CLI authentication](cli-auth.md) for supported OS stores, expiry, logout/revocation and headless-enrollment limitations.

### Optional private key delivery for existing automation

Use an appropriately scoped self-owned key for existing account-owned resources;
a project-owned key controls that project's resources, not the user's bots. Match
the actual authenticated stable subject, never infer it from an email address.
Store the key in a private file outside shared source trees; do not paste it into
chat, command arguments, environment-value logs or Git.

```sh
export RUE_CONTROL_API_URL=https://YOUR-RUE-API
export RUE_CONTROL_TOKEN_FILE=/absolute/private/rue-control.token
rue control access
rue control hosts
rue control agents
rue control agent-operations AGENT_UUID
rue control agent-configure AGENT_UUID \
  --config-file /absolute/private/agent-config.json \
  --expected-revision REVISION --request-id REQUEST_UUID \
  --acknowledge-execution --acknowledge-filesystem
```

To create an agent on an existing owned host, use the same private configuration format and a stable UUID captured before submission:

```sh
rue control agent-create WORKER_UUID --name 'My agent' \
  --config-file /absolute/private/agent-config.json \
  --request-id REQUEST_UUID --acknowledge-execution \
  --acknowledge-filesystem
```

Creation may start execution. The command calls the existing SDK `createManagedAgent()` and authenticated `POST /managed-agents`, requiring both `rue:agents:write` and `rue:agents:execute`. It does not issue a key or enroll a host. On an unconfirmed response, reconcile agent/operation state before retrying; never change the request ID merely to retry. CLI validation happens before submission and transport failures are not automatically retried. Ordinary filesystem restrictions still apply.

Supply the complete current configuration with the intended changes; do not drop
provider/model, MCP, thinking or sharing settings inadvertently. Ordinary workspace
validation still rejects `/Users/calvin`. This command does not add VM shares.

For a selected-agent image update:

```sh
rue control agent-upgrade AGENT_UUID \
  --image sha256:NEW_DIGEST --expected-image sha256:CURRENT_DIGEST \
  --pi-version VERSION --expected-revision REVISION \
  --request-id REQUEST_UUID --acknowledge-execution
```

Capture the request ID before submission. On an unconfirmed result, read operation
history and current agent state; do not submit a new request ID or replay work.
This CLI does not build images, deploy the API/webapp, change the manager binary,
provision PostgreSQL, or turn an ordinary key into platform-root authority.

## Remaining implementation: actual platform administration

1. **Explicit administrator binding.** Bind a verified key ID and stable owner to
   this Rue installation, permitted hosts/environments, expiry and revocation
   epoch. Bootstrap through an existing authenticated administrator/native
   operator. Do not grant global administration merely because a self-service
   Tenancy key requests a new scope, and do not add this authority implicitly to
   the ordinary `All` preset. Administrative delegation must itself be audited
   and restricted. No fabricated user session or owner impersonation.
2. **Native host controller.** Enroll a controller running on Mason, outside the
   Colima guest. Use authenticated outbound polling and a dedicated host identity;
   no model-visible Docker socket, personal SSH-agent forwarding, or public
   unauthenticated shell endpoint. It must be able to approve/share the requested
   host path and coordinate a VM change when necessary. A controller inside the
   Docker guest cannot add Mac filesystem shares.
3. **Durable named operations.** Implement separately authorized host-filesystem,
   manager/runtime-build, platform-release and database-maintenance operations.
   Use idempotency keys, revision/generation fences, application-resource locks,
   bounded payloads/output, sanitized audit events and explicit uncertain states.
   Validate target ownership and controller capability on acceptance and execution.
   Never automatically replay started/uncertain execution. An arbitrary shell
   handler behind a generic bearer token is not this control plane.
4. **Administrator runtime profile.** Add end-to-end API/SDK/native validation for
   the deliberate whole-home/host-admin exception, distinct from ordinary grants.
   Pin it to the selected agent and a current administrator binding. Explicitly
   handle exposure of controller state and live VM disks; do not casually bind a
   writable live disk into an agent and assume data preservation. Prefer named
   controller operations where they meet the task without exposing all credentials.
5. **Sandblocks release adapter.** Keep Rue API/webapp/site/docs releases managed
   by Sandblocks. Use explicitly delegated project credentials privately, reviewed
   immutable artifacts and app-scoped environment delivery. Preserve the current
   SQLite/key/attachment/workspace mounts; refresh and rehearse backup/restore
   before replacement. Do not deploy the entire dirty checkout or bypass storage
   adoption safeguards.
6. **Safe self-change.** Return a durable operation ID before draining this agent.
   Preserve its private workspace, transcript, queued work and approvals, and let
   the controller complete replacement independently. Verify the new runtime and
   authenticated readiness before declaring success. No automatic task replay or
   unreviewed fleet-wide restart. VM changes need planned host maintenance.

The first controller enrollment and administrator binding necessarily use an
already-authorized context. This sandbox cannot grant itself either authority.
After that bootstrap, the intended API/CLI/SDK operations can remove the need for
repeated manual host intervention, but that executor path is not implemented yet.

## Verification

Ten targeted tests cover new API-key discovery, wildcard non-escalation, owner
binding, expiry/unavailability, SDK requests, private configuration files, CLI
acknowledgements, single-agent mutations and ambiguous-response handling, plus
existing CLI regressions. SDK/core typechecks pass. Tests use synthetic keys and
mocked controller/API responses: no live grant, filesystem change, image build,
SSH login, deployment or database mutation occurred.

### Continuation verification and live cutover limits

The added creation command passed six Node CLI tests (including the existing regressions). Four real in-process HTTP/API-key tests passed, including machine-key creation, same-request deduplication, cross-owner denial, revocation and no fallback to human login. Test credentials were synthetic; no live agent was created. Development syntax checks passed. The standard core typecheck was blocked by stale SDK declarations: `workers.ts` returns `resourceHealthVersion`, present in SDK source but absent from its existing `dist/workers.d.ts`; that increment did not rewrite generated SDK output. The subsequent browser-login increment rebuilt the SDK normally, and core/webapp typechecks now pass without dependency changes.

The live API health probe returned HTTP 200. Credentialed live acceptance remains pending owner authorization; the new browser-approved login removes the need for manual key-file delivery. The existing operator human session returned 401, and its expired token was not replaced through impersonation or an issuer bypass. PostgreSQL is still not the primary API store: a new source inventory found 332 synchronous `.prepare()` call sites across 36 core files. Async integration, a reviewed lease-reset importer, attachment/key verification and restore rehearsal remain required. No database switch or live bot restart was performed. See [PostgreSQL migration](postgres-migration.md). User authorization is recorded; these are implementation and credential-delivery gates, not a request for additional consent.

See [workspace permissions](workspace-permissions.md),
[Mason operator setup](../deploy/worker/MASON.md), and
[infrastructure bootstrap](operator-ssh-bootstrap.md).
