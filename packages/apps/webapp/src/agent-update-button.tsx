import {useQuery} from '@tanstack/react-query'
import {rue} from './client'
import {AgentUpgrade} from './agent-upgrade'
export function AgentUpdateButton({owner,agentId,sessionId,connectionId,piVersion}:{owner:string;agentId:string;sessionId:string;connectionId?:string;piVersion?:string|null}){
 const agents=useQuery({queryKey:['managed-agents',owner],queryFn:()=>rue.managedAgents(),retry:false,refetchInterval:5000})
 const agent=agents.data?.agents.find(a=>a.id===agentId&&a.sessionId===sessionId)
 return agent?<AgentUpgrade key={`${owner}:${agent.id}`} owner={owner} agent={agent} piVersion={agent.connectionId===connectionId?piVersion:undefined}/>:null
}
