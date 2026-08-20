export interface KeynameAuthConfig {
  apiUrl: string
  clientId: string
  redirectUri: string
  scopes?: string[]
}

export interface KeynameTokenSet {
  token: string
  refreshToken?: string
  expiresAt?: number
}

export interface AuthStorage {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

const STATE_KEY = 'rue.keyname.state'
const VERIFIER_KEY = 'rue.keyname.verifier'

const encode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')

const randomValue = () => encode(crypto.getRandomValues(new Uint8Array(32)))

async function challenge(verifier: string) {
  return encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
}

export function createKeynameAuth(config: KeynameAuthConfig, storage: AuthStorage) {
  const apiUrl = config.apiUrl.replace(/\/$/, '')
  return {
    async authorizeUrl() {
      const state = randomValue()
      const verifier = randomValue()
      await Promise.all([storage.set(STATE_KEY, state), storage.set(VERIFIER_KEY, verifier)])
      const url = new URL(`${apiUrl}/authorize`)
      url.searchParams.set('client_id', config.clientId)
      url.searchParams.set('redirect_uri', config.redirectUri)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('state', state)
      url.searchParams.set('code_challenge', await challenge(verifier))
      url.searchParams.set('code_challenge_method', 'S256')
      url.searchParams.set('scope', (config.scopes ?? ['openid', 'profile', 'email']).join(' '))
      return url.toString()
    },
    async exchange(callbackUrl: string): Promise<KeynameTokenSet> {
      const callback = new URL(callbackUrl)
      const [expectedState, verifier] = await Promise.all([storage.get(STATE_KEY), storage.get(VERIFIER_KEY)])
      if (!expectedState || callback.searchParams.get('state') !== expectedState || !verifier) {
        throw new Error('Keyname callback state is invalid')
      }
      const code = callback.searchParams.get('code')
      if (!code) throw new Error('Keyname callback has no authorization code')
      const response = await fetch(`${apiUrl}/v1/code/exchange`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, clientId: config.clientId, redirectUri: config.redirectUri, codeVerifier: verifier }),
      })
      if (!response.ok) throw new Error(`Keyname code exchange failed (${response.status})`)
      await Promise.all([storage.remove(STATE_KEY), storage.remove(VERIFIER_KEY)])
      return response.json() as Promise<KeynameTokenSet>
    },
  }
}

export const browserAuthStorage: AuthStorage = {
  async get(key) { return sessionStorage.getItem(key) },
  async set(key, value) { sessionStorage.setItem(key, value) },
  async remove(key) { sessionStorage.removeItem(key) },
}
