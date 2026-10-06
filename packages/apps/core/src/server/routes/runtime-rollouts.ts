import {latestPiRelease} from '../pi-release.js'
import {bodyLimit} from 'hono/body-limit'
import {OpenAPIHono,z} from '@hono/zod-openapi'
import type {ServerContext} from '../context.js'
import {sessionServices} from '../session-services.js'
import {refreshOwnedWorkerProject} from '../project-authority.js'
import {WorkerError} from '../../storage/workers.js'
import {TerminalPairingError} from '../../storage/terminal-pairing.js'
import {RuntimeControlError,runtimeControlGrantInput} from '../../storage/runtime-control.js'
import {rolloutRequestSchema,rolloutReportSchema} from '../../storage/runtime-rollouts.js'
const uuid=z.string().uuid(),identity=z.object({instance:uuid,generation:z.number().int().positive()})
function routes(path:string|string[]='*'){
 const app=new OpenAPIHono<{Variables:{ctx:ServerContext}}>()
 for(const scope of Array.isArray(path)?path:[path]){app.use(scope,bodyLimit({maxSize:8192,onError:c=>c.json({error:'request_too_large'},413)}));app.use(scope,async(c,next)=>{c.header('cache-control','private, no-store');return next()})}
 app.onError((e,c)=>e instanceof TerminalPairingError?c.json({error:'invalid_terminal_credential'},401):e instanceof WorkerError||e instanceof RuntimeControlError?c.json({error:e.code},e.status):e instanceof z.ZodError?c.json({error:'invalid_runtime_rollout'},400):c.json({error:'runtime_rollout_unavailable'},503))
 return app
}
export function runtimeRolloutAccountRoutes(){
 const app=routes()
 app.get('/pi-release',async c=>c.json(await latestPiRelease()))
 app.get('/agents/:id/grant',async c=>{
  if(c.get('principal').principalType!=='user')return c.json({error:'human_approval_required'},403)
  return c.json(await sessionServices(c.var.ctx).execution.control.get(c.get('principal').subject,uuid.parse(c.req.param('id'))))
 })
 app.put('/agents/:id/grant',async c=>{
  if(c.get('principal').principalType!=='user')return c.json({error:'human_approval_required'},403)
  const input=runtimeControlGrantInput.parse(await c.req.json().catch(()=>null)),owner=c.get('principal').subject,id=uuid.parse(c.req.param('id'))
  const store=sessionServices(c.var.ctx).execution
  if(input.enabled){const current=await store.control.get(owner,id);await refreshOwnedWorkerProject(store.projects,c.var.ctx.projectAuthority,current.workerId,owner)}
  const result=await store.control.update(owner,id,input)
  c.var.ctx.bus.publish('managed-agent.updated',{ownerSubject:owner,agentId:id});return c.json(result)
 })
 app.get('/hosts/:id',async c=>c.json({rollouts:await sessionServices(c.var.ctx).execution.rollouts.list(c.get('principal').subject,uuid.parse(c.req.param('id')))}))
 app.get('/:id',async c=>c.json(await sessionServices(c.var.ctx).execution.rollouts.get(c.get('principal').subject,uuid.parse(c.req.param('id')))))
 app.post('/:id/cancel',async c=>{z.object({}).strict().parse(await c.req.json());return c.json(await sessionServices(c.var.ctx).execution.rollouts.cancel(c.get('principal').subject,uuid.parse(c.req.param('id'))))})
 app.post('/:id/resolve',async c=>{const input=z.object({expectedUpdatedAt:z.number().int().nonnegative(),acknowledgeStopped:z.literal(true)}).strict().parse(await c.req.json());return c.json(await sessionServices(c.var.ctx).execution.rollouts.resolve(c.get('principal').subject,uuid.parse(c.req.param('id')),input.expectedUpdatedAt))})
 app.post('/hosts/:id',async c=>{
  const workerId=uuid.parse(c.req.param('id')),input=rolloutRequestSchema.parse(await c.req.json()),owner=c.get('principal').subject
  const store=sessionServices(c.var.ctx).execution
  await refreshOwnedWorkerProject(store.projects,c.var.ctx.projectAuthority,workerId,owner)
  const result=await store.rollouts.request(owner,workerId,input)
  c.var.ctx.bus.publish('worker.control.changed',{ownerSubject:owner,workerId});return c.json(result,202)
 })
 return app
}
export function runtimeRolloutTerminalRoutes(){
 const app=routes(['/connections/:id/runtime-control','/connections/:id/runtime-control/*'])
 const auth=(id:string,header:string|undefined)=>{const token=header?.match(/^Bearer (rue_terminal_[A-Za-z0-9_-]{43})$/)?.[1];if(!token)throw new WorkerError(401,'invalid_terminal_credential');return {id,token}}
 // Preserve the bearer-only HTTP contract; do not invent a socket-instance proof.
 app.get('/connections/:id/runtime-control',async c=>c.json(await sessionServices(c.var.ctx).execution.control.describe(auth(c.req.param('id'),c.req.header('authorization')))))
 app.post('/connections/:id/runtime-control/rollouts',async c=>{
  const input=rolloutRequestSchema.parse(await c.req.json().catch(()=>null)),store=sessionServices(c.var.ctx).execution,proof=auth(c.req.param('id'),c.req.header('authorization'))
  const connection=await store.terminal.authenticate(proof.token,proof.id)
  const result=await store.control.requestRollout(proof,input)
  c.var.ctx.bus.publish('worker.control.changed',{ownerSubject:connection.ownerSubject,workerId:result.workerId});return c.json(result,202)
 })
 app.get('/connections/:id/runtime-control/rollouts/:job',async c=>c.json(await sessionServices(c.var.ctx).execution.control.rollout(auth(c.req.param('id'),c.req.header('authorization')),uuid.parse(c.req.param('job')))))
 return app
}
export function runtimeRolloutWorkerRoutes(){
 const app=routes('/:id/runtime-rollouts/*')
 const auth=(id:string,header:string|undefined,input:z.infer<typeof identity>)=>{const secret=header?.match(/^Bearer (rue_worker_[A-Za-z0-9_-]{43})$/)?.[1];if(!secret)throw new WorkerError(401,'invalid_worker_credential');return {id:uuid.parse(id),secret,...input}}
 app.post('/:id/runtime-rollouts/poll',async c=>{const input=identity.strict().parse(await c.req.json());return c.json(await sessionServices(c.var.ctx).execution.rollouts.poll(auth(c.req.param('id'),c.req.header('authorization'),input)))})
 app.post('/:id/runtime-rollouts/:job/report',async c=>{const input=identity.extend({report:rolloutReportSchema}).strict().parse(await c.req.json());const {report,...who}=input;return c.json(await sessionServices(c.var.ctx).execution.rollouts.report(auth(c.req.param('id'),c.req.header('authorization'),who),uuid.parse(c.req.param('job')),report))})
 return app
}
