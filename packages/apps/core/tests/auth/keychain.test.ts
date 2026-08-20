import { describe, it, expect } from 'vitest'
import { getAuthBackend, seedFromEnv } from '../../src/auth/index.js'

/**
 * These tests interact with the real OS keychain when available. To avoid
 * polluting the user's actual keychain, we use a unique random provider name
 * for each test run and clean up afterwards.
 *
 * On CI without a keychain backend the memory fallback is exercised — the
 * assertions still hold.
 */
describe('auth: keychain backend', () => {
  it('round-trips set/get/remove', async () => {
    const backend = getAuthBackend()
    const provider = `rue-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    try {
      expect(await backend.get(provider)).toBeNull()
      await backend.set(provider, 'shh')
      expect(await backend.get(provider)).toBe('shh')
      expect(await backend.remove(provider)).toBe(true)
      expect(await backend.get(provider)).toBeNull()
    } finally {
      // Best-effort cleanup even if assertions fail.
      await backend.remove(provider).catch(() => {})
    }
  })

  it('seedFromEnv stores env values when no entry exists', async () => {
    const backend = getAuthBackend()
    const provider = 'anthropic'
    // Capture any existing value so we restore it after.
    const existing = await backend.get(provider)
    try {
      // Remove first so the seed actually writes.
      await backend.remove(provider).catch(() => {})
      const fakeEnv = { ANTHROPIC_API_KEY: 'sk-test-' + Date.now() } as NodeJS.ProcessEnv
      await seedFromEnv(fakeEnv)
      expect(await backend.get(provider)).toBe(fakeEnv.ANTHROPIC_API_KEY)
    } finally {
      await backend.remove(provider).catch(() => {})
      if (existing) await backend.set(provider, existing).catch(() => {})
    }
  })
})
