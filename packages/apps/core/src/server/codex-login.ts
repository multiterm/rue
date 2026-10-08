import {startCodexDevice,pollCodexDevice,CODEX_VERIFICATION_URL,type CodexDevice} from '../provider/codex-oauth.js'
import {PostgresOAuthError as OAuthVaultError,activeOAuthLoginStatuses as active,type OAuthLoginRepository,type OAuthLoginStatus} from '@multiterm/rue-db/postgres'
type Pending={abort:AbortController;timer?:ReturnType<typeof setTimeout>;device?:CodexDevice;nextPoll:number;encrypted?:string;accountId?:string}
export type CodexLoginProvider={start:typeof startCodexDevice;poll:typeof pollCodexDevice}
/** One coordinated core. Provider exchanges stay outside storage transactions;
 * durable compare-and-set transitions fence cancellation, expiry and retries. */
export class CodexLogin {
 private pending=new Map<string,Pending>()
 private starting=new Map<string,Promise<unknown>>()
 constructor(private provider:CodexLoginProvider={start:startCodexDevice,poll:pollCodexDevice}){}
 private key(owner:string,id:string){return JSON.stringify([owner,id])}
 private discard(owner:string,id:string){const key=this.key(owner,id),flow=this.pending.get(key);clearTimeout(flow?.timer);flow?.abort.abort();this.pending.delete(key)}
 private valid(owner:string,id:string,flow:Pending){return !flow.abort.signal.aborted&&this.pending.get(this.key(owner,id))===flow}
 async status(store:OAuthLoginRepository,owner:string,id:string):Promise<{id:string;provider:'openai-codex';status:OAuthLoginStatus;expiresAt:number;pollAfterMs:number;userCode?:string;verificationUri?:string;accountId?:string}>{
  const intent=await store.get(owner,id);if(!intent)throw new OAuthVaultError(404,'oauth_login_not_found')
  const flow=this.pending.get(this.key(owner,id))
  if(active.includes(intent.status)&&!flow){await store.transition(owner,id,active,'failed');return this.status(store,owner,id)}
  if(!active.includes(intent.status))this.discard(owner,id)
  return {id,provider:'openai-codex' as const,status:intent.status,expiresAt:intent.expiresAt,pollAfterMs:flow?.device?.intervalMs??5000,
   ...(intent.status==='pending'&&flow?.device?{userCode:flow.device.userCode,verificationUri:CODEX_VERIFICATION_URL}:{}),
   ...(intent.status==='review'&&flow?.accountId?{accountId:flow.accountId}:{})}
 }
 async start(store:OAuthLoginRepository,owner:string,id:string,expectedRevision:number):Promise<Awaited<ReturnType<CodexLogin['status']>>>{
  const key=this.key(owner,id),previous=this.starting.get(key)
  if(previous){await previous;return this.start(store,owner,id,expectedRevision)}
  const work=this.begin(store,owner,id,expectedRevision);this.starting.set(key,work)
  try{return await work}finally{if(this.starting.get(key)===work)this.starting.delete(key)}
 }
 private async begin(store:OAuthLoginRepository,owner:string,id:string,expectedRevision:number){
  const key=this.key(owner,id),existing=this.pending.get(key),flow=existing??{abort:new AbortController(),nextPoll:0} as Pending
  if(!existing)this.pending.set(key,flow)
  let reserved:Awaited<ReturnType<OAuthLoginRepository['reserve']>>
  try{reserved=await store.reserve(owner,id,expectedRevision)}catch(error){if(!existing)this.discard(owner,id);throw error}
  if(!reserved.created){if(!existing)this.discard(owner,id);return this.status(store,owner,id)}
  flow.timer=setTimeout(()=>this.discard(owner,id),Math.max(1,reserved.intent.expiresAt-Date.now()));flow.timer.unref()
  try{
   const signal=AbortSignal.any([flow.abort.signal,AbortSignal.timeout(10000)])
   const device=await this.provider.start(signal)
   if(signal.aborted||!this.valid(owner,id,flow))throw Error()
   flow.device=device;flow.nextPoll=Date.now()+device.intervalMs
   if(!await store.transition(owner,id,['starting'],'pending'))this.discard(owner,id)
  }catch{await store.transition(owner,id,['starting'],'failed');this.discard(owner,id)}
  return this.status(store,owner,id)
 }
 async poll(store:OAuthLoginRepository,owner:string,id:string){
  const state=await this.status(store,owner,id),flow=this.pending.get(this.key(owner,id))
  if(state.status!=='pending'||!flow?.device||flow.nextPoll>Date.now())return state
  if(!await store.transition(owner,id,['pending'],'authorizing'))return this.status(store,owner,id)
  try{
   const signal=AbortSignal.any([flow.abort.signal,AbortSignal.timeout(10000)])
   const result=await this.provider.poll(flow.device,signal)
   if(signal.aborted||!this.valid(owner,id,flow))throw Error()
   if(result.status==='review'){
    flow.encrypted=store.seal(owner,id,result.credential);flow.accountId=result.credential.accountId
    if(!await store.transition(owner,id,['authorizing'],'review'))this.discard(owner,id)
   }else{
    if(result.status==='slow_down')flow.device.intervalMs=Math.min(60000,flow.device.intervalMs+5000)
    flow.nextPoll=Date.now()+flow.device.intervalMs
    if(!await store.transition(owner,id,['authorizing'],'pending'))this.discard(owner,id)
   }
  }catch{await store.transition(owner,id,['authorizing'],'failed');this.discard(owner,id)}
  return this.status(store,owner,id)
 }
 async confirm(store:OAuthLoginRepository,owner:string,id:string){
  const state=await this.status(store,owner,id),flow=this.pending.get(this.key(owner,id))
  if(state.status==='complete')return state
  if(state.status!=='review'||!flow?.encrypted)throw new OAuthVaultError(409,'oauth_login_not_ready')
  try{await store.confirm(owner,id,flow.encrypted)}
  catch{await store.transition(owner,id,['review'],'failed');this.discard(owner,id);throw new OAuthVaultError(409,'oauth_login_changed')}
  this.discard(owner,id);return this.status(store,owner,id)
 }
 async cancel(store:OAuthLoginRepository,owner:string,id:string){
  await store.cancel(owner,id);this.discard(owner,id);return this.status(store,owner,id)
 }
}
