import type { MiddlewareHandler } from 'hono'

const EXEMPT_PATHS = new Set(['/doc', '/openapi.json', '/health'])

interface KeynameClaims {
  subject: string
  principalType: 'user' | 'machine'
  scopes?: string[]
  expiresAt?: number
  audience?: string
}

export function keynameAuth(apiUrl: string, audience?: string): MiddlewareHandler {
  if (!audience) return async (_context, next) => next()
  const endpoint = `${apiUrl.replace(/\/$/, '')}/v1/token/verify`
  return async (context, next) => {
    if (EXEMPT_PATHS.has(context.req.path)) return next()
    const header = context.req.header('authorization')
    const token = header?.startsWith('Bearer ') ? header.slice(7) : ''
    if (!token) return context.json({ error: 'KEYNAME_AUTH_REQUIRED' }, 401)
    let claims: KeynameClaims | undefined
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, audience }),
      })
      if (response.ok) {
        const body = await response.json() as { token?: KeynameClaims } & KeynameClaims
        claims = body.token ?? body
      }
    } catch {
      return context.json({ error: 'KEYNAME_AUTH_UNAVAILABLE' }, 503)
    }
    if (!claims?.subject || (claims.expiresAt && claims.expiresAt <= Date.now())) {
      return context.json({ error: 'KEYNAME_AUTH_INVALID' }, 401)
    }
    return next()
  }
}
