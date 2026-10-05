import {useContext,useEffect,useRef,useState} from 'react'
import {useQuery,useQueryClient} from '@tanstack/react-query'
import {Button,Input,DataTable,Dialog,TableIcon,Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@multiterm/rue-ui'
import {RueApiError,type RueManagedAgent,type RueManagedAction,type RueManagedAgentConfig,type RueMcpProfile} from '@multiterm/rue-sdk'
import {rue} from './client'
import {SettingsRefresh,SettingsAdd} from './settings-support'
import {LiveSyncContext} from './live-sync'
import {LoadingSkeleton} from './loading-skeleton'
const defaults:Record<string,string>={openai:'gpt-4.1-mini',anthropic:'claude-sonnet-4-5',google:'gemini-2.5-pro',openrouter:'openai/gpt-4.1-mini','openai-codex':'gpt-5.4'}
function Choice({label,value,change,items}:{label:string;value:string;change(value:string):void;items:{value:string;label:string}[]}){
 return <label className="settings-stack"><span>{label}</span><Select value={value} onValueChange={change}><SelectTrigger aria-label={label}><SelectValue placeholder={`Choose ${label.toLowerCase()}`}/></SelectTrigger><SelectContent>{items.map(item=><SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></label>
}
function Operations({owner,id}:{owner:string;id:string}){
 const live=useContext(LiveSyncContext)
 const operations=useQuery({queryKey:['managed-operations',owner,id],queryFn:()=>rue.managedOperations(id),retry:false,refetchInterval:live?false:5000})
 return <ul aria-label="Lifecycle operations">{operations.data?.operations.slice(0,8).map(op=><li key={op.id}>{op.action} · revision {op.revision} · {op.status}</li>)}{operations.isError&&<li>Operation history unavailable.</li>}</ul>
}
function AgentConfiguration({agent,profiles,capable,busy,save,cancel}:{agent:RueManagedAgent;profiles:RueMcpProfile[];capable:boolean;busy:boolean;save(config:RueManagedAgentConfig):void;cancel():void}){
 const [config,setConfig]=useState(agent.config),[ack,setAck]=useState(false)
 const invalid=Boolean(config.mcp?.length&&(!capable||config.mcp.some(id=>!profiles.some(p=>p.id===id))))
 const update=(next:RueManagedAgentConfig)=>{setConfig(next);setAck(false)}
 return <form className="settings-stack" onSubmit={e=>{e.preventDefault();if(ack&&!invalid)save(config)}}>
  <Choice label="Updated tool permissions" value={config.permission} change={value=>update({...config,permission:value as RueManagedAgentConfig['permission'],...(value==='read-only'?{mcp:undefined}:{})})} items={[{value:'read-only',label:'Read-only tools'},{value:'coding',label:'Coding: bash, edit and write'}]}/>
  {profiles.map(profile=><label key={profile.id} className="settings-consent"><input type="checkbox" checked={config.mcp?.includes(profile.id)??false} disabled={!config.mcp?.includes(profile.id)&&(!capable||config.permission!=='coding'||(config.mcp?.length??0)>=4)} onChange={e=>update({...config,mcp:e.target.checked?[...(config.mcp??[]),profile.id]:(config.mcp??[]).filter(id=>id!==profile.id)})}/>Use {profile.name}</label>)}
  {config.mcp?.filter(id=>!profiles.some(p=>p.id===id)).map(id=><label key={id} className="settings-consent"><input type="checkbox" checked onChange={()=>update({...config,mcp:config.mcp?.filter(value=>value!==id)})}/>Unavailable MCP connection · {id}</label>)}
  <label className="settings-consent"><input type="checkbox" checked={config.shareToolOutput} onChange={e=>update({...config,shareToolOutput:e.target.checked})}/>Share tool output, which may contain private files or secrets.</label>
  <label className="settings-consent"><input type="checkbox" checked={config.shareThinking} onChange={e=>update({...config,shareThinking:e.target.checked})}/>Share thinking independently.</label>
  <p>Saving stops this agent and may interrupt active work. History and workspace are retained. Resume it after saving.</p>
  <label className="settings-consent"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>I authorize these tool permissions, sharing choices and selected MCP credentials.</label>
  {invalid&&<p role="alert">Remove unavailable MCP connections or choose a capable host.</p>}
  <div className="settings-actions"><Button type="submit" disabled={busy||!ack||invalid}>Save configuration and stop</Button><Button type="button" variant="ghost" disabled={busy} onClick={cancel}>Cancel configuration</Button></div>
 </form>
}
export function ManagedAgentsPanel({owner}:{owner:string}){
 const live=useContext(LiveSyncContext),cache=useQueryClient()
 const agents=useQuery({queryKey:['managed-agents',owner],queryFn:()=>rue.managedAgents(),retry:false,refetchInterval:live?false:5000})
 const hosts=useQuery({queryKey:['workers',owner],queryFn:()=>rue.workers(),retry:false,refetchInterval:live?false:5000})
 const profiles=useQuery({queryKey:['mcp',owner],queryFn:()=>rue.mcpProfiles(),retry:false,refetchInterval:live?false:30000})
 const [creating,setCreating]=useState(false),[name,setName]=useState('My managed agent'),[host,setHost]=useState(''),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[details,setDetails]=useState<string>(),[editingAgent,setEditingAgent]=useState<string>(),[managingAgent,setManagingAgent]=useState<string>()
 const [config,setConfig]=useState<RueManagedAgentConfig>({provider:'openai',model:defaults.openai,permission:'read-only',mounts:[],shareToolOutput:true,shareThinking:true})
 const createIntent=useRef<{signature:string;requestId:string}|undefined>(undefined),actions=useRef(new Map<string,{requestId:string;expectedRevision:number}>())
 const eligible=hosts.data?.workers.filter(w=>w.ownerSubject===owner&&w.status!=='revoked'&&w.health?.capabilities.includes('managed-agents-v1'))??[]
 useEffect(()=>{
  const deadlines=hosts.data?.workers.filter(w=>w.status==='online'&&w.leaseExpiresAt).map(w=>w.leaseExpiresAt!-w.serverNow-Math.max(0,Date.now()-hosts.dataUpdatedAt)).filter(n=>n>0)??[]
  if(!deadlines.length)return
  const timer=setTimeout(()=>void cache.invalidateQueries({queryKey:['workers',owner]}),Math.min(...deadlines)+50)
  return()=>clearTimeout(timer)
 },[hosts.data,hosts.dataUpdatedAt,owner,cache])
 const mcpCapable=eligible.find(w=>w.id===(host||eligible[0]?.id))?.health?.capabilities.includes('managed-mcp-v1')===true
 const mcpProfiles=profiles.data?.ownerSubject===owner?profiles.data.profiles.filter(p=>p.revokedAt===null):[]
 const codexInvalid=config.provider==='openai-codex'&&eligible.find(w=>w.id===(host||eligible[0]?.id))?.health?.capabilities.includes('managed-codex-v1')!==true
 const mcpInvalid=Boolean(config.mcp?.length&&(!mcpCapable||profiles.isError||config.mcp.some(id=>!mcpProfiles.some(p=>p.id===id))))
 async function refresh(){await Promise.all(['managed-agents','managed-operations','workers','sessions','remote-computers'].map(key=>cache.invalidateQueries({queryKey:[key]})))}
 async function create(){
  const workerId=host||eligible[0]?.id
  if(!ack||mcpInvalid||codexInvalid||!workerId||!eligible.some(w=>w.id===workerId))return
  setBusy(true);setError('')
  const input={workerId,name:name.trim(),acknowledgeExecution:true as const,config},signature=JSON.stringify(input)
  if(createIntent.current?.signature!==signature)createIntent.current={signature,requestId:crypto.randomUUID()}
  try{await rue.createManagedAgent({...input,requestId:createIntent.current.requestId});createIntent.current=undefined;setCreating(false);setAck(false);await refresh()}
  catch{setError('Creation may have been accepted. Check the list before changing the form; retrying the same form is safe.');void refresh()}
  finally{setBusy(false)}
 }
 async function change(agent:RueManagedAgent,action:RueManagedAction,configuration?:RueManagedAgentConfig){
  if(action==='purge'&&!window.confirm(`Permanently purge ${agent.name}'s saved Pi history, conversation and managed workspace volumes? This cannot be undone. Host bind sources, backups and exported copies are not deleted.`))return
  if(action==='destroy'&&!window.confirm(`Destroy ${agent.name}? This stops its runtime but retains conversation history and workspace volumes. It does not delete host files.`))return
  if(action==='stop'&&!window.confirm(`Stop ${agent.name}? Active work may be interrupted and will not be replayed.`))return
  setBusy(true);setError('')
  const key=agent.id+':'+action+(configuration?':'+JSON.stringify(configuration):'')
  for(const old of actions.current.keys())if(old.startsWith(agent.id+':')&&old!==key)actions.current.delete(old)
  const intent=actions.current.get(key)??{requestId:crypto.randomUUID(),expectedRevision:agent.revision};actions.current.set(key,intent)
  try{await rue.changeManagedAgent(agent.id,{...intent,action,...(action==='purge'?{acknowledgePurge:true as const}:{}),...(configuration?{config:configuration,acknowledgeExecution:true as const}:{})});actions.current.delete(key);setEditingAgent(undefined);await refresh()}
  catch{setError('The action may have been accepted. Refresh to see current state; retrying the same action will reuse its request ID.');void refresh()}
  finally{setBusy(false)}
 }
 const hostFor=(agent:RueManagedAgent)=>hosts.data?.workers.find(w=>w.id===agent.workerId&&w.ownerSubject===owner)
 const state=(agent:RueManagedAgent)=>agent.purgedAt?'Purged':agent.purgeRequested?'Purge requested':agent.desired==='destroyed'?(agent.observed==='destroyed'?'Destroyed':'Destruction requested'):hostFor(agent)?.status!=='online'?'Host unavailable':agent.observed
 const unavailable=agents.error instanceof RueApiError&&agents.error.status===404
 return <section className="settings-stack" aria-label="Managed execution">
  {unavailable?<p>Managed execution is not enabled on this server.</p>:agents.isPending?<LoadingSkeleton label="Loading managed agents" kind="list"/>:agents.isError&&!agents.data?<p role="alert">Managed agents unavailable.</p>:<>
   {!eligible.length&&<p>No execution-capable host is configured. An enrollment-only worker cannot launch agents.</p>}
   {creating&&<Dialog open title="Create managed agent" onClose={()=>{if(!busy)setCreating(false)}} className="max-h-[calc(100dvh-40px)] overflow-y-auto"><form className="settings-stack" onSubmit={e=>{e.preventDefault();void create()}}>
    <Input label="Managed agent name" value={name} maxLength={60} onChange={e=>setName(e.target.value)} show={{label:true,hideRequireType:true}}/>
    <Choice label="Execution host" value={host||eligible[0]?.id||''} change={value=>{setHost(value);setAck(false)}} items={eligible.map(w=>({value:w.id,label:`${w.name} · ${w.status}`}))}/>
    <Choice label="Provider" value={config.provider} change={value=>{const provider=value as RueManagedAgentConfig['provider'];setConfig({...config,provider,model:defaults[provider]??''})}} items={Object.keys(defaults).map(value=>({value,label:value}))}/>
    <Input label="Model ID" value={config.model} maxLength={128} onChange={e=>setConfig({...config,model:e.target.value})} show={{label:true,hideRequireType:true}}/>
    <Choice label="Tool permissions" value={config.permission} change={value=>{setConfig({...config,permission:value as RueManagedAgentConfig['permission'],...(value==='read-only'?{mcp:undefined}:{})});setAck(false)}} items={[{value:'read-only',label:'Read-only tools'},{value:'coding',label:'Coding: bash, edit and write'}]}/>
    {mcpProfiles.length>0&&<fieldset className="settings-stack"><legend>MCP connections</legend><p>Selected MCP programs receive their saved credentials and can execute code in this agent. Coding permission and an MCP-capable host are required.</p>{mcpProfiles.map(profile=><label key={profile.id} className="settings-consent"><input type="checkbox" checked={config.mcp?.includes(profile.id)??false} disabled={config.permission!=='coding'||!mcpCapable||(!config.mcp?.includes(profile.id)&&(config.mcp?.length??0)>=4)} onChange={e=>{setConfig({...config,mcp:e.target.checked?[...(config.mcp??[]),profile.id]:(config.mcp??[]).filter(id=>id!==profile.id)});setAck(false)}}/>Use {profile.name}</label>)}</fieldset>}
    {codexInvalid&&<p role="alert">Codex OAuth requires an updated host/runtime.</p>}
    {mcpInvalid&&<p role="alert">The selected MCP connections or host are unavailable.</p>}
    <p>This agent gets a private persistent workspace, not a host filesystem mount. AI keys require a separate explicit grant in AI keys settings.</p>
    <label className="settings-consent"><input type="checkbox" checked={config.shareToolOutput} onChange={e=>setConfig({...config,shareToolOutput:e.target.checked})}/>Share tool output, which may contain private files or secrets.</label>
    <label className="settings-consent"><input type="checkbox" checked={config.shareThinking} onChange={e=>setConfig({...config,shareThinking:e.target.checked})}/>Share thinking independently.</label>
    <label className="settings-consent"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>I authorize unattended prompts on this host with these tool permissions{config.mcp?.length?' and access to the selected MCP credentials':''}.</label>
    <Button type="submit" disabled={busy||!ack||mcpInvalid||codexInvalid||!name.trim()||!config.model.trim()||!eligible.length} isLoading={busy}>Start managed agent</Button>
   {error&&<p role="alert">{error}</p>}</form></Dialog>}
   <DataTable title="Managed agents" actions={<><SettingsRefresh label="Refresh managed agents" disabled={agents.isFetching||busy} onClick={()=>void refresh()}/><SettingsAdd label="managed agent" disabled={agents.isPending||agents.isError||!eligible.length||busy} onClick={()=>setCreating(true)}/></>} rows={agents.data?.agents??[]} rowKey={agent=>agent.id} empty="No managed agents." columns={[
    {id:'name',title:'Agent',value:agent=>agent.name},
    {id:'host',title:'Host',value:agent=>hostFor(agent)?.name??'Unknown host'},
    {id:'provider',title:'Provider',value:agent=>agent.config.provider,filterOptions:Object.keys(defaults).map(value=>({value,label:value}))},
    {id:'model',title:'Model',value:agent=>agent.config.model},
    {id:'status',title:'Status',value:state},
    {id:'desired',title:'Desired',value:agent=>agent.desired,filterOptions:['running','stopped','destroyed'].map(value=>({value,label:value}))},
    {id:'actions',title:'Actions',value:()=>'',sortable:false,render:agent=><Button variant="ghost" size="icon" aria-label={`Manage ${agent.name}`} title="Manage agent" disabled={busy} onClick={()=>{setEditingAgent(undefined);setDetails(undefined);setManagingAgent(agent.id)}}><TableIcon kind="access"/></Button>}
   ]}/>
   {agents.data?.agents.filter(agent=>agent.id===managingAgent).map(agent=>{const worker=hostFor(agent);return <Dialog key={agent.id} open title={`Manage ${agent.name}`} onClose={()=>{if(!busy)setManagingAgent(undefined)}} className="max-h-[calc(100dvh-40px)] overflow-y-auto"><article className="settings-card" aria-label={`Managed agent ${agent.name}`}>
    <div className="settings-item-heading"><h4>{agent.name}</h4><span role="status">{agent.purgedAt?'Purged':agent.purgeRequested?'Purge requested':agent.desired==='destroyed'?(agent.observed==='destroyed'?'Destroyed':'Destruction requested'):worker?.status!=='online'?'Host unavailable':agent.observed}</span></div>
    <p>{worker?.name??'Unknown host'} · {agent.config.provider}/{agent.config.model} · {agent.config.permission}{agent.config.mcp?.length?` · ${agent.config.mcp.length} MCP connections`:''}</p>
    <p>Desired: {agent.desired} · revision {agent.revision}{agent.observedRevision!==agent.revision?' · awaiting reconciliation':''}</p>
    {agent.error&&<p role="status">Runtime status: {agent.error.replaceAll('_',' ')}.</p>}
    {agent.desired!=='destroyed'&&<><Button variant="ghost" disabled={busy} onClick={()=>setEditingAgent(editingAgent===agent.id?undefined:agent.id)}>Configure tools and MCP</Button>{editingAgent===agent.id&&<AgentConfiguration key={`${agent.id}:${agent.revision}`} agent={agent} profiles={mcpProfiles} capable={worker?.health?.capabilities.includes('managed-mcp-v1')===true&&!profiles.isError} busy={busy} save={config=>void change(agent,'configure',config)} cancel={()=>setEditingAgent(undefined)}/>}</>}
    {agent.desired!=='destroyed'?<div className="settings-actions">
     <Button disabled={busy} onClick={()=>void change(agent,agent.desired==='stopped'?'resume':'stop')}>{agent.desired==='stopped'?'Resume agent':'Stop agent'}</Button>
     <Button disabled={busy||agent.desired!=='running'} onClick={()=>void change(agent,'reload')}>Reload after current work</Button>
     <Button variant="ghost" disabled={busy} onClick={()=>void change(agent,'destroy')}>Destroy runtime</Button>
    </div>:agent.purgedAt?<p>Stored history and managed volumes were purged. The audit tombstone is retained.</p>:<><p>History and workspace volumes are retained. Destruction does not purge them.{agent.observed!=='destroyed'?' Runtime authority is revoked; host cleanup is not yet confirmed.':''}</p>{agent.purgeRequested?<p role="status">Waiting for the host to confirm permanent deletion.</p>:worker?.health?.capabilities.includes('managed-purge-v1')?<Button variant="destructive" disabled={busy} onClick={()=>void change(agent,'purge')}>Purge retained data permanently</Button>:<p>A purge-capable worker is required to remove retained volumes.</p>}</>}
    <Button variant="ghost" onClick={()=>setDetails(details===agent.id?undefined:agent.id)}>{details===agent.id?'Hide operations':'Lifecycle operations'}</Button>
    {details===agent.id&&<Operations owner={owner} id={agent.id}/>}
   </article></Dialog>})}
  </>}
  {agents.isError&&agents.data&&<p role="status">Showing last-known agent state.</p>}
  {error&&<p role="alert">{error}</p>}
 </section>
}
