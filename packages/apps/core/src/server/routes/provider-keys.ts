import {sessionServices} from '../session-services.js'
import { OpenAPIHono, z } from '@hono/zod-openapi'
import {providerCatalog,managedProviderCatalog,credentialProviders,supportedProviderModel} from '../../provider/catalog.js'
import { bodyLimit } from 'hono/body-limit'
import type { ServerContext } from '../context.js'
import { ProviderKeyError, providerSchema, targetSchema } from '../../storage/provider-keys.js'
import { AgentSettingsError } from '../../storage/agent-settings.js'
import { RelayError } from '../../storage/terminal-relay.js'
import { TerminalPairingError } from '../../storage/terminal-pairing.js'
import { WorkerError } from '../../storage/workers.js'

import {OAuthVaultError,type OAuthRefresh} from '../../storage/provider-oauth.js'
import {refreshCodexOAuth} from '../../provider/codex-oauth.js'
function routes(path = '*') {
  const app = new OpenAPIHono<{ Variables: { ctx: ServerContext } }>()
  app.use(path, async (c, next) => { c.header('cache-control', 'private, no-store'); c.header('referrer-policy','no-referrer'); return next() })
  app.use(path, bodyLimit({ maxSize: 8192, onError: c => c.json({ error: 'key_request_too_large' }, 413) }))
  app.onError((error, c) => {
    if (error instanceof ProviderKeyError || error instanceof WorkerError || error instanceof OAuthVaultError) return c.json({ error: error.code }, error.status)
    if (error instanceof TerminalPairingError) return c.json({ error: 'invalid_terminal_credential' }, 401)
    if (error instanceof RelayError) return c.json({ error: error.code }, 409)
    return c.json({ error: error instanceof AgentSettingsError ? error.code : 'provider_keys_unavailable' }, 503)
  })
  return app
}
const identity = z.object({ expectedOwnerSubject: z.string().min(1).max(512), expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) })
export function providerKeyAccountRoutes() {
  const app = routes()
  app.get('/catalog',async c=>c.json({providers:providerCatalog,managedProviders:managedProviderCatalog,credentialProviders:[...new Map([...credentialProviders,...await sessionServices(c.var.ctx).credentials.reported(c.get('principal').subject)].map(p=>[p.id,p])).values()]}))
  app.get('/', async c => c.json(await sessionServices(c.var.ctx).credentials.keys.list(c.get('principal').subject)))
  app.put('/:provider', async c => {
    const provider = providerSchema.safeParse(c.req.param('provider'))
    const input = identity.extend({ apiKey: z.string().trim().min(1).max(4096).nullable(),model:z.string().min(1).max(128).optional() }).strict().safeParse(await c.req.json().catch(() => null))
    if (!provider.success || !input.success) return c.json({ error: 'invalid_key_request' }, 400)
    const owner = c.get('principal').subject
    if (input.data.expectedOwnerSubject !== owner) return c.json({ error: 'key_owner_changed' }, 409)
    if(input.data.model&&!supportedProviderModel(provider.data,input.data.model))return c.json({error:'provider_model_unavailable'},400)
    const result = await sessionServices(c.var.ctx).credentials.keys.save(owner, provider.data, input.data.expectedRevision, input.data.apiKey,input.data.model)
    c.var.ctx.bus.publish('provider-key.updated', { ownerSubject: owner })
    return c.json(result)
  })
  app.put('/:provider/grants', async c => {
    const provider = providerSchema.safeParse(c.req.param('provider'))
    const input = identity.extend({ target: targetSchema, enabled: z.boolean(), acknowledgeExposure: z.literal(true) }).strict().safeParse(await c.req.json().catch(() => null))
    if (!provider.success || !input.success) return c.json({ error: 'invalid_key_grant' }, 400)
    const owner = c.get('principal').subject
    if (input.data.expectedOwnerSubject !== owner) return c.json({ error: 'key_owner_changed' }, 409)
    const result = await sessionServices(c.var.ctx).credentials.keys.grant(owner, provider.data, input.data.expectedRevision, input.data.target, input.data.enabled)
    c.var.ctx.bus.publish('provider-key.updated', { ownerSubject: owner })
    return c.json(result)
  })
  return app
}
export function providerKeyDeliveryRoutes(kind: 'terminal' | 'worker',refresh:OAuthRefresh=refreshCodexOAuth) {
  const path = kind === 'terminal' ? '/connections/:id/provider-keys/:provider' : '/:id/provider-keys/:provider'
  const app = routes(path)
  app.post(path, async c => {
    const provider = z.union([providerSchema,z.literal('openai-codex')]).safeParse(c.req.param('provider')), id = z.string().min(1).max(128).safeParse(c.req.param('id'))
    const schema = kind === 'terminal' ? z.object({ instance: z.string().uuid() }).strict() : z.object({ instance: z.string().uuid(), generation: z.number().int().positive() }).strict()
    const input = schema.extend({ availability: z.literal(true).optional() }).safeParse(await c.req.json().catch(() => null))
    if (!provider.success || !id.success || !input.success) return c.json({ error: 'invalid_key_request' }, 400)
    const header = c.req.header('authorization') ?? '', token = header.startsWith('Bearer ') ? header.slice(7) : ''
    const store=sessionServices(c.var.ctx).credentials
    const auth={id:id.data,token,instance:input.data.instance,generation:'generation' in input.data&&typeof input.data.generation==='number'?input.data.generation:undefined}
    const owner=await store.transportOwner(kind,auth)
    if(provider.data==='openai-codex'){
      if(kind!=='terminal')return c.json({error:'oauth_terminal_only'},403)
      if(input.data.availability)return c.json({provider:provider.data,granted:await store.oauthAvailable(auth,owner)})
      const before=await store.oauth.metadata(owner)
      try{return c.json(await store.oauthAccess(auth,owner,refresh))}
      finally{const after=await store.oauth.metadata(owner);if(after.state!==before.state||after.expiresAt!==before.expiresAt||after.state==='reauthorize')c.var.ctx.bus.publish('provider-key.updated',{ownerSubject:owner})}
    }
    return c.json(await store.deliver(kind,auth,owner,provider.data,Boolean(input.data.availability)))
  })
  return app
}
