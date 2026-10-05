import {useRef,useState} from 'react'
import {CLI_LOGIN_GRANTS,CLI_LOGIN_KEY_TTL_MS,parseCliLoginRequest,type RueApiKey,type CliLoginRequest} from '@multiterm/rue-sdk'
import {Button,FormContainer,Scrollbar} from '@multiterm/rue-ui'
import {useKeyname} from './auth'
import {rue} from './client'
import {app} from './app'
export function CliLogin(){
 const auth=useKeyname(),attempted=useRef(false),[busy,setBusy]=useState(false),[done,setDone]=useState(false),[error,setError]=useState('')
 const [request]=useState<CliLoginRequest|undefined>(()=>{try{if(window.top!==window.self)return undefined;return parseCliLoginRequest(window.location.hash,app.urls.api)}catch{return undefined}})
 async function approve(){
  if(!request||!auth.user||auth.status!=='authenticated'||attempted.current)return
  attempted.current=true;setBusy(true);setError('');let key:(RueApiKey&{token?:string})|undefined
  const subject=auth.user.subject
  try{
   if(request.expiresAt<=Date.now())throw Error('expired')
   const expiresAt=Date.now()+CLI_LOGIN_KEY_TTL_MS
   key=await rue.createApiKey({owner:{type:'self'},name:`Rue CLI ${request.requestId.slice(0,8)}`,grants:[...CLI_LOGIN_GRANTS],expiresAt,requestId:request.requestId})
   if(!key.token||key.owner.type!=='self'||key.owner.subject!==subject||key.service!=='rue'||key.expiresAt!==expiresAt||key.revokedAt!==null||JSON.stringify([...key.grants].sort())!==JSON.stringify([...CLI_LOGIN_GRANTS].sort())||request.expiresAt<=Date.now())throw Error('invalid')
   const response=await fetch(request.callback,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({state:request.state,token:key.token,subject,keyId:key.id}),credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(30000)})
   if(response.status!==204)throw Error('callback')
   setDone(true)
  }catch{
   // Never reissue after an ambiguous response. If issuance succeeded, revoke that
   // key on failed delivery. A lost acknowledgement may revoke a saved CLI key.
   if(key?.id)await rue.revokeApiKey(key.id).catch(()=>{})
   setError('Login was not confirmed. Review Rue Settings → API keys and revoke any unused “Rue CLI” key, then start a new CLI login. No request was automatically retried.')
  }finally{key=undefined;setBusy(false)}
 }
 return <Scrollbar className="auth-scroll"><main className="portal-login-page"><FormContainer compact title="Authorize Rue CLI" description="Approve only a login you started on this computer." footer={<a href="/">Return to Rue</a>}>
  {!request?<p role="alert">This login request is invalid or expired. Run rue auth login again.</p>:done?<p role="status">Approved. Check the terminal for confirmation. You can close this page.</p>:<div className="grid gap-4">
   <p>Compare this code with your terminal: <strong>{request.state.slice(0,8)}</strong></p>
   <p>API: {request.apiOrigin}</p>
   <p>This creates a one-hour personal key to view hosts and view, create, configure, start, stop or delete your agents. It does not authorize host enrollment, runtime deployment or platform administration. The CLI stores the key in this computer’s OS credential store, replacing its previous login for this API.</p>
   <p>Do not approve links sent by someone else. The browser must run on the same computer as the CLI. Your browser may ask permission to contact the local application.</p>
   {auth.status==='authenticated'&&auth.user?<><p>Signed in as {auth.user.userEmail||auth.user.subject}</p><Button disabled={busy||attempted.current} isLoading={busy} onClick={()=>void approve()}>Approve CLI login</Button></>:<Button disabled={auth.status==='loading'} onClick={()=>void auth.signIn('modal')}>Sign in with Keyname</Button>}
   {(error||auth.error)&&<p role="alert">{error||auth.error}</p>}
  </div>}
 </FormContainer></main></Scrollbar>
}
