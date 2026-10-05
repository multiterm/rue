import type { RueRemoteComputer, RueSession } from '@multiterm/rue-sdk'
import './bot-execution.css'
import {useQuery} from '@tanstack/react-query'
import {rue} from './client'
import {useRemoteFreshness} from './use-remote-freshness'
import {sidebarAgentActivity,hasAgentCredentialGrant} from './sidebar-agent-activity'
import {remoteSetupProblem} from './agent-setup-help'
import { RemoteComputerIcon, CloudIcon } from '@multiterm/rue-ui'

export const isRemoteBot = (session: RueSession) => Boolean(session.terminalConnectionId || session.agent === 'pi-terminal')
export function BotExecution({ session, computers, compact = false, observedAt, healthError=false, sending=false }: { session: RueSession; computers?: RueRemoteComputer[]; compact?: boolean; observedAt?:number; healthError?:boolean; sending?:boolean }) {
  const computer = computers?.find(c => c.sessionId === session.id && c.ownerSubject === session.ownerSubject)
  const remote = isRemoteBot(session) || Boolean(computer)
  const managed = Boolean(session.meta.managedAgentId)
  const agents=useQuery({queryKey:['managed-agents',session.ownerSubject],queryFn:()=>rue.managedAgents(),enabled:managed&&!compact,retry:false,refetchInterval:15000})
  const hosts=useQuery({queryKey:['workers',session.ownerSubject],queryFn:()=>rue.workers(),enabled:managed&&!compact,retry:false,refetchInterval:15000})
  const agent=agents.data?.agents.find(a=>a.id===session.meta.managedAgentId&&a.sessionId===session.id&&a.connectionId===computer?.id)
  const host=agent?hosts.data?.workers.find(w=>w.id===agent.workerId&&w.ownerSubject===session.ownerSubject):undefined
  const credentials=useQuery({queryKey:['provider-keys',session.ownerSubject],queryFn:()=>rue.providerKeys(),enabled:managed&&!compact,retry:false,refetchInterval:15000})
  const fresh=useRemoteFreshness(computer,observedAt)
  const activity=sidebarAgentActivity(computer,fresh,remote,sending,healthError)
  if(!compact){
    const location=remote?(managed?host?.name??'Host not reported':computer?.name??'Host not reported'):'Cloud'
    const queued=computer?.runs.some(run=>run.status==='queued'||run.status==='claimed')
    const setup=managed?(credentials.isError||agents.isError?'Status unavailable':!credentials.data||!agent?'Checking setup':agent.observed==='failed'||!hasAgentCredentialGrant(session.ownerSubject,agent.config.provider,agent.connectionId??'',credentials.data)?'Needs attention':undefined):undefined
    const state=activity??(remote?(healthError||!fresh?'Status unavailable':!computer?.remoteEnabled?'Prompts disabled':setup??(remoteSetupProblem(computer,fresh,false)?'Needs attention':queued?'Waiting for agent':computer.health?.status?.state==='idle'||computer.health?.agentWorking===false?'Ready for next request':'Status unavailable')):'Ready for next request')
    return <span className="sidebar-agent-summary"><span className={`bot-execution ${remote?'remote':'cloud'}`}>{remote?<RemoteComputerIcon size={13} aria-hidden="true"/>:<CloudIcon size={13} aria-hidden="true"/>}{location}</span><span className={`sidebar-agent-status${activity?' sidebar-agent-activity':''}`} aria-label={`Agent ${state.toLowerCase()}`}>{activity&&<span className="sidebar-activity-icon" aria-hidden="true"><i/><i/><i/></span>}{state}</span></span>
  }
  const label = remote ? `${managed ? 'Managed' : 'Remote'} · ${computer?.name ?? 'Paired computer'}${compact ? '' : ` · ${computer ? `${computer.status}${computer.remoteEnabled ? '' : ' · prompts disabled'}` : 'status unavailable'}`}` : 'Cloud · Rue server'
  return <span className={`bot-execution ${remote ? 'remote' : 'cloud'}`} title={managed ? 'This Pi session is supervised on an enrolled host, with its own persistent workspace and explicit AI-key grants. It never falls back to cloud execution.' : remote ? 'This bot runs in its paired Pi session, using that computer’s provider credentials and tool permissions. It never falls back to cloud execution.' : 'This bot runs on Rue’s server using your server-side Agent settings. It is not paired to a computer.'}>{remote ? <RemoteComputerIcon size={13} aria-hidden="true"/> : <CloudIcon size={13} aria-hidden="true"/>}{label}</span>
}
