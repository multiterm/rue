# Development onboarding and shared controls

## Pi

Reload the Rue extension, then use `/rue-dev` or `/rue-dev resume`. Both commands read the current API/dashboard HTTPS origins from the owning Rue checkout's `.sandblocks/sandbox-development.json`, not the Pi session's working directory. No API or dashboard URL input is requested. Missing, ambiguous, non-HTTPS, credential-bearing, or path-bearing origins fail closed; no other deployment is selected automatically.

The command retains the existing pairing code, owner confirmation, origin/session-bound private store, local sharing opt-outs, and lease checks. It does not auto-pair on startup. `/rue` remains available for manually configured deployments. URLs and account identifiers are shown on separate lines, without trailing prose. Codes are still entered in Pi's local prompt, never chat or command arguments.

The new command requires the checkout's deployment metadata. A separately copied extension without that metadata cannot discover this development deployment; use `/rue` there until packaging supplies a public deployment manifest.

## Buttons and public layouts

Web application button elements now come from `@multiterm/rue-ui`. The shared `bare` variant retains application-specific geometry while sharing keyboard focus, pointer feedback, loading, and disabled semantics. Buttons default to `type="button"`; forms explicitly opt into submit. Disabled links remove their URL and keyboard navigation and suppress activation. UI-internal password/stepper, theme, copy, and dialog controls also use the shared component.

The mechanical JSX migration lives in `scripts/workflow/migrate-ui-buttons.mjs`; the quality suite rejects raw `<button>` elements in app source. Mobile controls now use `NativeButton` from `@multiterm/rue-ui/native` (locally aliased as Pressable). The native entry point imports no DOM/CSS modules and supplies focus, hover, press, loading and disabled accessibility behavior. Metro resolves the application's React/native renderer versions and excludes `.worktrees`. Native adapter unit tests, Expo Web browser tests, and Android/iOS JavaScript/Hermes exports pass. These are not installed-app or physical-device runtime tests.

Site and docs now use the UI package's shared `PublicLayout`: framed gutters, sticky header, compact navigation, mobile disclosure menu, theme controls, and footer. Reference implementations reviewed read-only:

- `keyname/core/packages/libs/web-kit/src/components/layout/PublicLayout.tsx`
- `keyname/core/packages/apps/docs/src/components/DocsLayout.tsx`

The Rue brand and content remain Rue's; this is structural/design alignment, not a copy of Keyname's product claims or effects.

## Host API keys

Settings → API keys is separate from AI keys. It uses the existing authenticated host enrollment/rotation/revocation service. Creating a key creates a named host identity, requires explicit root/Docker consent, and returns its secret only once. Existing hosts' keys can be rotated or revoked; there is one current key per host. Plaintext secrets are not placed in query caches or browser storage.

Tenancy now has platform-neutral project-key issuance, audience-bound verification and generic SDK methods; see `keyname/tenancy/docs/API-KEYS.md`. Rue does **not yet** accept those project keys or claim live Tenancy integration. Tenancy-backed Rue keys need a separately reviewed Rue service registration, tenant/project binding, scopes, verification contract, and revocation fencing for already-connected workers. The worker feature gate is unchanged.

## Remaining work

Manual Pi now [loads explicitly granted provider keys](provider-key-loading.md) in memory. [Mason preparation](../deploy/worker/MASON.md) created a dedicated bounded Colima VM and built/smoke-tested the worker image; it did not start an authenticated worker daemon. Worker key consumption, managed-agent runtime/lifecycle, MCP execution, Tenancy-to-Rue project binding and live host enrollment remain pending. No agent containers were created and the live worker feature gate was not changed.

## Validation for this continuation

- 353 Rue tests: core 128, SDK 13, worker 11, UI 7, targeted quality 52, desktop/mobile webapp 126, Expo Web 4, docs 6 and site 6.
- 85 Tenancy tests: 70 unit/SDK tests and 15 isolated real-PostgreSQL integration/migration tests, plus 13 standalone PostgreSQL onboarding checks. Identity verification in integration tests is simulated; production Keyname/Tenancy were not exercised.
- Typechecks and webapp/docs/site production builds passed. Android/iOS JavaScript/Hermes exports passed, not installed native applications. The webapp build retains a large-chunk advisory.
- Mason's actual VM/image checks and source watcher were verified separately. Private-state guards were unit-tested; no enrolled private volume was created. No external provider request, live credential delivery or authenticated worker run is claimed.
- Both repositories retain their existing work; no commits, resets or broad cleanup were performed.
