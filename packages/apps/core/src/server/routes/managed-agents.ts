import {OpenAPIHono,z} from '@hono/zod-openapi'
import {bodyLimit} from 'hono/body-limit'
import type {ServerContext} from '../context.js'
import {refreshOwnedWorkerProject} from '../project-authority.js'
import {WorkerError} from '../../storage/workers.js'
import {sessionServices} from '../session-services.js'
import {managedCreateSchema,managedChangeSchema,type WorkerAuthority} from '../../storage/managed-agents.js'
import {compactRequestSchema} from '../../storage/managed-compaction.js'
const uuid=z.string().uuid()
const authority=z.object({instance:uuid,generation:z.number().int().positive()})
const grantInput=authority.extend({revision:z.number().int().positive(),boot:z.number().int().positive().default(1)}).strict()
const reportInput=authority.extend({report:z.unknown()}).strict()
export function managedAgentAccountRoutes(){
 const app=new OpenAPIHono<{Variables:{ctx:ServerContext}}>()
 app.use('*',async(c,next)=>{c.header('cache-control','private, no-store');return next()})
 app.onError((e,c)=>e instanceof WorkerError?c.json({error:e.code},e.status):e instanceof z.ZodError?c.json({error:'invalid_managed_agent_request'},400):c.json({error:'managed_agent_unavailable'},503))
 app.get('/',async c=>c.json({agents:await sessionServices(c.var.ctx).execution.managed.list(c.get('principal').subject)}))
 app.post('/',async c=>{
  const input=managedCreateSchema.parse(await c.req.json())
  const store=sessionServices(c.var.ctx).execution
  await refreshOwnedWorkerProject(store.projects,c.var.ctx.projectAuthority,input.workerId,c.get('principal').subject)
  const result=await store.managed.create(c.get('principal').subject,input)
  c.var.ctx.bus.publish('worker.control.changed',{ownerSubject:c.get('principal').subject,workerId:result.agent.workerId})
  c.var.ctx.bus.publish('managed-agent.updated',{ownerSubject:c.get('principal').subject,agentId:result.agent.id})
  c.var.ctx.bus.publish('session.created',{ownerSubject:c.get('principal').subject,sessionId:result.agent.sessionId})
  return c.json(result,201)
 })
 app.get('/:id/compactions',async c=>c.json({commands:await sessionServices(c.var.ctx).execution.compaction.list(c.get('principal').subject,uuid.parse(c.req.param('id')))}))
 app.post('/:id/compactions',async c=>{
  const body=compactRequestSchema.parse(await c.req.json()),id=uuid.parse(c.req.param('id')),owner=c.get('principal').subject
  const store=sessionServices(c.var.ctx).execution,agent=await store.managed.get(owner,id)
  await refreshOwnedWorkerProject(store.projects,c.var.ctx.projectAuthority,agent.workerId,owner)
  const result=await store.compaction.request(owner,id,body)
  c.var.ctx.bus.publish('worker.control.changed',{ownerSubject:owner,workerId:agent.workerId})
  c.var.ctx.bus.publish('managed-agent.updated',{ownerSubject:owner,agentId:id})
  return c.json(result,202)
 })
 app.get('/:id/operations',async c=>c.json({operations:await sessionServices(c.var.ctx).execution.managed.operations(c.get('principal').subject,uuid.parse(c.req.param('id')))}))
 app.patch('/:id',async c=>{
  const input=managedChangeSchema.parse(await c.req.json()),id=uuid.parse(c.req.param('id')),owner=c.get('principal').subject
  if(input.action==='upgrade'&&c.get('principal').principalType!=='user')return c.json({error:'human_approval_required'},403)
  const store=sessionServices(c.var.ctx).execution
  if(['resume','reload','configure','upgrade'].includes(input.action)){
   const agent=await store.managed.get(owner,id)
   await refreshOwnedWorkerProject(store.projects,c.var.ctx.projectAuthority,agent.workerId,owner)
  }
  const result=await store.managed.change(owner,id,input)
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
  return c.json({commands:await sessionServices(c.var.ctx).execution.compaction.workerCommands(auth(c.req.param('id'),c.req.header('authorization'),body))})
 })
 app.post('/:id/agents/compactions/:command/assign',async c=>{
  const body=authority.strict().parse(await c.req.json())
  return c.json(await sessionServices(c.var.ctx).execution.compaction.assign(auth(c.req.param('id'),c.req.header('authorization'),body),uuid.parse(c.req.param('command'))))
 })
 app.post('/:id/agents/snapshot',async c=>{
  const input=authority.strict().parse(await c.req.json())
  return c.json(await sessionServices(c.var.ctx).execution.managed.snapshot(auth(c.req.param('id'),c.req.header('authorization'),input)))
 })
 app.post('/:id/agents/:agent/grant',async c=>{
  const input=grantInput.parse(await c.req.json())
  return c.json(await sessionServices(c.var.ctx).execution.managed.grant(auth(c.req.param('id'),c.req.header('authorization'),{instance:input.instance,generation:input.generation}),uuid.parse(c.req.param('agent')),input.revision,undefined,input.boot))
 })
 app.post('/:id/agents/:agent/report',async c=>{
  const input=reportInput.parse(await c.req.json())
  const store=sessionServices(c.var.ctx).execution,authority=auth(c.req.param('id'),c.req.header('authorization'),{instance:input.instance,generation:input.generation})
  const {ownerSubject:owner}=await store.workers.validate(authority.id,authority.secret,authority.instance,authority.generation)
  const result=await store.managed.report(authority,uuid.parse(c.req.param('agent')),input.report)
  c.var.ctx.bus.publish('managed-agent.updated',{ownerSubject:owner,agentId:result.id})
  if(result.purgedAt!==null)c.var.ctx.bus.publish('session.deleted',{ownerSubject:owner})
  return c.json({agent:result})
 })
 return app
}
