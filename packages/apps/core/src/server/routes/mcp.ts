import {OpenAPIHono,z} from '@hono/zod-openapi'
import {bodyLimit} from 'hono/body-limit'
import type {ServerContext} from '../context.js'
import {WorkerError} from '../../storage/workers.js'
import {mcpProfileSchema,listMcpProfiles,createMcpProfile,removeMcpProfile} from '../../storage/mcp.js'
export function mcpAccountRoutes(){
 const app=new OpenAPIHono<{Variables:{ctx:ServerContext}}>()
 app.use('*',bodyLimit({maxSize:32768,onError:c=>c.json({error:'mcp_request_too_large'},413)}))
 app.use('*',async(c,next)=>{c.header('cache-control','private, no-store');return next()})
 app.onError((error,c)=>error instanceof WorkerError?c.json({error:error.code},error.status):error instanceof z.ZodError?c.json({error:'invalid_mcp_request'},400):c.json({error:'mcp_unavailable'},503))
 app.get('/',c=>c.json({ownerSubject:c.get('principal').subject,profiles:listMcpProfiles(c.var.ctx.db,c.get('principal').subject)}))
 app.put('/:id',async c=>{
  const {expectedOwnerSubject,...input}=mcpProfileSchema.extend({expectedOwnerSubject:z.string().min(1).max(512)}).parse(await c.req.json())
  if(expectedOwnerSubject!==c.get('principal').subject)return c.json({error:'mcp_owner_changed'},409)
  const profile=createMcpProfile(c.var.ctx.db,c.get('principal').subject,z.string().uuid().parse(c.req.param('id')),input)
  c.var.ctx.bus.publish('mcp.updated',{ownerSubject:c.get('principal').subject})
  return c.json({profile},201)
 })
 app.delete('/:id',async c=>{
  const input=z.object({expectedRevision:z.number().int().positive()}).strict().parse(await c.req.json())
  const result=removeMcpProfile(c.var.ctx.db,c.get('principal').subject,z.string().uuid().parse(c.req.param('id')),input.expectedRevision)
  const ownerSubject=c.get('principal').subject
  c.var.ctx.bus.publish('mcp.updated',{ownerSubject})
  for(const agent of result.agents){
   c.var.ctx.bus.publish('managed-agent.updated',{ownerSubject,agentId:agent.id})
   c.var.ctx.bus.publish('worker.control.changed',{ownerSubject,workerId:agent.workerId})
   c.var.ctx.bus.publish('terminal.control.changed',{ownerSubject,sessionId:agent.sessionId})
  }
  return c.json({profile:result.profile,stoppedAgents:result.agents.map(a=>a.id)})
 })
 return app
}
