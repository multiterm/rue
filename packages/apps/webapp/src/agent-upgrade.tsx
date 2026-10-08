import {useState} from 'react'
import './agent-upgrade.css'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {Button,Dialog,MenuSyncIcon} from '@multiterm/rue-ui'
import type {RueManagedAgent} from '@multiterm/rue-sdk'
import {rue} from './client'
import {comparePiVersions} from './agent-upgrade-policy'
type Intent={requestId:string;expectedRevision:number;expectedImage:string;image?:string;piVersion:string;currentVersion:string}
export function AgentUpgrade({owner,agent,piVersion}:{owner:string;agent:RueManagedAgent;piVersion?:string|null}){
 const cache=useQueryClient(),[intent,setIntent]=useState<Intent|null>(null)
 const hosts=useQuery({queryKey:['workers',owner],queryFn:()=>rue.workers(),retry:false,refetchInterval:15000})
 const published=useQuery({queryKey:['pi-release'],queryFn:()=>rue.latestPiRelease(),retry:false,staleTime:300000,refetchInterval:300000})
 const host=hosts.data?.workers.find(w=>w.id===agent.workerId&&w.ownerSubject===owner),image=agent.runtimeImage??host?.health?.runtimeImage
 const releases=host?.health?.runtimeReleases,current=piVersion??releases?.find(r=>r.image===image)?.piVersion,latest=published.data?.latestVersion
 const candidate=releases?.filter(r=>r.piVersion===latest&&r.image!==image).sort((a,b)=>b.createdAt-a.createdAt||a.image.localeCompare(b.image))[0]
 const active=['updating','rolling_back'].includes(agent.runtimeUpdateState??'')
 const outdated=Boolean(latest&&image&&(current?(comparePiVersions(latest,current)??0)>0:candidate))
 const live=()=>host?.status==='online'&&Boolean(host.leaseExpiresAt&&host.leaseExpiresAt>host.serverNow+Math.max(0,Date.now()-hosts.dataUpdatedAt))
 const reason=active?'The manager is updating this agent.':agent.desired!=='running'?'Start this agent before updating.':!live()||hosts.isError?'The agent’s manager is unavailable.':host?.desired!=='active'||!host.health?.dockerAvailable?'The manager is not ready.':!host.health.capabilities.includes('managed-agent-upgrade-v1')?'This host needs a manager with single-agent update support.':!candidate?'A compatible runtime for the latest Pi release must first be prepared on this host.':undefined
 const change=useMutation({retry:false,mutationFn:(value:Intent)=>rue.changeManagedAgent(agent.id,{requestId:value.requestId,expectedRevision:value.expectedRevision,expectedImage:value.expectedImage,image:value.image!,piVersion:value.piVersion,action:'upgrade',acknowledgeExecution:true},AbortSignal.timeout(15000)),onSuccess:()=>{void cache.invalidateQueries({queryKey:['managed-agents',owner]});void cache.invalidateQueries({queryKey:['remote-computers',owner]})}})
 const unchanged=intent&&intent.expectedRevision===agent.revision&&intent.expectedImage===image&&intent.image===candidate?.image&&intent.piVersion===latest
 const observedRequest=Boolean(intent&&agent.revision>intent.expectedRevision&&agent.runtimeUpdateVersion===intent.piVersion)
 const ready=Boolean(intent?.image&&!reason&&unchanged&&!change.isPending&&!change.isSuccess)
 if(!outdated&&!active&&!intent)return null
 return <><Button type="button" variant="ghost" className="agent-update-button size-9 shrink-0" aria-label="Update agent" title={active?'Agent update in progress':`Update agent${latest?` to Pi ${latest}`:''}`} onClick={()=>{if(!image||!latest)return;change.reset();setIntent({requestId:crypto.randomUUID(),expectedRevision:agent.revision,expectedImage:image,image:candidate?.image,piVersion:latest,currentVersion:current??'Not reported'})}}><MenuSyncIcon size={18} colorMode="stripped" className="size-[18px] fill-none stroke-current stroke-2" aria-hidden/></Button>
 <Dialog open={Boolean(intent)} title="Update agent" onClose={()=>{if(!change.isPending)setIntent(null)}}><div className="grid gap-4">
 <dl className="grid grid-cols-2 gap-2 text-sm"><dt>Current Pi version</dt><dd>{current??intent?.currentVersion}</dd><dt>Latest Pi version</dt><dd>{intent?.piVersion}</dd></dl>
 {!piVersion&&current&&<p className="text-xs text-muted">The current version comes from the manager’s image inventory; this agent has not reported its version yet.</p>}
 {!current&&<p className="text-xs text-muted">The installed version is unknown. Confirm only if you want this agent to use the latest published Pi build shown above.</p>}
 <p>Update <strong>{agent.name}</strong> to Pi {intent?.piVersion}? Only this agent restarts. Other agents stay running.</p>
 <p className="text-sm text-muted">The current task and pending uploads finish first. Your workspace, session and existing permissions are kept. Started or uncertain tasks are never replayed. The manager attempts rollback if startup fails.</p>
 {reason&&<p role="status" className="text-sm">{reason}</p>}
 {agent.runtimeUpdateState==='updated'&&observedRequest&&<p role="status">Agent updated to Pi {agent.runtimeUpdateVersion}.</p>}
 {agent.runtimeUpdateState==='rolled_back'&&<p role="status">The last update failed; the previous runtime was restored.</p>}
 {agent.runtimeUpdateState==='failed'&&<p role="alert">The update and rollback failed. This agent is stopped and needs review.</p>}
 {intent&&!unchanged&&!active&&!change.isSuccess&&<p role="status">The agent or release changed. Close this dialog and review the update again.</p>}
 {agent.runtimeUpdateState==='cancelled'&&observedRequest&&<p role="status">Update cancelled.</p>}
 {change.isSuccess&&!observedRequest&&<p role="status">Update requested. Waiting for the manager to report progress.</p>}
 {change.isError&&<p role="alert">Request unconfirmed. Check this agent’s status before retrying; this dialog retains the request ID.</p>}
 <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={change.isPending} onClick={()=>setIntent(null)}>{change.isSuccess?'Close':'Cancel'}</Button><Button type="button" disabled={!ready} isLoading={change.isPending} onClick={()=>{if(ready&&intent&&live())change.mutate(intent)}}>Update this agent</Button></div>
 </div></Dialog></>
}
