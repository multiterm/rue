import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, parse, resolve } from 'node:path'
import { Paths } from '../global/paths.js'
import {
  ConfigSchema,
  PartialConfigSchema,
  type Config,
  type PartialConfig,
} from './schema.js'

const CONFIG_FILENAMES = ['rue.json', 'rue.jsonc'] as const

/**
 * Discover `rue.json` files, walking up from `cwd` to filesystem root.
 *
 * Returns paths ordered ROOT → CWD, so callers can later merge in order
 * (more specific config wins).
 */
export function discoverProjectConfigs(cwd: string = process.cwd()): string[] {
  const found: string[] = []
  let dir = resolve(cwd)
  const { root } = parse(dir)
  // Walk up to filesystem root.
  while (true) {
    for (const name of CONFIG_FILENAMES) {
      const p = join(dir, name)
      if (existsSync(p)) found.push(p)
    }
    if (dir === root) break
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  // We collected CWD-first; reverse so ROOT comes first.
  return found.reverse()
}

/** Read + parse a config file, tolerating JSONC comments. */
export function readConfigFile(path: string): PartialConfig {
  const raw = readFileSync(path, 'utf8')
  const json = stripJsoncComments(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (err) {
    throw new Error(
      `Invalid JSON in config file ${path}: ${(err as Error).message}`,
    )
  }
  const result = PartialConfigSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(
      `Invalid config in ${path}: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    )
  }
  return result.data
}

/** Shallow-merge an array of partial configs (later wins). Nested objects merge shallowly. */
export function mergeConfigs(parts: PartialConfig[]): PartialConfig {
  const out: Record<string, unknown> = {}
  for (const part of parts) {
    for (const [k, v] of Object.entries(part)) {
      if (v === undefined) continue
      if (
        v !== null &&
        typeof v === 'object' &&
        !Array.isArray(v) &&
        out[k] !== null &&
        typeof out[k] === 'object' &&
        !Array.isArray(out[k])
      ) {
        out[k] = { ...(out[k] as object), ...(v as object) }
      } else {
        out[k] = v
      }
    }
  }
  return out as PartialConfig
}

/**
 * Load + merge the rue configuration.
 *
 * Order (earlier = lower precedence):
 *   1. User-global   `$XDG_CONFIG_HOME/rue/rue.json`
 *   2. Project       all `rue.json` found walking up from `cwd`, root first
 *
 * Then validates against ConfigSchema, applying defaults.
 */
export function loadConfig(cwd: string = process.cwd()): Config {
  const parts: PartialConfig[] = []
  if (existsSync(Paths.configFile)) {
    parts.push(readConfigFile(Paths.configFile))
  }
  for (const path of discoverProjectConfigs(cwd)) {
    parts.push(readConfigFile(path))
  }
  if (process.env.KEYNAME_AUTH_ENABLED || process.env.KEYNAME_API_URL || process.env.KEYNAME_CLIENT_ID || process.env.KEYNAME_CLIENT_SECRET) {
    parts.push({
      keyname: {
        enabled: process.env.KEYNAME_AUTH_ENABLED === 'true',
        apiUrl: process.env.KEYNAME_API_URL ?? 'https://api.keyname.dev',
        ...(process.env.KEYNAME_CLIENT_ID ? { clientId: process.env.KEYNAME_CLIENT_ID } : {}),
        ...(process.env.KEYNAME_CLIENT_SECRET ? { clientSecret: process.env.KEYNAME_CLIENT_SECRET } : {}),
      },
    })
  }
  const config = ConfigSchema.parse(mergeConfigs(parts))
  if (process.env.KEYNAME_REQUIRE_AUDIENCE === 'true' && config.keyname.enabled && !config.keyname.clientId) {
    throw new Error('KEYNAME_CLIENT_ID is required when KEYNAME_REQUIRE_AUDIENCE=true')
  }
  return config
}

/** Strip `//` and `/* * /` comments from a JSONC string (string-literal aware). */
function stripJsoncComments(src: string): string {
  let out = ''
  let i = 0
  const n = src.length
  let inString = false
  let stringQuote = ''
  let escape = false
  while (i < n) {
    const ch = src[i]
    if (inString) {
      out += ch
      if (escape) {
        escape = false
      } else if (ch === '\\') {
        escape = true
      } else if (ch === stringQuote) {
        inString = false
      }
      i++
      continue
    }
    if (ch === '"' || ch === "'") {
      inString = true
      stringQuote = ch
      out += ch
      i++
      continue
    }
    if (ch === '/' && src[i + 1] === '/') {
      // line comment
      i += 2
      while (i < n && src[i] !== '\n') i++
      continue
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++
      i += 2
      continue
    }
    out += ch
    i++
  }
  return out
}
