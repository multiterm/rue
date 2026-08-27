# Rue

Rue is a multisurface AI workspace for web, React Native, Electron, and terminal clients. Every surface uses Keyname identity and talks to one shared HTTP core. Browser sign-in uses Keyname `auth.js` and does not require `VITE_KEYNAME_CLIENT_ID`.

## Monorepo

```text
packages/apps/core       Rue API, agent engine, persistence, and CLI
packages/apps/webapp     TanStack React application
packages/apps/docs       searchable developer documentation
packages/apps/mobile     Expo React Native application (Runway-ready)
packages/apps/desktop    Electron shell for the web application
packages/apps/site       TanStack React landing page
packages/apps/tui        terminal client
packages/libs/auth       shared Keyname OAuth/PKCE primitives
packages/libs/db         Drizzle schema over Rue SQLite
packages/libs/gds        Tailwind v4 tokens, palettes, and native themes
packages/libs/trpc       end-to-end typed API and TanStack clients
packages/libs/sdk        public @multiterm/rue-sdk package
packages/libs/ui         shared shadcn-style React components
```

The repository follows the Multiterm/Honeycluster package layout and includes the Sandblocks v2 deployment contract in [`sandblocks.yml`](./sandblocks.yml). Web surfaces standardize on TanStack Router, Query, and Form with tRPC; server persistence exposes a Drizzle ORM facade over the existing SQLite connection. [`docs/architecture.md`](./docs/architecture.md) is the authoritative architecture record.

## Development

```sh
pnpm install
pnpm exec rune typecheck
pnpm exec rune test
pnpm exec rune playwright-install
pnpm exec rune test-e2e
pnpm exec rune build
```

Copy the variable names from [`docs/deployment.md`](./docs/deployment.md) into your secret manager. Never commit Keyname credentials.

Playwright covers the API lifecycle, Keyname login and workspace flows, docs navigation/search, site forms/themes, Expo web mobile surface, desktop renderer/security contract, and TUI layout contract in desktop and mobile Chromium profiles.

## Deploy and release

```sh
pnpm exec rune sandblocks-validate
pnpm exec rune deploy
pnpm exec rune runway-push
pnpm exec rune release-dry
pnpm exec rune release
```

Sandblocks-reserved branches map `develop` → HMR `develop`, `pre` → immutable `preview`, and `prod` → immutable `production`; ordinary feature and release branches never deploy. Install the branch-aware background and local quality hooks with `pnpm exec rune sandblocks-hooks-install`. Quality gates run locally and inside Sandblocks without depending on GitHub Actions. The public SDK is [`@multiterm/rue-sdk`](./packages/libs/sdk).
