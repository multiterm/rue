# Rue

Shortcut-triggered AI overlay. Press a global hotkey, get a translucent always-on-top chat panel, and pull context from your screen, highlighted text, or any web page.

Modeled after [Cluely](https://cluely.com/) / [cheap-cluely](https://github.com/nwx77/cheap-cluely) / [Thuki](https://github.com/quiet-node/thuki). Uses OpenRouter so you can route to any model (Claude, GPT, Llama, Mistral, …) with one key.

## Features

**Activation & window**
- **Global shortcut** — default `Ctrl+Shift+Space` (configurable). Toggles overlay show/hide from anywhere.
- **Frameless always-on-top overlay** — translucent, blurred, hides on blur (Esc to dismiss).
- **Stealth mode** — `setContentProtection(true)` excludes the window from screen recording / screen capture on Windows & macOS.
- **System tray** — show / quit menu, so the app stays reachable if the shortcut conflicts.

**Context capture**
- **Screen** — primary display screenshot via Electron `desktopCapturer`.
- **Selection** — clipboard save → simulate Ctrl/Cmd+C → read selection → restore clipboard.
- **Auto-attach selection** — when enabled, the shortcut grabs the previously-focused window's selection automatically on summon.
- **Web** — fetches a URL from main (no CORS), strips to plain text.
- **Image paste / drag** — drop or paste an image into the composer to attach.

**Chat**
- **OpenRouter** — pluggable model slug. Vision-capable models receive screenshots inline.
- **Streaming responses** — token-by-token via SSE.
- **Markdown + math + code highlighting** — `react-markdown` with GFM, KaTeX, and `rehype-highlight`.
- **Slash commands** — `/search`, `/tldr`, `/explain`, `/translate`, `/rewrite`, `/refine`, `/bullets`, `/todos`, `/think`. Type `/` for hints.
- **Conversation history** — SQLite (`better-sqlite3`) persistence, sidebar to browse and switch.

**Context inputs**
- **Voice dictation** — Web Speech API mic button; transcripts append to the prompt.
- **PDF drop** — drop a PDF onto the composer; text is extracted with `pdfjs-dist`.
- **Image paste / drag** — paste or drop an image to attach as a screenshot.
- **OCR fallback** — toggle in Inference to run `tesseract.js` on screenshots and send extracted text instead of the image. Lets non-vision models see your screen.

**Agents & integrations**
- **`/search` agent** — queries a local **SearXNG** Docker sidecar, fetches the top-N hits, extracts each page to plain text, synthesizes into a multi-source context block.
- **MCP servers** — configure any Model Context Protocol stdio server (filesystem, Gmail, Slack, Google Calendar, GitHub, …) in Tools settings. Tools are exposed to the model via OpenAI-compatible function calling; up to 4 agentic rounds per turn.
- **NotebookLM-style folders** — pick a folder as a notebook; Rue scans supported files (MD, TXT, code, configs), tokenizes + ranks chunks per query, prepends top-K to chat context.

**Feedback & data**
- **RLHF feedback** — thumbs up/down on assistant messages persist per-message in SQLite.
- **JSONL preference export** — Data tab exports `{prompt, chosen, rejected}` pairs for downstream DPO/RLHF training.

**UI**
- **Tailwind 4** + the monorepo's shared `@super-repo/ui` shadcn primitives.
- **Settings tabs** — Inference / Window / Prompt / Notebooks / Tools / Data.

## Layout

```
packages/apps/rue/desktop/
├── src/
│   ├── main/                       Electron main process
│   │   ├── index.ts                App entry, IPC, shortcut, auto-attach, agent wiring
│   │   ├── window.ts               Frameless overlay + setContentProtection
│   │   ├── tray.ts                 System tray icon + context menu
│   │   ├── store.ts                electron-store typed settings
│   │   ├── history.ts              SQLite conversations + messages + RLHF
│   │   ├── capture/                screenshot, selection, web, html-to-text
│   │   ├── agents/
│   │   │   ├── search.ts           SearXNG client + per-hit extraction
│   │   │   └── format.ts           Pure search-result formatter (tested)
│   │   ├── mcp/client.ts           MCP stdio client manager
│   │   └── notebook/
│   │       ├── index.ts            Notebook lifecycle + SQLite store
│   │       ├── scan.ts             Folder walker / file reader
│   │       └── rank.ts             Pure keyword chunk ranker (tested)
│   ├── preload/index.ts            contextBridge → window.rue API
│   └── renderer/                   React UI
│       ├── App.tsx                 Shell, sidebar/chat/settings router, notebook selector
│       ├── styles/                 Tailwind 4 globals + design tokens
│       ├── components/             Chat, Sidebar, Settings, Message, TitleBar, AttachmentChip
│       └── lib/                    openrouter (chat + stream + tools), attachments, slash,
│                                   ocr (tesseract.js), pdf (pdfjs), voice (Web Speech),
│                                   tools (MCP→OpenAI mapping)
├── docker/
│   └── searxng/                    Local SearXNG sidecar for /search
│       ├── docker-compose.yml
│       └── settings.yml
├── tests/                          Vitest unit tests (95 tests, 100% line cov)
├── electron.vite.config.ts
├── electron-builder.yml            Windows / Mac (x64+arm64) / Linux build targets
└── package.json
```

## Optional sidecars

### SearXNG (powers `/search`)

```bash
cd packages/apps/rue/desktop/docker/searxng
docker compose up -d
```

Listens on `127.0.0.1:8888`. Rue calls it via the `searxngUrl` setting (Tools tab). Edit `settings.yml` to enable/disable engines.

### MCP servers

Configure in Settings → Tools (JSON, same shape as Claude Desktop):

```json
[
  { "name": "fs", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/you/docs"] },
  { "name": "gh", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "GITHUB_TOKEN": "..." } }
]
```

Rue spawns each server as a stdio subprocess, lists their tools, and forwards model tool-calls to them. Up to 4 agentic rounds per turn.

### Notebooks (folder-as-context)

Settings → Notebooks → **Add folder**. Rue scans the folder (skips `node_modules`, `.git`, `dist`, etc.; supports MD, TXT, code, configs; ≤256KB per file, ≤500 files) and stores extracted text in `rue-notebooks.db`. Pick the notebook from the title bar dropdown to enable per-chat retrieval — Rue ranks chunks by token overlap and prepends top-K (≤12KB) to context.

## Develop

```bash
cd packages/apps/rue/desktop
pnpm install
rune dev
```

Opens the overlay. First run will land on the Settings panel — paste your OpenRouter key and pick a model.

## Build a Windows .exe

```bash
rune build-win
```

Installer lands in `packages/apps/rue/desktop/release/<version>/Rue-<version>-win-x64.exe`. NSIS installer, per-user install by default.

## Build a macOS .dmg

```bash
rune build-mac
```

Must be run on macOS — `electron-builder` cannot cross-compile a working `.dmg` from Windows or Linux. Produces two DMGs in `release/<version>/`:

- `Rue-<version>-mac-x64.dmg`  — Intel Macs
- `Rue-<version>-mac-arm64.dmg` — Apple Silicon

The DMG opens to a standard "drag to Applications" layout.

### macOS permissions (first run)

Because Rue captures the screen and sends synthetic keystrokes, macOS will prompt on first use:

| Capability       | macOS permission                                | Granted in                                  |
| ---------------- | ----------------------------------------------- | ------------------------------------------- |
| `📷 Screen` chip | **Screen Recording**                            | System Settings → Privacy & Security        |
| `✎ Selection` chip | **Accessibility** (sends Cmd+C to focused app) | System Settings → Privacy & Security        |

The required `NSScreenCaptureUsageDescription` and `NSAppleEventsUsageDescription` strings are baked into Info.plist via `electron-builder.yml`. After granting, restart Rue.

### Unsigned DMG / Gatekeeper

The build is **unsigned** — there's no Apple Developer cert configured. On first launch macOS will refuse with "Rue cannot be opened because the developer cannot be verified." Workaround once:

1. Right-click `Rue.app` in Applications → **Open** → confirm.

After that, double-click works. To sign + notarize properly, add `CSC_LINK` / `CSC_KEY_PASSWORD` env vars and an `afterSign` notarize hook — see the [electron-builder code-signing docs](https://www.electron.build/code-signing).

### Dock behavior

`LSUIElement: true` in `electron-builder.yml` makes Rue an "agent" app — no Dock icon, no menu bar. Access is via the global shortcut only. Remove that key if you want a Dock icon back.

## Build a Linux AppImage

```bash
rune build-linux
```

Produces `Rue-<version>-linux-${arch}.AppImage`. Requires `xdotool` on the host for the selection-capture chip to work at runtime.

## Cross-platform builds — what runs where

`electron-builder` is host-locked for one of the three platforms:

| Target           | Where to build                                    | Notes                                                                                |
| ---------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **macOS .dmg**   | Must run on **macOS**                             | Code-sign helpers + `hdiutil` are Mac-only. `--mac` from Linux/Windows will not work. |
| **Linux AppImage** | Linux native OR macOS native OR Docker          | First run downloads `appimagetool`. Cross-build from Mac works but APFS case-insensitivity occasionally trips. |
| **Windows .exe** | Windows native OR macOS with `wine` OR Docker     | `winCodeSign` step needs wine when not on Windows.                                   |

### Building all three from a Mac

Three options, in order of cleanliness:

**1. Native + wine (simplest)**

```bash
brew install --cask --no-quarantine wine-stable   # one-time, for the .exe build
cd packages/apps/rue/desktop
rune build-mac       # native — already proven
rune build-win       # via wine
rune build-linux     # native — works but see APFS caveat below
```

Wine on Apple Silicon runs through Rosetta — works, just slower than on Intel.

**2. Docker for Linux + Windows (isolated, reproducible)**

Requires Docker Desktop. The script in `scripts/docker-build.sh` runs `electronuserland/builder:wine` with the workspace copied into a scratch dir so the container's Linux-flavored `node_modules` never touches your Mac's:

```bash
rune build-mac            # native
rune build-linux-docker   # in container
rune build-win-docker     # in container
# or do it all in one shot:
rune build-all-docker
```

Docker caches `~/.cache/electron` and `~/.cache/electron-builder` in named volumes (`rue-build-electron-cache`, `rue-build-builder-cache`) so subsequent builds skip the ~200MB downloads.

On Apple Silicon, the image is x86_64-only and runs through Rosetta — first build is slow, subsequent builds are fast.

**3. GitHub Actions matrix (for releases)**

`.github/workflows@multiterm/rue-build.yml` runs the test + build matrix on `macos-latest`, `ubuntu-latest`, `windows-latest`. Push to a branch or run via `workflow_dispatch` and download three artifacts. Recommended for release builds (signed, reproducible, no local toolchain quirks).

### Local prerequisites by platform

- **macOS host:** Xcode CLT (`xcode-select --install`) for `better-sqlite3`'s native binding rebuild.
- **Linux host:** `libfuse2` runtime for the produced AppImage; `node-gyp` + `python3` for native rebuilds.
- **Windows host:** Visual Studio Build Tools (VS 2022 with the "Desktop development with C++" workload) for `better-sqlite3`.

### APFS case-insensitivity caveat

macOS's default APFS is case-insensitive; some Linux AppImage payloads expect a case-sensitive filesystem. If `build:linux` on Mac fails with "duplicate file" or similar, fall back to `build:linux:docker` (which builds inside a case-sensitive Linux container).

### Recovery — broken-symlink sweep

pnpm's hoisted layout creates symlinks for *all* platform-specific optional dependencies, even ones it never actually downloads. `@electron/rebuild` walks these and `stat`s every symlink — a broken symlink anywhere (left over from an interrupted install) crashes the build with `ENOENT: no such file or directory`. If that happens:

```bash
find node_modules/.pnpm/node_modules -maxdepth 3 -type l ! -exec test -e {} \; -delete
```

Safe — pnpm recreates them on next install if needed.

## Configuration

Settings persist via `electron-store` in the OS user-data directory (`%APPDATA%/Rue` on Windows). All four fields are editable from the Settings panel:

| Setting        | Default                                |
| -------------- | -------------------------------------- |
| API key                | _(empty — required)_                   |
| Model                  | `anthropic/claude-sonnet-4.5`          |
| Shortcut               | `CommandOrControl+Shift+Space`         |
| System prompt          | Concise on-screen assistant directive  |
| Stealth mode           | off                                    |
| Auto-attach selection  | off                                    |
| OCR fallback           | off                                    |
| SearXNG URL            | `http://localhost:8888`                |
| MCP servers            | `[]`                                   |

Shortcut syntax follows Electron's [Accelerator format](https://www.electronjs.org/docs/latest/api/accelerator).

## Architecture notes

**Why OpenRouter** — single key, model-agnostic, supports vision routing and OpenAI-compatible streaming. The renderer hits `openrouter.ai` directly (CSP locked to that origin); the main process never sees the key.

**Why selection grabs through the clipboard** — On Windows, getting "what's currently highlighted in another app" requires either UI Automation (heavy native dep) or simulating Ctrl+C and reading the clipboard. We do the latter, with a save/restore wrapper so the user's clipboard is preserved. Tradeoff: the previously-focused window must accept Ctrl+C; works for browsers, editors, terminals, most chat apps.

**Why hide on blur** — keeps the overlay out of the way. Disable by removing the `blur` handler in `src/main/window.ts` if you'd rather click-away-to-stay-open.

**CSP** — renderer connects only to `openrouter.ai`. Add origins to `<meta http-equiv="Content-Security-Policy">` in `src/renderer/index.html` if you swap providers.

## Reference

This app is modeled after [Cluely](https://cluely.com/) (commercial) and [cheap-cluely](https://github.com/nwx77/cheap-cluely) (open source clone). Both use the same recipe: global shortcut → overlay window → screen/audio/selection capture → LLM context.
