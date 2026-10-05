import {useContext,useEffect,useRef,useState} from 'react'
import {useQuery,useQueryClient} from '@tanstack/react-query'
import {Button,Checkbox,Input,Dialog} from '@multiterm/rue-ui'
import {RueApiError,type RueWorker,type RueWorkerAction} from '@multiterm/rue-sdk'
import {rue} from './client'
import {app} from './app'
import {LiveSyncContext} from './live-sync'
import {LoadingSkeleton} from './loading-skeleton'
import {ConnectionStatus,SettingsHelp,SettingsRefresh,SettingsAdd} from './settings-support'
export function ManagedHostsPanel({owner}:{owner:string}){
 const live=useContext(LiveSyncContext),cache=useQueryClient(),workers=useQuery({queryKey:['workers',owner],queryFn:()=>rue.workers(),retry:false,refetchInterval:live?false:5000})
 const [instructions,setInstructions]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[grant,setGrant]=useState<{worker:RueWorker;secret?:string}>()
 const [rotation,setRotation]=useState<RueWorker>(),[acknowledged,setAcknowledged]=useState(false),[saved,setSaved]=useState(false),changing=useRef(false)
 const valid=workers.data?.workers.every(worker=>worker.ownerSubject===owner)
 useEffect(()=>{
  const delays=workers.data?.workers.filter(w=>w.status==='online'&&w.leaseExpiresAt).map(w=>w.leaseExpiresAt!-w.serverNow-Math.max(0,Date.now()-workers.dataUpdatedAt)).filter(ms=>ms>0)??[]
  if(!delays.length)return;const timer=setTimeout(()=>void cache.invalidateQueries({queryKey:['workers',owner]}),Math.min(...delays)+50);return()=>clearTimeout(timer)
 },[workers.data,workers.dataUpdatedAt,owner,cache])
 async function change(worker:RueWorker,action:RueWorkerAction){
  if(changing.current)return
  if(action==='revoke'&&!window.confirm(`Revoke ${worker.name}? Host files are not deleted.`))return
  changing.current=true;setBusy(true);setError('');setGrant(undefined);setSaved(false)
  try{const result=await rue.changeWorker(worker.id,{action,expectedRevision:worker.revision});if(result.worker.ownerSubject!==owner)throw Error();if(result.secret)setGrant(result);setRotation(undefined);await cache.invalidateQueries({queryKey:['workers',owner]})}catch{setAcknowledged(false);setError('Host state changed or the request failed. Refresh before retrying.'+(action==='rotate'?' Rotation may have succeeded; do not assume the old credential still works.':''))}finally{changing.current=false;setBusy(false)}
 }
 return <div className="settings-stack">
  <div className="settings-toolbar"><h4>Managed hosts</h4><div className="flex gap-2"><SettingsRefresh label="Refresh hosts" disabled={workers.isFetching} onClick={()=>void workers.refetch()}/><SettingsAdd label="host" onClick={()=>setInstructions(true)}/></div></div>
  {instructions&&<Dialog open title="Add host" onClose={()=>setInstructions(false)} className="max-h-[calc(100dvh-40px)] overflow-y-auto"><section className="settings-card settings-stack" aria-label="Host setup"><h4>Connect with a Tenancy API key</h4><ol><li>In API keys, create a key with the Enrollment preset.</li><li>Save it to a private mode-0600 file on the supervisor, outside agent workspaces.</li><li>Set the variables below, then run <code>rue-worker enroll-key</code> and <code>rue-worker run</code>.</li></ol><pre className="overflow-x-auto text-xs">{`RUE_WORKER_API_URL=${app.urls.api}\nRUE_API_KEY_FILE=/private/path/rue-key\nRUE_WORKER_NAME=My-host\nRUE_ACKNOWLEDGE_HOST_CONTROL=true`}</pre><p>The supervisor requires explicit root/Docker control. Never give this key or the Docker socket to a bot.</p></section></Dialog>}
  {workers.isPending?<LoadingSkeleton label="Loading managed hosts" kind="list"/>:!valid?<p role="alert">{workers.error instanceof RueApiError&&workers.error.status===404?'Host management is not enabled on this server.':'Hosts unavailable. Check the server connection.'}</p>:<div className="settings-list">
   {!workers.data!.workers.length&&<div className="settings-empty"><strong>No hosts connected</strong><p>Add a host to enroll your worker.</p></div>}
   {workers.data!.workers.map(worker=><article key={worker.id} className="settings-card" aria-label={`Host ${worker.name}`}>
    <div className="settings-item-heading"><h4>{worker.name}</h4><ConnectionStatus status={workers.isError&&worker.status==='online'?'checking':worker.status}/></div>
    <div className="settings-row"><span>{worker.managedAgentCount==null?'Agent count unavailable':`${worker.managedAgentCount} managed ${worker.managedAgentCount===1?'agent':'agents'}`}</span><small>{worker.desired==='draining'?'Draining':worker.health?.capabilities.includes('managed-agents-v1')?worker.health.acceptingWork?'Ready for agents':'At capacity or waiting':'Agent runtime pending'}</small></div>
    {worker.health?.resources?.blockedBy&&<p role="status">{worker.status!=='online'?'Last reported: ':''}{worker.health.resources.blockedBy==='disk_pressure'?'Low disk space: new bot starts are paused. Free space or expand this host’s disk; do not delete bot volumes.':worker.health.resources.blockedBy==='memory_pressure'?'Low available memory: new bot starts are paused.':'Host resource checks failed: new bot starts are paused.'}</p>}
    {worker.health?.resources?.freeDiskBytes!=null&&<small>{(worker.health.resources.freeDiskBytes/1024**3).toFixed(1)} GiB disk available · {(worker.health.resources.minimumFreeDiskBytes/1024**3).toFixed(1)} GiB minimum to start bots</small>}
    <details><summary>Manage host</summary><div className="settings-stack"><code>{worker.id}</code>{worker.health&&<p>Worker {worker.health.version} · Docker {worker.health.dockerAvailable?'reachable':'unavailable'}</p>}{worker.status!=='revoked'&&<div className="settings-actions"><Button disabled={busy} onClick={()=>void change(worker,worker.desired==='active'?'drain':'activate')}>{worker.desired==='active'?'Drain host':'Activate host'}</Button><Button disabled={busy} onClick={()=>{setError('');setAcknowledged(false);setRotation(worker)}}>Rotate transport credential</Button><Button variant="ghost" disabled={busy} onClick={()=>void change(worker,'revoke')}>Revoke host</Button></div>}</div></details>
   </article>)}
  </div>}
  {workers.isError&&valid&&<p role="status">Showing last-known hosts. Refresh to check their status.</p>}
  {rotation&&<Dialog open title="Rotate transport credential" description={`Step 1 of 2 · Rotate the transport credential for ${rotation.name}?`} onClose={()=>{if(!changing.current)setRotation(undefined)}} footer={<><Button disabled={busy} onClick={()=>setRotation(undefined)}>Cancel</Button><Button disabled={busy||!acknowledged||Boolean(error)} onClick={()=>void change(rotation,'rotate')}>{busy?'Rotating…':'Rotate and disconnect host'}</Button></>}>
   <div className="settings-stack"><p>The old credential stops working immediately. This disconnects the host and interrupts its managed agents. Running tasks may fail; they are not automatically replayed.</p><p>Save the new one-time credential in the supervisor’s private transport state, then restart the supervisor to reconnect. Rotation does not install it on the host for you. Agent files and history are not deleted.</p><label className="flex items-start gap-2 text-sm"><Checkbox checked={acknowledged} disabled={busy} onCheckedChange={value=>setAcknowledged(value===true)}/>I can update the supervisor’s private credential and understand that this host will disconnect.</label>{error&&<p role="alert">{error}</p>}</div>
  </Dialog>}
  <SettingsHelp section="hosts"/>
  {grant?.secret&&<Dialog open title="Save new transport credential" description={`Step 2 of 2 · ${grant.worker.name}`} onClose={()=>{if(saved)setGrant(undefined)}} className="max-h-[calc(100dvh-40px)] overflow-y-auto" footer={<Button disabled={!saved} onClick={()=>setGrant(undefined)}>Done</Button>}>
   <div className="settings-stack"><p>Save this one-time credential before closing. It cannot be displayed again.</p><Input label="Worker secret" type="text" readOnly value={grant.secret} autoComplete="off" spellCheck={false} onFocus={event=>event.currentTarget.select()} show={{label:true,hideRequireType:true}}/><p>The host is disconnected until you save this one-time credential in the supervisor’s private transport state and restart the supervisor. Rotation does not install it on the host for you.</p><p>Use a private mode-0600 file outside agent workspaces; do not share it in chat. This is internal transport state, not an API key. The enrolling Tenancy key still controls authority.</p><label className="flex items-start gap-2 text-sm"><Checkbox checked={saved} onCheckedChange={value=>setSaved(value===true)}/>I have saved the new credential securely.</label></div>
  </Dialog>}
  {error&&!rotation&&<p role="alert">{error}</p>}
 </div>
}
