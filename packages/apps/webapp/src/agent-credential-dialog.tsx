import {useEffect,useRef,useState} from 'react'
import {Button,Checkbox,Dialog,Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@multiterm/rue-ui'
import type {RueManagedAgent,RueProviderKeys} from '@multiterm/rue-sdk'
import {rue} from './client'
import {providerName} from './provider-name'
import {ProviderKeyDialog} from './provider-keys'
export function AgentCredentialDialog({owner,agent,credentials,close,updated,onBusy,codexSupported=false}:{owner:string;agent:RueManagedAgent;credentials:RueProviderKeys;codexSupported?:boolean;close():void;updated(value:RueProviderKeys):void;onBusy(value:boolean):void}){
 const [selection,setSelection]=useState<string>(credentials.keys.some(k=>k.provider===agent.config.provider&&k.configured)?agent.config.provider:agent.config.provider==='openai-codex'&&credentials.oauth?.configured?'openai-codex':''),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[editing,setEditing]=useState(false)
 const locked=useRef(false),mounted=useRef(true),[original]=useState(agent)
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
 useEffect(()=>{onBusy(busy);return()=>onBusy(false)},[busy,onBusy])
 const key=credentials.keys.find(k=>k.provider===selection&&k.configured),oauth=selection==='openai-codex'?credentials.oauth:undefined
 const editingProvider=oauth?'openai-codex':key?.provider??agent.config.provider
 const granted=Boolean((key?.grants??oauth?.grants)?.some(g=>g.type==='terminal'&&g.id===agent.connectionId))
 const oauthReady=Boolean(oauth?.configured&&oauth.ownerSubject===owner&&oauth.runtimeSupported&&oauth.state==='ready'&&codexSupported)
 const compatible=Boolean((key&&key.provider===agent.config.provider)||(oauthReady&&agent.config.provider==='openai-codex')),changed=original.revision!==agent.revision||original.connectionId!==agent.connectionId
 const allowed=credentials.ownerSubject===owner&&credentials.keyStorageAvailable&&compatible&&agent.connectionId&&!changed
 async function apply(){
  if(!allowed||(!key&&!oauth)||(!granted&&!ack)||locked.current)return
  if(granted){close();return}
  locked.current=true;setBusy(true);setError('')
  let timer:ReturnType<typeof setTimeout>|undefined
  try{const input={expectedOwnerSubject:owner,expectedRevision:(key??oauth)!.revision,target:{type:'terminal' as const,id:agent.connectionId!},enabled:true,acknowledgeExposure:true as const};const request=oauth?rue.grantCodexOAuth(input).then(value=>{if(value.ownerSubject!==owner)throw Error();return {...credentials,oauth:value}}):rue.grantProviderKey(key!.provider,input);const result=await Promise.race([request,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('uncertain')),10000)})]);if(result.ownerSubject!==owner)throw Error();updated(result);if(mounted.current)close()}
  catch{if(mounted.current)setError('Credential selection was not confirmed. Close and refresh agent state before trying again.')}
  finally{clearTimeout(timer);locked.current=false;if(mounted.current)setBusy(false)}
 }
 if(editing)return <ProviderKeyDialog agentMode owner={owner} initialProvider={editingProvider} keys={credentials.keys} close={close} updated={updated}/>
 return <Dialog open title="Update AI key" onClose={()=>{if(!busy)close()}}><div className="grid gap-4">
 <Select value={selection} disabled={busy} onValueChange={value=>{setSelection(value);setAck(false);setError('')}}><SelectTrigger aria-label="Saved credential"><SelectValue placeholder="Choose a saved credential"/></SelectTrigger><SelectContent>
 {credentials.keys.filter(k=>k.configured).map(k=><SelectItem key={k.provider} value={k.provider}>{providerName(k.provider)} · API key</SelectItem>)}
 {credentials.oauth?.configured&&<SelectItem value="openai-codex">OpenAI Codex · OAuth</SelectItem>}
 </SelectContent></Select>
 {!credentials.keys.some(k=>k.configured)&&!credentials.oauth?.configured&&<p className="text-sm text-muted">No saved credentials.</p>}
 {oauth&&!oauthReady?<p role="status" className="text-sm text-muted">{oauth.state==='reauthorize'?'This OAuth connection needs a new sign-in.':oauth.state==='refreshing'?'OAuth refresh is in progress. Refresh agent state shortly.':'Update this host to an OAuth-capable runtime.'}</p>:(key||oauth)&&!compatible?<p role="status" className="text-sm text-muted">Change this agent’s provider/model to {selection} before using this credential.</p>:granted?<p role="status" className="text-sm text-muted">This saved credential is already shared with this agent.</p>:compatible?<label className="flex items-start gap-2 text-sm"><Checkbox checked={ack} disabled={busy} onCheckedChange={value=>setAck(value===true)}/>{oauth?'Allow this agent to receive OAuth access tokens. Refresh tokens stay on the server.':'Allow this agent to use this saved API key.'}</label>:null}
 {changed&&<p role="alert">Agent configuration changed. Reopen this dialog.</p>}{error&&<p role="alert">{error}</p>}
 <Button type="button" disabled={busy||!allowed||(!granted&&!ack)||Boolean(error)} onClick={()=>void apply()}>{busy?'Applying…':granted?'Done':'Use selected credential'}</Button>
 <Button type="button" variant="outline" disabled={busy} onClick={()=>setEditing(true)}>{editingProvider==='openai-codex'?'Connect or reconnect OAuth':'Add or replace saved API key'}</Button>
 <Button type="button" variant="ghost" disabled={busy} onClick={close}>Cancel</Button>
 </div></Dialog>
}
