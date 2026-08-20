import type { MiddlewareHandler } from 'hono'

/**
 * Basic-auth middleware. Active only when the server config supplies a
 * password. Mirrors opencode's `OPENCODE_SERVER_PASSWORD` behavior.
 *
 * The `/doc`, `/openapi.json`, and `/health` routes are exempt so clients
 * can discover the API without credentials.
 */
const EXEMPT_PATHS = new Set(['/doc', '/openapi.json', '/health'])

export function basicAuth(password: string | undefined): MiddlewareHandler {
  if (!password) {
    return async (_c, next) => next()
  }
  // Standard Basic auth: empty username, password as given.
  const expected = 'Basic ' + Buffer.from(`:${password}`).toString('base64')
  return async (c, next) => {
    if (EXEMPT_PATHS.has(c.req.path)) return next()
    const header = c.req.header('authorization')
    if (header !== expected) {
      return c.json({ error: 'unauthorized' }, 401, {
        'WWW-Authenticate': 'Basic realm="rue"',
      })
    }
    return next()
  }
}
