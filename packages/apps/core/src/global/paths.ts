/**
 * Canonical filesystem paths for the rue runtime.
 *
 * Layout (XDG on Linux/macOS, AppData on Windows via `xdg-basedir`):
 *   data/    OS-specific data dir  (Linux: $XDG_DATA_HOME or ~/.local/share)
 *     rue/
 *       rue.db          main SQLite database
 *       memory/            <name>.md memory files + MEMORY.md index
 *       skills/            user skill files
 *       logs/              JSONL debug logs
 *   config/  OS-specific config dir (Linux: $XDG_CONFIG_HOME or ~/.config)
 *     rue/
 *       rue.json        primary config (optional)
 *       themes/            *.json user themes
 *
 * Project-local discovery (rue.json walking up from cwd) is handled
 * separately by ../config.
 */

import { xdgConfig, xdgData } from 'xdg-basedir'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const APP_NAME = 'rue'

const defaultDataRoot = xdgData ?? join(homedir(), '.local', 'share')
const dataRoot = process.env.RUE_DATA_DIR ? resolve(process.env.RUE_DATA_DIR, '..') : defaultDataRoot
const appData = process.env.RUE_DATA_DIR ? resolve(process.env.RUE_DATA_DIR) : join(dataRoot, APP_NAME)
const configRoot = xdgConfig ?? join(homedir(), '.config')

export const Paths = {
  /** OS data dir for rue. Contains DB + filesystem-backed stores. */
  data: appData,
  /** OS config dir for rue. User-editable config + themes. */
  config: join(configRoot, APP_NAME),
  /** Main SQLite database file. */
  db: join(appData, 'rue.db'),
  /** Memory directory (one .md per memory). */
  memory: join(appData, 'memory'),
  /** User skills directory. */
  skills: join(appData, 'skills'),
  /** Logs directory. */
  logs: join(appData, 'logs'),
  /** Default rue.json location (user-global). */
  configFile: join(configRoot, APP_NAME, 'rue.json'),
  /** User-defined themes directory. */
  themes: join(configRoot, APP_NAME, 'themes'),
} as const

export type Paths = typeof Paths

/** Resolve a path under the data dir. */
export function dataPath(...segments: string[]): string {
  return resolve(Paths.data, ...segments)
}

/** Resolve a path under the config dir. */
export function configPath(...segments: string[]): string {
  return resolve(Paths.config, ...segments)
}
