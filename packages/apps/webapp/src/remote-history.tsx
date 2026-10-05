import {useEffect,useRef,useState} from 'react'
import {useQuery,useQueryClient} from '@tanstack/react-query'
import {Button,Checkbox,Dialog} from '@multiterm/rue-ui'
import type {RueSession} from '@multiterm/rue-sdk'
import {rue} from './client'
import {SettingsHelp} from './settings-support'
export function RemoteHistory({session,mode,close,actions,newBot}:{session:RueSession;mode:'clear'|'delete';close():void;actions():void;newBot():void}){
 const managed=typeof session.meta.managedAgentId==='string',cache=useQueryClient()
 const agents=useQuery({queryKey:['managed-agents',session.ownerSubject],queryFn:()=>rue.managedAgents(),enabled:managed,retry:false,refetchInterval:3000})
 const hosts=useQuery({queryKey:['workers',session.ownerSubject],queryFn:()=>rue.workers(),enabled:managed,retry:false})
 const agent=agents.data?.agents.find(a=>a.id===session.meta.managedAgentId&&a.sessionId===session.id)
 const worker=hosts.data?.workers.find(w=>w.id===agent?.workerId&&w.ownerSubject===session.ownerSubject)
 const [busy,setBusy]=useState(false),[ack,setAck]=useState<number>(),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const locked=useRef(false),mounted=useRef(true),intents=useRef(new Map<string,{requestId:string;expectedRevision:number}>())
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
 async function change(action:'destroy'|'purge'){
  if(!agent||locked.current||agents.isError||ack!==agent.revision)return
  locked.current=true;setBusy(true);setError('')
  if(!intents.current.has(action))intents.current.set(action,{requestId:crypto.randomUUID(),expectedRevision:agent.revision})
  let timer:ReturnType<typeof setTimeout>|undefined
  try{await Promise.race([rue.changeManagedAgent(agent.id,{...intents.current.get(action)!,action,...(action==='purge'?{acknowledgePurge:true as const}:{})}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('uncertain')),10000)})]);intents.current.delete(action);if(mounted.current){setAck(undefined);setNotice(action==='destroy'?'Removal requested. History and workspace retained.':'Purge requested. Waiting for host confirmation.')}}
  catch{if(mounted.current)setError('Result unconfirmed. Refresh before retrying; this action keeps its original request ID.')}
  finally{clearTimeout(timer);locked.current=false;if(mounted.current)setBusy(false);void Promise.all(['managed-agents','managed-operations','remote-computers','sessions'].map(key=>cache.invalidateQueries({queryKey:[key]})))}
 }
 const purging=Boolean(agent?.purgeRequested),destroyed=agent?.desired==='destroyed'
 return <Dialog open title={mode==='clear'?'Clear history?':'Delete bot?'} onClose={()=>{if(!busy)close()}}><div className="grid gap-4">
 {mode==='clear'?<><p>Pi retains this conversation locally. Rue cannot safely reset that session or clear only its mirror.</p><Button onClick={()=>{close();newBot()}}>Start a new bot</Button>{managed&&<Button variant="outline" onClick={()=>{close();actions()}}>Review context compaction</Button>}<p className="text-xs text-muted">A new bot starts fresh and keeps this history. Compaction reduces context; it does not delete history.</p></>:managed?<>
 <p>Remove the runtime first. Permanently deleting the bot also purges its saved Pi history and private workspace. Host directories and backups are not deleted.</p>
 {!agent?<p role="status">{agents.isError?'Runtime information unavailable.':'Loading runtime…'}</p>:agent.purgedAt?<p role="status">Purge confirmed.</p>:purging?<p role="status">Purge pending host confirmation.</p>:<><label className="flex items-start gap-2 text-sm"><Checkbox checked={ack===agent.revision} disabled={busy||agents.isError} onCheckedChange={v=>setAck(v===true?agent.revision:undefined)}/>{destroyed?'Permanently delete this bot, Pi history and private workspace.':'Stop and remove this runtime; keep its history and workspace.'}</label><Button variant="destructive" disabled={busy||ack!==agent.revision||agents.isError||(destroyed&&!worker?.health?.capabilities.includes('managed-purge-v1'))} isLoading={busy} onClick={()=>void change(destroyed?'purge':'destroy')}>{destroyed?'Purge bot and private data':'Remove runtime'}</Button>{destroyed&&!worker?.health?.capabilities.includes('managed-purge-v1')&&<p role="status">A purge-capable host is required.</p>}</>}
 </>:<p>This is a linked Pi session, not a Rue-managed runtime. Deleting its Rue bot never deletes local Pi files. Revoke the link through Connection before deleting the Rue copy.</p>}
 {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}<Button variant="ghost" disabled={busy} onClick={close}>Keep history</Button><SettingsHelp section="history"/>
 </div></Dialog>
}
