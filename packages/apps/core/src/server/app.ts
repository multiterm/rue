import {runtimeRolloutAccountRoutes,runtimeRolloutWorkerRoutes,runtimeRolloutTerminalRoutes} from './routes/runtime-rollouts.js'
import {notificationRoutes} from './routes/notifications.js'
import { OpenAPIHono } from '@hono/zod-openapi'
import { cors } from 'hono/cors'
import {HTTPException} from 'hono/http-exception'
import { logger } from 'hono/logger'
import { bodyLimit } from 'hono/body-limit'
import { basicAuth } from './auth-middleware.js'
import {tenancyKeyApi} from './tenancy-key-api.js'
import {apiKeyAccountRoutes} from './routes/api-keys.js'
import { keynameAuth } from './keyname-auth.js'
import { requestGuard } from './request-guard.js'
import type { ServerContext } from './context.js'
import {providerOAuthRoutes} from './routes/provider-oauth.js'
import { providerKeyAccountRoutes, providerKeyDeliveryRoutes } from './routes/provider-keys.js'
import { mcpAccountRoutes } from './routes/mcp.js'
import {managedCompactionRuntimeRoutes} from './routes/managed-compaction.js'
import { managedAgentAccountRoutes, managedAgentWorkerRoutes } from './routes/managed-agents.js'
import { workerAccountRoutes } from './routes/workers.js'
import { healthRoutes } from './routes/health.js'
import { sessionRoutes } from './routes/sessions.js'
import { messageRoutes } from './routes/messages.js'
import { eventRoutes } from './routes/event.js'
import { agentSettingsRoutes } from './routes/agent-settings.js'
import { pairingRoutes } from './routes/pairing.js'
import { terminalClientRoutes, terminalAccountRoutes } from './routes/terminal-pairing.js'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { appRouter } from '@multiterm/rue-trpc'
import { sessionServices } from './session-services.js'

export interface AppOptions {
  ctx: ServerContext
  /** Optional structured-logger toggle; defaults to off in tests. */
  log?: boolean
  /** Paired-computer bridge; enabled explicitly by server startup. */
  terminalPairing?: boolean
  managedWorkers?: boolean
  managedAgents?: boolean
}

/**
 * Build the Hono app. Pure function — no listener side-effects. The
 * `listen.ts` module is responsible for binding to a port.
 */
export function createApp(opts: AppOptions): OpenAPIHono<{ Variables: { ctx: ServerContext } }> {
  const app = new OpenAPIHono<{ Variables: { ctx: ServerContext } }>()
  app.onError((error,c)=>{
    if(error instanceof HTTPException)return error.getResponse()
    // Driver errors can embed SQL parameters, transcripts and ciphertext.
    // Neither HTTP responses nor deployment logs may serialize those errors.
    if(opts.log)console.error('[rue] request failed')
    return c.json({error:'internal_error'},500)
  })

  // Attach the shared ctx to every request.
  app.use('*', async (c, next) => {
    if(opts.ctx.stopping||opts.ctx.storage?.available===false)return c.json({error:'storage_unavailable'},503)
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
      allowHeaders: ['authorization', 'content-type', 'x-rue-directory', 'last-event-id'],
      maxAge: 600,
    }),
  )

  const terminalPairing = opts.terminalPairing === true && opts.ctx.config.keyname.enabled
  if (terminalPairing && opts.managedWorkers && opts.managedAgents) app.route('/terminal-client', managedCompactionRuntimeRoutes())
  if (terminalPairing) {app.route('/terminal-client',runtimeRolloutTerminalRoutes());app.route('/terminal-client', terminalClientRoutes())}
  if (opts.managedWorkers && opts.ctx.config.keyname.enabled) app.route('/worker-client', providerKeyDeliveryRoutes('worker'))
  if (opts.managedWorkers && opts.managedAgents && opts.ctx.config.keyname.enabled) {app.route('/worker-client', managedAgentWorkerRoutes());app.route('/worker-client',runtimeRolloutWorkerRoutes())}
  const keyApi=tenancyKeyApi(opts.ctx,opts.managedAgents===true)
  app.use('*',async(c,next)=>{
    if(/^Bearer tnk_/.test(c.req.header('authorization')??'')){
      if(!opts.managedWorkers||!opts.ctx.config.keyname.enabled)return c.json({error:'invalid_credential_scope'},401)
      return keyApi.fetch(c.req.raw)
    }
    return next()
  })
  // Bridge secrets are never forwarded to Keyname or accepted on account APIs.
  app.use('*', async (c, next) => {
    if (/^Bearer (rue_(terminal|worker)_|tnk_)/.test(c.req.header('authorization') ?? '')) return c.json({ error: 'invalid_credential_scope' }, 401)
    return next()
  })
  app.use('*', keynameAuth(opts.ctx.config.keyname.enabled, opts.ctx.config.keyname.apiUrl, opts.ctx.config.keyname.clientId))
  // Retain local-only password support for offline development when Keyname is disabled.
  if (!opts.ctx.config.keyname.enabled) app.use('*', basicAuth(opts.ctx.config.server.password))
  app.use('*', requestGuard())
  app.use('*', (c, next) => bodyLimit({ maxSize: c.req.method === 'POST' && /^\/session\/[^/]+\/message$/.test(c.req.path) ? 28 * 1024 * 1024 : 1_048_576, onError: (c) => c.json({ error: 'REQUEST_BODY_TOO_LARGE' }, 413) })(c, next))

  // Group mounts. Each sub-app brings its own OpenAPI routes; openapi3 spec
  // is merged when we call .doc() below.
  app.route('/', healthRoutes())
  app.route('/', sessionRoutes())
  app.route('/', messageRoutes(terminalPairing))
  app.route('/', eventRoutes())
  app.route('/', pairingRoutes())
  app.route('/', agentSettingsRoutes())
  app.route('/notifications',notificationRoutes())
  app.route('/provider-keys', providerKeyAccountRoutes())
  app.route('/provider-oauth',providerOAuthRoutes())
  if(opts.ctx.config.keyname.enabled)app.route('/api-keys',apiKeyAccountRoutes())
  if (terminalPairing) app.route('/terminal', terminalAccountRoutes())
  if (opts.managedWorkers && opts.ctx.config.keyname.enabled) app.route('/workers', workerAccountRoutes())
  if (opts.managedWorkers && opts.managedAgents && opts.ctx.config.keyname.enabled) {
    app.route('/managed-agents', managedAgentAccountRoutes())
    app.route('/runtime-rollouts',runtimeRolloutAccountRoutes())
    app.route('/mcp', mcpAccountRoutes())
  }
  app.all('/trpc/*', (c) => fetchRequestHandler({
    endpoint: '/trpc',
    req: c.req.raw,
    router: appRouter,
    createContext: () => ({sessions:sessionServices(opts.ctx).conversations,principalSubject:c.get('principal').subject,keyname:{apiUrl:opts.ctx.config.keyname.apiUrl,clientId:opts.ctx.config.keyname.clientId,clientSecret:opts.ctx.config.keyname.clientSecret}}),
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
