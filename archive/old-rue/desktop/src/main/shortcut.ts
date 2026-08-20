import { globalShortcut } from 'electron'

/**
 * Summon shortcut registration — accelerator only.
 *
 * Uses Electron's built-in globalShortcut.register() which supports
 * modifier+key chords (e.g. Control+Space, Cmd+Shift+Space). Pure JS,
 * no native deps, no Accessibility permission required.
 */

let registered: string | null = null

export interface ShortcutBindings {
  readonly accelerator: string
  readonly onSummon: () => void
}

export interface ShortcutStatus {
  readonly accelerator: boolean
}

export function registerShortcut(bindings: ShortcutBindings): ShortcutStatus {
  unregisterAll()
  const ok = bindings.accelerator
    ? globalShortcut.register(bindings.accelerator, bindings.onSummon)
    : false
  if (ok) registered = bindings.accelerator
  return { accelerator: ok }
}

export function unregisterAll(): void {
  if (registered) {
    globalShortcut.unregister(registered)
    registered = null
  }
}
