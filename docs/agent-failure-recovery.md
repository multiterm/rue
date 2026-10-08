# Managed-agent credential failures and rollout

## Observed failure

The managed Pi session log repeatedly recorded an empty assistant message with `stopReason: error` and:

> API key auth failed for provider openai-codex: Rue shared provider key unavailable. Check the connection and explicit AI-key grant.

The latest inspected failure at **2026-09-23 18:20:59 UTC** overlapped a Sandblocks development library-build operation (**18:20:35–18:21:25 UTC**). The current runtime's memory counters showed no OOM events. This points to interruption of credential retrieval during development updates, not evidence of another OOM. The old broker did not retain sanitized HTTP status details, so that exact upstream status cannot be reconstructed from the session log alone.

The running `/app/runner.js` was inspected and did not contain the newer credential retries or final-reply guard. Updating source through Sandblocks does not rebuild Mason's pinned agent-runtime image.

## Source fixes and safeguards

- Credential retrieval retries network failures and HTTP 429/500/502/503/504 up to four attempts, with backoff, five-second per-request timeouts and a 25-second overall bound.
- Every attempt checks current relay authority. Abort/lease loss terminates recovery; 400/401/403/404/409 is not retried. No positive credential cache is added.
- These are credential-service reads only. Inference requests and tools are **not** replayed automatically.
- Exhaustion reports a sanitized status/category, never credential values, private response bodies or URLs.
- A managed turn ending without a final reply fails explicitly. Recognized credential-broker failures receive a clear, non-secret diagnostic in chat rather than ending at a tool card.
- Development watcher source-only library rebuilds no longer reinstall dependencies. Dependency/lockfile changes still use frozen installation. Failed synchronization retries with bounded backoff instead of silently waiting forever for another edit.

## Applying the fixes

1. Run the tests below. Build the updated `deploy/worker/agent.Dockerfile` into a new image on the authorized host/build system; capture its immutable digest.
2. Wait for the active task to end. Use the existing managed-agent/host maintenance workflow to stop/drain, preserve workspace/history volumes and provider grants, update the pinned runtime policy, and resume. Preserve the existing capacity and filesystem policy; do not enroll a replacement identity or automatically replay unfinished prompts.
3. Verify the replacement runtime contains the new broker diagnostics/final-reply guard and its manager reports the expected revision/boot.
4. Restart the local development watcher deliberately to load its new source-only-build behavior. Do not signal a host PID from an unrelated container PID namespace.
5. Re-test a multi-tool task across a development update and confirm a final assistant reply or an explicit diagnostic. Persistent 4xx credential failures still need the owner to inspect the grant/OAuth status; transport retry cannot override those decisions.

```sh
node --test quality/credential-broker.node.test.mjs quality/development-sync.node.test.mjs
node --import tsx --test packages/apps/core/tests/web-push.node.ts
```

These source fixes and tests do not themselves deploy a new runtime image. A host-side rollout is required; do not confuse webapp/API hot reload with an updated agent container.
