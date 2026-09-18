import { OpenAPIHono, z } from '@hono/zod-openapi'
import { bodyLimit } from 'hono/body-limit'
import type { ServerContext } from '../context.js'
import { requestTerminalPairing, approveTerminalPairing, exchangeTerminalPairing, activateTerminalConnection, authenticateTerminalConnection, listTerminalConnections, revokeTerminalConnection, revokeTerminalCredential, TerminalPairingError } from '../../storage/terminal-pairing.js'

import { RelayError, remoteComputers, configureComputer, attachComputer, pollComputer, transitionCommand, publishCommand, mirrorTerminalText } from '../../storage/terminal-relay.js'

const instanceSchema = z.object({ instance: z.string().uuid() }).strict()
const outputSchema = z.object({ instance: z.string().uuid(), version: z.number().int().min(1), text: z.string().max(100_000), status: z.enum(['running', 'completed', 'failed']) }).strict()
const mirrorSchema = z.object({ instance: z.string().uuid(), eventId: z.string().uuid(), role: z.enum(['user', 'assistant']), text: z.string().min(1).max(100_000) }).strict()

type Environment = { Variables: { ctx: ServerContext } }
const requestId = z.string().length(32).regex(/^[A-Za-z0-9_-]+$/)
const connectionId = z.string().length(37).regex(/^term_[A-Za-z0-9_-]+$/)
const startSchema = z.object({ challenge: z.string().length(64).regex(/^[a-f0-9]+$/), piSessionId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/) }).strict()
const exchangeSchema = z.object({ requestId, verifier: z.string().length(43).regex(/^[A-Za-z0-9_-]+$/), code: z.string().length(12).regex(/^\d+$/) }).strict()
const approvalSchema = z.object({ expectedOwnerSubject: z.string().min(1).max(512), botName: z.string().trim().min(1).max(60) }).strict()

function bearer(header?: string): string { return header?.startsWith('Bearer ') ? header.slice(7) : '' }

function protectedRoutes() {
  const app = new OpenAPIHono<Environment>()
  app.use('*', async (c, next) => {
    c.header('cache-control', 'no-store')
    c.header('referrer-policy', 'no-referrer')
    return next()
  })
  app.use('*', (c, next) => bodyLimit({ maxSize: c.req.path.includes('/relay/') ? 1_048_576 : 4096, onError: c => c.json({ error: 'terminal_request_too_large' }, 413) })(c, next))
  app.onError((error, c) => {
    if (error instanceof RelayError) return c.json({ error: error.code }, 409)
    if (!(error instanceof TerminalPairingError)) return c.json({ error: 'terminal_pairing_unavailable' }, 503)
    const status = error.code === 'invalid_terminal_credential' ? 401 : error.code === 'already_approved' ? 409 : error.code === 'pairing_unavailable' ? 429 : 400
    return c.json({ error: error.code }, status)
  })
  return app
}

/** Mount ONLY at /terminal-client, before Keyname. This namespace handles its own authentication. */
export function terminalClientRoutes() {
  const app = protectedRoutes()
  // Fixed-size application-wide budgets; never trust caller-supplied forwarding headers.
  const budgets = { pairing: { start: 0, count: 0 }, credential: { start: 0, count: 0 } }
  app.use('*', async (c, next) => {
    const pairing = c.req.path.endsWith('/requests') || c.req.path.endsWith('/exchange')
    const budget = budgets[pairing ? 'pairing' : 'credential'], now = Date.now()
    if (now - budget.start >= 60_000) { budget.start = now; budget.count = 0 }
    if (++budget.count > (pairing ? 60 : 600)) return c.json({ error: 'terminal_rate_limited' }, 429, { 'retry-after': '60' })
    return next()
  })
  app.post('/requests', async c => {
    const body = startSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json({ error: 'invalid_request' }, 400)
    return c.json(requestTerminalPairing(c.var.ctx.db, body.data.challenge, body.data.piSessionId), 201)
  })
  app.post('/exchange', async c => {
    const body = exchangeSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json({ error: 'invalid_pairing' }, 400)
    return c.json(exchangeTerminalPairing(c.var.ctx.db, body.data.requestId, body.data.verifier, body.data.code))
  })
  app.post('/activate', async c => {
    const body = z.object({ confirmOwnerSubject: z.string().min(1).max(512) }).strict().safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json({ error: 'invalid_request' }, 400)
    const token = bearer(c.req.header('authorization'))
    return c.json(activateTerminalConnection(c.var.ctx.db, token, Date.now(), body.data.confirmOwnerSubject))
  })
  app.get('/connections/:id', c => {
    if (!connectionId.safeParse(c.req.param('id')).success) return c.json({ error: 'invalid_terminal_credential' }, 401)
    const token = bearer(c.req.header('authorization'))
    return c.json(authenticateTerminalConnection(c.var.ctx.db, token, c.req.param('id')))
  })
  app.delete('/connections/:id', c => {
    if (!connectionId.safeParse(c.req.param('id')).success) return c.json({ error: 'invalid_terminal_credential' }, 401)
    return c.json({ revoked: revokeTerminalCredential(c.var.ctx.db, bearer(c.req.header('authorization')), c.req.param('id')) })
  })
  app.post('/connections/:id/relay/:action', async c => {
    const id = c.req.param('id'), action = c.req.param('action'), token = bearer(c.req.header('authorization'))
    if (!connectionId.safeParse(id).success) return c.json({ error: 'invalid_request' }, 400)
    const raw = await c.req.json().catch(() => null)
    if (action === 'mirror') {
      const b = mirrorSchema.safeParse(raw)
      if (!b.success) return c.json({ error: 'invalid_request' }, 400)
      const result = mirrorTerminalText(c.var.ctx.db, token, id, b.data.instance, b.data.eventId, b.data.role, b.data.text)
      c.var.ctx.bus.publish('message.created', result)
      return c.json(result)
    }
    const b = instanceSchema.safeParse(raw)
    if (!b.success) return c.json({ error: 'invalid_request' }, 400)
    if (action === 'attach') return c.json(attachComputer(c.var.ctx.db, token, id, b.data.instance))
    if (action === 'poll') return c.json(pollComputer(c.var.ctx.db, token, id, b.data.instance))
    return c.json({ error: 'terminal_route_not_found' }, 404)
  })
  app.post('/connections/:id/relay/commands/:command/:action', async c => {
    const id = c.req.param('id'), action = c.req.param('action'), token = bearer(c.req.header('authorization'))
    if (!connectionId.safeParse(id).success || !z.string().uuid().safeParse(c.req.param('command')).success) return c.json({ error: 'invalid_request' }, 400)
    const raw = await c.req.json().catch(() => null)
    if (action === 'output') {
      const b = outputSchema.safeParse(raw)
      if (!b.success) return c.json({ error: 'invalid_request' }, 400)
      const result = publishCommand(c.var.ctx.db, token, id, b.data.instance, c.req.param('command'), b.data.version, b.data.text, b.data.status)
      const connection = authenticateTerminalConnection(c.var.ctx.db, token, id)
      c.var.ctx.bus.publish('part.updated', { sessionId: connection.sessionId, messageId: result.assistant_message_id })
      return c.json({ accepted: true, version: result.version })
    }
    const b = instanceSchema.safeParse(raw)
    if (!b.success || !['claim', 'start', 'reject'].includes(action)) return c.json({ error: 'invalid_request' }, 400)
    const result = transitionCommand(c.var.ctx.db, token, id, b.data.instance, c.req.param('command'), action as 'claim' | 'start' | 'reject')
    const connection = authenticateTerminalConnection(c.var.ctx.db, token, id)
    c.var.ctx.bus.publish('part.updated', { sessionId: connection.sessionId })
    return c.json(result)
  })
  // Never fall through into account routes or reinterpret a bridge credential as a Keyname token.
  app.all('*', c => c.json({ error: 'terminal_route_not_found' }, 404))
  return app
}

/** Mount behind Keyname authentication and the ordinary per-owner request guard. */
export function terminalAccountRoutes() {
  const app = protectedRoutes()
  app.use('*', async (c, next) => {
    if (c.get('principal').principalType !== 'user') return c.json({ error: 'human_approval_required' }, 403)
    return next()
  })
  app.post('/requests/:id/approve', async c => {
    const body = approvalSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success || !requestId.safeParse(c.req.param('id')).success) return c.json({ error: 'invalid_request' }, 400)
    const owner = c.get('principal').subject
    if (body.data.expectedOwnerSubject !== owner) return c.json({ error: 'terminal_identity_changed' }, 409)
    return c.json(approveTerminalPairing(c.var.ctx.db, c.req.param('id'), owner, body.data.botName))
  })
  app.get('/computers', c => c.json({ computers: remoteComputers(c.var.ctx.db, c.get('principal').subject) }))
  app.patch('/computers/:id', async c => {
    const b = z.object({ expectedOwnerSubject: z.string().min(1).max(512), name: z.string().trim().min(1).max(60).regex(/^[^\x00-\x1f\x7f]*$/), remoteEnabled: z.boolean(), expectedRevision: z.number().int().min(0) }).strict().safeParse(await c.req.json().catch(() => null))
    if (!b.success || !connectionId.safeParse(c.req.param('id')).success) return c.json({ error: 'invalid_request' }, 400)
    if (b.data.expectedOwnerSubject !== c.get('principal').subject) return c.json({ error: 'terminal_identity_changed' }, 409)
    configureComputer(c.var.ctx.db, c.get('principal').subject, c.req.param('id'), b.data.name, b.data.remoteEnabled, b.data.expectedRevision)
    return c.json({ updated: true })
  })
  app.get('/connections', c => c.json({ connections: listTerminalConnections(c.var.ctx.db, c.get('principal').subject) }))
  app.delete('/connections/:id', c => {
    if (!connectionId.safeParse(c.req.param('id')).success) return c.json({ error: 'connection_not_found' }, 404)
    const removed = revokeTerminalConnection(c.var.ctx.db, c.get('principal').subject, c.req.param('id'))
    return removed ? c.json({ revoked: true }) : c.json({ error: 'connection_not_found' }, 404)
  })
  return app
}
