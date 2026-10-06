import {OpenAPIHono,z} from '@hono/zod-openapi'
import {bodyLimit} from 'hono/body-limit'
import type {ServerContext} from '../context.js'
import {WorkerError} from '../../storage/workers.js'
import {RelayError} from '../../storage/terminal-relay.js'
import {sessionServices} from '../session-services.js'
const input=z.object({instance:z.string().uuid()}).strict()
export function managedCompactionRuntimeRoutes(){
 const app=new OpenAPIHono<{Variables:{ctx:ServerContext}}>()
 app.use('/:id/compactions/*',bodyLimit({maxSize:2048,onError:c=>c.json({error:'request_too_large'},413)}))
 let windowStart=0,requests=0
 app.use('/:id/compactions/*',async(c,next)=>{
  c.header('cache-control','private, no-store');c.header('referrer-policy','no-referrer')
  const now=Date.now();if(now-windowStart>=60000||now<windowStart){windowStart=now;requests=0}
  if(++requests>8192)return c.json({error:'compaction_rate_limited'},429)
  return next()
 })
 app.onError((e,c)=>e instanceof WorkerError?c.json({error:e.code},e.status):e instanceof z.ZodError||e instanceof SyntaxError?c.json({error:'invalid_compaction_request'},400):e instanceof RelayError?c.json({error:'runtime_fenced'},409):c.json({error:'compaction_unavailable'},403))
 app.post('/:id/compactions/:action',async c=>{
  const action=z.enum(['poll','claim','ack']).parse(c.req.param('action'))
  const raw=await c.req.json(),body=z.object({instance:z.string().uuid()}).parse(raw)
  const token=c.req.header('authorization')?.match(/^Bearer (rue_terminal_[A-Za-z0-9_-]{43})$/)?.[1]
  if(!token)return c.json({error:'invalid_terminal_credential'},401)
  const auth={id:z.string().regex(/^term_[A-Za-z0-9_-]{32}$/).parse(c.req.param('id')),token,instance:body.instance},services=sessionServices(c.var.ctx),store=services.execution.compaction
  if(action==='poll'){input.parse(raw);return c.json({commands:await store.runtimeCommands(auth)})}
  if(action==='claim'){const value=input.extend({commandId:z.string().uuid()}).strict().parse(raw);return c.json(await store.claim(auth,value.commandId))}
  if(action==='ack'){const value=input.extend({commandId:z.string().uuid(),nonce:z.string().regex(/^[A-Za-z0-9_-]{43}$/),outcome:z.enum(['succeeded','failed'])}).strict().parse(raw);const owner=await services.credentials.transportOwner('terminal',auth);const command=await store.acknowledge(auth,value.commandId,value.nonce,value.outcome);c.var.ctx.bus.publish('managed-agent.updated',{ownerSubject:owner,agentId:command.agentId});return c.json(command)}
  return c.json({error:'invalid_compaction_request'},400)
 })
 return app
}
