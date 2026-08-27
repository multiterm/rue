# @multiterm/rue-core

Rue's authenticated HTTP core, session engine, provider adapters, persistence, realtime event stream, and CLI.

Implemented:

- Hono/OpenAPI and tRPC endpoints
- Keyname and local Basic authentication
- Principal-owned sessions, messages, parts, and tenant-filtered SSE
- SQLite migrations, legacy import, integrity-checked backup, and configurable data directory
- Anthropic, OpenRouter, and Ollama adapters
- Streaming text sessions, compaction, retry recovery, limits, and replayable events
- `rue serve`, `rue run`, `rue tui`, `rue account`, and `rue db`

The tool permission/execution layer and advanced MCP, memory, notebook, schedule, and skill routes remain tracked in [`docs/stack-review-and-implementation-plan.md`](../../../docs/stack-review-and-implementation-plan.md).
