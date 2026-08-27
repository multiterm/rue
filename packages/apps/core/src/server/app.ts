import { OpenAPIHono } from '@hono/zod-openapi'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { bodyLimit } from 'hono/body-limit'
import { basicAuth } from './auth-middleware.js'
import { keynameAuth } from './keyname-auth.js'
import { requestGuard } from './request-guard.js'
import type { ServerContext } from './context.js'
import { healthRoutes } from './routes/health.js'
import { sessionRoutes } from './routes/sessions.js'
import { messageRoutes } from './routes/messages.js'
import { eventRoutes } from './routes/event.js'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { appRouter } from '@multiterm/rue-trpc'
import { createRueDatabase } from '@multiterm/rue-db'

export interface AppOptions {
  ctx: ServerContext
  /** Optional structured-logger toggle; defaults to off in tests. */
  log?: boolean
}

/**
 * Build the Hono app. Pure function — no listener side-effects. The
 * `listen.ts` module is responsible for binding to a port.
 */
export function createApp(opts: AppOptions): OpenAPIHono<{ Variables: { ctx: ServerContext } }> {
  const app = new OpenAPIHono<{ Variables: { ctx: ServerContext } }>()

  // Attach the shared ctx to every request.
  app.use('*', async (c, next) => {
    c.set('ctx', opts.ctx)
    return next()
  })

  if (opts.log) app.use('*', logger())

  // Desktop, web, mobile, and TUI clients connect from different origins.
  // Keyname bearer-token verification protects API routes in configured environments.
  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['authorization', 'content-type', 'x-rue-directory'],
      maxAge: 600,
    }),
  )

  app.use('*', keynameAuth(opts.ctx.config.keyname.enabled, opts.ctx.config.keyname.apiUrl, opts.ctx.config.keyname.clientId))
  // Retain local-only password support for offline development when Keyname is disabled.
  if (!opts.ctx.config.keyname.enabled) app.use('*', basicAuth(opts.ctx.config.server.password))
  app.use('*', requestGuard())
  app.use('*', bodyLimit({ maxSize: 1_048_576, onError: (c) => c.json({ error: 'REQUEST_BODY_TOO_LARGE' }, 413) }))

  // Group mounts. Each sub-app brings its own OpenAPI routes; openapi3 spec
  // is merged when we call .doc() below.
  app.route('/', healthRoutes())
  app.route('/', sessionRoutes())
  app.route('/', messageRoutes())
  app.route('/', eventRoutes())
  app.all('/trpc/*', (c) => fetchRequestHandler({
    endpoint: '/trpc',
    req: c.req.raw,
    router: appRouter,
    createContext: () => ({ db: opts.ctx.orm ?? createRueDatabase(opts.ctx.db), principalSubject: c.get('principal').subject }),
  }))

  // OpenAPI document. SSE route doesn't appear here (intentional; see event.ts).
  app.doc('/doc', {
    openapi: '3.0.0',
    info: {
      title: 'Rue API',
      version: '0.0.0',
      description: 'HTTP API for @multiterm/rue-core. Consumed by @multiterm/rue-sdk.',
    },
  })
  // Alias commonly expected by tooling.
  app.get('/openapi.json', (c) => c.redirect('/doc', 302))

  return app
}
