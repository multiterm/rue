import {Hono} from 'hono'
import {z} from 'zod'
import {randomUUID} from 'node:crypto'
import {notificationInbox,readNotification} from '../../storage/notifications.js'
import {savePushSubscription,removePushSubscription,validatePushSubscription} from '../../storage/push-subscriptions.js'
import {decryptCredential} from '../../storage/agent-settings.js'
const device=z.string().uuid()
export function notificationRoutes(){
 const app=new Hono()
 app.use('*',async(c,next)=>{if(c.get('principal').principalType!=='user')return c.json({error:'user_account_required'},403);return next()})
 app.get('/',c=>c.json(notificationInbox(c.get('ctx').db,c.get('principal').subject)))
 app.get('/push',c=>{
  const {db,pushTransport}=c.get('ctx'),owner=c.get('principal').subject
  const devices=db.prepare('SELECT device_id AS deviceId,expires_at AS expiresAt FROM push_subscriptions WHERE owner_subject=? AND expires_at>?').all(owner,Date.now())
  return c.json({enabled:Boolean(pushTransport),publicKey:pushTransport?.publicKey??null,devices})
 })
 app.put('/push/:deviceId',async c=>{
  const {db,pushTransport}=c.get('ctx');if(!pushTransport)return c.json({error:'push_unavailable'},503)
  const id=device.safeParse(c.req.param('deviceId'));if(!id.success)return c.json({error:'invalid_device'},400)
  let body:unknown;try{body=await c.req.json()}catch{return c.json({error:'invalid_subscription'},400)}
  try{return c.json(savePushSubscription(db,c.get('principal').subject,id.data,body))}catch(error){
   const code=error instanceof Error?error.message:''
   if(code==='push_subscription_conflict')return c.json({error:code},409)
   if(code==='push_device_limit')return c.json({error:code},429)
   if(code==='agent_key_storage_unavailable')return c.json({error:'push_unavailable'},503)
   return c.json({error:'invalid_subscription'},400)
  }
 })
 app.delete('/push/:deviceId',c=>{
  const id=device.safeParse(c.req.param('deviceId'));if(!id.success)return c.json({error:'invalid_device'},400)
  removePushSubscription(c.get('ctx').db,c.get('principal').subject,id.data);return c.json({removed:true})
 })
 app.post('/push/:deviceId/test',async c=>{
  const {db,pushTransport}=c.get('ctx');if(!pushTransport)return c.json({error:'push_unavailable'},503)
  const id=device.safeParse(c.req.param('deviceId'));if(!id.success)return c.json({error:'invalid_device'},400)
  const owner=c.get('principal').subject,now=Date.now()
  const row=db.prepare('SELECT id,encrypted_subscription,last_test_at FROM push_subscriptions WHERE owner_subject=? AND device_id=? AND expires_at>?').get(owner,id.data,now) as {id:string;encrypted_subscription:string;last_test_at:number|null}|undefined
  if(!row)return c.json({error:'subscription_not_found'},404)
  if(!db.prepare('UPDATE push_subscriptions SET last_test_at=? WHERE id=? AND (last_test_at IS NULL OR last_test_at<?)').run(now,row.id,now-30000).changes)return c.json({error:'test_rate_limited'},429)
  try{await pushTransport.send(validatePushSubscription(JSON.parse(decryptCredential(db,[owner,'web-push',row.id],row.encrypted_subscription))),{id:randomUUID(),kind:'test'});return c.json({accepted:true})}
  catch{return c.json({error:'test_delivery_failed'},502)}
 })
 app.post('/read-all',c=>{c.get('ctx').db.prepare('UPDATE notifications SET read_at=? WHERE owner_subject=? AND read_at IS NULL').run(Date.now(),c.get('principal').subject);return c.json({read:true})})
 app.post('/:id/read',c=>{
  const id=c.req.param('id');if(!/^[a-f0-9-]{36}$/.test(id))return c.json({error:'invalid_notification'},400)
  if(!readNotification(c.get('ctx').db,c.get('principal').subject,id))return c.json({error:'notification_not_found'},404)
  return c.json({read:true})
 })
 return app
}
