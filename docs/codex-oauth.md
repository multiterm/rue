# Codex OAuth integration

## Current status

The encrypted vault, refresh fencing, owner-authenticated device-code routes and webapp sign-in flow are implemented and tested. **AI keys → Add new key** reads provider authentication metadata: choosing **OpenAI Codex** replaces the API-key fields with OpenAI sign-in, a one-time code and explicit account confirmation. Refresh tokens remain server-side; the browser receives only temporary device-code/status metadata. Explicitly granted agents receive only expiring access tokens. Connecting/reconnecting grants no agent access.

**Agent grants, access-token delivery, native Pi Codex support and the webapp workflow are implemented.** Hosts advertise `managed-codex-v1` only for verified immutable runtime images labelled `io.rue.codex-oauth=1`. Older hosts cannot create/configure or bootstrap Codex agents. Cloud model choices remain unchanged.

Mason's development rollout is verified: generation 9 advertises the new capability and its agent is running with preserved enrollment, session and workspace. Existing model configuration and grants were not changed. The live saved OAuth connection reports ready, with no agent grants yet. No live Codex inference or refresh was performed by this rollout.

No local Pi auth file is imported or modified. Real account authorization and quota require the user's independent sign-in; synthetic tests do not establish those.

OpenAI API keys and `openai-codex` OAuth are different credentials with different billing/access. An API quota error does not establish whether Codex subscription access is available. Never paste OAuth access or refresh tokens into the API-key input.

Do not clone an active Pi OAuth credential into Rue. Both stores could rotate the same refresh token independently. Prefer an independent, provider-authorized Rue device-code sign-in. Import is only safe as an explicitly reviewed, exclusive handoff; this implementation does not automate that handoff.

## Implemented foundation

- Migration 21 adds a dedicated OAuth credential table. AES-GCM associated data binds ciphertext to owner, OAuth namespace and provider. Existing API-key ciphertext, grants and the deployment encryption key are preserved.
- Storage accepts only bounded, canonical Codex OAuth credentials. JWT decoding checks account/expiry consistency, **not authenticity or Rue ownership**; claims never establish a Rue principal.
- Metadata/audits exclude access tokens, refresh tokens and raw provider responses. Browser-facing integration must never return either token.
- Save/reconnect and removal are revision-checked, clear all previous Codex grants and invalidate outstanding refresh claims. Removal leaves a revision tombstone.
- OAuth grants are agent/terminal-specific; no supervisor/host grant is supported. Existing terminal identity reset/revocation cleanup also invalidates OAuth grants.
- Refresh rotation takes a durable SQLite claim before network I/O. Concurrent requests on one handle share a promise; another handle/process cannot issue a second refresh. Token persistence is conditional on the same claim, preventing a late result from overwriting logout or replacement.
- Interrupted, failed, malformed, timed-out or account-changing refreshes require reauthorization. An uncertain refresh token is never automatically retried, even after restart. An adapter ignoring cancellation is bounded by a six-second deadline and cannot publish a late result.
- The machine-only storage primitive requires a synchronous live-authority validator and checks it and the explicit grant again after refresh. It returns access-token-only request auth, never a refresh token. The terminal HTTP delivery route validates token, instance and live lease in that callback, including after an asynchronous refresh.
- Refresh uses the pinned Pi Codex public client/issuer protocol, with fixed HTTPS endpoint, no redirects, bounded response bodies and sanitized errors. A contract test compares the issuer/client request with the native Pi provider.

Already delivered access tokens may remain valid until provider expiry. Rue revocation prevents subsequent delivery; it cannot erase copies or promise immediate provider-side invalidation.

## Device sign-in safety

Migration 22 records owner-bound request IDs and login status, never device secrets or tokens. Starts are idempotent; polling is serialized and rate-limited to the provider interval. Limits are five allocated intents per owner per hour and 128 active intents across the core. Intents expire after 15 minutes; metadata tombstones are retained for 24 hours. A cancelled intent cannot be restarted accidentally. Interrupted sign-ins fail closed after core restart rather than replaying an uncertain code exchange.

The browser must confirm the returned OpenAI account before the encrypted credential is committed. Save uses the revision captured at login start. Cancel/provider switching/closing the modal aborts the intent; late results cannot revive it. Pending review credentials are encrypted in server memory and discarded on cancellation/expiry. Provider error bodies are never returned. This flow uses one coordinated core; multi-replica login coordination is not implemented.

Verification includes HTTP owner/consent/revision/lease fencing, concurrent refresh and late authority loss, the real Pi ModelRuntime with access-only auth and local OAuth precedence, synthetic Codex SSE responses, and the model → grant → resume browser workflow. Provider interactions are mocked; account/device-code eligibility and quota are not proven by these tests. Native desktop/mobile review remains deferred.

## Using OAuth with a managed bot

1. In **AI keys → Add new key**, choose **OpenAI Codex**, complete the independent OpenAI sign-in and confirm the account.
2. In the bot's **Change provider / model**, choose **OpenAI Codex** and a supported model. Applying stops the runtime with explicit consent; permissions and workspace are preserved.
3. In **Update AI key**, select the saved **OpenAI Codex · OAuth** connection and acknowledge agent access. Alternatively use its **Manage access** action in AI keys. Host-wide OAuth grants are prohibited.
4. Resume the agent separately. Connecting or granting never sends a model request, changes the model implicitly, proves quota, or replays previous failed work.

Human grant endpoint: `PUT /provider-oauth/openai-codex/grants`, with owner/revision, terminal target, exposure acknowledgement and enabled flag. Machine endpoint: `POST /terminal-client/connections/:id/provider-keys/openai-codex`, with the existing terminal bearer token and current instance. Availability returns metadata only; delivery returns `{provider, credentialType, accessToken, expiresAt}`. Refresh credentials never enter bootstrap, browser storage, environment variables or agent files.

The Pi adapter resolves access for every request without a positive token cache. Pi's `ModelAuth.apiKey` field is its literal request-bearer transport slot, not an API-key credential persisted to a store. Availability is labelled OAuth, and existing local Pi OAuth remains authoritative. Rue-backed Codex streams use SSE with zero retries and no redirects, preventing uncertain WebSocket fallback or network-error replay.

**OAuth connected**, **agent grant**, **host capability**, and **model entitlement** remain separate facts. An expired or uncertain refresh requires a new sign-in; reconnect clears grants. Explicitly authorize any live inference canary and never replay the earlier quota-failed prompt. Managed compaction is independently consented maintenance; see [compaction](./managed-compaction.md).
