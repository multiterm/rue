/**
 * OS keychain access for rue API keys.
 *
 * Uses `keytar` (macOS Keychain, Windows Credential Manager, Linux libsecret).
 * Falls back to environment variables when the keychain is unavailable
 * (CI, headless Linux without libsecret installed).
 *
 * Key convention: service = 'rue', account = '<provider-id>'.
 */

import { createRequire } from 'node:module'

interface KeytarModule {
  getPassword(service: string, account: string): Promise<string | null>
  setPassword(service: string, account: string, password: string): Promise<void>
  deletePassword(service: string, account: string): Promise<boolean>
  findCredentials(service: string): Promise<Array<{ account: string; password: string }>>
}

const require = createRequire(import.meta.url)
let keytar: KeytarModule | undefined
try {
  keytar = require('keytar') as KeytarModule
} catch {
  // Native keytar is optional on headless Linux/Sandblocks images.
}

const SERVICE = 'rue'

export interface AuthBackend {
  get(provider: string): Promise<string | null>
  set(provider: string, secret: string): Promise<void>
  remove(provider: string): Promise<boolean>
  all(): Promise<Record<string, string>>
}

class KeytarBackend implements AuthBackend {
  async get(provider: string): Promise<string | null> {
    return keytar!.getPassword(SERVICE, provider)
  }
  async set(provider: string, secret: string): Promise<void> {
    await keytar!.setPassword(SERVICE, provider, secret)
  }
  async remove(provider: string): Promise<boolean> {
    return keytar!.deletePassword(SERVICE, provider)
  }
  async all(): Promise<Record<string, string>> {
    const creds = await keytar!.findCredentials(SERVICE)
    const out: Record<string, string> = {}
    for (const c of creds) out[c.account] = c.password
    return out
  }
}

/**
 * Memory backend — used when keytar is unavailable. Not persisted across
 * processes; values must be seeded from env or settings on each boot.
 */
class MemoryBackend implements AuthBackend {
  private store = new Map<string, string>()
  async get(provider: string): Promise<string | null> {
    return this.store.get(provider) ?? null
  }
  async set(provider: string, secret: string): Promise<void> {
    this.store.set(provider, secret)
  }
  async remove(provider: string): Promise<boolean> {
    return this.store.delete(provider)
  }
  async all(): Promise<Record<string, string>> {
    return Object.fromEntries(this.store.entries())
  }
}

let cached: AuthBackend | undefined

export function getAuthBackend(): AuthBackend {
  if (cached) return cached
  // Tests and CI must never prompt for or mutate a developer's real keychain.
  if (process.env.VITEST || process.env.CI || process.env.RUE_AUTH_BACKEND === 'memory') {
    cached = new MemoryBackend()
    return cached
  }
  cached = keytar ? new KeytarBackend() : new MemoryBackend()
  return cached
}

/** Seed in-memory entries from environment variables (called on boot). */
export async function seedFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const backend = getAuthBackend()
  const map: Array<[string, string | undefined]> = [
    ['anthropic', env.ANTHROPIC_API_KEY ?? env.CLAUDE_CODE_OAUTH_TOKEN],
    ['openrouter', env.OPENROUTER_API_KEY],
    ['ollama', env.OLLAMA_HOST], // not a secret, but useful to record
  ]
  for (const [provider, value] of map) {
    if (!value) continue
    const existing = await backend.get(provider)
    if (existing) continue
    await backend.set(provider, value)
  }
}
