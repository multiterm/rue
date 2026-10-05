# Pi ↔ Rue connection hardening

## Implemented: persistent WebSocket transport with relay protocol 2

The Pi extension uses bridge API version **7** and negotiates relay protocol **2** at explicit attach. Deploy the API first, then `/reload` and `/rue resume` in Pi. No re-pairing is required for a valid saved link. If Pi reports a bridge version mismatch, restart Pi and resume. An incompatible API fails closed.

Migration 8 adds protocol, lease, command timestamps and bounded health metadata without replacing existing storage. Older extensions retain protocol-1 behavior until updated; they do **not** gain the new leases automatically. Changing transport does not change the relay protocol or instance. A connection cannot switch relay protocol on the same instance. A new explicit attach fences the previous instance and interrupts its uncertain work.

### Persistent transport and bounded uploads

- When advertised by the API, Pi opens one authenticated **WSS** connection at `/terminal-client/socket`. Credentials are sent in its first frame, never in URLs. Browser-origin upgrades are rejected; browsers use the existing authenticated SSE connection instead.
- New queued commands and control changes push a notification to Pi. It immediately retrieves the authoritative command state over the socket; there is no fixed polling delay before dispatch.
- Text/tool snapshots and command transitions use correlated WebSocket requests with durable acknowledgements. A 40 ms coalescing window schedules pending output immediately; it no longer waits for a 1.5-second tick.
- Healthy sockets remain open. A small **15-second lease heartbeat** verifies authority and carries health metadata, not queued prompt text or transcript data. Control traffic remains independent of serialized uploads.
- WebSocket RPC reuses the HTTP route schemas, credential scope, instance fencing and storage operations. Pairing and large attachment downloads remain HTTPS.
- The browser reconciles computer health, the visible remote transcript and its queue every 10 seconds even while SSE appears healthy. Events still invalidate affected state with 100 ms batching; stream loss enables faster 2–3 second polling until push is restored. Transcript reads bypass the HTTP cache. Reconciliation only reads state: it never resends a prompt. An individual missed event must not leave a completed reply hidden until a manual refresh. An open stream receiving no bytes for 75 seconds (three server heartbeat intervals) is cancelled and reconnected, rather than remaining falsely healthy indefinitely. Normal 25-second server pings keep quiet streams open. Snapshot refreshes do not block consumption of incoming events.
- Each upload batch is limited to eight entries and a two-second soft budget between requests. HTTP requests (including body consumption) and socket acknowledgements have ten-second deadlines. A socket acknowledgement timeout closes the unhealthy connection.
- Full content stays in the bounded durable outbox. Snapshot ordering, coalescing and idempotent acknowledgements remain intact; a failed acknowledgement save restores the in-memory entry and stops sharing.
- New prompts are not claimed while uploads remain pending. Upload failures cannot be masked by a successful heartbeat.

### Retry and authority

Network errors, 408, 429 and 5xx retry with exponential backoff and jitter, capped at 15 seconds per lane. `Retry-After` seconds or dates are bounded to 15 seconds. Other HTTP failures—including unknown 409 conflicts—stop the bridge. Error bodies are not included in diagnostics.

A healthy socket is never periodically reopened. After transport loss, reconnect attempts use bounded jittered backoff and authenticate the **same existing instance**, without calling attach or replaying commands. After three consecutive socket setup failures, the link stays on HTTPS fallback until explicitly resumed. Unsupported runtimes/proxies also use the existing 1.5-second HTTPS fallback; `/rue status` and the connection-details dialog report the actual transport. Heartbeats/polling on fallback are not reconnects.

Only control reads and idempotent output uploads retry automatically. Claim/start dispatch transitions remain conservative: **a lost acknowledgement stops the bridge and never replays the prompt**. A fresh process never replays saved command output or executes an interrupted command. There is no automatic attach after authority expires.

### Renewable execution leases

- Protocol-2 connection leases last at most **60 seconds**, bounded by credential expiry. Only authenticated, same-instance control requests renew them.
- Claimed/running commands have their own persisted leases, renewed only while still valid and owned by that instance. Expired leases cannot be revived by a poll, output upload or start retry.
- Never-claimed queue entries have no age-based expiry. Local approval expires five minutes from claim; maximum protocol-2 execution duration is **24 hours from start**. Healthy runs can exceed ten minutes. Protocol 1 retains a ten-minute execution bound measured from dispatch, not time spent queued. Transport expiry does not itself dispatch or discard queued work; fresh authority is still required to claim it. Explicit disable/revoke/re-pair actions retain cancellation semantics.
- Pi checks authority with a 250 ms watchdog and again around execution boundaries. Deadlines are anchored to request start using a monotonic clock, with a one-second safety margin. Wall-clock checks conservatively stop on large sleep/forward jumps or backward jumps greater than one second; server clock rollback also fails closed.
- A delayed response cannot resurrect an expired local lease. All network work aborts when the bridge stops. Only a turn actually dispatched by this bridge is cancelled; unrelated local work is left alone.

JavaScript cannot run watchdog callbacks while the process or OS is suspended. On resumption, deadline checks fail closed; server lease validation independently rejects stale requests. This is not a claim that already-running external side effects can be undone.

### Diagnostics and merged header

`GET /terminal-client/connections/:id/receipts` provides read-only delivery evidence using that connection's active terminal credential. It returns at most 128 recent mirrored-message IDs, SHA-256 text digests, versions, and final flags; never text, credentials, or another connection's receipts. It does not renew authority or replay work. Matching a final receipt proves API persistence, not browser rendering.

`/rue status` reports the selected transport, connection/retry state, last heartbeat, lease expiry, last upload acknowledgement, retry count, upload failures, pending count/bytes, poll latency and a locally generated stop reason. No credentials or transcript content are included.

Polls send a strictly validated health report: numeric diagnostics, a transport enum, and an optional `agentWorking` boolean derived from Pi's idle/pending state. This includes locally initiated tasks, without transmitting task text. The owner-scoped computer API exposes it with server heartbeat/lease timestamps. Reports describe the **last received** state; a disconnected client cannot deliver its final local stop reason. Detailed server-wide metrics export is not implemented.

The separate connection banner has been removed. The sticky agent header uses its background fill and hosts the status dot, refresh and reconnect buttons. Click the dot for diagnostics. Green indicates a fresh connection, amber indicates delayed/failed health checks or upload retries, and red indicates a disconnected/revoked/expired link. Status also has accessible text; color is not the only cue. Cached data is explicitly marked as last reported, not proof of liveness. Reconnect is shown only for a server-confirmed disconnected state and is retained through failed background refreshes until the server reports recovery. Browser-clock lease expiry alone produces uncertainty, not a reconnect action. Freshness uses the server observation timestamp plus local elapsed time, with one deadline timer instead of per-second render intervals. Only an explicitly requested refresh changes the refresh button's busy appearance; background checks do not make it flash. The queue panel owns the fallback polling timer, while the working indicator observes the same cache without a second timer. Refresh and managed-runtime controls now live in the three-dot menu.

### In-thread working indicator

The unboxed avatar-and-status row appears at the end of the chat thread and scrolls with the messages. It is not pinned above the queue or composer and does not remain on screen when reading earlier messages. Cloud requests/streaming parts, remote queue states, and Pi's reported activity drive it; it is not tied only to the send HTTP request. Each bot has isolated activity state. Stale or failed remote health checks show “Checking agent status…” rather than silently presenting the task as completed. New local-Pi activity reporting requires `/reload` then `/rue resume`.

## Validation and remaining rollout checks

Real-socket automated tests exercise immediate command/output delivery with the periodic timer disabled, no periodic healthy reconnects, same-instance recovery, rejection of account credentials/browser origins/arbitrary RPC paths, and cleanup. Browser tests verify push suppresses fast polling, a missed reply appears through periodic reconciliation while SSE remains open, and stream loss restores faster fallback polling. Automated coverage also exercises slow/stalled uploads, independent heartbeats, retry delays, revocation, hung control requests, wall-clock jumps, bounded batches, persistence failures, lost claim/start/output acknowledgements, protocol mismatch, long-running lease renewal, stale-instance isolation, owner-scoped diagnostics, and merged-header states. Existing pairing, transcript ordering, attachment, privacy and browser suites remain required.

Still validate with an actual Pi session and real network disruptions, sleep/wake, and API process restarts before claiming production reliability. In-memory fault injection is not real-device verification.

## Deliberately retained as future work

gRPC is not required for this JavaScript/Pi integration: WebSocket provides bidirectional push over the existing HTTPS ingress without adding HTTP/2/gRPC-Web infrastructure. Durable outbox IDs and authoritative reconciliation recover socket notification gaps; browser SSE still reconciles after reconnect. Horizontal shared-store/event coordination and durable cross-process event cursors remain future work. Central metrics for stale-instance rejections, duplicate acknowledgements and interrupted runs can be added without recording content.
