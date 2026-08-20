/**
 * @multiterm/rue-webui — entry point.
 *
 * SolidJS + Vite SPA. Talks to @multiterm/rue-core via @multiterm/rue-sdk.
 *
 * Layout: collapsible left sidebar (sessions), main pane (Conversation +
 * AskBar), status bar (model, tokens, scope indicator). Command palette
 * (Cmd+K). Themes from @multiterm/rue-ui.
 *
 * Served by core's `/` catch-all route AND embedded into @multiterm/rue-desktop's
 * Electron renderer (BrowserWindow points at the built bundle).
 *
 * Phase 0: scaffold only. Phase 7 implements the web UI.
 *
 * See ../docs/refactor-plan.md.
 */
export const RUE_WEBUI_VERSION = '0.0.0'
