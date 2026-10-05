import {useEffect,useState} from 'react'
import {useQuery,useQueryClient} from '@tanstack/react-query'
import {Button} from '@multiterm/rue-ui'
import {rue} from './client'
import {enablePush,disablePush,pushSupported,pushDeviceId,renewPush} from './web-push-client'
export function NotificationSettings({owner}:{owner:string}){
 const cache=useQueryClient(),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
 const settings=useQuery({queryKey:['push-settings',owner],queryFn:()=>rue.pushSettings(),retry:false})
 const inbox=useQuery({queryKey:['notification-inbox',owner],queryFn:()=>rue.notificationInbox(),refetchInterval:15000,retry:false})
 const [deviceId]=useState(()=>{try{return pushDeviceId()}catch{return ''}})
 const supported=pushSupported()&&Boolean(deviceId),on=settings.data?.devices.some(device=>device.deviceId===deviceId)
 async function action(run:()=>Promise<unknown>,success:string){setBusy(true);setMessage('');try{await run();setMessage(success);await cache.invalidateQueries({queryKey:['push-settings',owner]});await inbox.refetch()}catch(error){setMessage(error instanceof Error?error.message:'Could not confirm notification settings. Retry after checking your connection.')}finally{setBusy(false)}}
 return <div className="settings-stack">
 <p>Receive private, generic task-completion alerts on this device, even when Rue is closed. Your browser and operating system control delivery; permission, network access, and Focus settings still apply.</p>
 <p className="text-sm text-muted">On iPhone or iPad, install Rue using Share → Add to Home Screen, then enable notifications from the installed app (iOS/iPadOS 16.4+). Notification contents do not include prompts or replies.</p>
 {settings.isPending&&<p role="status">Checking push service…</p>}{settings.isError&&<p role="alert">Could not load notification settings. <Button variant="ghost" onClick={()=>void settings.refetch()}>Retry</Button></p>}
 {settings.data&&!settings.data.enabled&&<p role="status">Web Push is not configured on this server. The inbox below still records task outcomes.</p>}
 {!supported&&<p role="status">Push notifications are unavailable in this browser, or device storage is blocked.</p>}
 <Button disabled={busy||settings.isPending||settings.isError||(!on&&(!supported||!settings.data?.enabled))} onClick={()=>void action(()=>on?disablePush():enablePush(owner,settings.data!.publicKey!),on?'Notifications disabled on this device.':'Device subscribed. Send a test to verify delivery.')}>{on?'Disable notifications on this device':'Enable notifications on this device'}</Button>
 <Button variant="outline" disabled={busy||!on||!settings.data?.enabled} onClick={()=>void action(()=>rue.testPush(deviceId),'Push service accepted the test. Check your device notifications; acceptance is not proof of display.')}>Send test notification</Button>
 {on&&typeof Notification!=='undefined'&&Notification.permission!=='granted'&&<p role="alert">This device is registered, but browser notification permission is not granted.</p>}
 {!!settings.data?.devices.length&&<section className="grid gap-2"><h4>Subscribed devices</h4>{settings.data.devices.map(device=><div key={device.deviceId} className="flex items-center justify-between gap-2 text-sm"><span>{device.deviceId===deviceId?'This device':`Device ${device.deviceId.slice(0,8)}`} · expires {new Date(device.expiresAt).toLocaleDateString()}</span><Button variant="ghost" disabled={busy} onClick={()=>void action(()=>device.deviceId===deviceId?disablePush():rue.removePushSubscription(device.deviceId),'Device subscription removed.')}>Remove</Button></div>)}</section>}
 {message&&<p role="status">{message}</p>}
 <section className="grid gap-3" aria-label="Notification inbox"><h4>Inbox · {inbox.data?.unread??0} unread</h4><p className="text-sm text-muted">Latest 100 task outcomes. Completed means the agent turn ended, not that its result was verified.</p><Button variant="ghost" disabled={busy||!inbox.data?.unread} onClick={()=>void action(()=>rue.readAllNotifications(),'Inbox marked read.')}>Mark all read</Button>
 {inbox.isPending&&<p role="status">Loading inbox…</p>}{inbox.isError&&<p role="alert">Inbox unavailable. <Button variant="ghost" onClick={()=>void inbox.refetch()}>Retry</Button></p>}
 {inbox.data&&!inbox.data.items.length&&<p>No task notifications yet.</p>}
 <ul className="grid gap-2">{inbox.data?.items.map(item=><li key={item.id} className="flex items-center justify-between gap-2 rounded border border-border p-3"><div><strong>{item.kind==='task_completed'?'Agent turn completed':'Agent task failed'}{item.readAt===null?' · unread':''}</strong><p className="text-xs text-muted">{new Date(item.createdAt).toLocaleString()}</p></div><Button variant="ghost" disabled={busy} onClick={()=>void action(async()=>{await rue.readNotification(item.id);window.dispatchEvent(new CustomEvent('rue-open-session',{detail:item.sessionId}))},'Opened conversation.')}>Open</Button></li>)}</ul></section>
 </div>
}
export function TaskNotifications({owner,openSession}:{owner:string;openSession(id:string):void}){
 useEffect(()=>{void renewPush(owner).catch(()=>{})},[owner])
 useEffect(()=>{
  const open=(event:Event)=>{const id=(event as CustomEvent).detail;if(typeof id==='string')openSession(id)}
  const worker=(event:MessageEvent)=>{if(event.data?.type==='rue-open-session'&&typeof event.data.sessionId==='string')openSession(event.data.sessionId)}
  window.addEventListener('rue-open-session',open);navigator.serviceWorker?.addEventListener('message',worker)
  return()=>{window.removeEventListener('rue-open-session',open);navigator.serviceWorker?.removeEventListener('message',worker)}
 },[openSession])
 return null
}
