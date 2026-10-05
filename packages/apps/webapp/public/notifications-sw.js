// Push display only. Never cache authenticated API responses or app requests.
self.addEventListener('install',()=>self.skipWaiting())
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()))
function state(update){return new Promise((resolve,reject)=>{
 const request=indexedDB.open('rue-push',1)
 request.onupgradeneeded=()=>request.result.createObjectStore('state')
 request.onerror=()=>reject(request.error)
 request.onsuccess=()=>{
  const db=request.result,transaction=db.transaction('state',update?'readwrite':'readonly'),store=transaction.objectStore('state'),read=store.get('settings');let value
  read.onsuccess=()=>{value=read.result??{enabled:false,seen:[]};if(update){value=update(value);store.put(value,'settings')}}
  transaction.oncomplete=()=>{db.close();resolve(value)};transaction.onerror=()=>{db.close();reject(transaction.error)}
 }
})}
self.addEventListener('message',event=>{
 if(event.data?.type!=='rue-push-display'||typeof event.data.enabled!=='boolean')return
 event.waitUntil(state(value=>({...value,enabled:event.data.enabled,seen:event.data.enabled?value.seen:[]})).then(async()=>{if(!event.data.enabled){for(const notification of await self.registration.getNotifications())notification.close()}event.ports[0]?.postMessage({ok:true})}))
})
let queue=Promise.resolve()
self.addEventListener('push',event=>{
 queue=queue.catch(()=>{}).then(async()=>{
  let payload;try{payload=event.data?.json()}catch{return}
  if(!payload||typeof payload.id!=='string'||!/^[a-f0-9-]{36}$/.test(payload.id)||!['task_completed','task_failed','test'].includes(payload.kind))return
  if(payload.sessionId!==undefined&&(typeof payload.sessionId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(payload.sessionId)))return
  const settings=await state();if(!settings.enabled||settings.seen.includes(payload.id))return
  const title=payload.kind==='test'?'Rue test notification':payload.kind==='task_failed'?'Rue task needs attention':'Rue agent turn completed'
  await self.registration.showNotification(title,{body:payload.kind==='test'?'Web Push reached this device.':'Open Rue to review the result.',tag:`rue-event-${payload.id}`,data:{sessionId:payload.sessionId},icon:'/icon-192.png',badge:'/icon-192.png'})
  await state(value=>({...value,seen:[...value.seen.slice(-499),payload.id]}))
 })
 event.waitUntil(queue)
})
self.addEventListener('notificationclick',event=>{
 event.notification.close()
 const sessionId=event.notification.data?.sessionId
 event.waitUntil((async()=>{
  const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true})
  const client=clients.find(c=>new URL(c.url).origin===self.location.origin)
  if(client){await client.focus();if(typeof sessionId==='string')client.postMessage({type:'rue-open-session',sessionId});return}
  await self.clients.openWindow(typeof sessionId==='string'?`/?session=${encodeURIComponent(sessionId)}`:'/')
 })())
})
