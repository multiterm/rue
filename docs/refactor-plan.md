# Rue → Opencode-Style Re-Architecture

Status: **Historical plan — superseded by [`architecture.md`](./architecture.md).**
Owner: Rue team.
Last updated: 2026-08-27.

This document preserves the original opencode-style re-architecture proposal. The implemented React/TanStack/tRPC architecture and current delivery decisions are defined in `architecture.md`; references below to SolidJS, OpenTUI, and phase-zero status are no longer authoritative.

---

## 1. Goal

Rebuild rue using the opencode architecture: **one core (server + agent + persistence), many surfaces (TUI, web, desktop) that all consume the same HTTP API via a generated SDK**.

All existing rue features are preserved; the layout and interaction model match opencode.

---

## 2. Why

1. The current rue product is a single Electron app whose React renderer contains the entire agentic engine. There is no way to ship a TUI, a webapp, or a mobile client without lifting that engine first — and the existing scaffolds (`core/`, `cli/`, `webapp/`, `mobile/`) acknowledge this is "step 2 of the restructure" but have never been filled in.
2. Opencode's architecture solves exactly this. Its TUI, web UI, desktop Electron shell, VS Code extension, Slack bot, and GitHub Action are all SDK consumers of the same HTTP core. Adopting it gives rue the same multi-surface freedom for free.
3. The opencode UX (sidebar + main + status bar + command palette + tool-call cards + diff view + themes + keyboard-first navigation) is materially better than what rue has today and is what the user explicitly asked for.

---

## 3. Architectural decisions

| # | Decision | Choice | Notes |
|---|----------|--------|-------|
| D1 | Runtime | **Bun** for core + tui; **Node** for desktop main process | Subpath imports (`#db`, `#pty`) to bridge. Mirrors opencode. |
| D2 | HTTP framework | **Hono + `@hono/zod-openapi`** | Effect HttpApi rejected: paradigm shift, v4 still beta, no existing Effect in rue. Hono delivers the same typed-routes + OpenAPI-spec outcome with rue's existing zod schemas. |
| D3 | Session schema | **Adopt opencode's `Part` discriminated union** | Unlocks tool-call cards, diff cards, reasoning blocks, step markers, fork-from-message. One-shot migration from existing `messages` table. |
| D4 | UI framework | **SolidJS** (replace React) | OpenTUI requires it; sharing components between TUI + Web UI is the entire reason opencode feels cohesive. Tailwind 4 carried over. |
| D5 | Overlay/summon mode | **Keep, desktop-only** | Frameless overlay window mode is a desktop setting alongside the normal resizable window. Resolves the README/code drift. |
| D6 | Capture routes (screenshot/selection/web) | **`web` capture is core; `screenshot`/`selection` are desktop-only routes** that the core delegates to the Electron main process via the preload bridge. Returns `501 Not Implemented` when core runs headless. | |
| D7 | Interport pairing / mobile | **Archive for now** | No mobile peer exists; re-introduce when `@multiterm/rue-mobile` has code. |
| D8 | Leaked references | **Delete `references/1` and `references/2`** (leaked Claude Code repos). Keep `references/opencode/`. Move `references/interport/` to `archive/`. | Removes IP/legal smell. Self-healing can target `references/opencode` and the live rue tree. |
| D9 | Auto-update | **Defer** | Revisit when a release pipeline exists. |
| D10 | Refactor strategy | **Build new tree alongside old; old code goes to `archive/old-rue/`** | Avoids in-place refactor trap. Old tree kept for one release cycle for reference. |

---

## 4. Target package layout

All paths are relative to `cli/packages/apps/rue/`.

```
core/        @multiterm/rue-core      server + agent + persistence + CLI (Bun)
sdk/         @multiterm/rue-sdk       generated HTTP client + helpers
ui/          @multiterm/rue-ui        SolidJS component library, themes, tokens
tui/         @multiterm/rue-tui       SolidJS + OpenTUI terminal UI (loaded by `rue tui`)
webui/       @multiterm/rue-webui     SolidJS + Vite SPA (served by core, embedded by desktop)
desktop/     @multiterm/rue-desktop   Electron shell (thin) — main, preload, renderer
plugin/      @multiterm/rue-plugin    public plugin types (later phase)
extensions/  editor extensions (later phase)
mobile/      stub kept
landing/     stub kept
docs/        this folder
archive/     old code, kept one release cycle
references/  opencode reference only; leaked code deleted
```

Inside `core/src/`:

```
index.ts           yargs CLI: run, serve, tui, web, account, providers, agent, mcp, session, db
server/            Hono app, OpenAPI generation, middleware
  routes/          session, provider, tool, mcp, notebook, memory, scope,
                   schedule, skill, file, capture, settings, event (SSE)
session/           session.ts, message.ts (Part union), llm.ts, compaction.ts, runQuery.ts
provider/          anthropic.ts, openrouter.ts, ollama.ts (lifted from old renderer/lib)
tool/              registry.ts, types.ts, builtins/, toolSearch.ts, agentTool.ts,
                   taskTool.ts, scheduleTools.ts, memoryTools.ts, skillTool.ts, cameraTool.ts
mcp/               stdio + http client manager
notebook/          scan, rank, index    (lifted from old main/notebook)
memory/            memdir, age, types    (lifted from old main/memory)
scope/             scope.ts, search.ts   (lifted from old main/scope)
schedule/          scheduler.ts          (lifted from old main/schedule)
skill/             loader, frontmatter, bundled, types
capture/           screenshot.ts, selection.ts, web.ts (web is server; others delegate to desktop)
storage/           better-sqlite3 schema + migrations
config/            rue.json discovery + merge + validation (zod)
auth/              OS keychain (keytar) — replaces plaintext apiKey
bus/               in-process pubsub for SSE
plugin/            loader (later phase)
```

---

## 5. Feature preservation map

Every feature in the current rue desktop has a destination in the new architecture.

| Current feature | New location | Notes |
|-----------------|--------------|-------|
| Anthropic/OpenRouter/Ollama providers | `core/src/provider/*` | Lifted from `desktop/src/renderer/src/lib/*.ts` |
| `runQuery` agentic loop | `core/src/session/runQuery.ts` | Same generator-based loop |
| Compaction + context-overflow recovery | `core/src/session/compaction.ts` | Same logic |
| Sub-agent spawner | `core/src/session/spawn.ts` | Same |
| Tool registry | `core/src/tool/registry.ts` | Single source of truth (no more renderer/main duplication) |
| Built-in tools (read/write/edit/grep/glob/bash/verify/git_checkpoint) | `core/src/tool/builtins/` | Scope enforcement only here |
| MCP client | `core/src/mcp/` | Same `@modelcontextprotocol/sdk` usage |
| Notebooks (NotebookLM-style) | `core/src/notebook/` | Same SQLite schema |
| Chat scopes (per-conversation folder allowlist) | `core/src/scope/` | |
| Memory (`userData/memory/*.md`) | `core/src/memory/` | YAML frontmatter parser carried over |
| Skills (bundled + user + MCP-prompt-derived) | `core/src/skill/` | |
| Scheduling (`Sleep`, `ScheduleTask`, recurring) | `core/src/schedule/` + tools | Persistent across restarts |
| Slash commands | Command palette + `core/src/session/slash.ts` | |
| Voice (Web Speech + Whisper) | `webui/src/lib/voice.ts` (renderer-only) | Moved closer to UI |
| OCR fallback (tesseract.js) | `webui/src/lib/ocr.ts` | Renderer-only |
| PDF extraction | `core/src/file/pdf.ts` | Server-side now |
| Screenshot capture | `desktop/src/main/capture/screenshot.ts` (+ core route delegates) | |
| Selection capture | `desktop/src/main/capture/selection.ts` (+ core route delegates) | |
| Web page capture | `core/src/capture/web.ts` | Works headless too |
| Global shortcut + summon | `desktop/src/main/shortcut.ts` | Desktop-only |
| Overlay mode (frameless, content-protection, top-most) | `desktop/src/main/window.ts` + webui `?overlay=1` flag | Setting, not a separate mode |
| Tray icon | `desktop/src/main/tray.ts` | |
| Auto-attach selection on summon | `desktop/src/main/index.ts` | |
| RLHF thumbs ± + JSONL export | Core SQLite + `GET /session/:id/preferences.jsonl` | |
| Self-healing debug mode | Core config flag; protected paths still hard-coded | Refactored to be path-list driven |
| Interport pairing (libp2p) | `archive/old-rue/` until mobile exists | |

---

## 6. Phased delivery

Every phase ends in a working, demonstrable state.

| # | Phase | Deliverable | Verification |
|---|-------|-------------|--------------|
| 0 | **Foundation** | Archive old tree. Create `core/sdk/ui/tui/webui/desktop` empty packages with tsconfigs, package.jsons, workspace wiring, vitest config. Adopt Bun + Hono + Solid in dev tooling. | `pnpm install`, `pnpm exec rune typecheck` green, empty test suite passes |
| 1 | **Core skeleton + storage** | `@multiterm/rue-core` boots `rue serve`. SQLite schema for sessions/messages/parts/notebooks/memory/scope/schedule. One-shot migration from old `rue-history.db`. Config loader. Auth-via-keychain. | `rue serve` listens, `GET /doc` returns OpenAPI, migration test passes |
| 2 | **Provider + session + runQuery** | Lift `anthropic.ts`/`openrouter.ts`/`ollama.ts`/`runQuery.ts`/`compaction.ts`/`spawn.ts` from old renderer into core. Wire to HTTP routes. SSE event stream. | `rue run "hello"` round-trips through core, messages stream |
| 3 | **Tools** | Lift entire tool registry. Move scope enforcement to core (single source of truth). Built-in tools run server-side. Permission gate via SSE prompt → user response. | Unit tests for every tool passing; permission flow integration test |
| 4 | **MCP + memory + notebook + scope + schedule + skill** | Lift from `main/*` into `core/src/*`. Expose via HTTP. | Tests preserved from current `tests/main/*` pass |
| 5 | **SDK generation** | `@multiterm/rue-sdk` with `createRueClient` + `createRueServer`. Generated from core's OpenAPI via `@hey-api/openapi-ts`. | TS SDK compiles, hello-world script connects |
| 6 | **UI library** | `@multiterm/rue-ui`: SolidJS components (Button, Input, Dialog, ScrollArea, Tabs, Switch, ModelPicker, MessageList, ToolCard, AttachmentChip, AskBar, ChatHeader, SidebarSessionList, SettingsTabs). Tailwind 4. Theme tokens (port opencode JSON themes). | Storybook/component tests render every primitive |
| 7 | **Web UI** | `@multiterm/rue-webui`: Solid + Vite SPA. Routes: home, `session/:id`, settings. Opencode-style layout: collapsible left sidebar (sessions), main pane (Conversation + AskBar), status bar (model, tokens, scope indicator). Command palette (Cmd+K). Connects via `@multiterm/rue-sdk`. | `rue web` opens browser, full chat flow works |
| 8 | **TUI** | `@multiterm/rue-tui`: SolidJS + OpenTUI. Same layout shape as web UI. Same component library where possible. Themes, command palette, keymap. | `rue tui` runs a real conversation in the terminal |
| 9 | **Desktop shell** | `@multiterm/rue-desktop`: Electron. Main process spawns `rue serve` sidecar, manages window (normal + overlay), tray, global shortcut, capture bridge. Renderer loads `webui/dist`. | DMG/AppImage/NSIS builds; summon + screenshot work |
| 10 | **Polish** | Command-palette parity, all themes, diff viewer, shiki rendering, tool-card variants, keyboard nav, migration guide, updated README. | E2E suite passes; UX pass side-by-side with opencode |

Stopping after Phase 9 is acceptable.

---

## 7. What the user gains / loses

**Gains**
- Opencode-style layout: sidebar + main + status bar + command palette + tool cards + diff view + themes.
- Native TUI (`rue tui`) sharing sessions with the desktop.
- `rue run "..."` for one-shot inline use.
- Real keyboard navigation everywhere.
- API keys in OS keychain instead of plaintext JSON.
- Clean separation between window modes (normal vs overlay) as a setting.

**Losses (temporary)**
- Interport device pairing (until mobile ships).

**Losses (permanent, intentional)**
- The morphing-window-modes UX (`bar` → `chat` → `settings` heights with bottom-pinned tween).
- React in the renderer.

---

## 8. Out of scope (for this refactor)

- Auto-update / release pipeline (D9).
- Cloud sync (rue remains local-first).
- Mobile client implementation.
- Editor extensions (stubs remain).
- Plugin SDK publication.
