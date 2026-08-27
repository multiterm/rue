# Deployment

## Keyname

Register separate public OAuth clients for the webapp, site, mobile app, and Electron app. Use Authorization Code + PKCE for client surfaces. Register exact redirect URIs, including:

- `http://localhost:5173/auth/callback`
- `rue://auth/callback`
- production web and Electron callback URLs

Configure secrets through Sandblocks/Pluto or the deployment environment:

```text
KEYNAME_API_URL=https://api.keyname.dev
KEYNAME_AUTH_ENABLED=true
# Optional API audience for a registered OAuth client:
KEYNAME_CLIENT_ID=
VITE_KEYNAME_API_URL=https://api.keyname.dev
# Native PKCE still requires a registered public client:
EXPO_PUBLIC_KEYNAME_API_URL=https://api.keyname.dev
EXPO_PUBLIC_KEYNAME_CLIENT_ID=
```

Browser and Electron surfaces load Keyname `auth.js`; they do not require `VITE_KEYNAME_CLIENT_ID`. Client IDs are public, but client secrets must never be placed in Vite, Expo, or Electron bundles. The immutable `preview` and `production` services set `KEYNAME_REQUIRE_AUDIENCE=true`; `KEYNAME_CLIENT_ID` is therefore mandatory there and is sent to Keyname as the token audience check. The HMR `develop` environment permits audience-free integration while tenant isolation remains enforced.

## Sandblocks

The v2 contract deploys the API, webapp, docs, and landing site from three reserved branches: `develop` maps to the HMR-enabled `develop` environment, `pre` maps to immutable `preview`, and `prod` maps to immutable `production`. Other branches are ignored. Install the committed deployment and quality hooks once per clone with `pnpm exec rune sandblocks-hooks-install` and inspect them with `pnpm exec rune sandblocks-hooks-status`. Deployments run in the background and write ignored logs under `.sandblocks/logs/`. Set `SANDBLOCKS_SKIP_POST_COMMIT=1` to skip deployment or `RUE_SKIP_QUALITY=1` to bypass a local quality hook explicitly.

GitHub Actions is not part of Rue's build, test, promotion, or deployment lifecycle. Local pre-commit/pre-push gates and Sandblocks pipelines own those checks.

Validate before deployment:

```sh
pnpm exec rune sandblocks-validate
pnpm exec rune sandblocks-doctor
pnpm exec rune sandblocks-register
pnpm exec rune deploy
```

## Runway

The mobile app follows Fuel's variant and APK layout. Install/build the Runway CLI, then:

```sh
pnpm --filter @multiterm/rue-mobile exec rune android
pnpm exec rune runway-push
```

The guard script permits only `https://runway.honeycluster.xyz`.
