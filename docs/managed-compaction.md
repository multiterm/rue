# Managed-agent compaction

## Status

The durable core state machine, authenticated HTTP transport, verified manager dispatch, Pi runner adapter and capability-gated webapp action are implemented. The runner calls Pi's native compaction, flushes the session file and directory, and acknowledges only its result. Unsupported hosts keep Compact disabled.

**Mason development rollout verified:** the documented SSH identity (`~/.ssh/github`) resolved the authentication failure caused by using default identities. The idle agent was stopped/resumed through revision-checked manager actions. Worker generation 7 advertises `managed-compact-v1`, and the resumed runtime publishes Pi status through the authenticated API. Enrollment checksum, all 11 original Pi session entries (byte-for-byte), workspace contents, VM mount boundary and active `abby` context were preserved. Private VM backups and previous image tags remain available.

No live compaction or model inference was requested. Deployment and deterministic compaction tests do not establish provider quota.

This is compaction of the managed Pi session through its manager, not compaction or deletion of Rue's displayed chat. It may make a model request using that agent's existing, independently granted credentials. It does not grant credentials, change providers, run tools or replay a prompt.

## Implemented safety boundary

Migration 23 adds `managed_compactions`. Commands pin the owner, agent, configuration revision, host generation and runtime boot. Requests require explicit model-use acknowledgement and `managed-compact-v1`; workers advertise it only after verifying an immutable runtime image labelled `io.rue.compact=1`.

The state machine is:

```
queued -> assigned (manager) -> running (one runtime claim) -> succeeded | failed
   |          |                    |
cancelled  cancelled             uncertain
```

- Only an idle, connected, observed-running agent can receive a new request. Existing queued, claimed or running prompts take precedence. A compaction reservation prevents new prompt claims.
- An authenticated manager must assign the command before an authenticated, lease-bound runtime can claim it. Both identities must belong to the exact agent/host.
- Only the first committed claim returns an execution nonce. Duplicate claims, including those from another database handle after a lost reply, never return execution authority again. Only the nonce hash is stored.
- Queue lifetime is five minutes; execution is bounded to two minutes. A command that might have executed becomes **uncertain**, never queued again.
- Uncertain execution holds that runtime's prompt gate. Explicit stop/resume or another valid runtime fencing transition is required to release it; an expired command alone is not enough.
- Reload drains an already-running compaction; its old, still-valid grant can acknowledge completion before replacement. Stop, destruction, revocation, boot replacement and runtime-instance takeover fence late acknowledgements.
- Reusing a request ID returns the original result, including cancellation or uncertainty. Changed intent conflicts. Preview limits are 24 new requests per agent per day and 1,000 retained command tombstones per agent; tombstones are not silently pruned to permit replay.
- Command metadata contains no model summaries, prompt text, raw provider errors or credentials. Core transitions leave messages, parts, session metadata and lifecycle revisions untouched.

## Runtime executor contract

`ManagedCompactor` reserves locally before claiming, rejects concurrent execution, validates the bounded ticket and checks idle state again after the asynchronous claim. This second check matters: Pi's manual `session.compact()` first aborts any active agent operation. The adapter must never invoke it while other work is active.

The executor discards the returned summary, persists the existing Pi session before acknowledgement, and reports only `succeeded` or `failed`. Lost claim/acknowledgement responses, persistence failures, authority loss and deadlines hold the local prompt gate and invoke a runtime-fencing callback. Late results cannot send a success acknowledgement or release the gate. There is no automatic retry.

## Transport and validation

Account routes: `GET/POST /managed-agents/:id/compactions`. Supervisor routes: `POST /worker-client/:id/agents/compactions` and `.../compactions/:command/assign`. Runtime routes: `POST /terminal-client/:id/compactions/{poll,claim,ack}`. Nonces travel only over authenticated runtime responses/acknowledgements, never account metadata.

Tests cover transport loss, durable claims across database handles, expiry, runtime/host fencing, concurrent prompts, verified manager dispatch and the real Pi SDK's compaction persistence. The SDK integration test supplies a deterministic summary hook: it proves session persistence and absence of mirrorable assistant messages, not live model inference.

## Development rollout procedure

Use the documented SSH identity, build the supervisor and capability-labelled runtime images, and inspect current agent activity before any stop/replacement. Preserve enrollment, Pi history, volumes, encryption keys and the Abby Docker context. Stop/drain through existing revision-checked controls before changing immutable runtime policy; do not swap images underneath running agents. Verify reported capability and Pi status after rollout. Compaction itself remains an explicitly consented action and can fail if the selected model lacks a valid grant or quota.
