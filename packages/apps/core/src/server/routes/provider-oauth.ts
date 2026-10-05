import {OpenAPIHono,z} from '@hono/zod-openapi'
import {bodyLimit} from 'hono/body-limit'
import type {ServerContext} from '../context.js'
import {CodexLogin,type CodexLoginProvider} from '../codex-login.js'
import {OAuthVaultError,providerOAuthMetadata,removeProviderOAuth,grantProviderOAuth} from '../../storage/provider-oauth.js'
const identity=z.object({expectedOwnerSubject:z.string().min(1).max(512)})
export function providerOAuthRoutes(provider?:CodexLoginProvider){
 const app=new OpenAPIHono<{Variables:{ctx:ServerContext}}>(),login=new CodexLogin(provider)
 app.use('*',async(c,next)=>{c.header('cache-control','private, no-store');c.header('referrer-policy','no-referrer');if(c.get('principal').principalType!=='user')return c.json({error:'human_authorization_required'},403);return next()})
 app.use('*',bodyLimit({maxSize:2048,onError:c=>c.json({error:'oauth_request_too_large'},413)}))
 app.onError((error,c)=>error instanceof OAuthVaultError?c.json({error:error.code},error.status):c.json({error:'oauth_unavailable'},503))
 app.get('/openai-codex',c=>c.json({ownerSubject:c.get('principal').subject,...providerOAuthMetadata(c.var.ctx.db,c.get('principal').subject),runtimeSupported:true}))
 app.put('/openai-codex/grants',async c=>{
  const input=identity.extend({expectedRevision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),target:z.object({type:z.literal('terminal'),id:z.string().regex(/^term_[A-Za-z0-9_-]{32}$/)}).strict(),enabled:z.boolean(),acknowledgeExposure:z.literal(true)}).strict().safeParse(await c.req.json().catch(()=>null))
  if(!input.success)return c.json({error:'invalid_oauth_grant'},400)
  const owner=c.get('principal').subject;if(owner!==input.data.expectedOwnerSubject)return c.json({error:'oauth_owner_changed'},409)
  const result=grantProviderOAuth(c.var.ctx.db,owner,input.data.expectedRevision,input.data.target.id,input.data.enabled)
  c.var.ctx.bus.publish('provider-key.updated',{ownerSubject:owner})
  return c.json({ownerSubject:owner,...result,runtimeSupported:true})
 })
 app.post('/openai-codex/start',async c=>{
  const input=identity.extend({requestId:z.string().uuid(),expectedRevision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),acknowledgeStorage:z.literal(true)}).strict().safeParse(await c.req.json().catch(()=>null))
  if(!input.success)return c.json({error:'invalid_oauth_request'},400)
  const owner=c.get('principal').subject;if(input.data.expectedOwnerSubject!==owner)return c.json({error:'oauth_owner_changed'},409)
  return c.json(await login.start(c.var.ctx.db,owner,input.data.requestId,input.data.expectedRevision))
 })
 app.get('/openai-codex/flows/:id',c=>{const id=z.string().uuid().safeParse(c.req.param('id'));if(!id.success)return c.json({error:'invalid_oauth_request'},400);return c.json(login.status(c.var.ctx.db,c.get('principal').subject,id.data))})
 app.post('/openai-codex/flows/:id/:action',async c=>{
  const id=z.string().uuid().safeParse(c.req.param('id')),action=z.enum(['poll','confirm','cancel']).safeParse(c.req.param('action'))
  const schema=c.req.param('action')==='confirm'?identity.extend({acknowledgeAccount:z.literal(true)}).strict():identity.strict()
  const input=schema.safeParse(await c.req.json().catch(()=>null))
  if(!input.success||!id.success||!action.success)return c.json({error:'invalid_oauth_request'},400)
  const owner=c.get('principal').subject;if(owner!==input.data.expectedOwnerSubject)return c.json({error:'oauth_owner_changed'},409)
  const result=action.data==='poll'?await login.poll(c.var.ctx.db,owner,id.data):action.data==='confirm'?login.confirm(c.var.ctx.db,owner,id.data):login.cancel(c.var.ctx.db,owner,id.data)
  if(action.data==='confirm'&&result.status==='complete')c.var.ctx.bus.publish('provider-key.updated',{ownerSubject:owner})
  return c.json(result)
 })
 app.delete('/openai-codex',async c=>{
  const input=identity.extend({expectedRevision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)}).strict().safeParse(await c.req.json().catch(()=>null))
  if(!input.success)return c.json({error:'invalid_oauth_request'},400)
  const owner=c.get('principal').subject;if(owner!==input.data.expectedOwnerSubject)return c.json({error:'oauth_owner_changed'},409)
  const result=removeProviderOAuth(c.var.ctx.db,owner,input.data.expectedRevision);c.var.ctx.bus.publish('provider-key.updated',{ownerSubject:owner});return c.json({ownerSubject:owner,...result,runtimeSupported:true})
 })
 return app
}
