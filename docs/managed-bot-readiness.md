# Managed bot credential readiness

A green connection indicator means the runtime is connected, not that its provider
credential is configured, authorized, valid at the provider, or within quota.

The webapp checks fresh credential metadata before submitting a managed prompt.
It requires the session/agent/connection binding, matching account, available key
storage, and an explicit terminal grant for the configured provider. A worker grant
or another bot's grant is not sufficient. Codex requires its own ready OAuth grant;
an OpenAI API key is not a substitute. New-bot creation now explains this setup.
A failed check preserves the draft and does not enqueue the prompt or infer again.

This is a UX preflight, not an authorization replacement or provider connectivity
test. Broker authorization remains authoritative at each credential retrieval.
Credentials can be revoked or expire after preflight. Other clients are not gated
by this webapp helper. No credential is automatically granted or copied to new bots.

Runtime fallback errors no longer assume an unknown failure is an AI-key problem.
Known provider messages are preserved with existing redaction. Never automatically
replay failed/uncertain tasks: tools may already have run.

## Honeycluster screenshot investigation

The screenshot's generic error does not establish the underlying cause. The source
permits creating a bot before granting a provider credential and previously sent
prompts without a readiness check. These gaps have been addressed in source.
The Honeycluster instance's current credentials and runtime failure have not been
verified: the available sandbox has no signed-in development account, Docker socket,
Docker executable or SSH executable. Local session history belongs to the older
agent ID and is not evidence of this Honeycluster failure.

From an authorized host/account session, inspect Honeycluster's selected provider,
model, explicit connection grant and sanitized runtime error. Distinguish broker
unavailability, OAuth reauthorization, provider quota/model access, context overflow,
and runtime failures. Do not change credentials, reset history, retry started work,
or restart unrelated agents merely because the fallback text mentions a key.

The webapp preflight requires the updated web build; runtime error changes require
a prepared runtime image and an approved single-agent update. Source validation is
not evidence that Mason has been updated or Honeycluster repaired.

Validation: `quality/managed-prompt-preflight.node.test.mjs`, existing credential
broker node tests, and webapp/agent-runtime TypeScript checks.
