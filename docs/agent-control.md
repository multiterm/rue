# Rue SDK/CLI runtime control

## What is implemented

The Rue API persists owner-scoped runtime rollout jobs. An opted-in **0.3.0+ manager** executes them independently of the requesting agent/CLI. Jobs survive a disconnected caller and manager restart; they are not shell commands forwarded into an agent container.

The first rollout version uses an **already-built, local immutable `sha256:` image ID**. The manager verifies the runtime/filesystem image labels before changing host state. It does not pull arbitrary images, build caller-supplied Dockerfiles, execute remote shell commands or accept host paths. Build/test/signing or operator approval of a candidate image remains a separate trusted build step. A capability check rejects older managers before a job is accepted.

The state machine performs preflight → drain → stop idle agents → switch the private pinned image → resume prior running agents → verify fresh generation/revision/connection and image telemetry. Prompt acceptance stays fenced during verification. An unhealthy candidate is stopped and the old image restored before releasing prompts. Existing identities, configurations, grants and named workspace/history volumes are retained. Previously stopped agents remain stopped. Already-started or uncertain prompts are not replayed. Never-started queued requests remain saved and may execute after the agent is authorized and ready again.

Concurrent configuration changes, lost authority or an unconfirmed rollback produce `uncertain`, not success. The host remains fenced until an operator stops all agents, confirms the policy, resolves the job, and explicitly reactivates it. This version rejects inventories over the manager protocol's current 64-entry bound; it does not silently truncate them.

## One-time manager bootstrap (required)

Adding SDK/API methods cannot retrofit an executor into an already-running old manager. The recommended local upgrade is the guarded bootstrap command. In Rue, drain the Mason host and stop its agents after their tasks finish; **leave the manager running** so preflight can verify fresh status. Do not change agent/host desired states concurrently with maintenance.

On Mason macOS, from this repository:

```sh
node scripts/deployment/bootstrap-mason-control.mjs \
  --worker-id YOUR_WORKER_UUID --api-url https://YOUR-RUE-API
# Only after preflight reports ready:
node scripts/deployment/bootstrap-mason-control.mjs \
  --worker-id YOUR_WORKER_UUID --api-url https://YOUR-RUE-API \
  --apply --acknowledge-host-execution
```

This command verifies the dedicated Colima boundary and private volume, builds both images, checks that the agent artifact contains the credential-retry/final-reply fixes, rechecks maintenance readiness, preserves the old manager/container resources and private policy, and verifies the new manager's API connection. It keeps a rollback path without deleting named volumes. Build logs and safe progress metadata are written privately under `~/.local/state/rue/control-bootstrap/`, not the shared repository. If concurrent work appears or rollback cannot be confirmed, it reports that operator review is required rather than forcing containers away.

The command intentionally refuses execution inside a managed agent or on a non-Mason Docker context. It does not enroll a new identity, grant a caller admin rights, activate the host, or resume agents. After successful verification, activate the host and resume the intended agents in Rue. The local bootstrap needs host operator access; subsequent runtime-image changes can use the delegated SDK/CLI path.

Manual equivalent / recovery procedure on the authorized Mason host:

1. Deploy the new API/schema first; keep its existing storage mount intact. Source hot reload can deliver the API changes without recreating its data container.
2. Build the new worker image from `deploy/worker/Dockerfile` and the tested candidate agent image from `deploy/worker/agent.Dockerfile`, using the verified dedicated `colima-rue` context. Do not use the default Docker context.
3. Wait for active work to finish. Stop the agents through Rue and confirm stopped observations; stop the supervisor through its existing Compose workflow. Do not delete its private volume or re-enroll its identity.
4. Configure the reviewed image with the updated helper:

   ```sh
   node scripts/deployment/mason-worker.mjs --configure-runtime \
     --agent-image sha256:REVIEWED_LOCAL_IMAGE_ID \
     --allow-runtime-rollouts
   node scripts/deployment/mason-worker.mjs --start
   ```

   The helper preserves current capacity and MOTHERSHIP policy unless explicitly changed. `--disable-runtime-rollouts` revokes this host-side opt-in during maintenance. `runtime-policy` on the new worker prints only safe image/capacity metadata, never its enrollment secret.
5. Resume intended agents. Confirm `rue control hosts` reports `managed-runtime-rollout-v1` and the expected `runtimeImage`.

## One-time in-app approval for an agent's own host

For a managed agent, prefer **Bot menu → Permissions → Runtime update control → Allow runtime updates**. The signed-in human owner reviews the host-wide impact, selects 1 hour / 24 hours / 7 days, and checks explicit consent. Approving does not stop an agent or start an update. No additional key is copied into the agent, chat, or filesystem, and no manager/agent restart is needed to change the approval.

The API stores an audited grant bound to the owner, agent ID, worker ID and terminal connection ID. Every delegated call revalidates its existing relay identity, live managed authority, binding and expiry. Ordinary relay endpoints remain unchanged. Agents and machine keys cannot create/renew grants or grant other agents access. Moving an agent to another host/connection does not transfer approval; normal reloads of the same identity retain it until expiry/revocation.

The approved agent can use:

```sh
rue control self-status --api-url HTTPS_ORIGIN --relay-state-file /private/path/relay.json
rue control self-rollout --api-url HTTPS_ORIGIN --relay-state-file /private/path/relay.json \
  --image sha256:APPROVED_LOCAL_IMAGE --expected-image sha256:CURRENT_IMAGE \
  --expected-revision HOST_REVISION --request-id STABLE_UUID --acknowledge-host-execution
rue control self-rollout-status JOB_UUID --api-url HTTPS_ORIGIN --relay-state-file /private/path/relay.json
```

`self-rollout` returns immediately. Finish the current assistant reply so the manager can drain it; do not wait for your own replacement inside the task. The SDK equivalents are `terminalRuntimeControl`, `rolloutOwnRuntime` and `ownRuntimeRollout`. The host is derived server-side, never supplied by the agent. Only jobs submitted through that agent's delegation can be read through this channel. It cannot build images, execute host commands, resolve uncertain jobs or administer unrelated agents/hosts.

`self-status` reports `approved`, `canSubmit`, `blockedBy` and grant expiry. A valid approval may still be blocked by a drained host, active rollout or unavailable manager. Revocation immediately blocks new delegated requests and cancels preflight jobs; expiry is rechecked before a preflight job may begin draining. Updates already draining/replacing containers can finish their safe rollout/rollback sequence. Separately issued API keys are independent and must be revoked under API keys settings.

## Alternative scoped caller credentials

For external controllers managing owned hosts, an owner can issue a short-lived Rue/Tenancy machine key through the existing API-key management flow. Suggested grants:

- `rue:hosts:read`, `rue:agents:read`: inspection.
- `rue:runtimes:read`: job status/history.
- `rue:runtimes:deploy` **and** `rue:agents:execute`: runtime deployment. This is privileged host execution authority over already-approved runtime images.
- `rue:agents:write` plus execution permission for individual lifecycle commands.

Do not paste the key into chat, source, arguments or logs. Deliver it through an approved private secret file/secret-manager integration. The CLI requires an absolute, owner-held, mode-0600, non-symlink file. A terminal relay credential, AI-provider credential or Sandblocks project key is **not** a general Rue administration credential. The in-app approval above authorizes only its narrow delegated routes; it does not turn the relay token into an account/admin token.

```sh
export RUE_CONTROL_API_URL=https://YOUR-RUE-API
export RUE_CONTROL_TOKEN_FILE=/private/path/rue-control.token
rue control hosts
rue control agents
rue control rollout WORKER_UUID \
  --image sha256:REVIEWED_LOCAL_CANDIDATE \
  --expected-image sha256:CURRENT_LOCAL_IMAGE \
  --expected-revision WORKER_REVISION \
  --request-id STABLE_UUID \
  --acknowledge-host-execution
rue control rollout-status JOB_UUID
```

An existing agent may inspect only its own manager readiness with `self-status`. Reading status never grants permission; `canSubmit` becomes true only after the owner's explicit in-app approval and while the host is ready.

All output is JSON. Reuse the same request ID and unchanged intent after an uncertain submission; changed intent conflicts. `--wait --timeout 1800` polls from an external controller. **An agent requesting its own rollout must not wait inside its current task:** finish the reply so the manager can drain it. The CLI rejects `--wait` when running inside Pi. Timing out or closing a client does not cancel the durable job.

`rue control cancel-rollout JOB_UUID` only cancels preflight jobs. `resolve-rollout` requires an uncertain job, its exact `--expected-updated-at`, `--acknowledge-stopped`, a drained host and confirmed stopped agents; it does not resume anything.

## SDK

```ts
const api = createRueClient({baseUrl, token: loadScopedToken})
const job = await api.rolloutRuntime(workerId, {
  requestId, expectedWorkerRevision, expectedImage, image,
  acknowledgeHostExecution: true,
})
const current = await api.runtimeRollout(job.id)
```

The API includes worker-audit records and exposes only owner-scoped job metadata. It does not expose provider keys, host enrollment secrets or raw Docker logs. Broader webapp control remains subject to each endpoint's explicit grants; this is not an unrestricted admin token.

## Validation

```sh
node --import tsx --test packages/apps/core/tests/runtime-rollouts.node.ts packages/apps/core/tests/control-cli.node.ts
node --test quality/mason-control-bootstrap.node.test.mjs
node --import tsx --test packages/apps/core/tests/runtime-control.node.ts
# With a running dev deployment (account/API calls are mocked):
RUE_TEST_WEB_URL=https://YOUR-WEBAPP RUE_TEST_API_URL=https://YOUR-API \
  node --test quality/runtime-control-ui.browser.test.mjs
```

Tests exercise SQLite transactions, API routes, owner/lease/revision checks, drain/prompt fencing, success, rollback, operator recovery, private-token-file handling and the worker executor through injected host ports. These do not claim a Docker rollout happened on Mason. Live execution additionally requires the one-time manager bootstrap, a locally built candidate and a scoped caller credential.
