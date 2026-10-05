import {useContext} from 'react'
import {useQuery} from '@tanstack/react-query'
import {Button} from '@multiterm/rue-ui'
import type {RueSession} from '@multiterm/rue-sdk'
import {rue} from './client'
import {app} from './app'
import {isRemoteBot} from './bot-execution'
import {LiveSyncContext} from './live-sync'
import {useRemoteFreshness} from './use-remote-freshness'
export type BotAccountPage='Models'|'AI keys'|'Agents'|'Server'
function Facts({rows}:{rows:Array<[string,string]>}){return <dl className="bot-settings-facts">{rows.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
const date=(value?:number|null)=>value&&Number.isFinite(value)?new Date(value).toLocaleString():'Not reported'
export function BotConnectionPage({session,manage}:{session:RueSession;manage(page:BotAccountPage):void}){
 const remote=isRemoteBot(session),managed=remote&&Boolean(session.meta.managedAgentId),live=useContext(LiveSyncContext)
 const query=useQuery({queryKey:['remote-computers',session.ownerSubject],queryFn:()=>rue.remoteComputers(),enabled:remote,retry:false,refetchInterval:live?false:5000})
 const computer=query.data?.computers.find(c=>c.ownerSubject===session.ownerSubject&&c.sessionId===session.id)
 const agents=useQuery({queryKey:['managed-agents',session.ownerSubject],queryFn:()=>rue.managedAgents(),enabled:managed,retry:false,refetchInterval:live?false:5000})
 const hosts=useQuery({queryKey:['workers',session.ownerSubject],queryFn:()=>rue.workers(),enabled:managed,retry:false,refetchInterval:live?false:5000})
 const agent=agents.data?.agents.find(a=>a.id===session.meta.managedAgentId&&a.sessionId===session.id&&(!computer||a.connectionId===computer.id))
 const host=agent?hosts.data?.workers.find(w=>w.id===agent.workerId&&w.ownerSubject===session.ownerSubject):undefined
 const refreshing=query.isFetching||(managed&&(agents.isFetching||hosts.isFetching))
 const refresh=()=>{void query.refetch();if(managed){void agents.refetch();void hosts.refetch()}}
 const fresh=useRemoteFreshness(computer,query.dataUpdatedAt)
 const status=query.isError?'Health check unavailable':!computer?'Not reported':computer.status==='online'&&!fresh?'Heartbeat delayed':computer.status
 return <section className="bot-settings-fields" aria-label="Connection info">
 <p className="text-sm text-muted">{remote?'Last reported connection information. Cached values do not prove the agent is connected. This bot never falls back to cloud execution.':'This bot runs on the Rue server, not on a paired computer.'}</p>
 {remote&&query.isPending?<p role="status">Loading connection…</p>:<Facts rows={[
 ['Execution',remote?(session.meta.managedAgentId?'Managed Pi runtime':'Linked Pi session'):'Rue cloud'],
 ['Rue API',app.urls.api],['Session',session.id],
 ...(remote?[
 ...(managed?[
 ['Host',host?.name??(hosts.isPending?'Loading…':'Not reported')],
 ['Agent',agent?.name??(agents.isPending?'Loading…':'Not reported')]
 ]:[['Computer',computer?.name??'Not reported']]),['Connection',status],['Remote prompts',query.isError||!computer?'Unknown':computer.remoteEnabled?'Enabled':'Disabled'],
 ['Last heartbeat',date(computer?.lastSeenAt)],['Lease expires',date(computer?.leaseExpiresAt)],['Transport',computer?.health?.transport??'Not reported'],
 ['Pending uploads',computer?.health?String(computer.health.pendingCount):'Not reported']
 ] as Array<[string,string]>:[])
 ]}/>}
 {query.isError&&remote&&<p role="alert">Connection could not be refreshed. No reconnect or prompt was attempted.</p>}
 {managed&&(agents.isError||hosts.isError)&&<p role="alert">Host or agent details could not be refreshed. Any displayed names are last-known values.</p>}
 {remote&&<Button type="button" variant="ghost" disabled={refreshing} onClick={refresh}>Refresh connection</Button>}
 <Button type="button" variant="secondary" onClick={()=>manage(remote?'Agents':'Server')}>{remote?'Manage connection':'Server settings'}</Button>
 </section>
}
export function BotAiPage({session,manage}:{session:RueSession;manage(page:BotAccountPage):void}){
 const remote=isRemoteBot(session),managed=remote&&Boolean(session.meta.managedAgentId)
 const cloud=useQuery({queryKey:['agent-settings',session.ownerSubject],queryFn:()=>rue.agentSettings(),enabled:!remote,retry:false})
 const agents=useQuery({queryKey:['managed-agents',session.ownerSubject],queryFn:()=>rue.managedAgents(),enabled:managed,retry:false})
 const keys=useQuery({queryKey:['provider-keys',session.ownerSubject],queryFn:()=>rue.providerKeys(),retry:false})
 const runtime=agents.data?.agents.find(a=>a.id===session.meta.managedAgentId&&a.sessionId===session.id)
 const defaults=cloud.data?.ownerSubject===session.ownerSubject?cloud.data:undefined
 const provider=managed?runtime?.config.provider:remote?session.provider:defaults&&defaults.revision>0?defaults.provider:session.provider
 const model=managed?runtime?.config.model:remote?session.model:defaults&&defaults.revision>0?defaults.model:session.model
 const key=keys.data?.ownerSubject===session.ownerSubject?keys.data.keys.find(k=>k.provider===provider&&k.configured):undefined
 const oauth=provider==='openai-codex'&&keys.data?.oauth?.ownerSubject===session.ownerSubject?keys.data.oauth:undefined
 const oauthState=oauth?.configured?oauth.state==='reauthorize'?'OAuth reauthorization required':oauth.grants?.some(g=>g.id===session.terminalConnectionId)?'OAuth · granted to this agent':'OAuth · not granted to this agent':'No saved OAuth connection'
 const granted=Boolean(key?.grants.some(g=>g.type==='terminal'&&g.id===session.terminalConnectionId))
 const keyState=!provider?'Provider not reported':keys.isError||keys.isPending||keys.data?.ownerSubject!==session.ownerSubject?'Key metadata unavailable':remote?(key?granted?'Saved key · granted to this agent':'Saved key · not granted to this agent':'No saved key for this provider'):cloud.isError||!defaults?'Cloud key status unavailable':defaults.revision===0?'Server/provider defaults; key status not reported':defaults.apiKeyConfigured?'Cloud API key configured':'No account cloud API key configured'
 return <section className="bot-settings-fields" aria-label="AI configuration">
 <p className="text-sm text-muted">{managed?'Requested managed configuration; the runtime may still be reconciling. Changes require explicit configuration and may stop the agent.':remote?'Last reported model from the linked Pi session. Change its provider and model in Pi; Rue does not replace its local credentials.':'Cloud model settings are shared across your cloud bots. Changing them is not a per-bot override.'}</p>
 {(managed&&agents.isPending)||(!remote&&cloud.isPending)?<p role="status">Loading AI settings…</p>:<Facts rows={[
 ['Provider',provider??'Not reported'],['Model',model??'Not reported'],['Agent',remote?'Pi':defaults&&defaults.revision>0?defaults.harness:session.agent??'Server default'],
 ...(runtime?[['Tool permissions',runtime.config.permission],['Desired state',runtime.desired],['Revision',String(runtime.revision)],['Observed revision',runtime.observedRevision===null?'Not reported':String(runtime.observedRevision)]] as Array<[string,string]>:[]),['Keys',provider==='openai-codex'&&!keys.isError&&!keys.isPending?oauthState:keyState]
 ]}/>}
 {((managed&&(agents.isError||(!agents.isPending&&!runtime)))||(!remote&&(cloud.isError||(!cloud.isPending&&!defaults))))&&<p role="alert">AI configuration is unavailable. Last-known values are not proof of the current runtime configuration.</p>}
 <p className="text-sm text-muted">A saved key or grant does not confirm provider entitlement or available quota. Local Pi credentials may be separate.</p>
 {(provider==='openai'||provider==='openai-codex')&&<p className="text-sm text-muted">Codex OAuth is separate from an OpenAI API key. Select OpenAI Codex in Add new key to sign in; never paste an OAuth token into an API-key field. Managed access requires an updated host and a separate agent grant.</p>}
 <Button type="button" variant="secondary" onClick={()=>manage('AI keys')}>Manage AI keys</Button>
 <Button type="button" variant="ghost" onClick={()=>manage(remote?'Agents':'Models')}>{remote?'Manage agent':'Cloud model settings'}</Button>
 </section>
}
