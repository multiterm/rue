# Settings & support

Open Settings from the workspace header. Appearance, Models, AI keys, Agents, Hosts, API keys, Server, and MCP each have a dedicated page. Support links to these guides and the issue tracker.

## Appearance

Choose **Light**, **Dark**, or **System** independently from the accent palette. System follows operating-system changes. Palette cards preview primary, accent and surface colours. Both preferences follow your Rue account across devices.

## Models

Models controls cloud-chat defaults: the model and system prompt for the next message. The current cloud Pi integration supports OpenAI. Remote Pi sessions continue to choose their model locally; saving a provider key does not silently change their model or permissions.

## AI keys

Store OpenAI, Anthropic, Google, and OpenRouter API keys. **Add new key** selects authentication by provider: choose **OpenAI Codex** for OAuth sign-in instead of pasting an API key. Follow the OpenAI link, enter the one-time code there, then confirm the returned account in Rue. Access and refresh tokens never enter browser storage. Reconnecting clears previous Codex grants. To use Codex on a managed bot, choose a Codex provider/model on an updated host, grant that agent access to the saved OAuth connection, and resume separately. Connecting alone grants no access and does not test quota. Refresh tokens stay server-side; granted agents receive access tokens only. Keys are encrypted on the API server and are never returned by account-facing list or save endpoints. Existing OpenAI keys remain available; no re-entry or data migration is required.

The provider table opens an **Add new key** modal with shared provider/model selectors and a masked key input. Search the pinned runtime catalog to find any supported model; lists render at most 100 matches plus the current selection. The selected model is a suggested default in **Add new bot**, not a credential restriction or a change to existing bots/cloud settings.

Saving a key does not validate its provider account, billing, or model access. Removing it also removes its access grants. Codex OAuth is a separate saved connection from an OpenAI API key.

Secure storage requires the operator's existing `RUE_SETTINGS_ENCRYPTION_KEY` or private database-adjacent key file. Back up the encryption key separately from the database; losing it makes saved credentials unusable. The application never generates a replacement encryption key automatically.

### Sharing with a host or remote agent

Choose Manage access beside a saved key, select a host or agent, and explicitly allow that machine to read the key. Enrollment and Pi pairing alone do not grant credential access.

A host grant is host-wide trust, not an individual-agent restriction. The selected machine can retain any plaintext key it receives. Revocation blocks future retrieval but cannot erase copies or cancel requests already using a key. Rotate the provider key at the provider if a machine is compromised.

The credential broker requires a live authenticated connection, matching instance/generation, and a current per-provider grant. Stale, revoked, expired, or unrelated connections cannot retrieve keys. Delivery is audited without recording the credential.

The updated Pi extension (Bridge API 8, Pi 0.85.1) uses explicitly granted keys in memory when local credentials are missing. Run `/reload`, then `/rue-dev resume` or `/rue resume`. Local credentials and other extensions' providers are preserved; borrowed keys are not written to auth files or shell environments. Managed runtime 0.2 uses the same broker through its Agent identity; choose that Agent when granting access, not merely its Host. OpenAI cloud chat already uses the saved OpenAI key.

## Remote agents

The **Agents** page has searchable, sortable **Managed agents** and **Linked agents** tables, with filters and pagination matching AI keys. Managed agents are supervised Pi runtimes; linked agents are manually paired Pi sessions, not entire hosts. Icon-only Refresh controls sit beside **+ Add new** in table headers. The same pattern is used for provider/API keys, Hosts and MCP. Create managed agent, Link agent, Add host and Add MCP connection open modals rather than expanding forms in the page. Open a row’s Manage action for connection controls or the existing lifecycle, configuration and purge controls. Each session has one bot and its own connection status.

For this development checkout, `/rue-dev` reads the API and dashboard URLs from Rue's deployment metadata. `/rue-dev resume` uses the same API-origin/session-bound saved link without URL prompts. Missing metadata fails closed; it never silently selects a different deployment. Account confirmation, pairing codes, and trust/sharing controls are unchanged.

Run `/rue` in Pi with Rue's extension installed for a custom deployment, then choose Link agent and paste the request ID. Approve only a request you started. Paste the one-time code into Pi's local pairing prompt and confirm the same account. Enable remote prompts under Manage agent after linking.

New links trust remote prompts and share user, assistant, and tool text by default. Tool output can include private file contents and secrets printed by commands. Use `/rue untrust` to require local approval, and `/rue hide-tools` to stop future tool sharing. Thinking is independently opt-in with `/rue share-thinking`; `/rue hide-thinking` stops future sharing. Already uploaded content is not removed by changing these policies.

Use `/rue status` to inspect transport and upload health. A stopped link can usually resume with `/rue resume`; a revoked or expired link must pair again. Use the same Pi session to preserve its bot/history. Interrupted commands are not automatically replayed.

## History

Cloud bots can clear their messages and attachments while keeping settings and drafts. For Pi-backed bots, **Clear history** explains that local Pi history is retained and offers starting a new bot or reviewing compaction. Remote session reset is not implemented; neither option silently deletes or resets the existing session.

**Delete bot** for a managed bot first offers runtime removal, preserving history and workspace. Once removed, a separate confirmation requests permanent purge of the bot, saved Pi history and private workspace. Host bind sources, backups and exported copies are never purged. Consent is pinned to the agent revision; uncertain mutations keep their request identity. Acceptance is not completion—the host must confirm purge.

Deleting a manually linked bot removes Rue’s mirrored history but does not delete local Pi files or stop the local process.

## Workspace

Open a managed bot’s three-dot menu and choose **Workspace**. `/workspace` is private persistent storage. The **+** button opens an add-directory modal; choose an existing path under `/Volumes/MOTHERSHIP` and read-only or read/write access. Up to eight distinct grants (2 KiB total) are supported. Read-only parents can contain writable children, but writable parents cannot have read-only exceptions.

The operator must enable secure host mounts. Traversal, symlinks, missing shares and source replacements fail closed. Linux mounts enforce access for Pi, shell commands and MCP subprocesses. Whole-volume grants expose readable secrets and writable code; choose narrower directories when possible. Colima’s administrative cache is always excluded, and existing Unix permissions still apply.

Authorize the directories, then **Apply and stop**. The old runtime is fenced and its processes/open descriptors terminated. Resume separately from Actions. Only this agent container changes—not the VM. Managed workspace and Pi history remain intact. Copied data and completed effects cannot be recalled, and prompts are never replayed. If the revision changes, reload before applying.

## Permissions

Permissions is separate from Workspace. **Read only** enables read tools; **Coding** also enables shell, write and edit. These are enforced presets, not independent per-command grants. Existing MCP grants require Coding; remove them through runtime configuration before selecting Read only. Tool-output and thinking sharing are separate checkboxes. Changes retain directory, model, provider and credential configuration and require explicit consent and a separate resume.

## Agent actions

Open a managed bot’s settings or three-dot menu and choose **Actions**. Provider/model changes and AI-key updates remain here, not in the menu. **Status**, **Connection**, **Routines**, **Workspace**, **Permissions**, **Manage runtime** and **Sync conversation** are available from the menu. **Refresh** refreshes saved data without sending prompts; clear-history and delete entries open explicit scope dialogs rather than remaining disabled.

**Sync conversation** asks the connected agent to check explicitly shared uploads and refreshes saved Rue messages. It does not replay prompts, import unshared local Pi history or inject context. Its confirmation refers to reported pending uploads, not proof that unshared local history exists in Rue.

- **Compact agent** asks the host manager to compact the agent's Pi context using its current model and grant. It can incur model costs. Rue’s displayed chat stays unchanged. Only updated, capable hosts enable the action. Existing work must finish first.
- **Change provider / model** stops the runtime and saves the revision-checked choice while preserving its tool permissions, history and workspace. Resume separately. Selecting a provider does not grant its credentials or prove quota.
- **Update AI key** opens a dropdown of saved API keys and OAuth connections. A compatible saved API key can be shared with this agent after explicit consent; other agents' grants and account credentials are unchanged. A different provider requires changing the agent's provider/model first. Saved OAuth connections can be applied to Codex agents on OAuth-capable hosts, with separate exposure consent. Refresh tokens never reach the agent. Revocation blocks future delivery but cannot erase access tokens already received. **Add or replace saved API key** is a separate action: replacing a key affects every agent sharing that account-level key and requires confirmation of that scope. Neither action changes the bot's model or the saved default model.
- **Stop**, **Resume** and **Reload** use the manager control protocol, never a model prompt. Reload waits for accepted work. Stop can interrupt work, which will not be replayed.
- **Remove runtime** retains history and workspace volumes. Permanent purge is separate in general Agents settings.

Activity distinguishes a request being accepted from runtime confirmation. Do not treat an uncertain compaction as safe to repeat: inspect status and fence/recover the runtime first. A failed or expired request does not automatically run again.

## Agent status

Bot settings and the three-dot menu expose **Agent status**: Pi's directory/branch, current provider/model, thinking level, context usage, token totals, cache activity and reported model cost. These are observed values, separate from requested configuration. Stale reports are labelled; unavailable fields are not inferred.

Managed agents require an updated runtime. Linked Pi sessions opt in using **`/rue share-status`**, independently of tool output or thinking-content sharing. Use **`/rue hide-status`** to stop future reports. No prompt text, summaries, credentials or environment variables are included.

Counters cover the Pi session, including compaction/branch-summary usage. Cache-hit percentage describes the last assistant response. Cost is Pi's model-cost estimate, not an invoice; subscription markers do not prove quota. Context may be unknown just after compaction. Interactive extensions may not expose auto-compaction configuration.

## Hosts

Hosts lists enrolled supervisors, connection status, capabilities and managed-agent counts. Mason's worker supports managed Pi creation, stop/resume, reload, destruction, separate purge and MCP. A connected host must also advertise execution capability before it can launch a bot.

For a new host, create a Tenancy API key with the Enrollment preset. **Add host** shows the private key-file configuration for `rue-worker enroll-key`. The enrolling supervisor must explicitly acknowledge root/Docker control. Its transport identity is stored privately; it is not a second API-key type. Existing Mason does not need re-enrollment.

The API needs Keyname, managed-worker/agent feature flags and a provisioned Tenancy verifier for new enrollment. See the repository deployment guide for pinned images, private state and resource limits.

The Compose worker's Docker socket is equivalent to host-administrator access. Do not expose it or the worker credential to agents. Do not mount the host root filesystem to troubleshoot enrollment. Managed bots use private workspaces. Host filesystem mounts require a separate approved policy and are not enabled by enrollment.

Drain records host intent. Rotation immediately invalidates the old credential; update its protected file and restart the worker. Revocation is irreversible for that enrollment. None of these actions deletes host data.

## API keys

API keys are issued by Tenancy and can be personal or project-owned. The shared table lists names, owners, status, permissions and expiry, with search, sorting, status filters and revocation actions. Integrating applications use Tenancy’s owner/list/create/revoke APIs through their authenticated server integration; possessing an application key does not itself authorize issuing more keys. **Create API key** opens a compact modal with a name, owner, expiry, and permissions. Choose All, Restricted, Read only, or Enrollment. Rue enforces the selected grants; Tenancy stores their application-defined strings.

Save the masked secret once to a private mode-0600 file. Never paste it into chat, shell arguments or browser storage. The same key authorizes allowed management requests and host enrollment using `rue-worker enroll-key`; no second enrollment API key is needed. Worker transport identity remains internal and is fenced by the key's renewable authority.

The old project-key/binding APIs and enrollment forms are removed. Obsolete binding records are deleted and dependent host identities revoked; Mason's existing enrollment and bot data are preserved. Live Tenancy release/verifier provisioning remains pending, so unavailable deployments fail closed rather than issuing local substitute keys.

To add a bot on an already connected Mason, open **Add new bot**, choose a suggestion or enter a name, select **Mason · managed host** as Deployment location, choose provider/model and tool permissions, acknowledge execution, then **Add bot**. Grant the approved provider key to the resulting bot's **Agent** target separately in **AI keys** before inference. The advanced **Agents → Create managed agent** form remains available. The bot uses a private persistent workspace; this does not enable host filesystem mounts.

## Server

Server provides **Link device** and shows the current Rue API endpoint, health, and authentication method. Deployment configuration determines the endpoint; this page does not change it or expose server secrets.

Pi and workers use outbound authenticated WebSockets over the same HTTPS ingress. The browser uses an authenticated event stream. Keep TLS enabled and do not expose an unauthenticated API to a network. Worker streams currently require a single coordinated Rue core instance.

If a reply appears in Pi but not the browser, refresh the conversation. Rue retains acknowledged messages on the server and reconciles after event-stream reconnects. A stalled event stream is cancelled after 75 seconds without bytes, allowing fallback reads and reconnection.

## Project authorization

Choose a project owner in **API keys** when your Tenancy membership permits it. Use that generic key for permitted Rue API requests and enrollment; the retired project-binding form must not be used. Project authority is not human impersonation.

Delegated execution authority is bounded to 45 seconds from verification start and by key expiry. Revocation fences dependent hosts and agents without deleting their history or workspace volumes. Live Tenancy deployment and verifier provisioning remain prerequisites; unavailable integrations do not silently issue local keys or enroll unbound replacement hosts.

## MCP

MCP settings save reviewed **stdio** programs for selected managed agents. Supply an executable available inside the agent image/workspace, a JSON argument array, and a masked environment JSON object for credentials. Arguments are visible metadata: never put secrets in them. Rue does not install packages or expand a shell automatically.

Select connections when creating a coding-enabled managed agent on an MCP-capable host, or use **Configure tools and MCP** on an existing agent. Saving configuration stops the runtime; resume after reviewing the new permissions. Provider keys and tool/thinking sharing remain independent.

Environment values are encrypted at rest, but code inside selected agents can read delivered credentials. Removing a connection stops affected agents and removes that selection; already delivered copies cannot be recalled. To rotate credentials, remove the connection, create a replacement, configure it on the agent, and resume. A saved profile is not proof that its program is running or healthy.

HTTP/OAuth transports and resource/prompt browsing are not available. Manual Pi sessions keep their own independently reviewed integrations.

## Support

Use Support in Settings to open this documentation or report an issue. Include versions, connection status, and sanitized error codes. Never attach API keys, worker credentials, pairing codes, auth stores, or unreviewed tool transcripts.
