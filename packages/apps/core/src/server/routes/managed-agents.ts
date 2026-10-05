import {OpenAPIHono,z} from '@hono/zod-openapi'
import {bodyLimit} from 'hono/body-limit'
import type {ServerContext} from '../context.js'
import {refreshOwnedWorkerProject} from '../project-authority.js'
import {WorkerError} from '../../storage/workers.js'
import {managedCreateSchema,managedChangeSchema,createManagedAgent,changeManagedAgent,listManagedAgents,managedOperations,managedSnapshot,managedGrant,reportManagedAgent,type WorkerAuthority} from '../../storage/managed-agents.js'
import {compactRequestSchema,requestManagedCompaction,managedCompactions,workerCompactions,assignManagedCompaction} from '../../storage/managed-compaction.js'
const uuid=z.string().uuid()
const authority=z.object({instance:uuid,generation:z.number().int().positive()})
const grantInput=authority.extend({revision:z.number().int().positive(),boot:z.number().int().positive().default(1)}).strict()
const reportInput=authority.extend({report:z.unknown()}).strict()
export function managedAgentAccountRoutes(){
 const app=new OpenAPIHono<{Variables:{ctx:ServerContext}}>()
 app.use('*',async(c,next)=>{c.header('cache-control','private, no-store');return next()})
 app.onError((e,c)=>e instanceof WorkerError?c.json({error:e.code},e.status):e instanceof z.ZodError?c.json({error:'invalid_managed_agent_request'},400):c.json({error:'managed_agent_unavailable'},503))
 app.get('/',c=>c.json({agents:listManagedAgents(c.var.ctx.db,c.get('principal').subject)}))
 app.post('/',async c=>{
  const input=managedCreateSchema.parse(await c.req.json())
  await refreshOwnedWorkerProject(c.var.ctx.db,c.var.ctx.projectAuthority,input.workerId,c.get('principal').subject)
  const result=createManagedAgent(c.var.ctx.db,c.get('principal').subject,input)
  c.var.ctx.bus.publish('worker.control.changed',{ownerSubject:c.get('principal').subject,workerId:result.agent.workerId})
  c.var.ctx.bus.publish('managed-agent.updated',{ownerSubject:c.get('principal').subject,agentId:result.agent.id})
  c.var.ctx.bus.publish('session.created',{ownerSubject:c.get('principal').subject,sessionId:result.agent.sessionId})
  return c.json(result,201)
 })
 app.get('/:id/compactions',c=>c.json({commands:managedCompactions(c.var.ctx.db,c.get('principal').subject,uuid.parse(c.req.param('id')))}))
 app.post('/:id/compactions',async c=>{
  const body=compactRequestSchema.parse(await c.req.json()),id=uuid.parse(c.req.param('id')),owner=c.get('principal').subject
  const agent=c.var.ctx.db.prepare('SELECT worker_id FROM managed_agents WHERE id=? AND owner_subject=?').get(id,owner) as {worker_id:string}|undefined
  if(!agent)throw new WorkerError(404,'managed_agent_not_found')
  await refreshOwnedWorkerProject(c.var.ctx.db,c.var.ctx.projectAuthority,agent.worker_id,owner)
  const result=requestManagedCompaction(c.var.ctx.db,owner,id,body)
  c.var.ctx.bus.publish('worker.control.changed',{ownerSubject:owner,workerId:agent.worker_id})
  c.var.ctx.bus.publish('managed-agent.updated',{ownerSubject:owner,agentId:id})
  return c.json(result,202)
 })
 app.get('/:id/operations',c=>c.json({operations:managedOperations(c.var.ctx.db,c.get('principal').subject,uuid.parse(c.req.param('id')))}))
 app.patch('/:id',async c=>{
  const input=managedChangeSchema.parse(await c.req.json()),id=uuid.parse(c.req.param('id')),owner=c.get('principal').subject
  if(input.action==='upgrade'&&c.get('principal').principalType!=='user')return c.json({error:'human_approval_required'},403)
  if(['resume','reload','configure','upgrade'].includes(input.action)){
   const agent=c.var.ctx.db.prepare('SELECT worker_id FROM managed_agents WHERE id=? AND owner_subject=?').get(id,owner) as {worker_id:string}|undefined
   if(!agent)throw new WorkerError(404,'managed_agent_not_found')
   await refreshOwnedWorkerProject(c.var.ctx.db,c.var.ctx.projectAuthority,agent.worker_id,owner)
  }
  const result=changeManagedAgent(c.var.ctx.db,owner,id,input)
  c.var.ctx.bus.publish('worker.control.changed',{ownerSubject:c.get('principal').subject,workerId:result.agent.workerId})
  c.var.ctx.bus.publish('managed-agent.updated',{ownerSubject:c.get('principal').subject,agentId:result.agent.id})
  c.var.ctx.bus.publish('terminal.control.changed',{ownerSubject:c.get('principal').subject,sessionId:result.agent.sessionId})
  return c.json(result)
 })
 return app
}
export function managedAgentWorkerRoutes(){
 const app=new OpenAPIHono<{Variables:{ctx:ServerContext}}>()
 app.use('/:id/agents/*',bodyLimit({maxSize:16384,onError:c=>c.json({error:'request_too_large'},413)}))
 app.use('/:id/agents/*',async(c,next)=>{c.header('cache-control','private, no-store');return next()})
 app.onError((e,c)=>e instanceof WorkerError?c.json({error:e.code},e.status):e instanceof z.ZodError?c.json({error:'invalid_managed_agent_request'},400):c.json({error:'managed_agent_unavailable'},503))
 const auth=(id:string,header:string|undefined,body:z.infer<typeof authority>):WorkerAuthority=>{
  const token=header?.match(/^Bearer (rue_worker_[A-Za-z0-9_-]{43})$/)?.[1]
  if(!token)throw new WorkerError(401,'invalid_worker_credential')
  return {id:uuid.parse(id),secret:token,...body}
 }
 app.post('/:id/agents/compactions',async c=>{
  const body=authority.strict().parse(await c.req.json())
  return c.json({commands:workerCompactions(c.var.ctx.db,auth(c.req.param('id'),c.req.header('authorization'),body))})
 })
 app.post('/:id/agents/compactions/:command/assign',async c=>{
  const body=authority.strict().parse(await c.req.json())
  return c.json(assignManagedCompaction(c.var.ctx.db,auth(c.req.param('id'),c.req.header('authorization'),body),uuid.parse(c.req.param('command'))))
 })
 app.post('/:id/agents/snapshot',async c=>{
  const input=authority.strict().parse(await c.req.json())
  return c.json(managedSnapshot(c.var.ctx.db,auth(c.req.param('id'),c.req.header('authorization'),input)))
 })
 app.post('/:id/agents/:agent/grant',async c=>{
  const input=grantInput.parse(await c.req.json())
  return c.json(managedGrant(c.var.ctx.db,auth(c.req.param('id'),c.req.header('authorization'),{instance:input.instance,generation:input.generation}),uuid.parse(c.req.param('agent')),input.revision,Date.now(),input.boot))
 })
 app.post('/:id/agents/:agent/report',async c=>{
  const input=reportInput.parse(await c.req.json())
  const result=reportManagedAgent(c.var.ctx.db,auth(c.req.param('id'),c.req.header('authorization'),{instance:input.instance,generation:input.generation}),uuid.parse(c.req.param('agent')),input.report)
  const owner=(c.var.ctx.db.prepare('SELECT owner_subject FROM managed_agents WHERE id=?').get(result.id) as {owner_subject:string}).owner_subject
  c.var.ctx.bus.publish('managed-agent.updated',{ownerSubject:owner,agentId:result.id})
  if(result.purgedAt!==null)c.var.ctx.bus.publish('session.deleted',{ownerSubject:owner})
  return c.json({agent:result})
 })
 return app
}
