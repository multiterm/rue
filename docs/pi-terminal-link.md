# Pi terminal linking

Status: **development bridge implemented**. See [Remote computers](remote-computers.md) for current setup, limits, and test evidence. The notes below record the original pairing design and implementation requirements; they are not a current availability checklist. The extension must be explicitly loaded on each computer and linked by its user. Production is not enabled by this change.

## Intended flow

1. A trusted Pi extension registers `/rue`. It starts no network connection merely by being loaded.
2. In the current terminal session, `/rue` creates a random verifier and sends only its SHA-256 challenge and the opaque Pi session ID to Rue over HTTPS.
3. The terminal displays a URL on the configured Rue web origin containing a random public request ID, never a token or OTP.
4. The user signs in with Keyname, checks the connection request, chooses a bot name, and explicitly approves. The browser displays a short-lived, single-use code. No automatic approval on page load.
5. The code is pasted into a terminal UI prompt, not a model message or slash-command argument. Exchange requires both the code and the terminal's original verifier.
6. Rue creates an owner-scoped bot and an inactive connection credential. The terminal displays the server-verified account subject and scope for confirmation before activating the connection.
7. New user/assistant text is mirrored bidirectionally. Dashboard prompts require local approval before running. Existing Pi tool permissions and approval extensions remain authoritative.
8. `/rue disconnect`, dashboard revocation, expiry, or bot deletion stop future bridge access. Reconnection must never bypass these checks.

## Implemented foundation

Migration 5 adds `terminal_pairing_requests` and `terminal_connections`. The storage module implements:
- Five-minute pairing expiry and a bounded pending-request pool.
- Owner approval with a one-time, 12-digit code; repeat approval cannot replace the owner or regenerate the code.
- Terminal-verifier binding, durable failed-code counters, and five-attempt lockout.
- Transactional single-use exchange; replay cannot create a second bot.
- A random 256-bit, seven-day token, stored only as a hash on the server.
- Explicit activation, owner-only revocation, and connection/session/owner checks on authentication.
- Cascading credential removal on bot deletion.

The storage layer takes an already verified owner subject; it is **not itself an HTTP authentication boundary**.

The opt-in HTTP boundary now provides:
- `POST /terminal-client/requests` and `/exchange`: bounded, validated anonymous handshake endpoints.
- `POST /terminal-client/activate`: bridge-token authorization plus explicit confirmed owner subject.
- `GET`/`DELETE /terminal-client/connections/:id`: connection-scoped status and self-revocation, including declining an inactive grant.
- `POST /terminal/requests/:id/approve`: verified Keyname human identity and expected-owner check.
- `GET /terminal/connections` and `DELETE /terminal/connections/:id`: owner-scoped listing and revocation.

Terminal credentials are rejected on account routes before contacting Keyname. Client namespace unknown routes terminate without falling through. Pairing bodies are capped at 4 KiB; errors do not reflect input. Responses use `no-store` and `no-referrer`. Fixed-size per-application budgets cap anonymous requests/exchanges at 60/minute and credential requests at 600/minute; they do not trust forwarded IP headers. These conservative global budgets may limit legitimate concurrent clients and need load/abuse review before enabling broadly.

Linked-bot messages currently fail closed with `terminal_transport_unavailable`, including after session metadata edits or revocation, instead of invoking a cloud provider. Browser SDK methods support approval, listing, and revocation; approval refuses HTTP redirects. The browser screen and Pi client are not implemented yet.

## Required before enabling

### API and browser
- Wire the implemented authenticated approval boundary into the browser and validate account switching in browser tests.
- Separate terminal-only authentication namespace. A bridge credential must not authenticate ordinary account, settings, or other-bot APIs. Do not repurpose existing device records as bearer credentials.
- Terminal-linked bots must never silently fall back to cloud-provider execution when the terminal is offline, unconfirmed, expired, or revoked.
- Browser flow survives sign-in without storing OTPs or tokens in browser persistence. Only the public pending request ID may be retained.
- List/revoke connections and show offline, awaiting-approval, running, interrupted, and disconnected states.

### Durable realtime bridge
- Outbound-only terminal connection; no listener or open port on the user's workstation.
- Scope/revocation checks at connection establishment and throughout stream delivery.
- Durable command IDs, origin metadata, event revisions, bounded queues, deduplication and reconnect reconciliation. Replayed dashboard messages must not be echoed back as new user messages.
- Serialize local and remote turns. Never interrupt local work or automatically replay an ambiguously dispatched command after a crash; expose interrupted state for manual recovery.
- Synchronize new user text and assistant text only by default. Do not upload system prompts, provider keys, session files, reasoning, tool arguments/results, environment values, or prior history.

### Pi extension
- Use supported `registerCommand`, `message_start/update/end`, `agent_settled`, and session lifecycle APIs, not direct session-file editing.
- Use `sendUserMessage` with command/template expansion disabled for accepted remote text. No remote slash-command dispatch.
- Store bridge credentials and an outbox privately, outside the project and Pi transcript; bind them to API origin and the exact Pi session. Forks/new sessions do not inherit access automatically.
- Abort/clean up resources on reload, session switch, fork, and shutdown. Reject stale callbacks from the previous session.
- HTTPS only, no cross-origin redirects carrying credentials, bounded error handling, and no secret-bearing diagnostic logs.

### Validation and release
- Keep HTTP ownership, approval, token-scope, revocation, malformed-input and quota regressions passing; storage tests cover durable brute-force lockout. Add real-network transport tests when the relay is implemented.
- Real HTTP streaming/reconnect tests and Pi extension tests for echo suppression, local/remote concurrency, lost acknowledgements, session replacement and credential isolation.
- Responsive browser approval/link/revoke regressions, followed by a user-approved live pairing test.
- Install the reviewed local extension without replacing unrelated Pi settings. User runs `/reload`, then `/rue` to opt in.
- Respect the requested Git-first deployment workflow. Do not enable this by uploading a working-tree bundle or manually editing sandbox files.
