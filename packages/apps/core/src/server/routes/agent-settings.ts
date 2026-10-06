import { OpenAPIHono } from '@hono/zod-openapi'
import type { ServerContext } from '../context.js'
import { AgentSettingsUpdateSchema, AgentSettingsError } from '../../storage/agent-settings.js'
import {sessionServices} from '../session-services.js'
import { piModelIds } from '../../provider/pi.js'

export function agentSettingsRoutes() {
  const app = new OpenAPIHono<{ Variables: { ctx: ServerContext } }>()
  app.use('/agent/settings', async (c, next) => { c.header('cache-control', 'no-store'); return next() })
  app.get('/agent/settings', async c => c.json({ ownerSubject: c.get('principal').subject, ...await sessionServices(c.var.ctx).settings.get(c.get('principal').subject), models: piModelIds() }))
  app.put('/agent/settings', async c => {
    const parsed = AgentSettingsUpdateSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success || !piModelIds().includes(parsed.data.model)) return c.json({ error: 'invalid_agent_settings' }, 400)
    if (parsed.data.expectedOwnerSubject !== c.get('principal').subject) return c.json({ error: 'agent_settings_identity_changed' }, 409)
    try {
      const ownerSubject = c.get('principal').subject
      const settings = await sessionServices(c.var.ctx).settings.save(ownerSubject, parsed.data)
      c.var.ctx.bus.publish('provider-key.updated', { ownerSubject })
      return c.json({ ownerSubject, ...settings, models: piModelIds() })
    } catch (error) {
      if (error instanceof AgentSettingsError) return c.json({ error: error.code }, error.code === 'agent_settings_conflict' ? 409 : 503)
      return c.json({ error: 'agent_settings_unavailable' }, 503)
    }
  })
  return app
}
