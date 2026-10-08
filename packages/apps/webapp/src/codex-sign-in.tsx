import {useEffect,useRef,useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {Button,Checkbox,Input} from '@multiterm/rue-ui'
import type {RueOAuthFlow} from '@multiterm/rue-sdk'
import {rue} from './client'
export function CodexSignIn({owner,connected}:{owner:string;connected():void}){
 const metadata=useQuery({queryKey:['provider-oauth',owner],queryFn:()=>rue.codexOAuth(),retry:false})
 const [flow,setFlow]=useState<RueOAuthFlow>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[storage,setStorage]=useState(false),[account,setAccount]=useState(false),[paused,setPaused]=useState(false)
 const intent=useRef<{requestId:string;expectedRevision:number}|undefined>(undefined),alive=useRef(true)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;if(intent.current)void rue.codexOAuthAction(intent.current.requestId,'cancel',owner).catch(()=>{})}},[owner])
 async function start(){
  if(busy||!storage||metadata.data?.ownerSubject!==owner||!metadata.data.keyStorageAvailable)return
  setBusy(true);setError('');setAccount(false)
  if(!intent.current||flow&&['failed','cancelled','expired'].includes(flow.status))intent.current={requestId:crypto.randomUUID(),expectedRevision:metadata.data.revision}
  try{const result=await rue.startCodexOAuth({expectedOwnerSubject:owner,...intent.current,acknowledgeStorage:true});if(alive.current){setFlow(result);setPaused(false)}}catch{if(alive.current)setError('Sign-in could not be started. Retrying uses the same request; no existing credential was changed.')}finally{if(alive.current)setBusy(false)}
 }
 useEffect(()=>{
  if(!flow||paused||!['starting','pending','authorizing'].includes(flow.status))return
  let stopped=false
  const timer=setTimeout(()=>{void rue.codexOAuthAction(flow.id,'poll',owner).then(result=>{if(!stopped&&alive.current)setFlow(result)}).catch(()=>{if(!stopped&&alive.current){setError('Could not check sign-in. Resume checking without starting another login.');setPaused(true)}})},Math.max(1000,Math.min(flow.pollAfterMs,60000)))
  return()=>{stopped=true;clearTimeout(timer)}
 },[flow,paused,owner])
 async function confirm(){if(!flow||!account||busy)return;setBusy(true);setError('');try{const result=await rue.codexOAuthAction(flow.id,'confirm',owner);if(alive.current){setFlow(result);if(result.status==='complete')connected()}}catch{if(alive.current)setError('Could not confirm this connection. Check sign-in status before starting another login.')}finally{if(alive.current)setBusy(false)}}
 async function check(){if(!intent.current)return;setError('');try{const result=await rue.codexOAuthFlow(intent.current.requestId);if(alive.current){setFlow(result);setPaused(false);if(result.status==='complete')connected()}}catch{if(alive.current)setError('Sign-in status is unavailable. Close this dialog to cancel, then review connections before trying again.')}}
 const terminal=flow&&['failed','cancelled','expired'].includes(flow.status)
 const verifiedLink=flow?.verificationUri==='https://auth.openai.com/codex/device'&&flow.userCode&&/^[A-Za-z0-9-]{1,64}$/.test(flow.userCode)
 return <div className="grid gap-4" aria-label="Codex OAuth sign-in">
 <p className="text-sm text-muted">Codex requires OpenAI OAuth, not an API key. Sign in to OpenAI using a one-time code. Rue keeps access and refresh tokens encrypted on the server; this does not copy your local Pi login.</p>
 <p className="text-sm text-muted">Connecting does not change a bot, grant agent access or test quota. Choose a Codex model on an updated host, then grant this OAuth connection to that agent.</p>
 {metadata.isPending&&<p role="status">Checking OAuth storage…</p>}
 {(metadata.isError||metadata.data&&metadata.data.ownerSubject!==owner)&&<p role="alert">OAuth connection settings are unavailable.</p>}
 {metadata.data&&!metadata.data.keyStorageAvailable&&<p role="alert">Secure OAuth storage is unavailable.</p>}
 {(!flow||terminal)&&<><label className="flex items-start gap-2 text-sm"><Checkbox checked={storage} disabled={busy} onCheckedChange={value=>setStorage(value===true)}/>Authorize Rue to store this Codex connection. Reconnecting clears previous Codex grants.</label><Button type="button" disabled={busy||!storage||metadata.isError||metadata.data?.ownerSubject!==owner||!metadata.data?.keyStorageAvailable} isLoading={busy} onClick={()=>void start()}>{terminal?'Start a new sign-in':'Sign in with OpenAI'}</Button></>}
 {terminal&&<p role="status">Sign-in {flow.status}. No connection was saved by this attempt.</p>}
 {verifiedLink&&flow?.status==='pending'&&<><Input label="OpenAI one-time code" readOnly value={flow.userCode} autoComplete="off" show={{label:true,hideRequireType:true}}/><a className="settings-link-card" href="https://auth.openai.com/codex/device" target="_blank" rel="noopener noreferrer">Open OpenAI to authorize ↗</a><p className="text-sm text-muted">Enter this code only on OpenAI’s website. Expires {new Date(flow.expiresAt).toLocaleTimeString()}.</p></>}
 {flow&&['starting','pending','authorizing'].includes(flow.status)&&<p role="status">Waiting for OpenAI authorization…</p>}
 {flow?.status==='review'&&<><p>OpenAI account: <code className="break-all">{flow.accountId}</code></p><label className="flex items-start gap-2 text-sm"><Checkbox checked={account} disabled={busy} onCheckedChange={value=>setAccount(value===true)}/>I confirm this is the OpenAI account I intend to connect. Save its OAuth credentials and clear any previous Codex grants.</label><Button type="button" disabled={!account||busy} isLoading={busy} onClick={()=>void confirm()}>Save Codex connection</Button></>}
 {flow?.status==='complete'&&<p role="status">Codex connected. No agent access was granted.</p>}
 {error&&<p role="alert">{error}</p>}{(paused||error&&intent.current)&&<Button type="button" variant="ghost" onClick={()=>void check()}>Check sign-in status</Button>}
 </div>
}
