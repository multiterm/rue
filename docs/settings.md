# Settings and shared provider keys

The webapp settings modal groups Appearance, Models, AI keys, MCP, Agents, Hosts, API keys, Server, and Support. Agents contains shared TanStack tables for managed and manually linked Pi sessions. API keys uses the same table controls and Tenancy-backed issuance modal; authorization remains server-side. Desktop uses a compact sidebar; mobile uses horizontally scrollable tabs. Arrow/Home/End navigation, focus containment/restoration, and independent content scrolling are supported. Security explanations move to the public [settings guide](../packages/apps/docs/src/content/settings.md), except consent that is needed at the action itself.

Design references reviewed: OpenCode's [web UI](https://opencode.ai/docs/web/), [providers](https://opencode.ai/docs/providers/), [models](https://opencode.ai/docs/models/), [MCP servers](https://opencode.ai/docs/mcp-servers/), and [server](https://opencode.ai/docs/server/) documentation. These informed the categories, not claims of feature parity: Rue supports explicitly selected managed stdio MCP tools, not arbitrary server switching or full MCP transport parity.

## Credential broker

Migration 10 adds `provider_keys`, `provider_key_grants`, and `provider_key_audit`. OpenAI keeps its existing `agent_settings` ciphertext, AES-GCM associated data, revision, and cloud Pi integration. Other providers (Anthropic, Google, OpenRouter) use owner/provider-bound AES-GCM storage under the existing encryption key. No new credential key or data reset is generated.

Account API:

- `GET /provider-keys`: owner-scoped configuration metadata, suggested model and grants, never keys.
- `GET /provider-keys/catalog`: pinned Pi runtime model metadata for the four supported key providers, not account entitlement verification.
- `PUT /provider-keys/:provider`: expected owner/revision plus a key or null to remove it; optional supported `model` selects an Add new bot default. Migration 20 stores this non-secret preference separately, in the same revision-checked transaction. Removal clears the preference.
- `PUT /provider-keys/:provider/grants`: expected owner/revision, target `{type: terminal|worker, id}`, enabled flag, and explicit exposure acknowledgement.

Credential delivery:

- `POST /terminal-client/connections/:id/provider-keys/:provider`: terminal bearer token and `{instance}`.
- `POST /worker-client/:id/provider-keys/:provider`: worker bearer token and `{instance, generation}`.

Delivery requires an explicit grant plus the existing current-credential/instance/lease checks. Account tokens cannot use delivery routes; worker/terminal credentials cannot use account settings. Worker delivery retains the managed-worker/Keyname feature gate. Responses are private/no-store, request bodies are bounded only on broker routes, and successful access is audited without recording plaintext. Existing large transcript uploads must not inherit the broker's small request limit.

Key removal clears grants. Identity revocation and expired-link re-pairing clear target grants and advance provider revisions. Re-pairing preserves bot/history identity but not prior key-sharing consent. Ordinary worker credential rotation retains the same host identity and its grants while fencing the old credential.

A host grant is trust in the entire host supervisor. It is not a scoped managed-agent grant. Revocation cannot recall an already retrieved key. Future agent runtimes must not receive the supervisor credential or Docker socket.

## Current limits

- The broker is HTTP integration-tested. Manual Pi Bridge API 8 loads explicitly granted keys in memory with local-auth precedence; see [provider-key loading](provider-key-loading.md). Managed runtime 0.2 also uses the broker through its Agent identity. A Host grant does not automatically grant keys to managed sessions.
- Cloud chat still supports OpenAI; storing other keys does not enable those cloud providers.
- Worker 0.1 reports an authoritative managed-agent count of zero. Unknown older-API counts display as unavailable.
- Managed lifecycle, boot/restart fencing, explicit purge and stdio MCP are deployed in development. Approved host mounts and live generic Tenancy key rollout/verifier provisioning remain pending; the old project-binding API is removed. See [Mason](../deploy/worker/MASON.md).
- Provider-key validity/billing is not checked by saving it. Provider OAuth is not stored through this API.

## Validation

Core tests cover metadata redaction, legacy OpenAI compatibility, encrypted storage, ownership, explicit consent, revision conflicts, instance/generation fencing, lease expiry, key removal, revoked credentials, ciphertext binding, and re-pairing without grant inheritance. Existing full relay tests protect large text/thinking/tool uploads.

Desktop/mobile browser tests exercise navigation, responsive geometry, model drafts, masked ephemeral key inputs, explicit grants/revocation, host status/counts, and pairing consent. Browser tests use mocked APIs; they do not prove provider authentication or an installed Mason runtime.
