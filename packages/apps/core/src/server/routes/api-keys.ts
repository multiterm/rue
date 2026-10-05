import {OpenAPIHono,z} from '@hono/zod-openapi'
import {RUE_KEY_PERMISSIONS} from '@multiterm/rue-sdk'
import {boundedJson,tenancyKeySchema} from '../tenancy-keys.js'
import type {ServerContext} from '../context.js'
const id=z.string().min(3).max(128).regex(/^[A-Za-z0-9_-]+$/)
const keyMetadata=tenancyKeySchema.extend({revokedAt:z.number().int().positive().nullable()})
const owner=z.discriminatedUnion('type',[z.object({type:z.literal('self')}).strict(),z.object({type:z.literal('project'),organizationId:id,projectId:id}).strict()])
const input=z.object({owner,name:z.string().trim().min(1).max(120),grants:z.array(z.string().refine(p=>RUE_KEY_PERMISSIONS.some(known=>known.id===p))).min(1).max(RUE_KEY_PERMISSIONS.length).refine(g=>new Set(g).size===g.length),expiresAt:z.number().int().positive(),requestId:z.string().uuid()}).strict()
/** Browser uses its existing human session. Issuance authority remains in Tenancy. */
export function apiKeyAccountRoutes(){
 const app=new OpenAPIHono<{Variables:{ctx:ServerContext}}>()
 app.use('*',async(c,next)=>{c.header('cache-control','private, no-store');if(c.get('principal').principalType!=='user')return c.json({error:'human_authorization_required'},403);return next()})
 app.onError((e,c)=>c.json({error:e instanceof z.ZodError||e instanceof SyntaxError?'invalid_api_key_request':'tenancy_keys_unavailable'},e instanceof z.ZodError||e instanceof SyntaxError?400:503))
 async function forward(c:any,path:string,method:string,payload?:unknown){
  const origin=c.var.ctx.projectAuthority?.verifier.origin;if(!origin)return c.json({error:'tenancy_keys_unavailable'},503)
  const signal=AbortSignal.timeout(10000),response=await fetch(origin+path,{method,headers:{authorization:c.req.header('authorization'),'content-type':'application/json'},...(payload?{body:JSON.stringify(payload)}:{}),signal,redirect:'error',cache:'no-store'})
  if(response.status===204)return c.body(null,204)
  const body=await boundedJson(response,signal,4194304) as any
  if(!response.ok)return c.json({error:response.status===409?'api_key_request_conflict':response.status===403?'api_key_owner_forbidden':'tenancy_keys_unavailable'},[400,401,403,404,409,429].includes(response.status)?response.status:503)
  if(path==='/v1/api-key-owners')return c.json(z.object({owners:z.array(z.object({owner,label:z.string().min(1).max(512)}).strict()).max(257)}).strict().parse(body))
  if(method==='GET')return c.json({keys:z.array(z.unknown()).max(256).parse(body.keys).filter((key:any)=>key?.service==='rue').map(key=>keyMetadata.parse(key))})
  return c.json(keyMetadata.extend({token:z.string().regex(/^tnk_[A-Za-z0-9_-]{43}$/).optional()}).parse(body),response.status)
 }
 app.get('/owners',c=>forward(c,'/v1/api-key-owners','GET'))
 app.get('/',c=>{
  const organizationId=c.req.query('organizationId'),projectId=c.req.query('projectId');if(Boolean(organizationId)!==Boolean(projectId))return c.json({error:'invalid_api_key_owner'},400)
  const query=projectId?'?'+new URLSearchParams({organizationId:id.parse(organizationId),projectId:id.parse(projectId)}):''
  return forward(c,'/v1/api-keys'+query,'GET')
 })
 app.post('/',async c=>{const value=input.parse(await c.req.json());return forward(c,'/v1/api-keys','POST',{...value,service:'rue'})})
 app.delete('/:id',c=>forward(c,'/v1/api-keys/'+encodeURIComponent(id.parse(c.req.param('id'))),'DELETE'))
 return app
}
