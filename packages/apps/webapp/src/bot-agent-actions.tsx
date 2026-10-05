import {useContext,useEffect,useRef,useState,type SetStateAction} from 'react'
import {useQuery,useQueryClient} from '@tanstack/react-query'
import {Button} from '@multiterm/rue-ui'
import type {RueSession,RueManagedAgentConfig} from '@multiterm/rue-sdk'
import {rue} from './client'
import {LiveSyncContext} from './live-sync'
import {SettingsHelp} from './settings-support'
import {AgentModelDialog} from './agent-model-dialog'
import {AgentPermissions} from './agent-permissions'
import {AgentRuntimeControl} from './agent-runtime-control'
import {AgentCredentialDialog} from './agent-credential-dialog'
type Action='stop'|'resume'|'reload'|'destroy'|'compact'|'configure'
export type AgentActionView='actions'|'model'|'key'|'workspace'|'permissions'
export function BotAgentActions({session,onBusy,initialView='actions',onNavigate}:{session:RueSession;onBusy(value:boolean):void;initialView?:AgentActionView;onNavigate?(view:'actions'|'workspace'|'permissions'):boolean}){
 const owner=session.ownerSubject,live=useContext(LiveSyncContext),cache=useQueryClient()
 const agents=useQuery({queryKey:['managed-agents',owner],queryFn:()=>rue.managedAgents(),retry:false,refetchInterval:live?false:5000})
 const hosts=useQuery({queryKey:['workers',owner],queryFn:()=>rue.workers(),retry:false,refetchInterval:5000})
 const keys=useQuery({queryKey:['provider-keys',owner],queryFn:()=>rue.providerKeys(),retry:false})
 const agent=agents.data?.agents.find(value=>value.id===session.meta.managedAgentId&&value.sessionId===session.id)
 const operations=useQuery({queryKey:['managed-operations',owner,agent?.id],queryFn:()=>rue.managedOperations(agent!.id),enabled:Boolean(agent),retry:false,refetchInterval:live?false:5000})
 const compactions=useQuery({queryKey:['managed-compactions',owner,agent?.id],queryFn:()=>rue.managedCompactions(agent!.id),enabled:Boolean(agent),retry:false,refetchInterval:3000})
 const worker=hosts.data?.workers.find(w=>w.id===agent?.workerId&&w.ownerSubject===owner)
 const capable=!hosts.isError&&worker?.status==='online'&&worker.health?.capabilities.includes('managed-compact-v1')===true
 const pendingCompact=compactions.data?.commands.some(c=>['queued','assigned','running'].includes(c.status))
 const [view,setLocalView]=useState<AgentActionView>(initialView),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState(''),[history,setHistory]=useState(false)
 function setView(next:SetStateAction<AgentActionView>){const value=typeof next==='function'?next(view):next;if((value==='actions'||value==='workspace'||value==='permissions')&&onNavigate?.(value))return;setLocalView(value)}
 const mounted=useRef(true),locked=useRef(false),intent=useRef<{signature:string;requestId:string;expectedRevision:number}|undefined>(undefined)
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
 useEffect(()=>{onBusy(busy);return()=>onBusy(false)},[busy,onBusy])
 async function refresh(){await Promise.all(['managed-agents','managed-operations','managed-compactions','workers','sessions','remote-computers','provider-keys'].map(key=>cache.invalidateQueries({queryKey:[key]})))}
 async function change(action:Action,config?:RueManagedAgentConfig,revision=agent?.revision,filesystem=false){
  if(!agent||!revision||locked.current||agents.isError||agents.isFetching)return
  const warning=action==='compact'?`Compact ${agent.name}'s Pi context using its current model? Model costs may apply. Rue chat history stays unchanged.`:action==='destroy'?`Remove ${agent.name}'s runtime? Active work stops. Chat history and managed workspace volumes are retained; this is not permanent purge.`:action==='stop'?`Stop ${agent.name}? Active work may be interrupted and will not be replayed. Never-started queued requests are kept for when you resume.`:action==='resume'?`Resume ${agent.name} with its existing execution permissions and grants? Saved queued requests will run using the current model and permissions.`:null
  if(warning&&!window.confirm(warning))return
  locked.current=true;setBusy(true);setError('');setNotice('')
  const signature=action+(config?JSON.stringify([config,revision,filesystem]):'')
  if(intent.current?.signature!==signature)intent.current={signature,requestId:crypto.randomUUID(),expectedRevision:revision}
  const {requestId,expectedRevision}=intent.current
  let timer:ReturnType<typeof setTimeout>|undefined
  try{
   const request=action==='compact'?rue.compactManagedAgent(agent.id,{requestId,expectedRevision,acknowledgeModelUse:true}).then(command=>command.status):rue.changeManagedAgent(agent.id,{requestId,expectedRevision,action,...(config?{config,acknowledgeExecution:true as const,...(filesystem?{acknowledgeFilesystem:true as const}:{})}:{})}).then(result=>result.operation.status)
   const status=await Promise.race([request,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('uncertain')),10000)})])
   if(mounted.current){intent.current=undefined;setView(current=>current==='workspace'||current==='permissions'?current:'actions');setNotice(`Request accepted · ${status}`)}
   void refresh()
  }catch{if(mounted.current)setError('Result unconfirmed. Check activity before retrying; the same request ID is retained.');void refresh()}
  finally{clearTimeout(timer);locked.current=false;if(mounted.current)setBusy(false)}
 }
 const disabled=busy||agents.isError||agents.isFetching
 if(view==='workspace'||view==='permissions')return <section className="grid gap-3">{agent?<><AgentPermissions mode={view} agent={agent} extended={worker?.health?.capabilities.includes('managed-filesystem-v2')===true} supported={!hosts.isError&&worker?.status==='online'&&worker.health?.capabilities.includes('managed-filesystem-v1')===true} busy={disabled} error={error} save={(config,revision)=>void change('configure',config,revision,view==='workspace')}/>{view==='permissions'&&<AgentRuntimeControl owner={owner} agent={agent} disabled={disabled} onBusy={setBusy}/>}</>:<p role="status">{agents.isError?'Agent unavailable.':'Loading permissions…'}</p>}{notice&&<p role="status">{notice}</p>}<Button type="button" variant="ghost" disabled={busy} data-settings-page="Actions" onClick={()=>setView('actions')}>Actions</Button></section>
 return <section className="grid gap-3" aria-label="Managed agent actions">
 {agents.isPending?<p role="status">Loading agent state…</p>:!agent?<p role="alert">Agent unavailable.</p>:<>
 {agent.error==='capacity_unavailable'&&<p role="status" className="text-sm text-muted">Waiting for host capacity. Stop another agent to free a slot, or ask the host operator to increase its running-agent limit. Your bot has not been deleted.</p>}
 <p className="text-sm text-muted">Requested: {agent.desired} · Reported: {agent.observed}{agent.observedRevision!==agent.revision?' (updating)':''}</p>
 {agent.desired!=='destroyed'?<>
 <Button type="button" variant="outline" disabled={disabled} data-settings-page="Workspace" onClick={()=>setView('workspace')}>Workspace</Button>
 <Button type="button" variant="outline" disabled={disabled} data-settings-page="Permissions" onClick={()=>setView('permissions')}>Permissions</Button>
 <Button type="button" variant="outline" disabled={disabled} onClick={()=>setView('model')}>Change provider / model</Button>
 <Button type="button" variant="outline" disabled={disabled||keys.isError||keys.data?.ownerSubject!==owner||!keys.data?.keyStorageAvailable} onClick={()=>setView('key')}>Update AI key</Button>
 <Button type="button" variant="outline" disabled={disabled||!capable||compactions.isPending||compactions.isError||pendingCompact||agent.desired!=='running'} title={!capable?'Update to a compaction-capable manager and runtime':undefined} onClick={()=>void change('compact')}>Compact agent</Button>
 {!capable&&<small className="text-muted">Compact requires an updated manager/runtime.</small>}
 <Button type="button" variant="outline" disabled={disabled} onClick={()=>void change(agent.desired==='stopped'?'resume':'stop')}>{agent.desired==='stopped'?'Resume agent':'Stop agent'}</Button>
 <Button type="button" variant="outline" disabled={disabled||agent.desired!=='running'} onClick={()=>void change('reload')}>Reload after current work</Button>
 <Button type="button" variant="outline" disabled={disabled} onClick={()=>void change('destroy')}>Remove runtime</Button>
 </>:<p>Runtime removed or awaiting removal. History and workspace retained.</p>}
 {compactions.data?.commands[0]&&<p role="status" className="text-sm">Compaction · {compactions.data.commands[0].status}</p>}
 <Button type="button" variant="ghost" onClick={()=>setHistory(!history)}>{history?'Hide activity':'View activity'}</Button>
 {history&&<ul aria-label="Manager operations" className="text-sm">{operations.data?.operations.slice(0,5).map(operation=><li key={operation.id}>{operation.action} · {operation.status}</li>)}{operations.isError&&<li>Activity unavailable.</li>}</ul>}
 {view==='model'&&<AgentModelDialog codexSupported={!hosts.isError&&worker?.health?.capabilities.includes('managed-codex-v1')===true} owner={owner} agent={agent} busy={busy} error={error} close={()=>setView('actions')} save={(config,revision)=>void change('configure',config,revision)}/>}
 {view==='key'&&keys.data?.ownerSubject===owner&&<AgentCredentialDialog codexSupported={!hosts.isError&&worker?.health?.capabilities.includes('managed-codex-v1')===true} owner={owner} agent={agent} credentials={keys.data} onBusy={setBusy} close={()=>setView('actions')} updated={value=>{if(value.ownerSubject===owner)cache.setQueryData(['provider-keys',owner],value);void cache.invalidateQueries({queryKey:['provider-keys',owner]})}}/>}
 </>}
 {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
 <Button type="button" variant="ghost" disabled={busy||agents.isFetching} onClick={()=>void refresh()}>Refresh agent state</Button>
 <SettingsHelp section="agent-actions"/>
 </section>
}
