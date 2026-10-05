import {useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {Button,Checkbox,Dialog,Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@multiterm/rue-ui'
import type {RueManagedAgent,RueManagedAgentConfig} from '@multiterm/rue-sdk'
import {rue} from './client'
import {ProviderModelSelect} from './provider-model-select'
export function AgentModelDialog({owner,agent,busy,error,close,save,codexSupported=false}:{codexSupported?:boolean;owner:string;agent:RueManagedAgent;busy:boolean;error:string;close():void;save(config:RueManagedAgentConfig,revision:number):void}){
 const [original]=useState(agent),[provider,setProvider]=useState(agent.config.provider),[model,setModel]=useState(agent.config.model),[ack,setAck]=useState(false)
 const computers=useQuery({queryKey:['remote-computers',owner],queryFn:()=>rue.remoteComputers(),retry:false})
 const stamp=computers.data?.computers.find(c=>c.id===agent.connectionId&&c.sessionId===agent.sessionId&&c.ownerSubject===owner)?.health?.status?.catalogHash
 const catalog=useQuery({queryKey:['agent-catalog',owner,agent.connectionId,stamp],queryFn:()=>rue.computerCatalog(agent.connectionId!),enabled:Boolean(agent.connectionId),retry:false,staleTime:0})
 const report=catalog.data?.ownerSubject===owner&&catalog.data.connectionId===agent.connectionId&&catalog.data.sessionId===agent.sessionId?catalog.data:undefined
 const providers=report?.catalog?.providers
 const hosts=useQuery({queryKey:['workers',owner],queryFn:()=>rue.workers(),retry:false})
 const dynamic=!hosts.isError&&hosts.data?.workers.some(w=>w.id===agent.workerId&&w.ownerSubject===owner&&w.health?.capabilities.includes('managed-dynamic-providers-v1'))
 const supported=(id:string)=>Boolean(dynamic||['openai','anthropic','google','openrouter','openai-codex'].includes(id))
 const models=providers?.find(p=>p.id===provider)?.models??[]
 return <Dialog open title="Change provider and model" onClose={()=>{if(!busy)close()}}><div className="grid gap-4">
 <Select value={provider} disabled={busy||catalog.isError} onValueChange={value=>{setProvider(value as typeof provider);setModel('');setAck(false)}}><SelectTrigger aria-label="Agent provider"><SelectValue/></SelectTrigger><SelectContent>{providers?.map(p=><SelectItem key={p.id} value={p.id} disabled={!supported(p.id)||p.credentialMode==='unsupported'||p.id==='openai-codex'&&!codexSupported}>{p.name}</SelectItem>)}</SelectContent></Select>
 <ProviderModelSelect key={provider} models={models} value={model} disabled={busy||catalog.isPending||catalog.isError} onChange={value=>{setModel(value);setAck(false)}}/>
 <label className="flex items-start gap-2 text-sm"><Checkbox checked={ack} disabled={busy} onCheckedChange={value=>setAck(value===true)}/>Stop this agent and apply this model with its existing tool permissions. Resume separately.</label>
 {!dynamic&&<p className="text-xs text-muted">New provider identifiers require an updated manager; unsupported choices are disabled.</p>}
 {!codexSupported&&<p className="text-xs text-muted">Codex OAuth requires an updated host/runtime.</p>}
 <p className="text-xs text-muted">Provider access requires its own AI-key grant. Never-started queued requests remain saved and use the new model when resumed.</p>
 {!providers&&<p role="status">This agent has not reported its model catalog. Start or upgrade its runtime, then refresh status. Rue does not substitute the API server’s catalog.</p>}{providers&&<p className="text-xs text-muted">Reported by this agent · Pi {report?.piVersion??'version unknown'}. {report?.catalog?.truncated?'The report was bounded; some models are omitted.':''}</p>}{catalog.isError&&<p role="alert">Model catalog unavailable.</p>}{error&&<p role="alert">{error}</p>}
 <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={close}>Cancel</Button><Button type="button" disabled={busy||!ack||(provider==='openai-codex'&&!codexSupported)||catalog.isError||!supported(provider)||!providers?.some(p=>p.id===provider&&p.credentialMode!=='unsupported')||!models.some(m=>m.id===model)} isLoading={busy} onClick={()=>save({...original.config,provider,model},original.revision)}>Apply and stop</Button></div>
 </div></Dialog>
}
