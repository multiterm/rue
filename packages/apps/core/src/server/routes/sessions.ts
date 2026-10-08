import {HistoryError,ConversationError} from '@multiterm/rue-db/postgres'
import {sessionServices} from '../session-services.js'
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { randomBytes } from 'node:crypto'
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

  app.get('/session/:id/usage',async c=>{
    const owner=c.get('principal').subject,id=c.req.param('id')
    if(!await sessionServices(c.var.ctx).conversations.get(owner,id))return c.json({error:'session_not_found'},404)
    const days=Number(c.req.query('days')??30)
    if(![7,30,90].includes(days))return c.json({error:'invalid_usage_range'},400)
    c.header('cache-control','private, no-store')
    return c.json(await sessionServices(c.var.ctx).usage.report(owner,id,days))
  })

  app.delete('/session/:id/history',async c=>{
    const owner=c.get('principal').subject,id=c.req.param('id')
    if(!await sessionServices(c.var.ctx).conversations.get(owner,id))return c.json({error:'session_not_found'},404)
    const input=z.object({expectedLastMessageId:z.string().min(1).max(128).nullable()}).strict().safeParse(await c.req.json().catch(()=>null))
    if(!input.success)return c.json({error:'invalid_history_request'},400)
    const resetting=c.var.ctx.historyResets??=new Set<string>()
    if((c.var.ctx.activeRuns?.get(owner)??0)>0||resetting.has(owner))return c.json({error:'history_run_active'},409)
    resetting.add(owner)
    try{const result=await sessionServices(c.var.ctx).history.clear(owner,id,input.data.expectedLastMessageId);c.var.ctx.bus.publish('message.history-cleared',{ownerSubject:owner,sessionId:id});c.var.ctx.bus.publish('session.updated',{ownerSubject:owner,sessionId:id});return c.json(result)}catch(error){if(error instanceof HistoryError)return c.json({error:error.code},error.status);throw error}finally{resetting.delete(owner)}
  })

  // Binary content is authenticated separately; transcript polling only carries metadata.
  app.get('/session/:id/attachments/:part', async c => {
    const store = sessionServices(c.var.ctx).conversations
    const id = c.req.param('id'),owner=c.get('principal').subject
    if (!await store.get(owner,id)) return c.json({ error: 'session_not_found' }, 404)
    const row = await store.getPart(owner,c.req.param('part'))
    if (!row||row.sessionId!==id||row.type!=='file') return c.json({ error: 'attachment_not_found' }, 404)
    const file = row.payload
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
    async (c) => c.json((await sessionServices(c.var.ctx).conversations.list(c.get('principal').subject,{limit:100})).items, 200),
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
    async (c) => {
      const body = c.req.valid('json')
      const row = await sessionServices(c.var.ctx).conversations.create(c.get('principal').subject, {
        id: generateId('ses'),
        title: body.title,
        agent: body.agent,
        provider: body.provider ?? c.var.ctx.config.provider,
        model: body.model ?? c.var.ctx.config.model,
        directory: body.directory,
        scopes: body.scopes,
        parentId: body.parentId,
        meta: body.meta,
      })
      c.var.ctx.bus.publish('session.created', { ownerSubject:c.get('principal').subject,sessionId: row.id })
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
    async (c) => {
      const { id } = c.req.valid('param')
      const row = await sessionServices(c.var.ctx).conversations.get(c.get('principal').subject,id)
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
    async (c) => {
      const { id } = c.req.valid('param')
      const body = c.req.valid('json')
      const row = await sessionServices(c.var.ctx).conversations.update(c.get('principal').subject,id,body)
      if (!row) return c.json({ error: 'session_not_found' }, 404)
      c.var.ctx.bus.publish('session.updated', { ownerSubject:c.get('principal').subject,sessionId: row.id })
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
    async (c) => {
      const { id } = c.req.valid('param')
      try {
        const ok = await sessionServices(c.var.ctx).conversations.delete(c.get('principal').subject,id)
        if (ok) c.var.ctx.bus.publish('session.deleted', { ownerSubject:c.get('principal').subject, sessionId: id })
        return c.json({ deleted: ok }, 200)
      } catch(error) {
        if(error instanceof ConversationError&&error.status===409)return c.json({error:error.code},409)
        throw error
      }
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
    async (c) => {
      const { id } = c.req.valid('param')
      return c.json(await sessionServices(c.var.ctx).conversations.listMessages(c.get('principal').subject,id), 200)
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
    async (c) => {
      const { id } = c.req.valid('param'),owner=c.get('principal').subject,store=sessionServices(c.var.ctx)
      if (!await store.conversations.get(owner,id)) return c.json([], 200)
      await store.relay.reconcileSession(owner,id)
      return c.json((await store.conversations.listSessionParts(owner,id)).map(part => {
        if (part.type !== 'file') return part
        const { data: _data, ...payload } = part.payload
        return { ...part, payload }
      }), 200)
    },
  )

  return app
}
