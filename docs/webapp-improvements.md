# Webapp improvements: implementation status

## Implemented in source

- **Status editing:** provider/model, thinking level and automatic compaction use revision-checked manager configuration. Configuration stops the agent; resume separately. Reported values are not replaced by requested values.
- **Multiple bots per host:** online active managed hosts remain selectable when full. Creation does not require `acceptingWork`. The fixed 64 stored-agent ceiling is removed. Running capacity remains operator-controlled, defaults to one, and now accepts positive safe integers above two. Existing host policies are not automatically increased. Free memory/disk and authority checks remain enforced.
- **Capacity feedback:** full hosts are labelled in Add bot; agent Actions explains `capacity_unavailable`. The manager retries reconciliation without replaying prompts. Capacity waiting is still represented by the existing protocol's failure/error pair, not a new scheduling state.
- **Organization:** bot settings can pin or archive a bot. Archived bots are accessible from the sidebar and can be restored by clearing Archive and saving. Archive is not stop/delete/purge; runtimes and history remain intact.
- **Conversation search:** open **••• → Search conversation**. The shared-UI dialog searches loaded transcript text and jumps to matching messages (including grouped tool/thinking cards), without adding a container above the chat. The search term is retained for the current bot and cleared when switching bots. It is not account-wide or server-side full-text search.
- **Self-hosted Web Push and inbox:** Settings → Notifications enrolls each account/device, offers server-sent tests and revocation, and shows durable task outcomes. The API stores encrypted subscriptions and dispatches from a leased, retryable outbox. A real service worker handles background notifications, persistent deduplication and conversation links. Individual tools do not trigger completion notifications. See [setup and guarantees](web-push.md).

## Notification limitations

The API needs operator-provisioned VAPID keys before push enrollment is enabled. Vendor delivery and physical-device acceptance still need live verification. iOS requires an installed Home Screen webapp; unsupported browsers report that notifications are unavailable. Cloud HTTP tasks and Rue-managed/linked commands are covered; tasks started outside Rue's command queue are not. OS restrictions can still suppress delivery. The inbox remains available when push is unavailable.

## Still to implement / verify

1. Provision server VAPID keys and perform live vendor/physical-device acceptance for the implemented inbox/subscription/delivery stack. Add account-wide inbox pagination beyond the latest 100 records.
2. Host capacity telemetry and manager-side controls, resource-aware admission, fair scheduling, explicit waiting state, pagination for large host inventories. No claim of unlimited simultaneous execution.
3. Unified delete flow distinguishing runtime removal, conversation deletion and explicitly confirmed workspace purge. Existing lifecycle actions remain available.
4. Delivery recovery with request receipts and explicit uncertain-outcome reconciliation; never blindly replay timed-out tasks.
5. Account-wide full-text history search and richer filters.
6. Unified operational view for desired/observed revisions, deployment progress, sync failures and stale hosts.
7. Browser/accessibility tests for new organization/search/notification controls, including mobile layouts and permission-denied behavior. Full integration and runtime deployment verification remain required.

## Development synchronization

A generated root `core` crash dump exceeded the 256 MiB source bundle limit. It was moved outside the checkout; the watcher resumed successfully and served the status editor/shared icons. Disable core dumps for memory-heavy local checks (`ulimit -c 0`) to avoid recurrence. Source hot reload does not update an already-running managed runtime image or its host capacity policy.
