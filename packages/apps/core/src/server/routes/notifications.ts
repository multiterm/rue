import {Hono} from 'hono'
import {z} from 'zod'
import {randomUUID} from 'node:crypto'
import {sessionServices} from '../session-services.js'
const device=z.string().uuid()
export function notificationRoutes(){
 const app=new Hono()
 app.use('*',async(c,next)=>{if(c.get('principal').principalType!=='user')return c.json({error:'user_account_required'},403);return next()})
 app.get('/',async c=>c.json(await sessionServices(c.get('ctx')).notifications.inbox(c.get('principal').subject)))
 app.get('/push',async c=>{
  const {pushTransport}=c.get('ctx'),owner=c.get('principal').subject
  const devices=await sessionServices(c.get('ctx')).notifications.subscriptions.list(owner)
  return c.json({enabled:Boolean(pushTransport),publicKey:pushTransport?.publicKey??null,devices})
 })
 app.put('/push/:deviceId',async c=>{
  const {pushTransport}=c.get('ctx');if(!pushTransport)return c.json({error:'push_unavailable'},503)
  const id=device.safeParse(c.req.param('deviceId'));if(!id.success)return c.json({error:'invalid_device'},400)
  let body:unknown;try{body=await c.req.json()}catch{return c.json({error:'invalid_subscription'},400)}
  try{return c.json(await sessionServices(c.get('ctx')).notifications.subscriptions.save(c.get('principal').subject,id.data,body))}catch(error){
   const code=error instanceof Error?error.message:''
   if(code==='push_subscription_conflict')return c.json({error:code},409)
   if(code==='push_device_limit')return c.json({error:code},429)
   if(code==='agent_key_storage_unavailable')return c.json({error:'push_unavailable'},503)
   if(error instanceof z.ZodError||['push_endpoint_invalid','push_keys_invalid'].includes(code))return c.json({error:'invalid_subscription'},400)
   return c.json({error:'push_unavailable'},503)
  }
 })
 app.delete('/push/:deviceId',async c=>{
  const id=device.safeParse(c.req.param('deviceId'));if(!id.success)return c.json({error:'invalid_device'},400)
  await sessionServices(c.get('ctx')).notifications.subscriptions.remove(c.get('principal').subject,id.data);return c.json({removed:true})
 })
 app.post('/push/:deviceId/test',async c=>{
  const {pushTransport}=c.get('ctx');if(!pushTransport)return c.json({error:'push_unavailable'},503)
  const id=device.safeParse(c.req.param('deviceId'));if(!id.success)return c.json({error:'invalid_device'},400)
  const owner=c.get('principal').subject,store=sessionServices(c.get('ctx')).notifications
  const row=await store.subscriptions.claimTest(owner,id.data)
  if(row.status!=='ready')return row.status==='missing'?c.json({error:'subscription_not_found'},404):c.json({error:'test_rate_limited'},429)
  try{await pushTransport.send(store.decode(owner,row.id,row.encryptedSubscription),{id:randomUUID(),kind:'test'});return c.json({accepted:true})}
  catch{return c.json({error:'test_delivery_failed'},502)}
 })
 app.post('/read-all',async c=>{await sessionServices(c.get('ctx')).notifications.markAllRead(c.get('principal').subject);return c.json({read:true})})
 app.post('/:id/read',async c=>{
  const id=c.req.param('id');if(!/^[a-f0-9-]{36}$/.test(id))return c.json({error:'invalid_notification'},400)
  if(!await sessionServices(c.get('ctx')).notifications.markRead(c.get('principal').subject,id))return c.json({error:'notification_not_found'},404)
  return c.json({read:true})
 })
 return app
}
