import {rue} from './client'
const deviceKey='rue:web-push-device',ownerKey='rue:web-push-owner'
export function pushDeviceId(){let id=localStorage.getItem(deviceKey);if(!id){id=crypto.randomUUID();localStorage.setItem(deviceKey,id)}return id}
export function pushSupported(){return window.isSecureContext&&'Notification'in window&&'PushManager'in window&&'serviceWorker'in navigator}
export async function notificationRegistration(){await navigator.serviceWorker.register('/notifications-sw.js',{scope:'/'});return navigator.serviceWorker.ready}
async function switchDisplay(enabled:boolean){
 if(!('serviceWorker'in navigator))return
 const registration=await navigator.serviceWorker.getRegistration('/');if(!registration?.active)return
 await new Promise<void>((resolve,reject)=>{const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(Error('Notification worker did not respond.'))},5000);channel.port1.onmessage=()=>{clearTimeout(timer);channel.port1.close();resolve()};registration.active!.postMessage({type:'rue-push-display',enabled},[channel.port2])})
}
export async function enablePush(owner:string,publicKey:string){
 if(await Notification.requestPermission()!=='granted')throw Error('Notification permission was not granted. Check browser settings.')
 const registration=await notificationRegistration()
 let subscription=await registration.pushManager.getSubscription()
 if(subscription&&localStorage.getItem(ownerKey)!==owner){await subscription.unsubscribe();subscription=null}
 const bytes=Uint8Array.from(atob(publicKey.replace(/-/g,'+').replace(/_/g,'/')),character=>character.charCodeAt(0))
 if(subscription&&subscription.options.applicationServerKey){const old=new Uint8Array(subscription.options.applicationServerKey);if(old.length!==bytes.length||old.some((value,index)=>value!==bytes[index])){await subscription.unsubscribe();subscription=null}}
 subscription??=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes})
 const json=subscription.toJSON()
 if(!json.endpoint||!json.keys?.p256dh||!json.keys.auth)throw Error('The browser returned an invalid push subscription.')
 await rue.savePushSubscription(pushDeviceId(),{endpoint:json.endpoint,keys:{p256dh:json.keys.p256dh,auth:json.keys.auth}})
 localStorage.setItem(ownerKey,owner)
 await switchDisplay(true)
}
export async function disablePush(){
 const id=localStorage.getItem(deviceKey)
 // Attempt every revocation path even if a stale service worker cannot respond.
 let failure:unknown
 try{await switchDisplay(false)}catch(error){failure=error}
 try{const registration=await navigator.serviceWorker?.getRegistration('/');const subscription=await registration?.pushManager.getSubscription();await subscription?.unsubscribe()}catch(error){failure=error}
 localStorage.removeItem(ownerKey)
 try{if(id)await rue.removePushSubscription(id,AbortSignal.timeout(8000))}catch(error){failure=error}
 if(failure)throw failure
}
export async function clearPushOnSignOut(){try{await disablePush()}catch{/* Unsubscribing/display disabling is attempted before server revocation. */}}
export async function renewPush(owner:string){
 if(!pushSupported()||Notification.permission!=='granted'||localStorage.getItem(ownerKey)!==owner)return
 const deviceId=localStorage.getItem(deviceKey);if(!deviceId)return
 const settings=await rue.pushSettings()
 if(!settings.enabled||!settings.devices.some(device=>device.deviceId===deviceId))return
 const registration=await notificationRegistration(),subscription=await registration.pushManager.getSubscription(),json=subscription?.toJSON()
 if(json?.endpoint&&json.keys?.p256dh&&json.keys.auth)await rue.savePushSubscription(deviceId,{endpoint:json.endpoint,keys:{p256dh:json.keys.p256dh,auth:json.keys.auth}})
}
