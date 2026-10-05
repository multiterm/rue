import {OpenAPIHono,z} from '@hono/zod-openapi'
import type {ServerContext} from '../context.js'
import {changeWorker,listWorkers,WorkerError,workerIdSchema} from '../../storage/workers.js'
const mutation=z.object({action:z.enum(['drain','activate','revoke','rotate']),expectedRevision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)}).strict()
/** Human host management. Enrollment is exclusively the Tenancy-key POST path. */
export function workerAccountRoutes(){
 const app=new OpenAPIHono<{Variables:{ctx:ServerContext}}>()
 app.use('*',async(c,next)=>{c.header('cache-control','private, no-store');return next()})
 app.onError((error,c)=>error instanceof WorkerError?c.json({error:error.code},error.status):c.json({error:'worker_unavailable'},503))
 app.get('/',c=>c.json({workers:listWorkers(c.var.ctx.db,c.get('principal').subject)}))
 app.patch('/:id',async c=>{
  const input=mutation.safeParse(await c.req.json().catch(()=>null));if(!input.success||!workerIdSchema.safeParse(c.req.param('id')).success)return c.json({error:'invalid_worker_update'},400)
  const ownerSubject=c.get('principal').subject,result=changeWorker(c.var.ctx.db,ownerSubject,c.req.param('id'),input.data.action,input.data.expectedRevision)
  c.var.ctx.bus.publish('worker.control.changed',{ownerSubject,workerId:result.worker.id});return c.json(result)
 })
 return app
}
