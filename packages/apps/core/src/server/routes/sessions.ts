import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
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
  // 24-char random base36; collision odds are astronomically low for our scale.
  const rand = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  return `${prefix}_${rand.slice(0, 24)}`
}

/* ---------- routes ---------- */

export function sessionRoutes(): OpenAPIHono<{ Variables: { ctx: ServerContext } }> {
  const app = new OpenAPIHono<{ Variables: { ctx: ServerContext } }>()

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
    (c) => c.json(listSessions(c.var.ctx.db), 200),
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
      const row = getSession(c.var.ctx.db, id)
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
      const row = updateSession(c.var.ctx.db, id, body)
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
      },
    }),
    (c) => {
      const { id } = c.req.valid('param')
      const ok = deleteSession(c.var.ctx.db, id)
      if (ok) c.var.ctx.bus.publish('session.deleted', { sessionId: id })
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
      return c.json(listSessionParts(c.var.ctx.db, id), 200)
    },
  )

  return app
}
