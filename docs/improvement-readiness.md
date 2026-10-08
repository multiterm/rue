# Agent and deployment improvements — implementation status

## Implemented and tested in source

- **New-bot readiness:** host ownership, online/active state, Docker support, model
  catalog selection and saved credential checks before creation. Codex requires its
  own supported OAuth connection. Capacity pressure permits a queued start rather
  than pretending memory is reserved. Creation never automatically grants secrets.
  A separate per-agent grant remains required. A listed model is not a guarantee
  of installed-runtime compatibility or provider quota/access; those still need
  runtime verification after startup.
- **Health:** sidebar activity uses fresh telemetry. Managed agents without a verified
  matching credential grant are not labeled ready. Connection health, running work,
  queued work and setup errors remain distinct; an error checking health is not proof
  that execution stopped.
- **Recovery:** eligible saved requests are explicitly labeled never started. The
  undispatched-task tutorial opens Expired Requests, rather than encouraging a
  duplicate message. Claimed, started or uncertain work is not automatically replayed.
- **Diagnostics:** Agent status → View diagnostics → Copy. Snapshot fields are
  allowlisted; full configuration, raw errors, credentials, prompts/replies, host/bot
  names, directories and branch names are excluded. Account/session/connection
  bindings are checked before including data. Users can review the JSON before sharing.
- **Mobile regression coverage:** desktop and 412px Chromium checks cover bot switching,
  separate drafts, attachments, failed-send recovery, setup tutorials, readiness and
  diagnostic copy. These are not physical-keyboard/device acceptance tests.
- **Sandblocks in-place replacement guard:** worker preflights all selected existing
  containers before snapshot deletion/replacement. Unknown database binds, named
  volumes, malformed inspection results and unexpected sources fail closed without
  exposing host paths. This is a refusal guard, NOT automatic storage adoption. It
  does not provision storage for a new deployment ID or migrate existing data.

## Not yet activated or completed

- **Live Web Push:** Rue builds and push tests pass, but the deployed server has not
  been confirmed enabled. The Sandblocks control-plane app-scope forwarding fix is
  in source with HTTP regression coverage. It must be released before API-scoped
  VAPID secrets can reach Rue through the affected environment-snapshot path.
- **Persistent storage deployment:** the known manual API data/encryption-key mount
  must be represented by a supported durable deployment binding or migrated safely.
  The new refusal guard prevents an unsafe in-place replacement; it does not solve
  that missing platform feature. No API recreation is authorized by a green build.
- **Platform release:** the Sandblocks API and worker changes require their own rollout.
  The control plane is not a managed application in this project's app inventory.
  Its documented development release entry point is `bunx rune deploy-dev` in the
  Sandblocks repository (`docs/DEV-STACK-DEPLOY.md`), backed by
  `scripts/workflow/dev-stack-workflow.mjs`. A dry-run was reviewed without executing
  synchronization, migration or restart. It requires the configured deployment SSH
  identity and deployment sudo on the control-plane host. This agent sandbox has
  neither that identity nor a forwarded SSH agent. Use the authorized release runner;
  do not copy deployment credentials into an application sandbox or chat.
- **Physical push acceptance:** enable on real Android/desktop/iOS devices, close Rue,
  complete an actual task, verify OS display and authenticated conversation click-through.
  iOS/iPadOS requires the installed Home Screen app. Vendor acceptance alone is not
  proof of device display.

No runtime images, provider credentials, VAPID keys or agent identities were replaced.
No task replay, database migration/cutover or live platform rollout was performed.
