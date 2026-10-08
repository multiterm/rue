# Agent versions, catalogs and upgrades

Bot → Status displays the **reported Pi package version**, not the API or manager version. Old runtimes show “Not reported”. Version and catalog reporting are negotiated with the API, so a new runtime does not send unknown status fields to an old API.

For existing managed agents, Provider/Model editing uses that connection's owner-bound runtime catalog. It does not fall back to the API server's Pi package. The runtime exports only provider IDs/names, credential mode, model IDs/names and context sizes. Reports are bounded and indicate truncation. They never serialize native provider/model objects, headers, credentials or endpoint configuration. A reported supported model is not a billing/credential entitlement.

Catalogs upload until the API acknowledges their SHA-256 digest. Subsequent heartbeats contain the digest; a changed catalog, Pi version or reset connection requires a fresh upload. Computer lists and worker snapshots omit the full catalog. The editor fetches it on demand from the owner/connection/session-bound `/terminal/computers/:id/catalog` endpoint.

New native API-key providers can use the existing encrypted credential vault and explicit per-target grants. Codex remains on its separate OAuth flow; other OAuth-only providers are shown as unsupported for brokered credentials. New provider IDs require the manager's `managed-dynamic-providers-v1` capability. Model existence is resolved by Pi, not a hard-coded API Codex catalog. New-agent bootstrap presets remain separate from an existing agent's authoritative model report.

## Upgrade availability

The manager inventories already-local, immutable Docker images bearing Rue's runtime and Pi-version labels. It filters architecture, Linux OS, required filesystem support and existing MCP/compaction/Codex capabilities. Inventory does not pull, build, run or install images. The image build checks that its Pi label matches the pinned dependencies.

The chat input shows **Update agent** beside the microphone when a newer published Pi version is known. A bounded, cached npm dist-tag lookup supplies that version; it never downloads or installs code. The modal shows the current and latest versions and asks permission to restart **only this agent**. If a matching, compatible image has not been prepared, confirmation is disabled with an explanation. Older managers, stopped agents and offline/draining hosts also disable confirmation. Legacy agents can use the host's image-version inventory, explicitly labeled as such, until they report their own version. If neither reports a version, a different prepared latest image can still be offered, but the modal explicitly says the installed version is unknown rather than claiming it is older.

The human-approved `PATCH /managed-agents/:id` action `upgrade` requires a request ID, expected agent revision, expected current image, an inventory-listed immutable target image/Pi version and `acknowledgeExecution: true`. Machine principals cannot approve it. Request IDs are idempotent. SQLite migration 30 persists the selected image, previous image and update state; the default host image and other agents' revisions, grants and containers remain unchanged.

The manager advertises negotiated `managed-agent-upgrade-v1` support. It waits for accepted work and uploads to finish, preflights the selected image, replaces only that agent's container using its existing volumes/session/configuration, and verifies a fresh reported Pi version before releasing queued prompts. Failure requests one rollback to the previous image. Failed rollback stops only this agent for review. Stop/destroy can cancel an update; competing configuration changes are rejected while updating. Started or uncertain tasks are never replayed. A pending request is not an installed update.

Existing host-wide rollout APIs remain for hosts without individual image assignments. They reject hosts with pinned per-agent images rather than silently overriding or ignoring those assignments. Do not downgrade a manager to code that lacks per-agent image support while such assignments exist.

## Activation order

1. Sync/build the API, SDK and webapp.
2. Upgrade the manager to advertise local inventory, dynamic-provider and single-agent update support. This is a separate operator deployment, not an implicit side effect of the chat button.
3. Build a compatible agent image (`PI_VERSION` must match the pinned runtime manifest) and provision it on the host through the operator's existing build process.
4. Use **Update agent** and confirm the selected bot. Fresh version/catalog data appears only after that runtime starts reporting.

Source changes and webapp hot reload do not rebuild existing managed containers. Linked Pi installations remain managed on their own computer; legacy linked status may not report a package version or catalog.
