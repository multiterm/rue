import {latestPiRelease} from '../pi-release.js'
import {bodyLimit} from 'hono/body-limit'
import {OpenAPIHono,z} from '@hono/zod-openapi'
import type {ServerContext} from '../context.js'
import {refreshOwnedWorkerProject} from '../project-authority.js'
import {WorkerError} from '../../storage/workers.js'
import {authenticateTerminalConnection,TerminalPairingError} from '../../storage/terminal-pairing.js'
import {managedAuthority} from '../../storage/managed-agents.js'
import {RuntimeControlError,runtimeControlGrantInput,runtimeControlGrant,updateRuntimeControlGrant,runtimeControlDelegation,requestDelegatedRuntimeRollout,delegatedRuntimeRollout} from '../../storage/runtime-control.js'
import {requestRuntimeRollout,cancelRuntimeRollout,resolveRuntimeRollout,runtimeRollout,runtimeRollouts,pollRuntimeRollout,reportRuntimeRollout,rolloutRequestSchema,rolloutReportSchema} from '../../storage/runtime-rollouts.js'
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
 app.get('/agents/:id/grant',c=>{
  if(c.get('principal').principalType!=='user')return c.json({error:'human_approval_required'},403)
  return c.json(runtimeControlGrant(c.var.ctx.db,c.get('principal').subject,uuid.parse(c.req.param('id'))))
 })
 app.put('/agents/:id/grant',async c=>{
  if(c.get('principal').principalType!=='user')return c.json({error:'human_approval_required'},403)
  const input=runtimeControlGrantInput.parse(await c.req.json().catch(()=>null)),owner=c.get('principal').subject,id=uuid.parse(c.req.param('id'))
  if(input.enabled){const current=runtimeControlGrant(c.var.ctx.db,owner,id);await refreshOwnedWorkerProject(c.var.ctx.db,c.var.ctx.projectAuthority,current.workerId,owner)}
  const result=updateRuntimeControlGrant(c.var.ctx.db,owner,id,input)
  c.var.ctx.bus.publish('managed-agent.updated',{ownerSubject:owner,agentId:id});return c.json(result)
 })
 app.get('/hosts/:id',c=>c.json({rollouts:runtimeRollouts(c.var.ctx.db,c.get('principal').subject,uuid.parse(c.req.param('id')))}))
 app.get('/:id',c=>c.json(runtimeRollout(c.var.ctx.db,c.get('principal').subject,uuid.parse(c.req.param('id')))))
 app.post('/:id/cancel',async c=>{z.object({}).strict().parse(await c.req.json());return c.json(cancelRuntimeRollout(c.var.ctx.db,c.get('principal').subject,uuid.parse(c.req.param('id'))))})
 app.post('/:id/resolve',async c=>{const input=z.object({expectedUpdatedAt:z.number().int().nonnegative(),acknowledgeStopped:z.literal(true)}).strict().parse(await c.req.json());return c.json(resolveRuntimeRollout(c.var.ctx.db,c.get('principal').subject,uuid.parse(c.req.param('id')),input.expectedUpdatedAt))})
 app.post('/hosts/:id',async c=>{
  const workerId=uuid.parse(c.req.param('id')),input=rolloutRequestSchema.parse(await c.req.json()),owner=c.get('principal').subject
  await refreshOwnedWorkerProject(c.var.ctx.db,c.var.ctx.projectAuthority,workerId,owner)
  const result=requestRuntimeRollout(c.var.ctx.db,owner,workerId,input)
  c.var.ctx.bus.publish('worker.control.changed',{ownerSubject:owner,workerId});return c.json(result,202)
 })
 return app
}
export function runtimeRolloutTerminalRoutes(){
 const app=routes(['/connections/:id/runtime-control','/connections/:id/runtime-control/*'])
 const auth=(db:ServerContext['db'],id:string,header:string|undefined,now?:number)=>{const token=header?.match(/^Bearer (rue_terminal_[A-Za-z0-9_-]{43})$/)?.[1];if(!token)throw new WorkerError(401,'invalid_terminal_credential');return authenticateTerminalConnection(db,token,id,now)}
 app.get('/connections/:id/runtime-control',c=>{
  const db=c.var.ctx.db,connection=auth(db,c.req.param('id'),c.req.header('authorization'))
  const row=db.prepare('SELECT w.id,w.revision,w.health FROM managed_agents a JOIN workers w ON w.id=a.worker_id WHERE a.connection_id=? AND a.owner_subject=? AND w.owner_subject=a.owner_subject').get(connection.id,connection.ownerSubject) as {id:string;revision:number;health:string|null}|undefined
  if(!row)return c.json({managed:false,canSubmit:false})
  managedAuthority(db,connection.id)
  const health=row.health?JSON.parse(row.health):null
  return c.json({managed:true,workerId:row.id,workerRevision:row.revision,managerVersion:health?.version??null,runtimeImage:health?.runtimeImage??null,rolloutSupported:health?.capabilities?.includes('managed-runtime-rollout-v1')===true,...runtimeControlDelegation(db,connection)})
 })
 app.post('/connections/:id/runtime-control/rollouts',async c=>{
  const input=rolloutRequestSchema.parse(await c.req.json().catch(()=>null)),db=c.var.ctx.db,connection=auth(db,c.req.param('id'),c.req.header('authorization'))
  const result=requestDelegatedRuntimeRollout(db,now=>{const current=auth(db,c.req.param('id'),c.req.header('authorization'),now);if(current.ownerSubject!==connection.ownerSubject)throw new RuntimeControlError(403,'runtime_control_not_approved');return current},input)
  c.var.ctx.bus.publish('worker.control.changed',{ownerSubject:connection.ownerSubject,workerId:result.workerId});return c.json(result,202)
 })
 app.get('/connections/:id/runtime-control/rollouts/:job',c=>{const db=c.var.ctx.db;return c.json(delegatedRuntimeRollout(db,auth(db,c.req.param('id'),c.req.header('authorization')),uuid.parse(c.req.param('job'))))})
 return app
}
export function runtimeRolloutWorkerRoutes(){
 const app=routes('/:id/runtime-rollouts/*')
 const auth=(id:string,header:string|undefined,input:z.infer<typeof identity>)=>{const secret=header?.match(/^Bearer (rue_worker_[A-Za-z0-9_-]{43})$/)?.[1];if(!secret)throw new WorkerError(401,'invalid_worker_credential');return {id:uuid.parse(id),secret,...input}}
 app.post('/:id/runtime-rollouts/poll',async c=>{const input=identity.strict().parse(await c.req.json());return c.json(pollRuntimeRollout(c.var.ctx.db,auth(c.req.param('id'),c.req.header('authorization'),input)))})
 app.post('/:id/runtime-rollouts/:job/report',async c=>{const input=identity.extend({report:rolloutReportSchema}).strict().parse(await c.req.json());const {report,...who}=input;return c.json(reportRuntimeRollout(c.var.ctx.db,auth(c.req.param('id'),c.req.header('authorization'),who),uuid.parse(c.req.param('job')),report))})
 return app
}
