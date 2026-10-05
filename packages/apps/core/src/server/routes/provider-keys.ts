import {usageCredential} from '../../storage/agent-usage.js'
import {reportedProviders} from '../../storage/reported-providers.js'
import { OpenAPIHono, z } from '@hono/zod-openapi'
import {providerCatalog,managedProviderCatalog,credentialProviders,supportedProviderModel} from '../../provider/catalog.js'
import { bodyLimit } from 'hono/body-limit'
import type { ServerContext } from '../context.js'
import { delegatedProviderKey, delegatedProviderKeyAvailable, grantProviderKey, providerKeys, ProviderKeyError, providerSchema, saveProviderKey, targetSchema } from '../../storage/provider-keys.js'
import { AgentSettingsError } from '../../storage/agent-settings.js'
import { validateRelaySocket, RelayError } from '../../storage/terminal-relay.js'
import { TerminalPairingError } from '../../storage/terminal-pairing.js'
import { validateWorker, WorkerError } from '../../storage/workers.js'

import {delegatedOAuthAccess,delegatedOAuthAvailable,providerOAuthMetadata,OAuthVaultError,type OAuthRefresh} from '../../storage/provider-oauth.js'
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
  app.get('/catalog',c=>c.json({providers:providerCatalog,managedProviders:managedProviderCatalog,credentialProviders:[...new Map([...credentialProviders,...reportedProviders(c.var.ctx.db,c.get('principal').subject)].map(p=>[p.id,p])).values()]}))
  app.get('/', c => c.json(providerKeys(c.var.ctx.db, c.get('principal').subject)))
  app.put('/:provider', async c => {
    const provider = providerSchema.safeParse(c.req.param('provider'))
    const input = identity.extend({ apiKey: z.string().trim().min(1).max(4096).nullable(),model:z.string().min(1).max(128).optional() }).strict().safeParse(await c.req.json().catch(() => null))
    if (!provider.success || !input.success) return c.json({ error: 'invalid_key_request' }, 400)
    const owner = c.get('principal').subject
    if (input.data.expectedOwnerSubject !== owner) return c.json({ error: 'key_owner_changed' }, 409)
    if(input.data.model&&!supportedProviderModel(provider.data,input.data.model))return c.json({error:'provider_model_unavailable'},400)
    const result = saveProviderKey(c.var.ctx.db, owner, provider.data, input.data.expectedRevision, input.data.apiKey,input.data.model)
    c.var.ctx.bus.publish('provider-key.updated', { ownerSubject: owner })
    return c.json(result)
  })
  app.put('/:provider/grants', async c => {
    const provider = providerSchema.safeParse(c.req.param('provider'))
    const input = identity.extend({ target: targetSchema, enabled: z.boolean(), acknowledgeExposure: z.literal(true) }).strict().safeParse(await c.req.json().catch(() => null))
    if (!provider.success || !input.success) return c.json({ error: 'invalid_key_grant' }, 400)
    const owner = c.get('principal').subject
    if (input.data.expectedOwnerSubject !== owner) return c.json({ error: 'key_owner_changed' }, 409)
    const result = grantProviderKey(c.var.ctx.db, owner, provider.data, input.data.expectedRevision, input.data.target, input.data.enabled)
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
    const owner = kind === 'terminal'
      ? validateRelaySocket(c.var.ctx.db, token, id.data, input.data.instance).ownerSubject
      : validateWorker(c.var.ctx.db, id.data, token, input.data.instance, 'generation' in input.data && typeof input.data.generation === 'number' ? input.data.generation : NaN).owner_subject
    if(provider.data==='openai-codex'){
      if(kind!=='terminal')return c.json({error:'oauth_terminal_only'},403)
      const current=()=>{try{return validateRelaySocket(c.var.ctx.db,token,id.data,input.data.instance).ownerSubject===owner}catch{return false}}
      if(input.data.availability)return c.json({provider:provider.data,granted:delegatedOAuthAvailable(c.var.ctx.db,owner,id.data,current)})
      const before=providerOAuthMetadata(c.var.ctx.db,owner)
      try{return c.json(await delegatedOAuthAccess(c.var.ctx.db,owner,id.data,current,refresh))}
      finally{const after=providerOAuthMetadata(c.var.ctx.db,owner);if(after.state!==before.state||after.expiresAt!==before.expiresAt||after.state==='reauthorize')c.var.ctx.bus.publish('provider-key.updated',{ownerSubject:owner})}
    }
    const target = { type: kind, id: id.data }
    if (input.data.availability) return c.json({ provider: provider.data, granted: delegatedProviderKeyAvailable(c.var.ctx.db, owner, provider.data, target) })
    const delivered=delegatedProviderKey(c.var.ctx.db, owner, provider.data, target)
    return c.json({...delivered,credentialId:usageCredential(c.var.ctx.db,owner,provider.data,delivered.apiKey)})
  })
  return app
}
