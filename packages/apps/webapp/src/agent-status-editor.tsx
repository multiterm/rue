import {useRef,useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {Button,Checkbox,Dialog,Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@multiterm/rue-ui'
import type {RueManagedAgent,RueManagedAgentConfig} from '@multiterm/rue-sdk'
import {AgentModelDialog} from './agent-model-dialog'
import {rue} from './client'

export type EditableAgentStatus='Provider'|'Model'|'Thinking'|'Auto compaction'
export function AgentStatusEditor({agent,owner,field,close}:{agent:RueManagedAgent;owner:string;field:EditableAgentStatus;close():void}){
 const [original]=useState(agent),[thinking,setThinking]=useState(agent.config.thinkingLevel??(agent.config.shareThinking?'medium':'off')),[compact,setCompact]=useState(agent.config.autoCompaction??false),[ack,setAck]=useState(false)
 const cache=useQueryClient(),intent=useRef<{signature:string;id:string}|undefined>(undefined),locked=useRef(false)
 const hosts=useQuery({queryKey:['workers',owner],queryFn:()=>rue.workers(),retry:false})
 const worker=hosts.data?.workers.find(w=>w.id===agent.workerId&&w.ownerSubject===owner)
 const mutation=useMutation({mutationFn:async(config:RueManagedAgentConfig)=>{
  const signature=JSON.stringify(config)
  if(intent.current?.signature!==signature)intent.current={signature,id:crypto.randomUUID()}
  return rue.changeManagedAgent(original.id,{action:'configure',config,expectedRevision:original.revision,requestId:intent.current.id,acknowledgeExecution:true})
 },onSuccess:()=>{void Promise.all(['managed-agents','managed-operations','remote-computers'].map(key=>cache.invalidateQueries({queryKey:[key]})))}})
 const error=mutation.isError?'Change unconfirmed. Check manager activity before retrying. Unchanged retries use the same request ID.':''
 const save=(config:RueManagedAgentConfig)=>{if(locked.current)return;locked.current=true;mutation.mutate(config,{onSettled:()=>{locked.current=false}})}
 if(mutation.isSuccess)return <Dialog open title="Change requested" onClose={close}><p>The manager accepted the configuration. The agent will stop; resume it from Actions to use the new settings. Reported status changes only after the runtime reports back.</p><Button onClick={close}>Done</Button></Dialog>
 if(field==='Provider'||field==='Model')return <AgentModelDialog owner={owner} agent={original} busy={mutation.isPending} error={error} close={close} codexSupported={!hosts.isError&&worker?.health?.capabilities.includes('managed-codex-v1')===true} save={config=>save(config)}/>
 return <Dialog open title={`Change ${field.toLowerCase()}`} onClose={()=>{if(!mutation.isPending)close()}}><div className="grid gap-4">
 {field==='Thinking'?<><Select value={thinking} disabled={mutation.isPending} onValueChange={value=>{setThinking(value as typeof thinking);setAck(false)}}><SelectTrigger aria-label="Thinking level"><SelectValue/></SelectTrigger><SelectContent>{(['off','minimal','low','medium','high','xhigh'] as const).map(level=><SelectItem key={level} value={level}>{level}</SelectItem>)}</SelectContent></Select><p className="text-sm text-muted">The model may limit supported levels. Thinking visibility still depends on the separate sharing permission.</p></>:<label className="flex gap-2"><Checkbox checked={compact} disabled={mutation.isPending} onCheckedChange={value=>{setCompact(value===true);setAck(false)}}/>Enable automatic context compaction</label>}
 <label className="flex gap-2"><Checkbox checked={ack} disabled={mutation.isPending} onCheckedChange={value=>setAck(value===true)}/>Stop this agent and apply the change through its manager. Active work may be interrupted. Resume separately. Model costs may apply.</label>
 {error&&<p role="alert">{error}</p>}
 <div className="flex justify-end gap-2"><Button variant="ghost" disabled={mutation.isPending} onClick={close}>Cancel</Button><Button disabled={!ack||mutation.isPending} isLoading={mutation.isPending} onClick={()=>save({...original.config,...(field==='Thinking'?{thinkingLevel:thinking}:{autoCompaction:compact})})}>Apply and stop</Button></div>
 </div></Dialog>
}
