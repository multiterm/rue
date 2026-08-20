/**
 * @multiterm/rue-tui — entry point.
 *
 * SolidJS + OpenTUI terminal UI. Loaded in-process by `rue tui` (defined
 * in @multiterm/rue-core's CLI), or attached to a remote core via `rue tui attach
 * <url>` (Phase 8).
 *
 * Layout mirrors @multiterm/rue-webui: collapsible sidebar (session list), main pane
 * (conversation + ask bar), status bar, command palette, themes.
 *
 * Phase 0: scaffold only. Phase 8 implements the TUI.
 *
 * See ../docs/refactor-plan.md.
 */
export const RUE_TUI_VERSION = '0.0.0'
