import {useContext,useRef,useState} from 'react'
import {useQuery,useQueryClient} from '@tanstack/react-query'
import {Button,Input,Dialog} from '@multiterm/rue-ui'
import {RueApiError,type RueMcpProfile} from '@multiterm/rue-sdk'
import {rue} from './client'
import {LiveSyncContext} from './live-sync'
import {LoadingSkeleton} from './loading-skeleton'
import {SettingsHelp,SettingsRefresh,SettingsAdd} from './settings-support'
export function McpPanel({owner}:{owner:string}){
 const cache=useQueryClient(),live=useContext(LiveSyncContext)
 const profiles=useQuery({queryKey:['mcp',owner],queryFn:()=>rue.mcpProfiles(),retry:false,refetchInterval:live?false:30000})
 const [editing,setEditing]=useState(false),[name,setName]=useState(''),[command,setCommand]=useState('node'),[args,setArgs]=useState('[]'),[environment,setEnvironment]=useState('{}'),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const intent=useRef<{signature:string;id:string}|undefined>(undefined)
 async function refresh(){await Promise.all(['mcp','managed-agents','workers','remote-computers','sessions'].map(key=>cache.invalidateQueries({queryKey:[key,owner]})))}
 function cancel(){setEditing(false);setEnvironment('{}');setAck(false);intent.current=undefined;setError('')}
 async function save(){
  if(!ack)return
  let argumentsValue:string[],environmentValue:Record<string,string>
  try{
   argumentsValue=JSON.parse(args);environmentValue=JSON.parse(environment)
   if(!Array.isArray(argumentsValue)||argumentsValue.length>16||argumentsValue.some(value=>typeof value!=='string')||!environmentValue||Array.isArray(environmentValue)||typeof environmentValue!=='object'||Object.values(environmentValue).some(value=>typeof value!=='string'))throw Error()
  }catch{setError('Arguments must be a JSON string array; environment must be a JSON object with string values.');return}
  const input={expectedOwnerSubject:owner,name:name.trim(),command:command.trim(),args:argumentsValue,environment:environmentValue,acknowledgeTools:true as const},signature=JSON.stringify(input)
  if(intent.current?.signature!==signature)intent.current={signature,id:crypto.randomUUID()}
  setBusy(true);setError('')
  try{await rue.createMcpProfile(intent.current.id,input);cancel();await refresh()}
  catch{setError('The connection may have been saved. Refresh before changing the form; retrying the same form is safe.');void refresh()}
  finally{setBusy(false)}
 }
 async function remove(profile:RueMcpProfile){
  if(!window.confirm(`Remove ${profile.name}? Affected agents will be stopped and disconnected from this MCP server. Active work may be interrupted. Already delivered credentials cannot be recalled.`))return
  setBusy(true);setError('')
  try{await rue.removeMcpProfile(profile.id,profile.revision);await refresh()}
  catch{setError('Removal may have been accepted. Refresh to check current state.');void refresh()}
  finally{setBusy(false)}
 }
 const available=profiles.data?.ownerSubject===owner
 return <div className="settings-stack">
  {profiles.isPending?<LoadingSkeleton label="Loading MCP connections"/>:profiles.error instanceof RueApiError&&profiles.error.status===404?<p>MCP is not enabled on this server.</p>:!available?<p role="alert">MCP connections unavailable.</p>:<>
   <div className="settings-toolbar"><h4>MCP connections</h4><div className="flex gap-2"><SettingsRefresh label="Refresh MCP connections" disabled={busy||profiles.isFetching} onClick={()=>void refresh()}/><SettingsAdd label="MCP connection" disabled={busy} onClick={()=>setEditing(true)}/></div></div>
   {editing&&<Dialog open title="Add MCP connection" onClose={()=>{if(!busy)cancel()}} className="max-h-[calc(100dvh-40px)] overflow-y-auto"><form className="settings-stack" onSubmit={event=>{event.preventDefault();void save()}}>
    <Input label="MCP connection name" value={name} maxLength={60} disabled={busy} onChange={e=>setName(e.target.value)} show={{label:true,hideRequireType:true}}/>
    <Input label="Executable inside agent" value={command} maxLength={256} disabled={busy} onChange={e=>setCommand(e.target.value)} show={{label:true,hideRequireType:true}}/>
    <Input label="Arguments (JSON array)" value={args} maxLength={8192} disabled={busy} onChange={e=>setArgs(e.target.value)} show={{label:true,hideRequireType:true}}/>
    <p>Use an executable already available in the image or private workspace. Arguments are visible metadata: never put credentials in them. Rue performs no automatic package installation or shell expansion.</p>
    <Input label="Secret environment (JSON object)" type="password" autoComplete="new-password" value={environment} maxLength={8192} disabled={busy} onChange={e=>setEnvironment(e.target.value)} show={{label:true,hideRequireType:true}}/>
    <label className="settings-consent"><input type="checkbox" checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)}/>I trust this MCP program to execute code and access the workspace and credentials of agents I select.</label>
    <Button type="submit" isLoading={busy} disabled={busy||!ack||!name.trim()||!command.trim()}>Save MCP connection</Button>
   {error&&<p role="alert">{error}</p>}</form></Dialog>}
   {profiles.data!.profiles.filter(p=>p.revokedAt===null).map(profile=><article key={profile.id} className="settings-card" aria-label={`MCP connection ${profile.name}`}><h4>{profile.name}</h4><p>stdio · {profile.command} · {profile.environmentNames.length} protected environment values</p><p>Select this connection when creating a managed agent. To rotate credentials, remove it and create a new connection.</p><Button variant="ghost" disabled={busy} onClick={()=>void remove(profile)}>Remove MCP connection</Button></article>)}
  </>}
  {profiles.isError&&available&&<p role="status">Showing last-known MCP connections.</p>}
  {error&&<p role="alert">{error}</p>}
  <SettingsHelp section="mcp"/>
 </div>
}
