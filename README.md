# Rue

Rue is a multisurface AI workspace for web, React Native, Electron, and terminal clients. Every surface uses Keyname identity and talks to one shared HTTP core.

## Monorepo

```text
packages/apps/core       Rue API, agent engine, persistence, and CLI
packages/apps/webapp     React + Vite application
packages/apps/mobile     Expo React Native application (Runway-ready)
packages/apps/desktop    Electron shell for the web application
packages/apps/site       React landing page
packages/apps/tui        terminal client
packages/libs/auth       shared Keyname OAuth/PKCE primitives
packages/libs/sdk        public @multiterm/rue-sdk package
packages/libs/ui         shared UI primitives
```

The repository follows the Multiterm/Honeycluster package layout and includes the Sandblocks v2 deployment contract in [`sandblocks.yml`](./sandblocks.yml).

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Copy the variable names from [`docs/deployment.md`](./docs/deployment.md) into your secret manager. Never commit Keyname credentials.

## Deploy and release

```sh
pnpm exec sandblocks validate .
pnpm exec sandblocks sandbox up .
pnpm --filter @multiterm/rue-mobile runway:dev:build-and-push-apk
pnpm exec m-release --dry-run
pnpm exec m-release --yes
```

`develop` publishes beta versions; `main` publishes the `latest` npm channel. The public SDK is [`@multiterm/rue-sdk`](./packages/libs/sdk).
