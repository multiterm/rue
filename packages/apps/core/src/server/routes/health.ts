import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { ServerContext } from '../context.js'

const HealthSchema = z
  .object({
    ok: z.boolean(),
    version: z.string(),
    uptimeSec: z.number(),
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
      },
      200,
    ),
  )
  return app
}
