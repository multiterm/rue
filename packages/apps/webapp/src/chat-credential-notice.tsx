import {useContext,useEffect,useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {Button,Dialog} from '@multiterm/rue-ui'
import type {RueSession,RueRemoteComputer} from '@multiterm/rue-sdk'
import {rue} from './client'
import {LiveSyncContext} from './live-sync'
import {checkManagedPromptCredentials,ManagedPromptSetupError} from './managed-prompt-preflight'
import {attentionProblems,setupHelp} from './agent-setup-help'
import {useRemoteFreshness} from './use-remote-freshness'

/** Advisory only: pending setup/checks are not errors, and guides never mutate an agent. */
export function ChatCredentialNotice({session,owner,computer,observedAt,healthError=false,openAIKeys,openAgentStatus,openExpiredRequests,refreshConnection}:{session:RueSession;owner:string;computer?:RueRemoteComputer;observedAt?:number;healthError?:boolean;openAIKeys():void;openAgentStatus?():void;openExpiredRequests?():void;refreshConnection?():Promise<unknown>}){
 const live=useContext(LiveSyncContext),[tutorial,setTutorial]=useState<string>(),[checking,setChecking]=useState(false)
 const managed=Boolean(session.meta.managedAgentId),owned=session.ownerSubject===owner
 const access=useQuery({
  queryKey:['chat-credential-access',owner,session.id,session.meta.managedAgentId,session.terminalConnectionId??session.meta.terminalConnectionId],
  enabled:managed&&owned,
  queryFn:async({signal})=>{
   try{await checkManagedPromptCredentials(rue,session,owner,()=>!signal.aborted);return null}
   catch(error){if(signal.aborted)throw error;return {code:error instanceof ManagedPromptSetupError?error.code:'check_failed'}}
  },
  retry:false,refetchInterval:live?10000:5000,
 })
 const expected=session.terminalConnectionId??session.meta.terminalConnectionId
 const bound=computer?.ownerSubject===owner&&computer.sessionId===session.id&&(!expected||computer.id===expected)?computer:undefined
 const fresh=useRemoteFreshness(bound,observedAt)
 const remote=Boolean(expected||bound)
 const setupCode=managed?(access.isError?'check_failed':access.data?.code):undefined
 const codes=attentionProblems(remote?bound:undefined,fresh,remote&&healthError,setupCode,managed&&access.isPending)
 const issueKey=codes.join(','),guide=setupHelp(tutorial)
 useEffect(()=>{if(tutorial&&!codes.includes(tutorial))setTutorial(undefined)},[issueKey,tutorial])
 async function checkAgain(){setChecking(true);try{await Promise.all([...(managed?[access.refetch()]:[]),...(refreshConnection?[refreshConnection()]:[])])}finally{setChecking(false)}}
 if(!owned||!codes.length)return null
 return <><section aria-label="Bot setup needs attention" role="status" className="message-row system"><div className="message-with-actions"><div className="message-bubble">
  <header className="message-header"><strong className="message-title">Bot setup needs attention</strong></header><div className="grid gap-2">
  {codes.map(code=>{const help=setupHelp(code)!;return <div key={code} className="grid gap-2"><p className="m-0">{help.summary}</p><Button type="button" variant="outline" onClick={()=>setTutorial(code)}>{help.title}</Button></div>})}
  <p className="m-0 text-xs text-muted">Your draft stays here. These instructions do not send, restart or retry anything.</p>
  <Button type="button" variant="ghost" disabled={checking||access.isFetching} onClick={()=>void checkAgain().catch(()=>{})}>{checking||access.isFetching?'Checking status…':'Check again'}</Button>
 </div></div></div></section>
 <Dialog open={Boolean(guide)&&codes.includes(tutorial??'')} title={guide?.title??'Troubleshooting'} onClose={()=>setTutorial(undefined)}><div className="grid gap-4">
 <ol className="list-decimal pl-5 space-y-3">{guide?.steps.map(step=><li key={step}>{step}</li>)}</ol>
 {guide?.action==='keys'?<Button type="button" onClick={()=>{setTutorial(undefined);openAIKeys()}}>Open AI keys</Button>:guide?.action==='queue'&&openExpiredRequests?<Button type="button" onClick={()=>{setTutorial(undefined);openExpiredRequests()}}>Open Expired Requests</Button>:openAgentStatus&&<Button type="button" onClick={()=>{setTutorial(undefined);openAgentStatus()}}>Open Agent status</Button>}
 <Button type="button" variant="ghost" onClick={()=>setTutorial(undefined)}>Done</Button>
 </div></Dialog></>
}
