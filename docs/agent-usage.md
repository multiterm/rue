# Agent usage

Open a bot's **Settings → Usage** for its separate usage page. Select the last
7, 30 or 90 days, a provider and a credential. Daily charts and exact tables use
UTC and show input/output tokens, cache-read/write tokens and estimated USD cost.
The token chart includes cache tokens as separate reported categories.

## Meaning of the numbers

- These are **reported runtime estimates**, not provider invoices, purchased-credit
  deductions, account balances or quota checks. Rue does not invent a conversion
  between tokens, dollars and provider-specific credits.
- Missing pricing is `null`, not zero. Codex subscription requests are deliberately
  unpriced. Mixed priced/unpriced totals show an unpriced-request count.
- Empty buckets mean no reports. They do not establish that no spending occurred.
- Pre-existing cumulative status counters cannot be split safely across providers,
  models or old credentials. They are not backfilled into this ledger.

## Credential attribution

The broker returns an opaque reference derived with a server-side HMAC from the
owner, provider and actual key. Key values and suffixes are never sent to the page
or saved in usage records. Saving/granting the same key does not split its history;
changing the key produces another reference. These identifiers depend on the
existing settings-encryption key, which must be preserved during deployment.

The provider wrapper captures the reference from the actual request's `apiKey`
option before streaming starts. A key change while that request is running cannot
relabel its result. Only successfully brokered matching keys are attributed.
Local credentials, credentials supplied by other paths and OAuth remain explicitly
unattributed rather than being guessed from the agent's current configuration.
References identify a particular key, but are not a user-managed credential-name
or multi-key vault feature.

## Collection and safety

SQLite migration 31 adds `agent_usage_events` and `usage_credentials`. The ledger
is scoped to the owner and bot session, and deduplicates by connection/event ID.
Deleting the bot session deletes its events; clearing conversation text does not
remove aggregate usage history. The ongoing PostgreSQL migration must include
these tables before a database cutover.

Updated managed/linked Pi provider wrappers collect `stream`/`streamSimple` final
usage, including tool-loop/compaction calls that use those wrappers. Linked agents
must opt into status sharing. The cloud Pi adapter also records per-response usage.
Legacy cloud adapters, deferred requests and image APIs are not instrumented by
this change. Calls without returned usage cannot be reconstructed reliably.

The API advertises `usageVersion: 1` during relay attachment. Older APIs do not
receive newly collected telemetry. Delivery requires the current terminal token,
connection and lease instance; owners cannot read another account's report.

Usage delivery has a separate persisted backlog, retained across runtime restarts.
Transient upload failures retry telemetry only, never model/tool execution. It
cannot block the conversation outbox. Storage failure or the 1,000-event backlog
limit produces a local notice and can cause reporting gaps; this is not an audited
financial ledger. Turning status sharing off pauses usage collection/delivery.

## Deployment and verification

Roll out the API migration first, then updated agent runtimes/extensions using the
normal storage-preserving and single-agent update flows. Existing containers do
not acquire new instrumentation from a webapp source refresh. No runtime rollout
or paid provider request was performed as part of source verification.

Tests cover request/key rotation attribution, unknown pricing, telemetry failure
isolation, ingestion lease/revocation checks, owner isolation, idempotency, UTC
bucketing and desktop/mobile page filters, empty/error states and response binding.
Browser tests use synthetic API responses; they do not prove live collection.
