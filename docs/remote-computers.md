# Remote computers (development)

Rue can relay prompts and new text messages to an explicitly paired Pi session on
a local or remote computer. The connection is outbound HTTPS: no inbound ports,
SSH keys, provider credentials, or executable host commands belong in Rue settings.
Each link is scoped to **one account, one bot, and one Pi session**. Pair additional
Pi sessions separately, even when they run on the same physical computer.

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
6. Open Rue **Settings → Remote computers**. Enable remote prompts for the link.
   Select its new bot in the dashboard and send a prompt. Pi asks for approval
   before each remote prompt; the existing model, tools and approval extensions
   remain authoritative. No remote slash-command/template expansion is allowed.

Local user/assistant text after linking is mirrored. Tool results/arguments,
reasoning, system messages, provider credentials and pre-existing session history
are not read/uploaded by the extension. New assistant text can still refer to its
local context: review what you choose to share and which remote prompts you approve.
Remote turns block competing local input rather than interrupting local work.
Headless/unattended approval is deliberately not implemented.

## Controls and recovery

- Settings show connection health, expiry, prompt policy and recent run states.
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
- Connection credentials expire after seven days. There is no silent renewal.
  Queued/claimed prompts expire after five minutes; running prompts have a
  ten-minute bound. Lost heartbeats cause interruption, not automatic replay.
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
private database mount and matching encryption key; migration 6 adds relay state.

Tests cover real HTTP prompt delivery, persisted replies, SSE notification,
lost-ack retry, owner/credential isolation, revocation, interrupted dispatch,
queue bounds, local-only credential handling, extension lifecycle, disabled
command expansion, and responsive approval/settings screens. Identity and model
execution are simulated in automated tests. A real user must still complete the
pairing and approve a live model turn to validate their own computer/provider.
