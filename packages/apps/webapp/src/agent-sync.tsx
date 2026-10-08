import {useContext,useEffect,useRef,useState} from 'react'
import {useQueryClient} from '@tanstack/react-query'
import {Button,MenuSyncIcon} from '@multiterm/rue-ui'
import type {RueRemoteComputer} from '@multiterm/rue-sdk'
import {rue} from './client'
import {LiveSyncContext} from './live-sync'
import {useRemoteFreshness} from './use-remote-freshness'
import './agent-sync.css'
export function AgentSync({sessionId,computer,observedAt}:{sessionId:string;computer:RueRemoteComputer;observedAt:number}){
 const cache=useQueryClient(),live=useContext(LiveSyncContext),fresh=useRemoteFreshness(computer,observedAt)
 const [busy,setBusy]=useState(false),[requested,setRequested]=useState<number>(),[expired,setExpired]=useState(false),[error,setError]=useState('')
 const mounted=useRef(true),locked=useRef(false)
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
 useEffect(()=>{if(!requested)return;setExpired(false);const timer=setTimeout(()=>setExpired(true),20000);return()=>clearTimeout(timer)},[requested])
 const refresh=()=>Promise.all(['messages','parts'].map(key=>cache.invalidateQueries({queryKey:[key,sessionId]})).concat(['remote-computers','message-queue'].map(key=>cache.invalidateQueries({queryKey:[key]}))))
 async function sync(){
  if(locked.current||computer.sessionId!==sessionId)return
  locked.current=true;setBusy(true);setError('');setRequested(undefined)
  let timer:ReturnType<typeof setTimeout>|undefined
  try{
   const result=await Promise.race([rue.syncComputer(computer.id,sessionId),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('unconfirmed')),10000)})])
   if(mounted.current)setRequested(result.requestedAt)
  }catch{if(mounted.current)setError('Sync request unconfirmed. Refreshing saved messages; no prompt was resent.')}
  finally{clearTimeout(timer);void refresh();locked.current=false;if(mounted.current)setBusy(false)}
 }
 const pending=computer.health?.pendingCount,failures=computer.health?.uploadFailures??0
 const confirmed=Boolean(requested&&fresh&&(computer.lastSeenAt??0)>=requested&&pending===0)
 const label=error||(computer.status!=='online'?'Agent offline. Showing the last synced conversation.':!fresh?'Agent heartbeat delayed. Delivery status is not confirmed.':failures?'Agent sync delayed. Shared updates remain queued on Pi.':pending?`Syncing ${pending} shared agent update${pending===1?'':'s'}…`:requested?confirmed?'Shared updates checked. No pending uploads reported.':expired?'No fresh sync confirmation yet. Check the agent connection; do not resend an uncertain task.':'Checking agent sync…':!live?'Live updates interrupted. Refreshing the conversation automatically.':'')
 return <div className="agent-sync" aria-label="Agent conversation sync"><Button type="button" variant="ghost" disabled={busy} onClick={()=>void sync()} title="Refresh Rue and request a Pi status/upload check. Does not replay prompts or import unshared local history."><MenuSyncIcon size={16} colorMode="stripped" className="size-4 fill-none stroke-current stroke-2" aria-hidden/>Sync conversation</Button>{label&&<span role="status">{label}</span>}</div>
}
