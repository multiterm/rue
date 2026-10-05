import {agentUsage} from '../../storage/agent-usage.js'
import {clearSessionHistory,HistoryError} from '../../storage/history.js'
import { reconcileTerminalSession } from '../../storage/terminal-relay.js'
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { randomBytes } from 'node:crypto'
import {
  createSession,
  deleteSession,
  getSession,
  listMessages,
  listSessionParts,
  listSessions,
  updateSession,
} from '../../storage/index.js'
import type { ServerContext } from '../context.js'

/* ---------- shared schemas ---------- */

const SessionSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    agent: z.string().nullable(),
    provider: z.string().nullable(),
    model: z.string().nullable(),
    directory: z.string().nullable(),
    scopes: z.array(z.string()),
    parentId: z.string().nullable(),
    ownerSubject: z.string(),
    terminalConnectionId: z.string().nullable().optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
    meta: z.record(z.string(), z.unknown()),
  })
  .openapi('Session')

const MessageSchema = z
  .object({
    id: z.string(),
    sessionId: z.string(),
    role: z.enum(['user', 'assistant', 'system']),
    time: z.number(),
    provider: z.string().nullable(),
    model: z.string().nullable(),
    agent: z.string().nullable(),
    meta: z.record(z.string(), z.unknown()),
    seq: z.number(),
  })
  .openapi('Message')

const PartSchema = z
  .object({
    id: z.string(),
    sessionId: z.string(),
    messageId: z.string(),
    type: z.string(),
    seq: z.number(),
    payload: z.record(z.string(), z.unknown()),
  })
  .openapi('Part')

const CreateSessionSchema = z
  .object({
    title: z.string().optional(),
    agent: z.string().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    directory: z.string().optional(),
    scopes: z.array(z.string()).optional(),
    parentId: z.string().optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('CreateSession')

const UpdateSessionSchema = CreateSessionSchema.openapi('UpdateSession')

const IdParamSchema = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
})

const ErrorSchema = z.object({ error: z.string() }).openapi('Error')

/* ---------- generator ---------- */

function generateId(prefix: string): string {
  return `${prefix}_${randomBytes(18).toString('base64url')}`
}

/* ---------- routes ---------- */

export function sessionRoutes(): OpenAPIHono<{ Variables: { ctx: ServerContext } }> {
  const app = new OpenAPIHono<{ Variables: { ctx: ServerContext } }>()

  app.get('/session/:id/usage',c=>{
    const owner=c.get('principal').subject,id=c.req.param('id')
    if(!getSession(c.var.ctx.db,id,owner))return c.json({error:'session_not_found'},404)
    const days=Number(c.req.query('days')??30)
    if(![7,30,90].includes(days))return c.json({error:'invalid_usage_range'},400)
    c.header('cache-control','private, no-store')
    return c.json(agentUsage(c.var.ctx.db,owner,id,days))
  })

  app.delete('/session/:id/history',async c=>{
    const owner=c.get('principal').subject,id=c.req.param('id')
    if(!getSession(c.var.ctx.db,id,owner))return c.json({error:'session_not_found'},404)
    const input=z.object({expectedLastMessageId:z.string().min(1).max(128).nullable()}).strict().safeParse(await c.req.json().catch(()=>null))
    if(!input.success)return c.json({error:'invalid_history_request'},400)
    if((c.var.ctx.activeRuns?.get(owner)??0)>0)return c.json({error:'history_run_active'},409)
    try{const result=clearSessionHistory(c.var.ctx.db,id,owner,input.data.expectedLastMessageId);c.var.ctx.bus.publish('message.history-cleared',{ownerSubject:owner,sessionId:id});c.var.ctx.bus.publish('session.updated',{ownerSubject:owner,sessionId:id});return c.json(result)}catch(error){if(error instanceof HistoryError)return c.json({error:error.code},error.status);throw error}
  })

  // Binary content is authenticated separately; transcript polling only carries metadata.
  app.get('/session/:id/attachments/:part', c => {
    const { db } = c.var.ctx
    const id = c.req.param('id')
    if (!getSession(db, id, c.get('principal').subject)) return c.json({ error: 'session_not_found' }, 404)
    const row = db.prepare("SELECT payload FROM parts WHERE id=? AND session_id=? AND type='file'").get(c.req.param('part'), id) as { payload: string } | undefined
    if (!row) return c.json({ error: 'attachment_not_found' }, 404)
    const file = JSON.parse(row.payload)
    if (typeof file.data !== 'string') return c.json({ error: 'attachment_not_found' }, 404)
    c.header('Content-Type', 'application/octet-stream')
    c.header('Content-Disposition', 'attachment')
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Cache-Control', 'private, no-store')
    return c.body(new Uint8Array(Buffer.from(file.data, 'base64')))
  })

  // List
  app.openapi(
    createRoute({
      method: 'get',
      path: '/session',
      tags: ['session'],
      responses: {
        200: {
          description: 'List sessions, most recently updated first.',
          content: { 'application/json': { schema: z.array(SessionSchema) } },
        },
      },
    }),
    (c) => c.json(listSessions(c.var.ctx.db, 100, c.get('principal').subject), 200),
  )

  // Create
  app.openapi(
    createRoute({
      method: 'post',
      path: '/session',
      tags: ['session'],
      request: {
        body: {
          content: { 'application/json': { schema: CreateSessionSchema } },
          required: true,
        },
      },
      responses: {
        200: {
          description: 'Created session',
          content: { 'application/json': { schema: SessionSchema } },
        },
      },
    }),
    (c) => {
      const body = c.req.valid('json')
      const row = createSession(c.var.ctx.db, {
        id: generateId('ses'),
        title: body.title,
        agent: body.agent,
        provider: body.provider ?? c.var.ctx.config.provider,
        model: body.model ?? c.var.ctx.config.model,
        directory: body.directory,
        scopes: body.scopes,
        parentId: body.parentId,
        ownerSubject: c.get('principal').subject,
        meta: body.meta,
      })
      c.var.ctx.bus.publish('session.created', { sessionId: row.id })
      return c.json(row, 200)
    },
  )

  // Get
  app.openapi(
    createRoute({
      method: 'get',
      path: '/session/{id}',
      tags: ['session'],
      request: { params: IdParamSchema },
      responses: {
        200: {
          description: 'Session detail',
          content: { 'application/json': { schema: SessionSchema } },
        },
        404: {
          description: 'Not found',
          content: { 'application/json': { schema: ErrorSchema } },
        },
      },
    }),
    (c) => {
      const { id } = c.req.valid('param')
      const row = getSession(c.var.ctx.db, id, c.get('principal').subject)
      if (!row) return c.json({ error: 'session_not_found' }, 404)
      return c.json(row, 200)
    },
  )

  // Update
  app.openapi(
    createRoute({
      method: 'patch',
      path: '/session/{id}',
      tags: ['session'],
      request: {
        params: IdParamSchema,
        body: {
          content: { 'application/json': { schema: UpdateSessionSchema } },
          required: true,
        },
      },
      responses: {
        200: {
          description: 'Updated session',
          content: { 'application/json': { schema: SessionSchema } },
        },
        404: {
          description: 'Not found',
          content: { 'application/json': { schema: ErrorSchema } },
        },
      },
    }),
    (c) => {
      const { id } = c.req.valid('param')
      const body = c.req.valid('json')
      const row = updateSession(c.var.ctx.db, id, body, c.get('principal').subject)
      if (!row) return c.json({ error: 'session_not_found' }, 404)
      c.var.ctx.bus.publish('session.updated', { sessionId: row.id })
      return c.json(row, 200)
    },
  )

  // Delete
  app.openapi(
    createRoute({
      method: 'delete',
      path: '/session/{id}',
      tags: ['session'],
      request: { params: IdParamSchema },
      responses: {
        200: {
          description: 'Deleted',
          content: { 'application/json': { schema: z.object({ deleted: z.boolean() }) } },
        },
        409: { description: 'Destroy managed runtime first', content: { 'application/json': { schema: z.object({ error: z.string() }) } } },
      },
    }),
    (c) => {
      const { id } = c.req.valid('param')
      const managed = c.var.ctx.db.prepare("SELECT 1 FROM managed_agents WHERE session_id=? AND owner_subject=? AND desired!='destroyed'").get(id,c.get('principal').subject)
      if (managed) return c.json({ error: 'managed_agent_destroy_required' },409)
      const ok = deleteSession(c.var.ctx.db, id, c.get('principal').subject)
      if (ok) c.var.ctx.bus.publish('session.deleted', { ownerSubject:c.get('principal').subject, sessionId: id })
      return c.json({ deleted: ok }, 200)
    },
  )

  // Messages of a session
  app.openapi(
    createRoute({
      method: 'get',
      path: '/session/{id}/messages',
      tags: ['session'],
      request: { params: IdParamSchema },
      responses: {
        200: {
          description: 'Messages ordered by seq',
          content: { 'application/json': { schema: z.array(MessageSchema) } },
        },
      },
    }),
    (c) => {
      const { id } = c.req.valid('param')
      if (!getSession(c.var.ctx.db, id, c.get('principal').subject)) return c.json([], 200)
      return c.json(listMessages(c.var.ctx.db, id), 200)
    },
  )

  // Parts of a session (across all messages, in order)
  app.openapi(
    createRoute({
      method: 'get',
      path: '/session/{id}/parts',
      tags: ['session'],
      request: { params: IdParamSchema },
      responses: {
        200: {
          description: 'Parts ordered by (message.seq, part.seq)',
          content: { 'application/json': { schema: z.array(PartSchema) } },
        },
      },
    }),
    (c) => {
      const { id } = c.req.valid('param')
      if (!getSession(c.var.ctx.db, id, c.get('principal').subject)) return c.json([], 200)
      reconcileTerminalSession(c.var.ctx.db, id)
      return c.json(listSessionParts(c.var.ctx.db, id).map(part => {
        if (part.type !== 'file') return part
        const { data: _data, ...payload } = part.payload
        return { ...part, payload }
      }), 200)
    },
  )

  return app
}
