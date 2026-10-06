import {sessionServices} from '../session-services.js'
import { OpenAPIHono, z } from '@hono/zod-openapi'
import {usageEventSchema} from '../../storage/agent-usage.js'
import { providerKeyDeliveryRoutes } from './provider-keys.js'
import { bodyLimit } from 'hono/body-limit'
import type { ServerContext } from '../context.js'
import {TerminalPairingError,RelayError} from '@multiterm/rue-db/postgres'
import {relayHealthSchema as healthSchema} from '../../storage/relay-health.js'

const instanceSchema = z.object({ instance: z.string().uuid() }).strict()
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
    return c.json(await sessionServices(c.var.ctx).terminal.pairing.request( body.data.challenge, body.data.piSessionId), 201)
  })
  app.post('/exchange', async c => {
    const body = exchangeSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json({ error: 'invalid_pairing' }, 400)
    return c.json(await sessionServices(c.var.ctx).terminal.pairing.exchange( body.data.requestId, body.data.verifier, body.data.code))
  })
  app.post('/activate', async c => {
    const body = z.object({ confirmOwnerSubject: z.string().min(1).max(512) }).strict().safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json({ error: 'invalid_request' }, 400)
    const token = bearer(c.req.header('authorization'))
    return c.json(await sessionServices(c.var.ctx).terminal.pairing.activate(token, undefined, body.data.confirmOwnerSubject))
  })
  app.get('/connections/:id', async c => {
    if (!connectionId.safeParse(c.req.param('id')).success) return c.json({ error: 'invalid_terminal_credential' }, 401)
    const token = bearer(c.req.header('authorization'))
    return c.json(await sessionServices(c.var.ctx).terminal.pairing.authenticate(token, c.req.param('id')))
  })
  app.get('/connections/:id/authority', async c => {
    const id=c.req.param('id')
    if(!connectionId.safeParse(id).success)return c.json({error:'invalid_terminal_credential'},401)
    const result=await sessionServices(c.var.ctx).terminal.pairing.authority(bearer(c.req.header('authorization')),id)
    return result?c.json(result):c.json({error:'not_managed'},404)
  })
  app.get('/connections/:id/receipts', async c => {
    if (!connectionId.safeParse(c.req.param('id')).success) return c.json({ error: 'invalid_terminal_credential' }, 401)
    return c.json(await sessionServices(c.var.ctx).terminal.relay.receipts( bearer(c.req.header('authorization')), c.req.param('id')))
  })
  app.delete('/connections/:id', async c => {
    if (!connectionId.safeParse(c.req.param('id')).success) return c.json({ error: 'invalid_terminal_credential' }, 401)
    const token = bearer(c.req.header('authorization'))
    const {revoked,connection}=await sessionServices(c.var.ctx).terminal.pairing.revokeWithConnection(token,c.req.param('id'))
    if(revoked)c.var.ctx.bus.publish('terminal.control.changed',{ownerSubject:connection.ownerSubject,sessionId:connection.sessionId})
    return c.json({ revoked })
  })
  app.post('/connections/:id/relay/:action', async c => {
    const id = c.req.param('id'), action = c.req.param('action'), token = bearer(c.req.header('authorization'))
    if (!connectionId.safeParse(id).success) return c.json({ error: 'invalid_request' }, 400)
    const raw = await c.req.json().catch(() => null)
    if(action==='usage'){
      const input=z.object({instance:z.string().uuid(),event:usageEventSchema}).strict().safeParse(raw)
      if(!input.success)return c.json({error:'invalid_usage_event'},400)
      try{return c.json({recorded:await sessionServices(c.var.ctx).terminal.recordUsage({token,id,instance:input.data.instance},input.data.event)})}
      catch(error){
        if(error instanceof Error&&['Invalid usage owner','Invalid usage connection','Invalid usage time','Invalid usage credential'].includes(error.message))return c.json({error:'invalid_usage_event'},400)
        throw error
      }
    }
    if (action === 'mirror') {
      const b = mirrorSchema.safeParse(raw)
      if (!b.success) return c.json({ error: 'invalid_request' }, 400)
      const store=sessionServices(c.var.ctx),connection=await store.terminal.pairing.authenticate(token,id)
      const result=await store.terminal.relay.mirror(token,id,b.data.instance,b.data.eventId,b.data.role,b.data.text,undefined,b.data.snapshot)
      const message=await store.conversations.getMessage(connection.ownerSubject,result.messageId),parts=await store.conversations.listParts(connection.ownerSubject,result.messageId)
      const update={...result,ownerSubject:connection.ownerSubject,...(message?{upsert:{message,parts}}:{})}
      c.var.ctx.bus.publish('message.created', update)
      c.var.ctx.bus.publish('part.updated', update)
      return c.json(result)
    }
    const b = controlSchema.safeParse(raw)
    if (!b.success) return c.json({ error: 'invalid_request' }, 400)
    if (action === 'attach') {
      const result = await sessionServices(c.var.ctx).terminal.relay.attach(token, id, b.data.instance, undefined, b.data.protocol)
      c.var.ctx.bus.publish('terminal.control.changed', { ownerSubject:result.ownerSubject, sessionId: result.sessionId })
      return c.json({ ...result, usageVersion:1, transport: c.var.ctx.terminalSocketEnabled ? 'websocket-v1' : 'https' })
    }
    if (action === 'poll' || action === 'heartbeat') {
      const result = await sessionServices(c.var.ctx).terminal.relay.poll(token, id, b.data.instance, undefined, b.data.protocol, b.data.health)
      c.var.ctx.bus.publish('computer.updated', { ownerSubject:result.connection.ownerSubject, sessionId: result.connection.sessionId })
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
      const store=sessionServices(c.var.ctx).terminal,connection=await store.pairing.authenticate(token,id)
      const result=await store.relay.publish(token,id,b.data.instance,c.req.param('command'),b.data.version,b.data.text,b.data.status,undefined,b.data.transcript)
      c.var.ctx.bus.publish('part.updated', { ownerSubject:connection.ownerSubject,sessionId: connection.sessionId, messageId: result.assistant_message_id })
      return c.json({ accepted: true, version: result.version })
    }
    const b = instanceSchema.safeParse(raw)
    if (b.success && action === 'input') {
      c.header('Cache-Control', 'no-store')
      return c.json({ content: await sessionServices(c.var.ctx).terminal.relay.input( token, id, b.data.instance, c.req.param('command')) })
    }
    if (!b.success || !['claim', 'start', 'reject'].includes(action)) return c.json({ error: 'invalid_request' }, 400)
    const store=sessionServices(c.var.ctx).terminal,connection=await store.pairing.authenticate(token,id)
    const result=await store.relay.transition(token,id,b.data.instance,c.req.param('command'),action as 'claim'|'start'|'reject')
    c.var.ctx.bus.publish('part.updated', { ownerSubject:connection.ownerSubject,sessionId: connection.sessionId })
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
    return c.json(await sessionServices(c.var.ctx).terminal.pairing.approve( c.req.param('id'), owner, body.data.botName))
  })
  app.get('/computers', async c => c.json({ computers: await sessionServices(c.var.ctx).terminal.relay.list(c.get('principal').subject) }))
  app.get('/computers/:id/catalog',async c=>{
    const id=connectionId.safeParse(c.req.param('id'));if(!id.success)return c.json({error:'invalid_connection'},400)
    const value=await sessionServices(c.var.ctx).terminal.relay.catalog(c.get('principal').subject,id.data)
    return value?c.json(value):c.json({error:'connection_not_found'},404)
  })
  app.get('/computers/:id/queue', async c => {
    if (!connectionId.safeParse(c.req.param('id')).success) return c.json({ error: 'connection_not_found' }, 404)
    const messages = await sessionServices(c.var.ctx).terminal.relay.queue( c.get('principal').subject, c.req.param('id'))
    if (!messages) return c.json({ error: 'connection_not_found' }, 404)
    c.header('Cache-Control', 'private, no-store')
    return c.json({ messages, recoverableCount:await sessionServices(c.var.ctx).terminal.relay.recoverableCount(c.get('principal').subject,c.req.param('id'))??0 })
  })
  app.get('/computers/:id/queue/recoverable',async c=>{
    if(!connectionId.safeParse(c.req.param('id')).success)return c.json({error:'connection_not_found'},404)
    const messages=await sessionServices(c.var.ctx).terminal.relay.recoverableMessages(c.get('principal').subject,c.req.param('id'))
    if(!messages)return c.json({error:'connection_not_found'},404)
    return c.json({messages})
  })
  app.post('/computers/:id/queue/:command/requeue',async c=>{
    const input=z.object({expectedSessionId:z.string().min(1).max(128),acknowledgeRequeue:z.literal(true)}).strict().safeParse(await c.req.json().catch(()=>null))
    if(!input.success||!connectionId.safeParse(c.req.param('id')).success||!z.string().uuid().safeParse(c.req.param('command')).success)return c.json({error:'invalid_request'},400)
    const owner=c.get('principal').subject,result=await sessionServices(c.var.ctx).terminal.relay.restoreQueue(owner,c.req.param('id'),c.req.param('command'),input.data.expectedSessionId)
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
    const computer=(await sessionServices(c.var.ctx).terminal.relay.list(c.get('principal').subject)).find(row=>row.id===c.req.param('id'))
    if(!computer)return c.json({error:'connection_not_found'},404)
    if(computer.sessionId!==b.data.expectedSessionId)return c.json({error:'terminal_identity_changed'},409)
    const requestedAt=Date.now()
    if(computer.status==='online')c.var.ctx.bus.publish('terminal.control.changed',{ownerSubject:c.get('principal').subject,sessionId:computer.sessionId})
    c.header('Cache-Control','private, no-store')
    return c.json({requestedAt,agentOnline:computer.status==='online',sessionId:computer.sessionId})
  })
  app.patch('/computers/:id', async c => {
    const b = z.object({ expectedOwnerSubject: z.string().min(1).max(512), name: z.string().trim().min(1).max(60).regex(/^[^\x00-\x1f\x7f]*$/), remoteEnabled: z.boolean(), expectedRevision: z.number().int().min(0) }).strict().safeParse(await c.req.json().catch(() => null))
    if (!b.success || !connectionId.safeParse(c.req.param('id')).success) return c.json({ error: 'invalid_request' }, 400)
    if (b.data.expectedOwnerSubject !== c.get('principal').subject) return c.json({ error: 'terminal_identity_changed' }, 409)
    const store=sessionServices(c.var.ctx).terminal,owner=c.get('principal').subject
    await store.relay.configure(owner,c.req.param('id'),b.data.name,b.data.remoteEnabled,b.data.expectedRevision)
    const connection=(await store.pairing.list(owner)).find(row=>row.id===c.req.param('id'))
    if(connection)c.var.ctx.bus.publish('terminal.control.changed',{ownerSubject:owner,sessionId:connection.sessionId})
    return c.json({ updated: true })
  })
  app.get('/connections', async c => c.json({ connections: await sessionServices(c.var.ctx).terminal.pairing.list(c.get('principal').subject) }))
  app.delete('/connections/:id', async c => {
    if (!connectionId.safeParse(c.req.param('id')).success) return c.json({ error: 'connection_not_found' }, 404)
    const store=sessionServices(c.var.ctx).terminal,owner=c.get('principal').subject
    const connection=(await store.pairing.list(owner)).find(row=>row.id===c.req.param('id'))
    const removed=await store.pairing.revoke(owner,c.req.param('id'))
    if(removed&&connection)c.var.ctx.bus.publish('terminal.control.changed',{ownerSubject:owner,sessionId:connection.sessionId})
    return removed ? c.json({ revoked: true }) : c.json({ error: 'connection_not_found' }, 404)
  })
  return app
}
