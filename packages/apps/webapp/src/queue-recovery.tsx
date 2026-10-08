import {useEffect,useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {Button,Checkbox,Dialog} from '@multiterm/rue-ui'
import {RueApiError,type RueRemoteComputer,type RueRecoverableQueuedMessage,type RueSession} from '@multiterm/rue-sdk'
import {rue} from './client'
export function QueueRecoveryPage({session,onBusy}:{session:RueSession;onBusy(value:boolean):void}){
 const computers=useQuery({queryKey:['remote-computers',session.ownerSubject],queryFn:()=>rue.remoteComputers(),retry:false})
 const computer=computers.data?.computers.find(item=>item.ownerSubject===session.ownerSubject&&item.sessionId===session.id)
 if(computers.isPending)return <p role="status">Loading agent connection…</p>
 if(!computer)return <div className="grid gap-3"><p role={computers.isError?'alert':'status'}>{computers.isError?'Could not load the agent connection.':'No linked connection is available for this conversation.'}</p><Button type="button" variant="ghost" disabled={computers.isFetching} onClick={()=>void computers.refetch()}>Refresh connection</Button></div>
 return <>{computers.isError&&<p role="alert">Connection status could not be refreshed. Showing saved requests; requeueing is disabled until the connection check succeeds. <Button type="button" variant="ghost" disabled={computers.isFetching} onClick={()=>void computers.refetch()}>Retry connection</Button></p>}<QueueRecovery key={`${session.ownerSubject}:${computer.id}`} computer={computer} onBusy={onBusy} unavailable={computers.isError}/></>
}
function QueueRecovery({computer,onBusy,unavailable}:{computer:RueRemoteComputer;onBusy(value:boolean):void;unavailable:boolean}){
 const [selected,setSelected]=useState<RueRecoverableQueuedMessage|null>(null),[ack,setAck]=useState(false),[notice,setNotice]=useState('')
 const cache=useQueryClient()
 const query=useQuery({queryKey:['queue-recovery',computer.ownerSubject,computer.id],queryFn:()=>rue.recoverableQueueMessages(computer.id),retry:false,staleTime:0})
 const restore=useMutation({mutationFn:(id:string)=>rue.requeueExpiredMessage(computer.id,id,{expectedSessionId:computer.sessionId,acknowledgeRequeue:true},AbortSignal.timeout(15000)),onSuccess:async result=>{
  setSelected(null);setAck(false);setNotice(`Request restored · ${result.status}. The original message and attachments were retained.`)
  await Promise.all(['message-queue','remote-computers','messages','parts','sessions','notification-inbox','queue-recovery'].map(key=>cache.invalidateQueries({queryKey:[key]})))
 },onError:error=>{
  let code:unknown;try{if(error instanceof RueApiError)code=JSON.parse(error.body)?.error}catch{}
  setNotice(code==='computer_queue_full'?'The queue is full (10 requests). Wait for a task to finish, then go back and refresh.':code==='computer_not_ready'?'Enable or reconnect this agent, then go back and refresh before requeueing.':code==='queue_request_not_recoverable'?'This request is no longer recoverable. It may have been claimed or its saved history removed. Go back and refresh.':'Requeue was not confirmed. Go back and refresh the queue before retrying; do not send another copy of the request.')
 }})
 useEffect(()=>{onBusy(restore.isPending);return()=>onBusy(false)},[restore.isPending,onBusy])
 function close(){if(restore.isPending)return;setSelected(null);setAck(false);restore.reset();setNotice('');void query.refetch()}
 return <section className="grid gap-4" aria-label="Expired Requests">
 <p className="text-sm text-muted">Only expired items that were never claimed or started can be recovered here. Claimed, running, interrupted, cancelled, or deleted requests are never automatically replayed. Showing up to 20 recent eligible items.</p>
 {query.isPending&&<p role="status">Loading saved requests…</p>}{query.isError&&<p role="alert">Could not load saved requests.</p>}
 <ul className="grid gap-3">{query.data?.messages.map(message=><li key={message.id} className="grid gap-2 rounded border border-border p-3"><strong className="text-xs text-muted">Never started · explicit requeue required</strong><p className="whitespace-pre-wrap break-words text-sm">{message.text.slice(0,240)}{message.text.length>240?'…':''}</p><span className="text-xs text-muted">{new Date(message.created_at).toLocaleString()}</span><Button type="button" variant="outline" disabled={unavailable||query.isFetching||query.isError||restore.isPending} onClick={()=>{setSelected(message);setAck(false);setNotice('');restore.reset()}}>Review request</Button></li>)}</ul>
 {query.data&&!query.data.messages.length&&<p>No recoverable queued requests remain.</p>}
 <Button type="button" variant="ghost" disabled={query.isFetching||restore.isPending} onClick={()=>void query.refetch()}>Refresh saved requests</Button>
 {!selected&&notice&&<p role={restore.isError?'alert':'status'} className="text-sm">{notice}</p>}
 <Dialog open={Boolean(selected)} title="Requeue saved request" onClose={close} className="max-h-[calc(100dvh-40px)] overflow-y-auto"><div className="grid gap-4">
 <p>This queue item expired before it was claimed. Requeue only if you still want this work performed; review the conversation for work requested another way.</p>
 <p className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-surface p-3 text-sm">{selected?.text}</p>
 {selected&&<p className="text-xs text-muted">Originally submitted {new Date(selected.created_at).toLocaleString()}. Original attachments remain attached. The request goes to the end of the queue and waits for the agent if it is offline.</p>}
 <label className="flex items-start gap-2 text-sm"><Checkbox checked={ack} disabled={restore.isPending} onCheckedChange={checked=>setAck(checked===true)}/>I want to run this saved request using the bot’s current model and permissions.</label>
 {!computer.remoteEnabled&&<p role="status">Enable remote prompts before requeueing.</p>}
 <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="ghost" disabled={restore.isPending} onClick={close}>Back to expired requests</Button><Button type="button" disabled={unavailable||!ack||!selected||restore.isPending||restore.isError||!computer.remoteEnabled||computer.status==='revoked'} isLoading={restore.isPending} onClick={()=>selected&&restore.mutate(selected.id)}>Requeue request</Button></div>
 {selected&&notice&&<p role={restore.isError?'alert':'status'} className="text-sm">{notice}</p>}
 </div></Dialog>
 </section>
}
