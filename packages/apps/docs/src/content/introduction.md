# Rue documentation

Rue is one assistant across web, mobile, desktop, and terminal surfaces. Every client uses the same typed API, Keyname identity, and shared design system.

## Start locally

Install and verify the workspace:

```sh
pnpm install
pnpm exec rune typecheck
pnpm exec rune test
pnpm exec rune build
```

## Architecture

The API core owns sessions, providers, persistence, and tools. React applications consume the end-to-end typed tRPC API through TanStack Query. SQLite storage is described with Drizzle ORM while compatibility stores share the same connection.

## Application stack

- TanStack Router for typed routing
- TanStack Query for server state
- TanStack Form for accessible forms
- tRPC for end-to-end API types
- Drizzle ORM for persistence
- Tailwind CSS v4 and Rue GDS for presentation
