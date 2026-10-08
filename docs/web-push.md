# Self-hosted Web Push and notification inbox

Rue owns subscription storage, the durable delivery queue, retries and notification settings. No OneSignal or other notification SaaS account is needed. Encrypted delivery still travels through the browser vendor's push infrastructure (Google, Mozilla or Apple).

## Operator setup

For API-only encrypted configuration via Dotlocker and Envx, see
[API secret runtime](api-secret-runtime.md). That path preserves an existing VAPID
pair and keeps bootstrap credentials out of frontend builds. It is opt-in, not an
automatic migration of the currently stored Sandblocks secrets.

1. Install dependencies and deploy the updated API/webapp. Database migrations create the inbox, subscriptions and delivery queue. Back up the database and its existing settings-encryption key before rollout.
2. Keep `RUE_SETTINGS_ENCRYPTION_KEY` or the existing private `<database>.agent-key` file available. Subscription endpoints and encryption material are stored encrypted using this key.
3. Generate a VAPID pair once, outside the repository/shared source tree:

   ```sh
   node scripts/deployment/generate-push-config.mjs \
     mailto:YOUR-OPERATOR-ADDRESS \
     /absolute/private/directory/rue-push.env
   ```

   The parent directory must already exist. The script creates a mode-0600 file, refuses overwrite, and never prints keys. Use a real monitored operator address (or an HTTPS contact URL).
4. Load the file's `RUE_PUSH_SUBJECT`, `RUE_PUSH_PUBLIC_KEY` and `RUE_PUSH_PRIVATE_KEY` into **the API service's server environment**, using your deployment secret store or protected environment file. Never use `VITE_` variables for private keys. Apply the environment through a storage-preserving API rollout; a Docker restart alone does not refresh container environment values. Back up the VAPID pair; changing it requires browser re-enrollment.
5. Serve the webapp over HTTPS. Allow outbound HTTPS to `fcm.googleapis.com`, `updates.push.services.mozilla.com` and `web.push.apple.com`. Do not rewrite `/notifications-sw.js` to the application HTML. The worker deliberately does not intercept or cache API traffic.
6. In **Settings → Notifications**, enable this device, grant permission, and send a test notification. The UI explicitly says when the server is not configured. A successful test API response means the browser vendor accepted it—not proof that the OS displayed it.

Without server VAPID configuration the inbox works, but push enrollment is disabled. An incomplete/mismatched key pair or missing encryption key fails startup rather than advertising broken push support.

## Development deployment verification (2026-09-28)

The existing Sandblocks CLI credential authenticates to `honeycluster-multiterm`
with `read`, `write`, `execute`, and `admin` scopes. No additional local-machine
credential is needed for Rue deployments or secret management.

A live SDK test successfully created and deleted temporary, non-sensitive shared
and API-scoped markers. An API-scoped environment snapshot delivered the shared
marker instead of its API override; neither VAPID key reached the diagnostic
process. Operation: `fb458641-902f-4851-ada2-b6f88998c1a1`. Both temporary markers
were verified removed; existing push secrets were not modified. This confirms a
secret-delivery defect, not a credential-write authorization failure. The probe
ran in the deployment workspace, not inside the running Rue API.

The Sandblocks source fix forwards `app` through the server's managed-environment
resolver. Its three targeted suites pass (10 tests / 78 assertions), but the live
probe still fails. Creating another project API key cannot repair that deployed
server behavior. The documented Sandblocks control-plane release remains
`bunx rune deploy-dev`; the current Sandblocks CLI exposes application deployment
and secret management, not a control-plane self-update operation. A full platform
release can also update workers, so do not substitute an unreviewed fleet-wide
rollout for the narrow API correction.

After releasing that correction, verify API-only delivery again, preserve the
existing database/encryption-key mount during the Rue API rollout, and verify
`GET /notifications/push` with a real signed-in account before device enrollment.
An unauthenticated `401` is expected and does not establish push readiness. No
API restart, key rotation, or successful device delivery is claimed by this check.

## Browser behavior

- Enable independently on each browser/device. Permission is requested only after an explicit button click.
- iPhone/iPad: iOS/iPadOS 16.4+, install Rue using **Share → Add to Home Screen**, then enable from the installed app. Rue ships a standalone manifest and app icons.
- Desktop/Android: support depends on the browser and OS. Focus modes, denied permission, battery restrictions and suspended browser services may prevent delivery.
- Notifications contain generic completion/failure text, not prompts or replies. Clicking opens the relevant conversation after authentication.
- The inbox retains task outcomes even if push is unavailable. Settings displays the latest 100 records and a mark-all-read action.
- Explicit sign-out disables local display, unsubscribes the browser, and attempts bounded server revocation. Other devices can be revoked individually from settings. Subscriptions expire after 90 days unless renewed while their owner uses Rue.

## Delivery guarantees and safety

Managed/linked command completion and its notification/outbox inserts share a transaction. Request retries do not create duplicate notifications. Cloud HTTP task results also create notifications. A tool's individual completion is **not** treated as the task completing. Managed turns ending without a final reply are failed with a diagnostic, not a fabricated success summary.

Only devices already subscribed at the time of an outcome receive push; enrollment does not replay old history. Dispatch uses database leases for crash recovery, at most eight attempts, bounded exponential backoff/Retry-After, and a 24-hour delivery expiry. HTTP 404/410 removes expired subscriptions. Other permanent HTTP errors stop retrying. Settings has a rate-limited test endpoint.

Delivery is **at least once**, not exactly once. Browser notification tags plus persistent service-worker deduplication reduce duplicates. Vendor acceptance cannot guarantee OS display. Keep the durable inbox as the source of truth.

Subscriptions are owner/device scoped; another account cannot take over an existing endpoint. Enrollment validates HTTPS vendor endpoints and P-256/auth keys to prevent arbitrary outbound requests. Account endpoints reject machine credentials. Do not log subscription URLs, keys or provider response bodies.

## Tests

With platform-correct dependencies and Node 22.13+:

```sh
node --import tsx --test packages/apps/core/tests/web-push.node.ts
node --test quality/web-push.browser.test.mjs
```

The desktop/mobile notification UI check is `node --test quality/notifications-ui.browser.test.mjs` with `RUE_TEST_WEB_URL` and `RUE_TEST_API_URL` pointing to a running development deployment. It mocks account/API responses and browser enrollment without changing live account data.

The second command uses Playwright Chromium; `CHROMIUM_EXECUTABLE_PATH` can select a full Chromium executable. Chromium's minimal headless shell may report notification permission denied; use the full browser for notification tests. The browser test injects push via DevTools into a real service worker and verifies generic display, persistence/deduplication, malformed-payload rejection, display with the app document closed, and disable cleanup. It does not claim live Google/Apple/Mozilla delivery or physical-device verification.

Production acceptance still requires enabling on real desktop/Android/iOS devices, closing Rue, completing an actual task, and confirming delivery/click-through. Keep credentials out of test fixtures and reports.
