# Rue architecture

Status: authoritative  
Last updated: 2026-08-27

Rue is one authenticated HTTP core consumed by multiple clients. The current implementation baseline is TypeScript, Hono/OpenAPI, tRPC, Drizzle/SQLite, React, TanStack Router/Query/Form, Expo, Electron, and a Node terminal client.

## Boundaries

- `packages/apps/core`: API, CLI, providers, session engine, migrations, persistence, and event stream.
- `packages/libs/sdk`: public typed REST and SSE client.
- `packages/libs/trpc`: internal typed query facade used by browser surfaces.
- `packages/libs/db`: authoritative Drizzle view of the core SQLite schema. SQL migrations remain in core until migration generation is consolidated.
- `packages/apps/webapp`: primary authenticated product surface.
- `packages/apps/desktop`: secure Electron shell around the webapp.
- `packages/apps/mobile`: Expo Keyname and Rue session client.
- `packages/apps/tui`: terminal client available through `rue tui`.
- `packages/apps/site` and `packages/apps/docs`: public surfaces.

## Security model

Every remote request is authenticated by Keyname. Verified claims become a request principal. Sessions are owned by `owner_subject`; REST, tRPC, messages, parts, and SSE events are scoped to that owner. Local unauthenticated mode uses the synthetic `local` principal and must remain loopback-only unless a password is configured. Immutable environments require a Keyname audience.

## Delivery model

Three branches are reserved exclusively for Sandblocks:

- `develop` → `develop`: source/HMR services and fast quality gate.
- `pre` → `preview`: immutable services and complete quality gate.
- `prod` → `production`: immutable services and complete quality gate.

Feature branches do not deploy. GitHub is a source host, not a lifecycle dependency. Local hooks and Sandblocks own formatting checks, typecheck, tests, builds, CRAP, coverage, dependency audit, app permutations, and deployed Playwright contracts.

## Data model

SQLite remains the local-first store. `RUE_DATA_DIR` relocates all mutable Rue data. Deployments must provide durable storage for that directory before production promotion. Migrations are ordered, transactional, and recorded in the database. `rue db backup` creates a consistent backup and runs an integrity check.

## Realtime model

The core persists message parts while streaming. SSE events have monotonic process-local IDs and a bounded replay buffer supporting `Last-Event-ID`. Clients reconcile from persisted messages/parts after reconnect. A shared event transport is required before horizontally scaling the API.

## Decision changes

The former proposal to replace React with SolidJS is rejected for the active implementation. Sharing occurs at SDK, API contract, design-token, and domain-model layers rather than through one renderer framework. A future OpenTUI implementation may coexist behind the same SDK without changing the web stack.
