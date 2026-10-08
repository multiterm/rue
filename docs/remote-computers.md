# Remote agents (development)

Rue can relay prompts and new text messages to an explicitly paired Pi session on
a local or remote computer. The connection is outbound HTTPS: no inbound ports
or SSH credential upload is required. Provider keys use the separate encrypted
AI-key vault and explicit machine grants; [updated Pi links can load them in memory](provider-key-loading.md).
Never put SSH keys or executable host commands in pairing configuration.
Each link is scoped to **one account, one bot, and one Pi session**. A database
constraint enforces one bot per Pi session within an account. Re-pairing an active
session is rejected; use `/rue resume`. Renewing a revoked/expired link reuses its
bot/history, rotates its credential, cancels old unfinished commands, and resets
remote prompting to disabled. If a saved link has expired or been revoked, run
`/rue` and explicitly confirm replacing the saved link before pairing again. Pair additional Pi sessions separately, even on the
same physical computer.

Cloud and remote bots coexist: **Add new bot** creates a cloud bot using server
Agent settings. Pairing creates a remote bot (it does not convert a cloud bot).
The bot list and conversation header label **Cloud · Rue server** or
**Remote · computer name · connection status**. Remote-computer settings show the
linked bot and its ID. Agent location is separate from where its model provider
runs; a remote Pi session may still call a cloud model provider.

## Link a computer

1. On that computer, configure/login to your provider in Pi as usual. Codex OAuth
   and API keys stay in Pi's local credential store. Choose the model and review
   local tool/approval permissions there.
2. Start an interactive Pi session with the reviewed extension:
   `pi -e /absolute/path/to/rue/extensions/rue/index.ts`.
   The extension is inert until you invoke `/rue`; it is not globally installed.
   Tested against Pi 0.85.1's extension API (including disabled command expansion).
3. Run `/rue`. Enter the Rue API and dashboard HTTPS origins. Development currently
   uses `https://3668e4ec-138a8a71.sandblocks.dev` and
   `https://3668e4ec-b31185d9.sandblocks.dev`, respectively.
4. Confirm text sharing. Open the displayed dashboard link, sign in to your
   intended Keyname account, name the computer, and click **Approve computer**.
   Approval is never automatic. Only the public request ID goes in the URL.
5. Paste the one-time code into Pi's **local input dialog**, not chat or command
   arguments. Compare the account subject shown by Pi with the dashboard, then
   explicitly confirm it. Pairing expires after five minutes.
6. Open Rue **Settings → Remote agents**. Enable remote prompts for the link.
   Select its new bot in the dashboard and send a prompt. Paired connections trust
   remote prompts by default; the existing model, tools and tool-approval
   extensions remain authoritative. No remote slash-command/template expansion is allowed.

Local user/assistant text after linking is mirrored, including intermediate
assistant commentary and final answers. Local assistant replies stream through
versioned snapshots into the same chat message instead of waiting for the whole
message to finish. Unsent snapshots are coalesced; retries reuse the event ID and
version, and older snapshots cannot overwrite newer or finalized text. Text over
100,000 characters is split into continuation messages rather than silently
truncated, including long dashboard-triggered turns. The private outbox remains
bounded (100 entries / 1 MB); exhausting it explicitly stops sync and notifies Pi.
This is forward synchronization after pairing, not historical-session import.

Dashboard-triggered turns now mirror each assistant message independently, in source order around tool calls. The durable command's aggregate result is retained for bookkeeping but its duplicate transcript bubble is hidden. This fixes final answers appearing above later tools in the original response bubble. Snapshot retries remain idempotent; SSE refreshes are batched at 250 ms rather than 2.5 seconds. The bridge still polls every 1.5 seconds, with dashboard polling as fallback—this is not token-by-token transport.

Tool cards default to a compact header (tool, path/command, status) and at most five preview lines, capped at 140 characters per line. Click the header or preview to expand all arguments, output and diffs; long expanded sections scroll and can be copied in full. Collapse is display-only: no stored content is removed. New snapshots carry a minimal tool identity/chunk descriptor so large calls spanning transport messages render as one card. Old fenced tool transcripts also use compact cards. Expansion stays open while the same call streams updates.

Tool calls (**arguments, status, text output and available edit diffs**) are shared by default for paired links. **`/rue hide-tools`**
stops future sharing; **`/rue share-tools`** re-enables it. Neither removes already
uploaded or queued output. These commands do not change prompt trust. Tool output
can contain file contents and secrets printed by commands: sharing uploads that
text to the linked Rue account. The pairing dialog explains these defaults. Results are labeled by tool name, with error markers and fenced text;
images and arbitrary tool metadata are not serialized.

System messages, provider credential stores and pre-existing session history are not read/uploaded by the extension. Exposed thinking is a separate, opt-in capability described below. New assistant text can still refer to its
local context: review what you choose to share and which remote prompts you approve.
Remote turns block competing local input rather than interrupting local work.
Remote prompts are trusted by default after explicit pairing/account verification.
**`/rue untrust`** restores per-prompt approval; **`/rue trust`** re-enables trust.
These commands do not bypass Pi's underlying tool permissions. Both trust and
tool-sharing preferences are saved locally, scoped to the link's API origin and Pi
session. Explicit opt-outs survive `/reload` and `/rue resume`; old saved links
without those preferences adopt the enabled defaults on resume. Malformed stored
values fail closed rather than enabling a capability. The dashboard cannot set
these local preferences. Active trust is cleared on shutdown/session change;
only an explicitly resumed link restores its saved preferences.

`/rue disconnect` stops an active remote turn and revokes the link. Re-pairing
creates a fresh link with trust and tool sharing enabled; thinking sharing starts disabled. `/rue status` reports all three policies.
Initial linking still requires interactive pairing and account verification;
this does not add unattended pairing or remove the dashboard's remote-enable gate.

## Exposed thinking (opt-in)

After updating the extension, run `/reload`, then `/rue resume`, then **`/rue share-thinking`** in the linked Pi session. No re-pairing is required. **`/rue hide-thinking`** stops future thinking sharing. The preference is saved independently of tool sharing and prompt trust. New links, legacy links without this preference, and malformed preference values keep thinking private. Enabling sharing partway through a block does not backfill that private block.

Only plaintext from assistant `thinking` blocks explicitly exposed by Pi is eligible. Signatures, encrypted/opaque data, blocks marked redacted, and hidden model internals are never forwarded. This does not import past thinking or add cloud-agent reasoning support. Exposed thinking can contain sensitive context; enable sharing only for a Rue account you intend to receive it. Hiding thinking does not delete already uploaded or queued material.

Thinking is stored in dedicated `reasoning` parts and rendered as separate, collapsed **Thinking** cards in source order alongside assistant text and tools. Previews use the same five-line/140-character caps as tool cards. Click to expand/copy the full text; streaming updates preserve expansion. Large blocks are split into bounded transport chunks, then grouped into one card. Replies and command aggregates exclude thinking text. The existing private outbox limits still apply; sharing stops explicitly rather than silently dropping content when they are exceeded.

## Attachments from Rue

The composer supports photos, screenshots, videos and other files interleaved with
text. See [chat attachments](attachments.md) for size limits, private storage and
agent format support. Remote attachment downloads occur only after prompt approval
(or locally saved trust) and the durable start marker. Images go to Pi as image
content; other files are private temporary files for tools, removed when the bridge
stops. This does not enable Pi-to-Rue image mirroring.

## Connection reliability

[Pi ↔ Rue connection hardening](connection-hardening.md) documents the persistent WebSocket transport, protocol-2 leases, independent heartbeats, bounded upload batches, retry/backoff, diagnostics and no-replay safeguards. Healthy sockets stay open; queue notifications and output updates are event-driven, with HTTPS polling only as a fallback. Deploy the API first, then `/reload` and `/rue resume` to use bridge API 7; no re-pairing is needed for a valid link. Older extensions retain legacy timeouts until updated. The agent header now contains the connection status dot, refresh and reconnect controls; click the dot for last-reported diagnostics.

## Queue above the composer

A selected remote bot shows the pinned queue panel above its input when at least two requests are active: **queued**, **awaiting local approval** (`claimed`), or **working** (`running`). A single request keeps its status in the conversation. Expand the panel to see FIFO order; long prompts and the expanded list scroll without covering the input. Completed, failed, rejected, cancelled, interrupted and approval-expired runs leave the active queue, but their messages remain in history. Never-claimed requests do not expire merely because they waited behind a long task.

The account-scoped `GET /terminal/computers/:id/queue` endpoint returns only active prompt details—not credentials, results or attachment bytes—and is not limited to the last ten historical runs. Queue data refreshes on push events while SSE is healthy, with two-second polling only during stream loss. A failed refresh retains the last known queue with a stale-status warning and Retry button. Switching bots isolates the queue and resets expansion; a newly arriving batch starts collapsed. This shows Rue's durable remote-prompt queue, not a paired Pi terminal's private local input queue or a new cloud-agent queue.

### Recovering messages expired by older servers

The queue response also includes an owner-scoped `recoverableCount`. **••• → Expired queued requests** opens a dedicated settings-panel page, even when no active queue is displayed. It is also available from the bot settings page. The page loads up to 20 recent eligible items on demand; selecting a request opens a separate confirmation dialog. No recovery banner occupies the composer area.

Only `expired` rows with no claim/start/instance/lease, no output version/result, and intact original messages/parts can be restored. The owner must explicitly confirm execution using the bot's current model and permissions. The original command/request/message IDs and attachment bytes are preserved; the request is appended to the queue tail. Retries do not duplicate messages or re-run a claimed task. The API enforces the existing ten-active-request limit and server-side FIFO claims.

Claimed, started, interrupted, cancelled and deleted-history items are not recovered automatically. Review other ways you may already have requested the same work before requeueing. The stale expiry inbox/outbox entry is cleared on restoration; an already delivered device notification cannot be recalled.

Endpoints: `GET /terminal/computers/:id/queue/recoverable` and owner-only `POST /terminal/computers/:id/queue/:command/requeue` with `expectedSessionId` and `acknowledgeRequeue: true`. Updating the API/webapp is sufficient; no agent-image upgrade is required for queue retention.

## Controls and recovery

- Settings → Remote agents lists Pi connections and status; Manage agent contains expiry, name, prompt policy, and revocation controls. Run state remains in the conversation and queue.
  Names may be changed independently of the prompt policy. Revocation stops future
  authenticated relay requests and the connected client aborts its remote run.
- `/rue status` reports local connection status. `/rue disconnect` stops the local
  bridge and revokes the credential; if networking is unavailable, revoke it from
  the dashboard too. Completed tool side effects cannot be undone by revocation.
- `/rue resume` explicitly reconnects the same Pi session and API origin. It does
  not replay commands whose dispatch is uncertain. Reload/new session/fork/tree
  navigation closes the old bridge. Forks and new sessions must pair separately.
- Bridge credentials and a bounded outbox live under
  `~/.local/state/rue/pi-links` (0700 directory, 0600 files), outside the repository
  and Pi transcript. A per-link lock prevents simultaneous local writers. Remove
  a stale `.lock` only after confirming its owning process has exited.
- Linked connection credentials expire after seven days; there is no silent renewal. Managed credentials have a separate manager-controlled lifetime. Queued, never-claimed messages survive ordinary waiting, disconnects, managed stop/resume and temporary credential expiry; execution still requires fresh valid authority. Explicit remote-disable, connection/host revocation and re-pairing retain their cancellation semantics.
- Local approval still expires five minutes **after claim**. Protocol-2 runs are lease-fenced and capped at 24 hours from start; protocol-1 runs retain a ten-minute execution bound, measured from start rather than queue creation. Lost heartbeats interrupt claimed/running work; they never automatically requeue uncertain execution.
- SQLite stores durable command IDs, idempotent output versions and deduplicated
  local messages. SSE invalidates dashboard snapshots; linked conversations also
  poll persisted messages/parts for recovery. This is not durable SSE history.
- Failed or revoked links never invoke Rue's cloud provider as a fallback.
  Server-side Agent settings do not configure paired computers.

## Deployment and evidence

The bridge is enabled by server startup only for `SANDBLOCKS_RUNTIME=development`
(the existing development container's legacy `develop` tag is also recognized)
or an explicit `RUE_TERMINAL_BRIDGE=true`, and always requires Keyname auth.
Preview and production are not changed by development sync. Preserve the API's
private database mount and matching encryption key; migration 6 adds relay state
and migration 7 adds session uniqueness. Existing duplicate account/session
bindings must be resolved explicitly before migration 7; migration fails rather
than silently deleting bots or conversation history.

After updating the extension source, wait for the current Pi turn to finish,
then run `/reload` followed by `/rue resume` in the same Pi session. Trust and
tool sharing default on unless explicitly disabled for that saved link. Vite hot reload updates the webapp, **not** the extension code
already loaded inside Pi. Deploy the API's snapshot support before reloading the
new extension. Existing links do not need to be re-paired.

Tests cover real HTTP prompt delivery, persisted replies, SSE notification,
local streaming, full long-response tails, monotonic snapshots and finalization,
default-on trust/tool sharing, persistent independent opt-outs, legacy migration,
lost-ack retry, owner/credential isolation, revocation, interrupted dispatch,
queue bounds, local-only credential handling, extension lifecycle, disabled
command expansion, and responsive approval/settings screens. Identity and model
execution are simulated in automated tests. A real user must still complete the
pairing and run a live model turn to validate their own computer/provider.
