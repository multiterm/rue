import {useState} from 'react'
import {AgentStatusEditor,type EditableAgentStatus} from './agent-status-editor'
import {useQuery} from '@tanstack/react-query'
import type {RueSession} from '@multiterm/rue-sdk'
import {Button,MenuSettingsIcon,Dialog,CopyButton} from '@multiterm/rue-ui'
import {rue} from './client'
import {useRemoteFreshness} from './use-remote-freshness'
import {SettingsHelp} from './settings-support'
import {agentDiagnostics} from './agent-diagnostics'
const count=(value:number|null|undefined)=>value==null?'Unknown':new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(value)
export function BotAgentStatus({session}:{session:RueSession}){
 const [editing,setEditing]=useState<EditableAgentStatus>(),[diagnostics,setDiagnostics]=useState<string>()
 const managed=Boolean(session.meta.managedAgentId)
 const agents=useQuery({queryKey:['managed-agents',session.ownerSubject],queryFn:()=>rue.managedAgents(),enabled:managed,retry:false,refetchInterval:5000})
 const agent=agents.data?.agents.find(a=>a.id===session.meta.managedAgentId&&a.sessionId===session.id)
 const editable=(label:string):label is EditableAgentStatus=>['Provider','Model','Thinking','Auto compaction'].includes(label)
 const query=useQuery({queryKey:['remote-computers',session.ownerSubject],queryFn:()=>rue.remoteComputers(),retry:false,refetchInterval:5000})
 const computer=query.data?.computers.find(c=>c.ownerSubject===session.ownerSubject&&c.sessionId===session.id),status=computer?.health?.status
 const fresh=useRemoteFreshness(computer,query.dataUpdatedAt)&&!query.isError&&computer?.status==='online'
 const rows:Array<[string,string]>=status?[
 ['State',status.state],['Directory',status.cwd||'Not reported'],['Branch',status.branch??'Not reported'],
 ['Provider',status.provider??'Not reported'],['Model',status.model??'Not reported'],['Thinking',status.thinking??'Not reported'],
 ['Context',`${status.context.percent==null?'Unknown':status.context.percent.toFixed(1)+'%'} / ${count(status.context.window)}`],
 ['Context tokens',count(status.context.tokens)],['Auto compaction',status.autoCompaction==null?'Not reported':status.autoCompaction?'On':'Off'],
 ['Input / output',`↑${count(status.usage.input)} ↓${count(status.usage.output)}`],['Cache read / write',`${count(status.usage.cacheRead)} / ${count(status.usage.cacheWrite)}`],
 ['Cache hit (last response)',status.cacheHitPercent==null?'Unknown':`${status.cacheHitPercent.toFixed(1)}%`],
 ['Reported model cost',`$${status.usage.costUsd.toFixed(3)}${status.subscription===true?' (subscription)':status.subscription===null?' (billing type unreported)':''}`],
 ]:[]
 rows.unshift(['Pi version',status?.piVersion??'Not reported'])
 return <section className="grid gap-3" aria-label="Pi agent status">
 <p role="status" className="text-sm text-muted">{query.isPending?'Loading Pi status…':status?(fresh?'Last reported':'Stale · last reported'):'Pi status not reported'}{status&&computer?.lastSeenAt?` · ${new Date(computer.lastSeenAt).toLocaleTimeString()}`:''}</p>
 {status?.context.percent!=null&&<progress className="bot-context-progress" aria-label="Context window used" max={100} value={Math.min(100,status.context.percent)}/>}
 <dl className="bot-settings-facts">{rows.map(([label,value])=><div key={label}><dt>{label}</dt><dd className="flex items-center justify-end gap-2 break-all"><span>{value}</span>{managed&&editable(label)&&<Button type="button" variant="ghost" size="icon" aria-label={`Edit ${label.toLowerCase()}`} title={`Edit ${label.toLowerCase()}`} disabled={!agent||agents.isError||agent.desired==='destroyed'} onClick={()=>setEditing(label)}><MenuSettingsIcon colorMode="stripped" size={16} className="size-4 shrink-0 fill-none stroke-current stroke-2" aria-hidden="true"/></Button>}</dd></div>)}</dl>
 {!status&&!query.isPending&&<p className="text-sm text-muted">For linked Pi, enable <code>/rue share-status</code>. Managed agents need an updated runtime.</p>}
 {query.isError&&<p role="alert">Status could not be refreshed.</p>}
 <Button type="button" variant="ghost" disabled={query.isFetching} onClick={()=>void query.refetch()}>Refresh status</Button>
 {agent&&agent.observedRevision!==agent.revision&&<p role="status" className="text-sm text-muted">Configuration requested · awaiting manager/runtime reconciliation. Values above are last reported.</p>}
 {editing&&agent&&<AgentStatusEditor key={`${agent.id}:${editing}`} agent={agent} owner={session.ownerSubject} field={editing} close={()=>setEditing(undefined)}/>}
 {!managed&&<p className="text-xs text-muted">Linked Pi upgrades are managed on the linked computer, not by Rue’s host manager.</p>}
 <Button type="button" variant="outline" onClick={()=>setDiagnostics(agentDiagnostics(session,computer,agent,Boolean(fresh),query.isError))}>View diagnostics</Button>
 <Dialog open={diagnostics!==undefined} title="Agent diagnostics" onClose={()=>setDiagnostics(undefined)}><div className="grid gap-3"><p className="text-sm text-muted">A snapshot of connection and runtime metadata. Excludes credentials, conversation contents, raw errors, names, directories and branch names. Review before sharing.</p><pre className="max-h-[50dvh] overflow-auto whitespace-pre-wrap break-all text-xs">{diagnostics}</pre><CopyButton text={diagnostics??''} label="Copy diagnostics"/></div></Dialog>
 <SettingsHelp section="agent-status"/>
 </section>
}
