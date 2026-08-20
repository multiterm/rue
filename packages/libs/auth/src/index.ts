export interface KeynameTokenSet {
  token: string
  refreshToken?: string
  expiresAt?: number
  record?: KeynameUser
}
export interface KeynameUser { subject: string; userEmail: string; principalType: 'user' | 'machine'; expiresAt?: number }
export interface KeynameAuthChangeEvent { authenticated: boolean; record: KeynameUser | null; reason?: string; error?: unknown }
export interface KeynameBrowserClient {
  ready: Promise<KeynameTokenSet | null>
  signIn(options: { mode: 'modal' | 'redirect'; callbackUri: string }): Promise<KeynameTokenSet | null>
  currentUser(): Promise<KeynameUser | null>
  getAccessToken(options?: { minValidityMs?: number }): Promise<string | null>
  signOut(): Promise<void>
  closeModal(): void
  onAuthChange(listener: (event: KeynameAuthChangeEvent) => void): () => void
  startSessionPolling(options?: { intervalMs?: number; onLogout?: () => void }): ReturnType<typeof setInterval>
}
declare global { interface Window { Keyname?: KeynameBrowserClient } }
let browserClient: Promise<KeynameBrowserClient> | undefined
export function loadKeyname(apiUrl = 'https://api.keyname.dev'): Promise<KeynameBrowserClient> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Keyname can only be loaded in a browser'))
  if (window.Keyname) return Promise.resolve(window.Keyname)
  if (browserClient) return browserClient
  const pending = new Promise<KeynameBrowserClient>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-keyname-auth]')
    const script = existing ?? document.createElement('script')
    const loaded = () => window.Keyname ? resolve(window.Keyname) : reject(new Error('Keyname loaded without exposing its browser client'))
    script.addEventListener('load', loaded, { once: true })
    script.addEventListener('error', () => reject(new Error('Could not connect to Keyname')), { once: true })
    if (!existing) { script.src = `${apiUrl.replace(/\/$/, '')}/auth.js`; script.async = true; script.dataset.keynameAuth = ''; document.head.appendChild(script) }
  })
  const resolved = pending.catch(error => { browserClient = undefined; throw error })
  browserClient = resolved
  return resolved
}

// Explicit PKCE helper retained for native/server integrations that have a
// registered public OAuth client. Browser apps should use loadKeyname/auth.js.
export interface KeynameAuthConfig { apiUrl: string; clientId: string; redirectUri: string; scopes?: string[] }
export interface AuthStorage { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; remove(key: string): Promise<void> }
const STATE_KEY='rue.keyname.state', VERIFIER_KEY='rue.keyname.verifier'
const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')
const randomValue=()=>encode(crypto.getRandomValues(new Uint8Array(32)))
const challenge=async(verifier:string)=>encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))))
export function createKeynameAuth(config:KeynameAuthConfig,storage:AuthStorage){const apiUrl=config.apiUrl.replace(/\/$/,'');return {async authorizeUrl(){if(!config.clientId)throw new Error('A registered Keyname client ID is required for the native PKCE flow');const state=randomValue(),verifier=randomValue();await Promise.all([storage.set(STATE_KEY,state),storage.set(VERIFIER_KEY,verifier)]);const url=new URL(`${apiUrl}/authorize`);url.searchParams.set('client_id',config.clientId);url.searchParams.set('redirect_uri',config.redirectUri);url.searchParams.set('response_type','code');url.searchParams.set('state',state);url.searchParams.set('code_challenge',await challenge(verifier));url.searchParams.set('code_challenge_method','S256');url.searchParams.set('scope',(config.scopes??['openid','profile','email']).join(' '));return url.toString()},async exchange(callbackUrl:string):Promise<KeynameTokenSet>{const callback=new URL(callbackUrl);const[expectedState,verifier]=await Promise.all([storage.get(STATE_KEY),storage.get(VERIFIER_KEY)]);if(!expectedState||callback.searchParams.get('state')!==expectedState||!verifier)throw new Error('Keyname callback state is invalid');const code=callback.searchParams.get('code');if(!code)throw new Error('Keyname callback has no authorization code');const response=await fetch(`${apiUrl}/v1/code/exchange`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code,clientId:config.clientId,redirectUri:config.redirectUri,codeVerifier:verifier})});if(!response.ok)throw new Error(`Keyname code exchange failed (${response.status})`);await Promise.all([storage.remove(STATE_KEY),storage.remove(VERIFIER_KEY)]);return response.json() as Promise<KeynameTokenSet>}}}
export const browserAuthStorage:AuthStorage={async get(key){return sessionStorage.getItem(key)},async set(key,value){sessionStorage.setItem(key,value)},async remove(key){sessionStorage.removeItem(key)}}
