import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { ServerContext } from '../context.js'

const HealthSchema = z
  .object({
    ok: z.boolean(),
    version: z.string(),
    uptimeSec: z.number(),
    authentication: z.enum(['keyname', 'password', 'none']),
  })
  .openapi('Health')

export function healthRoutes(): OpenAPIHono<{ Variables: { ctx: ServerContext } }> {
  const app = new OpenAPIHono<{ Variables: { ctx: ServerContext } }>()
  const startedAt = Date.now()
  const route = createRoute({
    method: 'get',
    path: '/health',
    tags: ['system'],
    responses: {
      200: {
        description: 'Server health probe',
        content: { 'application/json': { schema: HealthSchema } },
      },
    },
  })
  app.openapi(route, (c) =>
    c.json(
      {
        ok: true,
        version: '0.0.0',
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
        authentication: c.var.ctx.config.keyname.enabled ? 'keyname' as const : c.var.ctx.config.server.password ? 'password' as const : 'none' as const,
      },
      200,
    ),
  )
  return app
}
