# In-app agent settings

Open **Settings** using the top-right collapsed menu, then select **Agent** in the left sidebar. **General** contains appearance controls. **Security** and **Developer** currently provide information, not new configuration controls. Switching categories preserves the unsaved Agent draft; closing the modal clears it. Settings belong to the signed-in Keyname subject, not the server administrator or another user.

Supported configuration:
- Harness: **Pi agent core** (`@earendil-works/pi-agent-core`, pinned). This is not the Pi coding CLI or its filesystem session/resource loader.
- Provider: **OpenAI**, using Pi's built-in model catalog and official provider endpoint. No arbitrary provider URLs or executable credential resolvers.
- Model and system prompt: saved account defaults for the next message, including existing bots. A bot's description and optional message instructions are appended to the account prompt.
- API key: password entry; blank preserves the stored key, a replacement rotates it, and the explicit removal checkbox deletes it. Keys are never returned to clients, placed in browser storage, or published as synced preferences/events. Saving is not a live credential validation.

Saving settings activates Pi for that account. Until then, legacy session/provider configuration remains compatible. Pi gets a fresh isolated agent for each request, restoring Rue's persisted text conversation. It streams through the existing message/part events. Shell/file tools, extensions, context-file discovery, self-updates, and deployment execution are disabled. This is a chat harness, not a remotely privileged coding agent. Provider failures are sanitized and requests have a two-minute deadline.

## Secret storage and operations

The `agent_settings` SQLite table contains public configuration and AES-256-GCM ciphertext. AAD binds ciphertext to its owner and provider. Reads expose only configured/available status. Writes use revision and expected-owner checks to prevent stale edits and account-switch races.

An operator must provision one stable 32-byte encryption key before the UI accepts API keys:
- `RUE_SETTINGS_ENCRYPTION_KEY`: base64-encoded 32 bytes, or
- `<absolute database filename>.agent-key`: raw 32 bytes, a regular non-symlink file owned by the API service user, mode `0600`.

There is **no automatic key generation, replacement, or environment-provider-key fallback** for configured account profiles. Missing or unreadable master keys fail closed. Never replace the master key in place without a coordinated ciphertext migration. Back it up separately from the database, with owner-only access; restoring encrypted settings requires the matching key.

**Development storage:** the canonical API now has a private, service-owned host bind from `/vol/nvme/docker/rue/development/data` to `/tmp/.local/share/rue`. The database and matching key are outside the public source workspace and survive container restart. Only the API receives this mount. Protected recovery snapshots and the separate master-key backup are under `/root/rue-consolidation-backups` on Abby.

**Lifecycle limitation:** this mount was provisioned by the operator, not by Sandblocks' current declarative service manifest. A replacement development API must receive the same mount and service network. The development startup guard refuses an unmounted/tmpfs fallback, so a generic full redeploy cannot silently start an empty database. Source/HMR sync remains supported. Preview and production have not been migrated and retain their existing storage limitations. Back up both database and key before any replacement; never put either in the public source workspace or Vite assets.

Endpoints: authenticated `GET /agent/settings` and `PUT /agent/settings`. The SDK exposes `agentSettings()` and `saveAgentSettings()`. PUT accepts harness, provider, model, systemPrompt, expectedOwnerSubject, expectedRevision, and optional apiKey (string or null). Errors never echo submitted fields or provider diagnostics.
