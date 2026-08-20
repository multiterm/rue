# @multiterm/rue-core

The rue server, agentic engine, and CLI in one package — modeled on `packages/opencode` in the opencode reference.

## Status

Phase 0 of the refactor: scaffold. See `../docs/refactor-plan.md`.

## Will contain (per phase)

| Phase | Adds |
|-------|------|
| 1 | HTTP server (Hono + zod-openapi), SQLite storage, config, auth (keychain) |
| 2 | Provider adapters (Anthropic, OpenRouter, Ollama), sessions, `runQuery`, SSE |
| 3 | Tool registry + built-in tools (read/write/edit/grep/glob/bash/verify/git_checkpoint) |
| 4 | MCP, notebooks, memory, scope, schedule, skills |
| 5 | OpenAPI spec generation feeding `@multiterm/rue-sdk` |
