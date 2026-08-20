# Deployment

## Keyname

Register separate public OAuth clients for the webapp, site, mobile app, and Electron app. Use Authorization Code + PKCE for client surfaces. Register exact redirect URIs, including:

- `http://localhost:5173/auth/callback`
- `rue://auth/callback`
- production web and Electron callback URLs

Configure secrets through Sandblocks/Pluto or the deployment environment:

```text
KEYNAME_API_URL=https://api.keyname.dev
KEYNAME_CLIENT_ID=
KEYNAME_REDIRECT_URI=
VITE_KEYNAME_API_URL=https://api.keyname.dev
VITE_KEYNAME_CLIENT_ID=
VITE_KEYNAME_REDIRECT_URI=
EXPO_PUBLIC_KEYNAME_API_URL=https://api.keyname.dev
EXPO_PUBLIC_KEYNAME_CLIENT_ID=
```

Client IDs are public. Never place a Keyname client secret in Vite, Expo, or Electron bundles. The core verifies bearer tokens using `KEYNAME_CLIENT_ID` as its audience.

## Sandblocks

The v2 contract builds and deploys the API, webapp, and landing site in preview, development, and production environments. Validate before deployment:

```sh
pnpm exec sandblocks validate .
pnpm exec sandblocks doctor .
pnpm exec sandblocks register .
pnpm exec sandblocks sandbox up .
```

## Runway

The mobile app follows Fuel's variant and APK layout. Install/build the Runway CLI, then:

```sh
pnpm --filter @multiterm/rue-mobile android
pnpm --filter @multiterm/rue-mobile runway:dev:build-and-push-apk
```

The guard script permits only `https://runway.honeycluster.xyz`.
