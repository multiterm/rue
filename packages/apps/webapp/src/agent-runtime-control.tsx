import {useEffect,useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {Button,Checkbox,Dialog,Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@multiterm/rue-ui'
import type {RueManagedAgent,RueRuntimeControlGrant,RueRuntimeControlGrantInput} from '@multiterm/rue-sdk'
import {rue} from './client'
export function AgentRuntimeControl({owner,agent,disabled,onBusy}:{owner:string;agent:RueManagedAgent;disabled:boolean;onBusy(value:boolean):void}){
 const cache=useQueryClient(),key=['runtime-control-grant',owner,agent.id]
 const query=useQuery({queryKey:key,queryFn:()=>rue.runtimeControlGrant(agent.id),retry:false,refetchInterval:15000})
 const data=query.data?.ownerSubject===owner&&query.data.agentId===agent.id?query.data:undefined
 const [approval,setApproval]=useState<RueRuntimeControlGrant|null>(null),[duration,setDuration]=useState<3600|86400|604800>(86400),[ack,setAck]=useState(false),[notice,setNotice]=useState('')
 const change=useMutation({mutationFn:(input:RueRuntimeControlGrantInput)=>rue.setRuntimeControlGrant(agent.id,input,AbortSignal.timeout(15000)),onSuccess:result=>{
  if(result.ownerSubject!==owner||result.agentId!==agent.id){setNotice('Account changed. Refresh before changing approval.');return}
  cache.setQueryData(key,result);setApproval(null);setAck(false);setNotice(result.enabled?'Approval saved. The agent can request runtime updates without copying an administration key.':'Approval revoked. Queued preflight updates were cancelled; an update already in progress may finish safely.')
 },onError:()=>setNotice('Could not confirm the approval change. Refresh and review the current state before retrying.'),onSettled:()=>{void query.refetch()}})
 useEffect(()=>{onBusy(change.isPending);return()=>onBusy(false)},[change.isPending,onBusy])
 const blocked=disabled||change.isPending||query.isFetching||query.isError||!data
 return <section className="grid gap-3 rounded-lg border border-border p-3" aria-label="Runtime update approval">
 <h3>Runtime update control</h3>
 <p className="text-sm text-muted">Optional owner approval for this agent to request runtime updates on its own host. This is separate from file/tool permissions and does not start an update. Separately issued API keys must be revoked in API keys settings.</p>
 {query.isPending?<p role="status">Loading approval…</p>:data?<p role="status">{data.enabled?`Approved until ${new Date(data.expiresAt!).toLocaleString()}`:'Not approved'} · {data.workerName}</p>:<p role="alert">Approval information is unavailable.</p>}
 {data&&!data.managerReady&&<p className="text-sm text-muted">A connected rollout-capable manager is required before approval can be enabled.</p>}
 <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={blocked||!data?.managerReady||!data.connectionId||agent.desired==='destroyed'} onClick={()=>{change.reset();setApproval(data!);setAck(false);setDuration(86400);setNotice('')}}>{data?.enabled?'Renew approval':'Allow runtime updates'}</Button>
 {data?.enabled&&<Button type="button" variant="ghost" disabled={blocked} onClick={()=>change.mutate({expectedOwnerSubject:owner,expectedRevision:data.revision,enabled:false})}>Revoke approval</Button>}
 <Button type="button" variant="ghost" disabled={change.isPending||query.isFetching} onClick={()=>void query.refetch()}>Refresh approval</Button></div>
 {notice&&<p role={change.isError?'alert':'status'} className="text-sm">{notice}</p>}
 {!!data?.audit.length&&<details className="text-xs text-muted"><summary>Approval activity</summary><ul>{data.audit.map((entry,index)=><li key={`${entry.createdAt}:${index}`}>{entry.action.replaceAll('_',' ')} · {new Date(entry.createdAt).toLocaleString()}</li>)}</ul></details>}
 <Dialog open={Boolean(approval)} title="Allow this agent to manage runtime updates" onClose={()=>{if(!change.isPending)setApproval(null)}}><div className="grid gap-4">
 <p>Allow <strong>{agent.name}</strong> to request already-built runtime images on <strong>{approval?.workerName}</strong>. An update may temporarily stop and restart every managed agent on that host after work has drained.</p>
 <p className="text-sm text-muted">This does not grant a shell, permission to build arbitrary code, access to other hosts, or the ability to approve other agents. No administration key is copied into the chat or agent. Approval survives ordinary reloads until it expires or you revoke it.</p>
 <div className="grid gap-2 text-sm"><span>Approval duration</span><Select value={String(duration)} disabled={change.isPending} onValueChange={value=>{setDuration(Number(value) as typeof duration);setAck(false)}}><SelectTrigger aria-label="Approval duration"><SelectValue/></SelectTrigger><SelectContent className="z-[80]"><SelectItem value="3600">1 hour</SelectItem><SelectItem value="86400">24 hours</SelectItem><SelectItem value="604800">7 days</SelectItem></SelectContent></Select></div>
 <label className="flex items-start gap-2 text-sm"><Checkbox checked={ack} disabled={change.isPending} onCheckedChange={checked=>setAck(checked===true)}/>I authorize this agent to request runtime updates affecting the managed agents on this host.</label>
 <p className="text-xs text-muted">Revocation blocks new requests and cancels preflight jobs. An update already draining or replacing containers is allowed to complete its safe rollout/rollback sequence.</p>
 {change.isError&&<p role="alert">The change was not confirmed. Close this dialog and refresh approval before retrying.</p>}
 <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={change.isPending} onClick={()=>setApproval(null)}>Cancel</Button><Button type="button" disabled={!ack||change.isPending||change.isError||!approval?.connectionId} isLoading={change.isPending} onClick={()=>approval?.connectionId&&change.mutate({expectedOwnerSubject:owner,expectedRevision:approval.revision,enabled:true,expectedAgentRevision:approval.agentRevision,expectedWorkerId:approval.workerId,expectedConnectionId:approval.connectionId,expiresInSeconds:duration,acknowledgeHostControl:true})}>Approve runtime updates</Button></div>
 </div></Dialog>
 </section>
}
