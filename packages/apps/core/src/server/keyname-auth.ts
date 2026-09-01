import type { MiddlewareHandler } from 'hono'
import type { AuthPrincipal } from './context.js'

const EXEMPT_PATHS = new Set(['/doc', '/openapi.json', '/health'])

interface KeynameClaims {
  subject: string
  principalType: 'user' | 'machine'
  scopes?: string[]
  expiresAt?: number
  audience?: string
}

export function keynameAuth(enabled: boolean, apiUrl: string, audience?: string): MiddlewareHandler {
  if (!enabled) return async (context, next) => {
    context.set('principal', { subject: 'local', principalType: 'local', scopes: ['rue:admin'] })
    return next()
  }
  const endpoint = `${apiUrl.replace(/\/$/, '')}/v1/token/verify`
  return async (context, next) => {
    if(EXEMPT_PATHS.has(context.req.path))return next()
    if(context.req.path.startsWith('/trpc/auth.login')||context.req.path.startsWith('/trpc/auth.verifyMfa')){context.set('principal',{subject:'public:login',principalType:'local',scopes:[]});return next()}
    const header = context.req.header('authorization')
    const token = header?.startsWith('Bearer ') ? header.slice(7) : ''
    if (!token) return context.json({ error: 'KEYNAME_AUTH_REQUIRED' }, 401)
    let claims: KeynameClaims | undefined
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, ...(audience ? { audience } : {}) }),
      })
      if (response.ok) {
        const body = await response.json() as { token?: KeynameClaims } & KeynameClaims
        claims = body.token ?? body
      }
    } catch {
      return context.json({ error: 'KEYNAME_AUTH_UNAVAILABLE' }, 503)
    }
    const expiresAt = claims?.expiresAt && claims.expiresAt < 1_000_000_000_000
      ? claims.expiresAt * 1000
      : claims?.expiresAt
    if (!claims?.subject || (expiresAt && expiresAt <= Date.now())) {
      return context.json({ error: 'KEYNAME_AUTH_INVALID' }, 401)
    }
    const principal: AuthPrincipal = {
      subject: claims.subject,
      principalType: claims.principalType,
      scopes: claims.scopes ?? [],
    }
    context.set('principal', principal)
    return next()
  }
}
