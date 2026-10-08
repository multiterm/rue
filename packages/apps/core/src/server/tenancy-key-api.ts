import {platformAccess} from './platform-access.js'
import {runtimeRolloutAccountRoutes} from './routes/runtime-rollouts.js'
import {createHash} from 'node:crypto'
import {OpenAPIHono,z} from '@hono/zod-openapi'
import {bodyLimit} from 'hono/body-limit'
import type {ServerContext} from './context.js'
import {keyResourceOwner,type TenancyKey} from './tenancy-keys.js'
import {asProjectClaims} from './tenancy-verifier.js'
import {requestGuard} from './request-guard.js'
import {ProjectError} from '../storage/projects.js'
import {WorkerError} from '../storage/workers.js'
import {sessionServices} from './session-services.js'
import {workerAccountRoutes} from './routes/workers.js'
import {managedAgentAccountRoutes} from './routes/managed-agents.js'
import {mcpAccountRoutes} from './routes/mcp.js'
export function keyPermissionsFor(method:string,path:string):string[]|undefined{
 if(method==='GET'&&path==='/platform/access')return []
 if(method==='GET'&&/^\/runtime-rollouts\/(?:hosts\/)?[a-f0-9-]+$/i.test(path))return ['rue:runtimes:read']
 if(method==='POST'&&(/^\/runtime-rollouts\/hosts\/[a-f0-9-]+$/i.test(path)||/^\/runtime-rollouts\/[a-f0-9-]+\/(resolve|cancel)$/i.test(path)))return ['rue:runtimes:deploy','rue:agents:execute']
 if(method==='GET'&&path==='/workers')return ['rue:hosts:read']
 if(method==='POST'&&path==='/workers')return ['rue:hosts:enroll','rue:agents:execute']
 if(method==='PATCH'&&/^\/workers\/[a-f0-9-]+$/i.test(path))return ['rue:hosts:manage']
 if(method==='GET'&&(path==='/managed-agents'||/^\/managed-agents\/[a-f0-9-]+\/operations$/i.test(path)))return ['rue:agents:read']
 if((method==='POST'&&path==='/managed-agents')||(method==='PATCH'&&/^\/managed-agents\/[a-f0-9-]+$/i.test(path)))return ['rue:agents:write','rue:agents:execute']
 if(method==='GET'&&path==='/mcp')return ['rue:mcp:read']
 if(['PUT','DELETE'].includes(method)&&/^\/mcp\/[a-f0-9-]+$/i.test(path))return ['rue:mcp:write']
}
function bindingId(origin:string,key:TenancyKey){const h=createHash('sha256').update(JSON.stringify([origin,key.id,key.owner])).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`}
/** A distinct machine authorization path: no Keyname fallback or unrestricted human principal. */
export function tenancyKeyApi(ctx:ServerContext,managedAgents:boolean){
 const app=new OpenAPIHono<{Variables:{ctx:ServerContext;key:TenancyKey;token:string;started:number}}>()
 app.use('*',bodyLimit({maxSize:1048576,onError:c=>c.json({error:'REQUEST_BODY_TOO_LARGE'},413)}))
 app.use('*',async(c,next)=>{c.set('ctx',ctx);c.header('cache-control','private, no-store');const token=c.req.header('authorization')?.slice(7)??'';const required=keyPermissionsFor(c.req.method,c.req.path);if(!required)return c.json({error:'invalid_credential_scope'},401)
  if(!ctx.projectAuthority?.verifier.verifyKey)return c.json({error:'tenancy_verification_unavailable'},503)
  if(c.req.method!=='GET'){try{await c.req.json()}catch{return c.json({error:'invalid_api_key_request'},400)}}
  const started=Date.now()
  let key:TenancyKey|undefined;try{key=await ctx.projectAuthority.verifier.verifyKey(token)}catch{return c.json({error:'tenancy_verification_unavailable'},503)}
  if(!key)return c.json({error:'api_key_invalid'},401)
  if(!required.every(p=>key.grants.includes(p)))return c.json({error:'api_key_permission_denied'},403)
  if(started+45000<=Date.now()||key.expiresAt<=Date.now())return c.json({error:'api_key_invalid'},401)
  c.set('key',key);c.set('token',token);c.set('started',started);c.set('principal',{subject:keyResourceOwner(key),principalType:'machine',scopes:key.grants});return next()
 })
 app.use('*',requestGuard())
 app.onError((e,c)=>e instanceof ProjectError||e instanceof WorkerError?c.json({error:e.code},e.status):c.json({error:'api_key_request_failed'},503))
 app.get('/platform/access',c=>c.json(platformAccess(c.var.key,managedAgents)))
 app.post('/workers',async c=>{
  const input=z.object({name:z.string().trim().min(1).max(60).regex(/^[^\x00-\x1f\x7f]+$/),requestId:z.string().uuid(),acknowledgeHostControl:z.literal(true),expectedOwnerSubject:z.string().max(512).optional()}).strict().safeParse(await c.req.json().catch(()=>null));if(!input.success)return c.json({error:'invalid_worker_enrollment'},400)
  const key=c.var.key,owner=keyResourceOwner(key);if(input.data.expectedOwnerSubject&&input.data.expectedOwnerSubject!==owner)return c.json({error:'worker_owner_changed'},409)
  const authority=ctx.projectAuthority!,id=bindingId(authority.verifier.origin,key),claims=asProjectClaims(key)
  const store=sessionServices(ctx).execution
  const binding=await store.projects.create(owner,id,authority.verifier.origin,c.var.token,claims,c.var.started)
  if(!await store.projects.updateProof(id,binding.revision,claims,c.var.started))return c.json({error:'api_key_invalid'},401)
  const result=await store.workers.create(owner,input.data.name,input.data.requestId,undefined,id)
  ctx.bus.publish('worker.updated',{ownerSubject:owner,workerId:result.worker.id});return c.json(result,result.secret?201:200)
 })
 app.route('/workers',workerAccountRoutes())
 if(managedAgents){app.route('/runtime-rollouts',runtimeRolloutAccountRoutes());app.route('/managed-agents',managedAgentAccountRoutes());app.route('/mcp',mcpAccountRoutes())}
 return app
}
