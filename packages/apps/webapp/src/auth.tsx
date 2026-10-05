import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react'
import {loadKeyname,type KeynameBrowserClient,type KeynameUser} from '@multiterm/rue-auth'
import {app} from './app'
import {rememberedAuthStore} from './remembered-auth'
type Status='loading'|'authenticated'|'anonymous'|'error'
interface AuthState{status:Status;user:KeynameUser|null;error:string;signIn(mode?:'modal'|'redirect'):Promise<void>;acceptAccessToken(token:string,user:{subject:string;userEmail?:string}):void;signOut():Promise<void>}
const Context=createContext<AuthState|null>(null)
let activeClient:KeynameBrowserClient|undefined
let credentialToken:string|undefined
let signedOut=false
export async function keynameAccessToken(){return signedOut?null:credentialToken??activeClient?.getAccessToken({minValidityMs:60_000})??null}
export function KeynameProvider({children}:{children:ReactNode}){
 const [status,setStatus]=useState<Status>('loading'),[user,setUser]=useState<KeynameUser|null>(null),[error,setError]=useState('')
 const generation=useRef(0),checking=useRef(false),requested=useRef(false),blocked=useRef(false),alive=useRef(false),authenticated=useRef(false)
 const store=useRef(rememberedAuthStore(app.urls.keynameApi)).current
 const clear=useCallback(()=>{generation.current++;blocked.current=true;signedOut=true;credentialToken=undefined;store.clear();authenticated.current=false;setUser(null);setStatus('anonymous');setError('')},[store])
 const sync=useCallback(async(client?:KeynameBrowserClient):Promise<void>=>{
  if(blocked.current)return
  if(checking.current){requested.current=true;return}
  checking.current=true
  const version=generation.current
  try{
   let next:KeynameUser|null=null
   if(credentialToken){
    const response=await fetch(`${app.urls.keynameApi.replace(/\/$/,'')}/v1/auth/session`,{headers:{authorization:`Bearer ${credentialToken}`},cache:'no-store',signal:AbortSignal.timeout(10000)})
    if(response.status===401||response.status===403){if(alive.current&&version===generation.current)clear();return}
    if(!response.ok)throw Error('Session check failed')
    const data=await response.json();next=data.session
    if(!next||typeof next.subject!=='string'||next.principalType!=='user')throw Error('Invalid session response')
   }else if(client){
    await client.getAccessToken({minValidityMs:60_000})
    const verified=client.session?await client.session():undefined
    next=verified&&!verified.authenticated?null:await client.currentUser()
   }else return
   if(!alive.current||version!==generation.current)return
   if(!next){clear();return}
   if(credentialToken)store.save({kind:'credential',tokens:{token:credentialToken,record:next}})
   else{const tokens=store.sdk();if(tokens?.record?.subject===next.subject)store.save({kind:'keyname',tokens})}
   authenticated.current=true;setUser(next);setStatus('authenticated');setError('')
  }catch{
   if(alive.current&&version===generation.current){setError('Could not verify your saved session. Check your connection and try again.');if(!authenticated.current)setStatus('error')}
  }finally{checking.current=false;if(requested.current&&alive.current){requested.current=false;void sync(activeClient)}}
 },[clear,store])
 useEffect(()=>{
  alive.current=true
  let disposed=false,unsubscribe=()=>{}
  const remembered=store.read()??store.legacyCredential()
  if(remembered)signedOut=false
  if(remembered?.kind==='credential'){credentialToken=remembered.tokens.token;void sync()}
  else if(remembered)store.restoreSdk(remembered)
  loadKeyname(app.urls.keynameApi).then(async client=>{
   if(disposed)return
   activeClient=client
   unsubscribe=client.onAuthChange(event=>{
    if(disposed||credentialToken)return
    if(blocked.current){store.clearSdk();return}
    if(!event.authenticated&&!event.error){clear();return}
    void sync(client)
   })
   await client.ready
   if(!disposed&&!credentialToken)await sync(client)
  }).catch(()=>{if(!disposed&&!credentialToken){setError('Could not connect to Keyname. Your saved session has not been removed.');setStatus('error')}})
  const resume=()=>{if(document.visibilityState!=='hidden')void sync(activeClient)}
  const changed=(event:StorageEvent)=>{if(event.key===store.key&&event.newValue===null){clear();void activeClient?.signOut().catch(()=>{})}}
  window.addEventListener('pageshow',resume);window.addEventListener('online',resume);document.addEventListener('visibilitychange',resume);window.addEventListener('storage',changed)
  return()=>{disposed=true;alive.current=false;generation.current++;unsubscribe();window.removeEventListener('pageshow',resume);window.removeEventListener('online',resume);document.removeEventListener('visibilitychange',resume);window.removeEventListener('storage',changed)}
 },[clear,store,sync])
 const signIn=async(mode:'modal'|'redirect'='modal')=>{
  setError('')
  try{
   const client=activeClient??await loadKeyname(app.urls.keynameApi);activeClient=client;await client.ready
   blocked.current=false;signedOut=false;generation.current++
   const tokens=await client.signIn({mode,callbackUri:`${app.urls.webapp}/login`})
   if(mode==='modal'&&tokens){credentialToken=undefined;store.save({kind:'keyname',tokens});await sync(client)}
  }catch{setError('Could not complete Keyname sign-in. Please try again.')}
 }
 const acceptAccessToken=(token:string,next:{subject:string;userEmail?:string})=>{
  generation.current++;blocked.current=false;signedOut=false;credentialToken=token
  const record:KeynameUser={subject:next.subject,userEmail:next.userEmail??'',principalType:'user'}
  store.save({kind:'credential',tokens:{token,record}})
  authenticated.current=true;setUser(record);setStatus('authenticated');setError('')
 }
 const signOut=async()=>{
  const token=credentialToken;clear()
  if(token)await fetch(`${app.urls.keynameApi.replace(/\/$/,'')}/v1/auth/signout`,{method:'POST',headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)}).catch(()=>{})
  await activeClient?.signOut().catch(()=>{})
 }
 return <Context.Provider value={{status,user,error,signIn,acceptAccessToken,signOut}}>{children}</Context.Provider>
}
export function useKeyname(){const value=useContext(Context);if(!value)throw new Error('useKeyname must be used inside KeynameProvider');return value}
