# Automatic provider keys in manual Pi

Rue Bridge API **8**, tested with Pi SDK **0.85.1**, can use explicitly granted OpenAI, Anthropic, Google and OpenRouter API keys. Run `/reload`, then `/rue-dev resume` (or `/rue resume`). In Rue Settings → AI keys, save the key and explicitly grant that Pi link access. Enrollment/pairing alone grants nothing. Select a supported model in Pi; Rue does not change the current model automatically.

## Resolution and lifecycle

- There are no extension-factory or session-start network calls. Hooks install only after explicit pairing/resume and a live execution lease.
- Existing local API keys, environment keys, OAuth and runtime overrides take precedence. Other extensions' registered providers are left alone.
- Pi's cached/built-in catalog is loaded without a catalog network refresh or reading/writing `auth.json`. Provider composition remains Pi-owned: changing/removing `models.json` credentials is not frozen by Rue's fallback.
- Availability checks use `{ instance, availability: true }` at the existing credential endpoint. They return `{ provider, granted }`, not plaintext, and do not decrypt keys or create key-access audit events. Worker metadata checks also require its generation.
- Request-time auth retrieves a granted key under the live connection/instance/lease. The broker response is bounded, HTTPS-origin-bound, nonredirecting, no-store and cancellable, with an eight-second deadline. Late results from stopped/replaced links are discarded.
- There is no positive credential cache and no auth-file, environment-variable or command-string installation. Values enter Pi's literal `ModelAuth` channel, never its `!command`/`$ENV` configuration interpreter.
- Disconnect, shutdown and session replacement remove owned registrations without deleting a newer registration from another extension. Local credentials are not removed. A stopped bridge cannot retrieve more keys even before provider cleanup.

Revocation stops future reads, not a provider request already sent or plaintext already received by a trusted host. Rotate the provider key after compromise. Existing local credentials may continue working independently of a revoked Rue grant. Conversely, Pi's `/logout` removes local credentials, not the independent Rue grant: revoke that grant in Rue or disconnect the link to stop the fallback. The receiving Pi process and its configured provider endpoints are trusted with the granted credential; this is not protection against a malicious local extension or tool.

## Limits and evidence

The Add new key modal now reads provider authentication metadata and offers a separate Codex device-code sign-in instead of an API-key input. OAuth is encrypted in its own vault, with explicit account confirmation and no automatic grants. Codex agents on verified OAuth-capable hosts can receive access-token-only delivery after an explicit Agent grant. Refresh tokens stay server-side; a connected account is not proof of an agent grant, entitlement or quota. Other provider IDs and custom registered providers are not managed by this key UI. Managed runtime 0.2 uses the broker through its Agent identity; a grant to the Host alone does not authorize its managed sessions. Saving a key does not validate the provider account or enable additional Rue cloud providers. Pi's existing local OAuth behavior is preserved; its active refresh credential is never copied into Rue. See [Codex OAuth](./codex-oauth.md) for sign-in, model selection, agent grants and the access-only runtime adapter.

Tests cover metadata-only checks, origin/instance/generation fencing, denial, response limits, stale results, literal command-like values, local-key precedence, live `models.json` removal and cleanup. Tests exercise the real pinned Pi SDK and actual Jiti reload, plus the core broker over local HTTP. External provider calls and authenticated deployed key retrieval were not performed.
