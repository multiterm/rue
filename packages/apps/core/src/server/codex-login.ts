import type {Database} from 'better-sqlite3'
import {startCodexDevice,pollCodexDevice,CODEX_VERIFICATION_URL,type CodexDevice} from '../provider/codex-oauth.js'
import {decryptCredential,encryptCredential} from '../storage/agent-settings.js'
import {OAuthVaultError,providerOAuthMetadata,saveProviderOAuth} from '../storage/provider-oauth.js'
type Status='starting'|'pending'|'authorizing'|'review'|'complete'|'cancelled'|'expired'|'failed'
type Intent={owner_subject:string;id:string;expected_revision:number;status:Status;created_at:number;expires_at:number}
type Pending={abort:AbortController;timer?:ReturnType<typeof setTimeout>;device?:CodexDevice;nextPoll:number;encrypted?:string;accountId?:string}
export type CodexLoginProvider={start:typeof startCodexDevice;poll:typeof pollCodexDevice}
const active=(status:Status)=>['starting','pending','authorizing','review'].includes(status)
/** One coordinated core, bounded ephemeral login state, durable idempotency fence.
 * After restart a pending login fails closed; uncertain exchanges are never replayed. */
export class CodexLogin {
 private pending=new Map<string,Pending>()
 constructor(private provider:CodexLoginProvider={start:startCodexDevice,poll:pollCodexDevice}){}
 private key(owner:string,id:string){return JSON.stringify([owner,id])}
 private row(db:Database,owner:string,id:string){return db.prepare('SELECT * FROM oauth_login_intents WHERE owner_subject=? AND id=?').get(owner,id) as Intent|undefined}
 private discard(owner:string,id:string){const key=this.key(owner,id),flow=this.pending.get(key);clearTimeout(flow?.timer);flow?.abort.abort();this.pending.delete(key)}
 private set(db:Database,owner:string,id:string,status:Status){db.prepare('UPDATE oauth_login_intents SET status=? WHERE owner_subject=? AND id=?').run(status,owner,id)}
 private cleanup(db:Database){
  const expired=db.prepare("SELECT * FROM oauth_login_intents WHERE expires_at<=? AND status IN ('starting','pending','authorizing','review')").all(Date.now()) as Intent[]
  for(const intent of expired){this.set(db,intent.owner_subject,intent.id,'expired');this.discard(intent.owner_subject,intent.id)}
  db.prepare('DELETE FROM oauth_login_intents WHERE created_at<?').run(Date.now()-86400000)
 }
 status(db:Database,owner:string,id:string){
  this.cleanup(db);const intent=this.row(db,owner,id);if(!intent)throw new OAuthVaultError(404,'oauth_login_not_found')
  const flow=this.pending.get(this.key(owner,id))
  if(active(intent.status)&&!flow){this.set(db,owner,id,'failed');intent.status='failed'}
  return {id,provider:'openai-codex' as const,status:intent.status,expiresAt:intent.expires_at,pollAfterMs:flow?.device?.intervalMs??5000,
   ...(intent.status==='pending'&&flow?.device?{userCode:flow.device.userCode,verificationUri:CODEX_VERIFICATION_URL}:{}),
   ...(intent.status==='review'&&flow?.accountId?{accountId:flow.accountId}:{})}
 }
 private valid(db:Database,owner:string,id:string,flow:Pending){const intent=this.row(db,owner,id);return !flow.abort.signal.aborted&&this.pending.get(this.key(owner,id))===flow&&intent&&active(intent.status)&&intent.expires_at>Date.now()}
 async start(db:Database,owner:string,id:string,expectedRevision:number){
  this.cleanup(db)
  const prior=this.row(db,owner,id)
  if(prior){if(prior.status!=='cancelled'&&prior.expected_revision!==expectedRevision)throw new OAuthVaultError(409,'oauth_login_changed');return this.status(db,owner,id)}
  const metadata=providerOAuthMetadata(db,owner)
  if(!metadata.keyStorageAvailable)throw new OAuthVaultError(503,'oauth_storage_unavailable')
  if(metadata.revision!==expectedRevision)throw new OAuthVaultError(409,'oauth_credential_changed')
  db.transaction(()=>{
   const recent=db.prepare('SELECT COUNT(*) AS n FROM oauth_login_intents WHERE owner_subject=? AND created_at>?').get(owner,Date.now()-3600000) as {n:number}
   const running=db.prepare("SELECT COUNT(*) AS n FROM oauth_login_intents WHERE status IN ('starting','pending','authorizing','review')").get() as {n:number}
   if(recent.n>=5||running.n>=128)throw new OAuthVaultError(409,'oauth_login_limit')
   db.prepare("INSERT INTO oauth_login_intents VALUES(?,?,?,'starting',?,?)").run(owner,id,expectedRevision,Date.now(),Date.now()+15*60000)
  }).immediate()
  const flow:Pending={abort:new AbortController(),nextPoll:0};this.pending.set(this.key(owner,id),flow)
  flow.timer=setTimeout(()=>this.discard(owner,id),Math.max(1,this.row(db,owner,id)!.expires_at-Date.now()));flow.timer.unref()
  try{
   const signal=AbortSignal.any([flow.abort.signal,AbortSignal.timeout(10000)])
   const device=await this.provider.start(signal)
   if(signal.aborted||!this.valid(db,owner,id,flow))throw Error()
   flow.device=device;flow.nextPoll=Date.now()+device.intervalMs;this.set(db,owner,id,'pending')
  }catch{if(this.valid(db,owner,id,flow)){this.set(db,owner,id,'failed');this.discard(owner,id)}}
  return this.status(db,owner,id)
 }
 async poll(db:Database,owner:string,id:string){
  const state=this.status(db,owner,id),flow=this.pending.get(this.key(owner,id))
  if(state.status!=='pending'||!flow?.device||flow.nextPoll>Date.now())return state
  this.set(db,owner,id,'authorizing')
  try{
   const signal=AbortSignal.any([flow.abort.signal,AbortSignal.timeout(10000)])
   const result=await this.provider.poll(flow.device,signal)
   if(signal.aborted||!this.valid(db,owner,id,flow))throw Error()
   if(result.status==='review'){
    flow.encrypted=encryptCredential(db,[owner,'oauth-login',id],JSON.stringify(result.credential));flow.accountId=result.credential.accountId
    this.set(db,owner,id,'review')
   }else{
    if(result.status==='slow_down')flow.device.intervalMs=Math.min(60000,flow.device.intervalMs+5000)
    flow.nextPoll=Date.now()+flow.device.intervalMs;this.set(db,owner,id,'pending')
   }
  }catch{if(this.valid(db,owner,id,flow)){this.set(db,owner,id,'failed');this.discard(owner,id)}}
  return this.status(db,owner,id)
 }
 confirm(db:Database,owner:string,id:string){
  const state=this.status(db,owner,id),flow=this.pending.get(this.key(owner,id))
  if(state.status==='complete')return state
  if(state.status!=='review'||!flow?.encrypted)throw new OAuthVaultError(409,'oauth_login_not_ready')
  try{
   db.transaction(()=>{
    const intent=this.row(db,owner,id)!
    if(!this.valid(db,owner,id,flow))throw new OAuthVaultError(409,'oauth_login_expired')
    const credential=JSON.parse(decryptCredential(db,[owner,'oauth-login',id],flow.encrypted!))
    if(credential.expires<=Date.now()+60000)throw new OAuthVaultError(409,'oauth_login_expired')
    saveProviderOAuth(db,owner,intent.expected_revision,credential);this.set(db,owner,id,'complete')
   }).immediate()
  }catch{this.set(db,owner,id,'failed');this.discard(owner,id);throw new OAuthVaultError(409,'oauth_login_changed')}
  this.discard(owner,id);return this.status(db,owner,id)
 }
 cancel(db:Database,owner:string,id:string){
  this.cleanup(db);const intent=this.row(db,owner,id)
  if(!intent){
   const recent=db.prepare('SELECT COUNT(*) AS n FROM oauth_login_intents WHERE owner_subject=? AND created_at>?').get(owner,Date.now()-3600000) as {n:number}
   if(recent.n>=5)throw new OAuthVaultError(409,'oauth_login_limit')
   db.prepare("INSERT INTO oauth_login_intents VALUES(?,?,-1,'cancelled',?,?)").run(owner,id,Date.now(),Date.now()+15*60000)
  }
  else if(active(intent.status))this.set(db,owner,id,'cancelled')
  this.discard(owner,id);return this.status(db,owner,id)
 }
}
