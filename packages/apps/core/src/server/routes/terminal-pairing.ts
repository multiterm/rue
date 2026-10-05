import {getMessage,listParts} from '../../storage/messages.js'
import { OpenAPIHono, z } from '@hono/zod-openapi'
import { managedAuthority } from '../../storage/managed-agents.js'
import {recordAgentUsage,usageEventSchema} from '../../storage/agent-usage.js'
import {validateRelaySocket} from '../../storage/terminal-relay.js'
import { providerKeyDeliveryRoutes } from './provider-keys.js'
import { bodyLimit } from 'hono/body-limit'
import type { ServerContext } from '../context.js'
import { requestTerminalPairing, approveTerminalPairing, exchangeTerminalPairing, activateTerminalConnection, authenticateTerminalConnection, listTerminalConnections, revokeTerminalConnection, revokeTerminalCredential, TerminalPairingError } from '../../storage/terminal-pairing.js'

import { RelayError, remoteComputers, computerCatalog, computerQueue, recoverableQueuedCount, recoverableQueuedMessages, restoreExpiredQueuedPrompt, configureComputer, attachComputer, pollComputer, transitionCommand, terminalCommandInput, publishCommand, mirrorTerminalText, terminalMirrorReceipts } from '../../storage/terminal-relay.js'

const instanceSchema = z.object({ instance: z.string().uuid() }).strict()
import {agentStatusSchema} from '../../storage/agent-status.js'
const healthSchema = z.object({ status:agentStatusSchema.optional(), transport: z.enum(['websocket', 'https']).optional(), agentWorking: z.boolean().optional(), uploadFailures: z.number().int().min(0).max(1000000), retries: z.number().int().min(0).max(1000000), lastUploadAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(), pendingCount: z.number().int().min(0).max(100), pendingBytes: z.number().int().min(0).max(2000000), pollLatencyMs: z.number().int().min(0).max(60000) }).strict()
const controlSchema = instanceSchema.extend({ protocol: z.union([z.literal(1), z.literal(2)]).optional(), health: healthSchema.optional() }).strict()
const outputSchema = z.object({ instance: z.string().uuid(), version: z.number().int().min(1), text: z.string().max(100_000), status: z.enum(['running', 'completed', 'failed']), transcript: z.boolean().optional() }).strict()
const mirrorSchema = z.object({ instance: z.string().uuid(), eventId: z.string().uuid(), role: z.enum(['user', 'assistant']), text: z.string().max(100_000), snapshot: z.object({ version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), final: z.boolean(), outcome:z.enum(['failed','interrupted']).optional(), reasoning: z.object({ id: z.string().uuid(), chunk: z.number().int().min(0).max(10000) }).strict().optional(), tool: z.object({ id: z.string().uuid(), name: z.string().min(1).max(100), status: z.enum(['running', 'completed', 'failed', 'interrupted']), chunk: z.number().int().min(0).max(10000) }).strict().optional() }).strict().optional() }).strict().refine(value => value.text.length > 0 || value.snapshot !== undefined).refine(value => !value.snapshot?.reasoning || (value.role === 'assistant' && !value.snapshot.tool)).refine(value=>!value.snapshot?.outcome||(value.role==='assistant'&&value.snapshot.final))

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
    const status = error.code === 'invalid_terminal_credential' ? 401 : ['already_approved', 'already_linked'].includes(error.code) ? 409 : error.code === 'pairing_unavailable' ? 429 : 400
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
  app.route('/', providerKeyDeliveryRoutes('terminal'))
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
  app.get('/connections/:id/authority', c => {
    const id = c.req.param('id'), now = Date.now()
    if (!connectionId.safeParse(id).success) return c.json({ error: 'invalid_terminal_credential' }, 401)
    const connection = authenticateTerminalConnection(c.var.ctx.db, bearer(c.req.header('authorization')), id, now)
    if (managedAuthority(c.var.ctx.db, id, now) === undefined) return c.json({ error: 'not_managed' }, 404)
    const relay=c.var.ctx.db.prepare('SELECT lease_expires_at FROM terminal_connections WHERE id=?').get(id) as {lease_expires_at:number|null}
    return c.json({ serverNow: now, expiresAt: connection.expiresAt, relayExpiresAt:relay.lease_expires_at, id: connection.id, piSessionId: connection.piSessionId, ownerSubject: connection.ownerSubject })
  })
  app.get('/connections/:id/receipts', c => {
    if (!connectionId.safeParse(c.req.param('id')).success) return c.json({ error: 'invalid_terminal_credential' }, 401)
    return c.json(terminalMirrorReceipts(c.var.ctx.db, bearer(c.req.header('authorization')), c.req.param('id')))
  })
  app.delete('/connections/:id', c => {
    if (!connectionId.safeParse(c.req.param('id')).success) return c.json({ error: 'invalid_terminal_credential' }, 401)
    const token = bearer(c.req.header('authorization'))
    const revoked = revokeTerminalCredential(c.var.ctx.db, token, c.req.param('id'))
    // Revocation also supports unactivated grants. Read only after credential validation.
    const connection = c.var.ctx.db.prepare('SELECT session_id AS sessionId FROM terminal_connections WHERE id=?').get(c.req.param('id')) as { sessionId: string } | undefined
    if (revoked && connection) c.var.ctx.bus.publish('terminal.control.changed', { sessionId: connection.sessionId })
    return c.json({ revoked })
  })
  app.post('/connections/:id/relay/:action', async c => {
    const id = c.req.param('id'), action = c.req.param('action'), token = bearer(c.req.header('authorization'))
    if (!connectionId.safeParse(id).success) return c.json({ error: 'invalid_request' }, 400)
    const raw = await c.req.json().catch(() => null)
    if(action==='usage'){
      const input=z.object({instance:z.string().uuid(),event:usageEventSchema}).strict().safeParse(raw)
      if(!input.success)return c.json({error:'invalid_usage_event'},400)
      const connection=validateRelaySocket(c.var.ctx.db,token,id,input.data.instance)
      try{return c.json({recorded:recordAgentUsage(c.var.ctx.db,connection.ownerSubject,connection.sessionId,id,input.data.event)})}
      catch{return c.json({error:'invalid_usage_event'},400)}
    }
    if (action === 'mirror') {
      const b = mirrorSchema.safeParse(raw)
      if (!b.success) return c.json({ error: 'invalid_request' }, 400)
      const result = mirrorTerminalText(c.var.ctx.db, token, id, b.data.instance, b.data.eventId, b.data.role, b.data.text, Date.now(), b.data.snapshot)
      const message=getMessage(c.var.ctx.db,result.messageId),parts=listParts(c.var.ctx.db,result.messageId)
      const update={...result,...(message?{upsert:{message,parts}}:{})}
      c.var.ctx.bus.publish('message.created', update)
      c.var.ctx.bus.publish('part.updated', update)
      return c.json(result)
    }
    const b = controlSchema.safeParse(raw)
    if (!b.success) return c.json({ error: 'invalid_request' }, 400)
    if (action === 'attach') {
      const result = attachComputer(c.var.ctx.db, token, id, b.data.instance, Date.now(), b.data.protocol)
      c.var.ctx.bus.publish('terminal.control.changed', { sessionId: result.sessionId })
      return c.json({ ...result, usageVersion:1, transport: c.var.ctx.terminalSocketEnabled ? 'websocket-v1' : 'https' })
    }
    if (action === 'poll' || action === 'heartbeat') {
      const result = pollComputer(c.var.ctx.db, token, id, b.data.instance, Date.now(), b.data.protocol, b.data.health)
      c.var.ctx.bus.publish('computer.updated', { sessionId: result.connection.sessionId })
      // Lease renewal is not a transcript/queue poll. Queued prompts are fetched
      // only on push notification or transport reconciliation.
      if (action === 'heartbeat') return c.json({ ...result, commands: result.commands.filter(row => row.status !== 'queued').map(row => ({ id: row.id, status: row.status, lease_expires_at: row.lease_expires_at })) })
      return c.json(result)
    }
    return c.json({ error: 'terminal_route_not_found' }, 404)
  })
  app.post('/connections/:id/relay/commands/:command/:action', async c => {
    const id = c.req.param('id'), action = c.req.param('action'), token = bearer(c.req.header('authorization'))
    if (!connectionId.safeParse(id).success || !z.string().uuid().safeParse(c.req.param('command')).success) return c.json({ error: 'invalid_request' }, 400)
    const raw = await c.req.json().catch(() => null)
    if (action === 'output') {
      const b = outputSchema.safeParse(raw)
      if (!b.success) return c.json({ error: 'invalid_request' }, 400)
      const result = publishCommand(c.var.ctx.db, token, id, b.data.instance, c.req.param('command'), b.data.version, b.data.text, b.data.status, Date.now(), b.data.transcript)
      const connection = authenticateTerminalConnection(c.var.ctx.db, token, id)
      c.var.ctx.bus.publish('part.updated', { sessionId: connection.sessionId, messageId: result.assistant_message_id })
      return c.json({ accepted: true, version: result.version })
    }
    const b = instanceSchema.safeParse(raw)
    if (b.success && action === 'input') {
      c.header('Cache-Control', 'no-store')
      return c.json({ content: terminalCommandInput(c.var.ctx.db, token, id, b.data.instance, c.req.param('command')) })
    }
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
  app.get('/computers/:id/catalog',c=>{
    const id=connectionId.safeParse(c.req.param('id'));if(!id.success)return c.json({error:'invalid_connection'},400)
    const value=computerCatalog(c.var.ctx.db,c.get('principal').subject,id.data)
    return value?c.json(value):c.json({error:'connection_not_found'},404)
  })
  app.get('/computers/:id/queue', c => {
    if (!connectionId.safeParse(c.req.param('id')).success) return c.json({ error: 'connection_not_found' }, 404)
    const messages = computerQueue(c.var.ctx.db, c.get('principal').subject, c.req.param('id'))
    if (!messages) return c.json({ error: 'connection_not_found' }, 404)
    c.header('Cache-Control', 'private, no-store')
    return c.json({ messages, recoverableCount:recoverableQueuedCount(c.var.ctx.db,c.get('principal').subject,c.req.param('id'))??0 })
  })
  app.get('/computers/:id/queue/recoverable',c=>{
    if(!connectionId.safeParse(c.req.param('id')).success)return c.json({error:'connection_not_found'},404)
    const messages=recoverableQueuedMessages(c.var.ctx.db,c.get('principal').subject,c.req.param('id'))
    if(!messages)return c.json({error:'connection_not_found'},404)
    return c.json({messages})
  })
  app.post('/computers/:id/queue/:command/requeue',async c=>{
    const input=z.object({expectedSessionId:z.string().min(1).max(128),acknowledgeRequeue:z.literal(true)}).strict().safeParse(await c.req.json().catch(()=>null))
    if(!input.success||!connectionId.safeParse(c.req.param('id')).success||!z.string().uuid().safeParse(c.req.param('command')).success)return c.json({error:'invalid_request'},400)
    const owner=c.get('principal').subject,result=restoreExpiredQueuedPrompt(c.var.ctx.db,owner,c.req.param('id'),c.req.param('command'),input.data.expectedSessionId)
    if(!result)return c.json({error:'queue_request_not_found'},404)
    if(result.changed){
      c.var.ctx.bus.publish('part.updated',{ownerSubject:owner,sessionId:input.data.expectedSessionId})
      c.var.ctx.bus.publish('session.updated',{ownerSubject:owner,sessionId:input.data.expectedSessionId})
      c.var.ctx.bus.publish('terminal.command.queued',{ownerSubject:owner,sessionId:input.data.expectedSessionId})
    }
    return c.json({id:result.id,status:result.status,restored:result.restored})
  })
  app.post('/computers/:id/sync', async c => {
    const b=z.object({expectedSessionId:z.string().min(1).max(128)}).strict().safeParse(await c.req.json().catch(()=>null))
    if(!b.success||!connectionId.safeParse(c.req.param('id')).success)return c.json({error:'invalid_request'},400)
    const computer=remoteComputers(c.var.ctx.db,c.get('principal').subject).find(row=>row.id===c.req.param('id'))
    if(!computer)return c.json({error:'connection_not_found'},404)
    if(computer.sessionId!==b.data.expectedSessionId)return c.json({error:'terminal_identity_changed'},409)
    const requestedAt=Date.now()
    if(computer.status==='online')c.var.ctx.bus.publish('terminal.control.changed',{sessionId:computer.sessionId})
    c.header('Cache-Control','private, no-store')
    return c.json({requestedAt,agentOnline:computer.status==='online',sessionId:computer.sessionId})
  })
  app.patch('/computers/:id', async c => {
    const b = z.object({ expectedOwnerSubject: z.string().min(1).max(512), name: z.string().trim().min(1).max(60).regex(/^[^\x00-\x1f\x7f]*$/), remoteEnabled: z.boolean(), expectedRevision: z.number().int().min(0) }).strict().safeParse(await c.req.json().catch(() => null))
    if (!b.success || !connectionId.safeParse(c.req.param('id')).success) return c.json({ error: 'invalid_request' }, 400)
    if (b.data.expectedOwnerSubject !== c.get('principal').subject) return c.json({ error: 'terminal_identity_changed' }, 409)
    configureComputer(c.var.ctx.db, c.get('principal').subject, c.req.param('id'), b.data.name, b.data.remoteEnabled, b.data.expectedRevision)
    const connection = listTerminalConnections(c.var.ctx.db, c.get('principal').subject).find(row => row.id === c.req.param('id'))
    if (connection) c.var.ctx.bus.publish('terminal.control.changed', { sessionId: connection.sessionId })
    return c.json({ updated: true })
  })
  app.get('/connections', c => c.json({ connections: listTerminalConnections(c.var.ctx.db, c.get('principal').subject) }))
  app.delete('/connections/:id', c => {
    if (!connectionId.safeParse(c.req.param('id')).success) return c.json({ error: 'connection_not_found' }, 404)
    const connection = listTerminalConnections(c.var.ctx.db, c.get('principal').subject).find(row => row.id === c.req.param('id'))
    const removed = revokeTerminalConnection(c.var.ctx.db, c.get('principal').subject, c.req.param('id'))
    if (removed && connection) c.var.ctx.bus.publish('terminal.control.changed', { sessionId: connection.sessionId })
    return removed ? c.json({ revoked: true }) : c.json({ error: 'connection_not_found' }, 404)
  })
  return app
}
