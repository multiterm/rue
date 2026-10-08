import {randomUUID} from 'node:crypto'
import type {Database} from 'better-sqlite3'
import {z} from 'zod'
import {decryptCredential,encryptCredential,encryptionKey} from './agent-settings.js'

export const CODEX_PROVIDER='openai-codex' as const
const REFRESH_DEADLINE=6000,REFRESH_MARGIN=60000
const secret=z.string().min(1).max(16384).regex(/^[\x21-\x7e]+$/)
const credentialSchema=z.object({type:z.literal('oauth'),access:secret,refresh:secret,expires:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),accountId:z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)}).strict()
export type CodexCredential=z.infer<typeof credentialSchema>
export type OAuthRefresh=(credential:CodexCredential,signal:AbortSignal)=>Promise<unknown>
import {OAuthVaultError} from '@multiterm/rue-db'
export {OAuthVaultError}
type Row={encrypted_credential:string|null;revision:number;expires_at:number|null;state:'ready'|'refreshing'|'reauthorize'|'removed';refresh_nonce:string|null;refresh_started_at:number|null}
const row=(db:Database,owner:string)=>db.prepare('SELECT * FROM provider_oauth_credentials WHERE owner_subject=? AND provider=?').get(owner,CODEX_PROVIDER) as Row|undefined
const scope=(owner:string)=>[owner,'provider-oauth',CODEX_PROVIDER]
function audit(db:Database,owner:string,action:string,id?:string){db.prepare('INSERT INTO provider_key_audit VALUES(?,?,?,?,?,?,?)').run(randomUUID(),owner,CODEX_PROVIDER,action,id?'terminal':null,id??null,Date.now())}
/** JWT decoding only checks token/metadata consistency, NOT issuer authentication.
 * The provider must still validate access tokens. Never use these claims as Rue identity. */
export function validateCodexCredential(value:unknown):CodexCredential{
 const parsed=credentialSchema.safeParse(value)
 if(!parsed.success)throw new OAuthVaultError(409,'oauth_credential_invalid')
 try{
  const parts=parsed.data.access.split('.')
  if(parts.length!==3||parts.some(p=>!p||!/^[A-Za-z0-9_-]+$/.test(p)))throw Error()
  const claims=JSON.parse(Buffer.from(parts[1]!,'base64url').toString('utf8'))
  if(claims?.['https://api.openai.com/auth']?.chatgpt_account_id!==parsed.data.accountId||!Number.isSafeInteger(claims.exp)||claims.exp<=0||claims.exp>Number.MAX_SAFE_INTEGER/1000)throw Error()
  return {...parsed.data,expires:Math.min(parsed.data.expires,claims.exp*1000)}
 }catch{throw new OAuthVaultError(409,'oauth_credential_invalid')}
}
function decrypt(db:Database,owner:string,value:Row){
 if(!value.encrypted_credential)throw new OAuthVaultError(404,'oauth_credential_missing')
 try{return validateCodexCredential(JSON.parse(decryptCredential(db,scope(owner),value.encrypted_credential)))}catch{throw new OAuthVaultError(503,'oauth_storage_unavailable')}
}
export function providerOAuthMetadata(db:Database,owner:string,now=Date.now()){
 const value=row(db,owner)
 const state=value?.state==='refreshing'&&now-(value.refresh_started_at??0)>=REFRESH_DEADLINE?'reauthorize':value?.state??'removed'
 return {provider:CODEX_PROVIDER,credentialType:'oauth' as const,configured:Boolean(value?.encrypted_credential),revision:value?.revision??0,grants:db.prepare("SELECT target_type AS type,target_id AS id FROM provider_key_grants WHERE owner_subject=? AND provider=? AND target_type='terminal'").all(owner,CODEX_PROVIDER) as Array<{type:'terminal';id:string}>,expiresAt:value?.expires_at??null,state,keyStorageAvailable:Boolean(encryptionKey(db))}
}
/** Only a completed, independently authorized login/handoff may call this.
 * Reconnecting always clears grants. Never clone an actively rotating Pi auth store. */
export function saveProviderOAuth(db:Database,owner:string,expectedRevision:number,value:unknown){
 const credential=validateCodexCredential(value)
 return db.transaction(()=>{
  if((row(db,owner)?.revision??0)!==expectedRevision)throw new OAuthVaultError(409,'oauth_credential_changed')
  const encrypted=encryptCredential(db,scope(owner),JSON.stringify(credential))
  db.prepare(`INSERT INTO provider_oauth_credentials VALUES(?,?,?,?,?,'ready',NULL,NULL)
   ON CONFLICT(owner_subject,provider) DO UPDATE SET encrypted_credential=excluded.encrypted_credential,revision=excluded.revision,expires_at=excluded.expires_at,state='ready',refresh_nonce=NULL,refresh_started_at=NULL`).run(owner,CODEX_PROVIDER,encrypted,expectedRevision+1,credential.expires)
  db.prepare('DELETE FROM provider_key_grants WHERE owner_subject=? AND provider=?').run(owner,CODEX_PROVIDER)
  audit(db,owner,'oauth_save');return providerOAuthMetadata(db,owner)
 }).immediate()
}
export function removeProviderOAuth(db:Database,owner:string,expectedRevision:number){
 return db.transaction(()=>{
  if((row(db,owner)?.revision??0)!==expectedRevision)throw new OAuthVaultError(409,'oauth_credential_changed')
  db.prepare(`INSERT INTO provider_oauth_credentials VALUES(?,?,NULL,?,NULL,'removed',NULL,NULL)
   ON CONFLICT(owner_subject,provider) DO UPDATE SET encrypted_credential=NULL,revision=excluded.revision,expires_at=NULL,state='removed',refresh_nonce=NULL,refresh_started_at=NULL`).run(owner,CODEX_PROVIDER,expectedRevision+1)
  db.prepare('DELETE FROM provider_key_grants WHERE owner_subject=? AND provider=?').run(owner,CODEX_PROVIDER)
  audit(db,owner,'oauth_remove');return providerOAuthMetadata(db,owner)
 }).immediate()
}
function targetAlive(db:Database,owner:string,id:string){return Boolean(db.prepare('SELECT 1 FROM terminal_connections WHERE id=? AND owner_subject=? AND activated_at IS NOT NULL AND revoked_at IS NULL AND expires_at>?').get(id,owner,Date.now()))}
export function grantProviderOAuth(db:Database,owner:string,expectedRevision:number,id:string,enabled:boolean){
 return db.transaction(()=>{
  const metadata=providerOAuthMetadata(db,owner)
  if(metadata.revision!==expectedRevision)throw new OAuthVaultError(409,'oauth_credential_changed')
  if(enabled&&!metadata.keyStorageAvailable)throw new OAuthVaultError(503,'oauth_storage_unavailable')
  if(enabled&&(!metadata.configured||metadata.state==='reauthorize'))throw new OAuthVaultError(409,'oauth_reauthorization_required')
  if(enabled&&!targetAlive(db,owner,id))throw new OAuthVaultError(404,'oauth_target_unavailable')
  if(enabled){const agent=db.prepare('SELECT w.health FROM managed_agents a JOIN workers w ON w.id=a.worker_id WHERE a.connection_id=? AND a.owner_subject=?').get(id,owner) as {health:string|null}|undefined;if(agent&&(!agent.health||!JSON.parse(agent.health).capabilities?.includes('managed-codex-v1')))throw new OAuthVaultError(409,'oauth_runtime_not_supported')}
  if(enabled)db.prepare("INSERT OR IGNORE INTO provider_key_grants VALUES(?,?,'terminal',?)").run(owner,CODEX_PROVIDER,id)
  else db.prepare("DELETE FROM provider_key_grants WHERE owner_subject=? AND provider=? AND target_type='terminal' AND target_id=?").run(owner,CODEX_PROVIDER,id)
  db.prepare('UPDATE provider_oauth_credentials SET revision=revision+1 WHERE owner_subject=? AND provider=?').run(owner,CODEX_PROVIDER)
  audit(db,owner,enabled?'oauth_grant':'oauth_revoke',id);return providerOAuthMetadata(db,owner)
 }).immediate()
}
function authorized(db:Database,owner:string,id:string,current:()=>boolean){
 if(!current()||!targetAlive(db,owner,id))throw new OAuthVaultError(403,'oauth_authority_expired')
 if(!db.prepare("SELECT 1 FROM provider_key_grants WHERE owner_subject=? AND provider=? AND target_type='terminal' AND target_id=?").get(owner,CODEX_PROVIDER,id))throw new OAuthVaultError(403,'oauth_not_granted')
}
// A durable claim prevents double refresh even across independent DB handles/processes.
// Only callers in this process/handle share a pending promise; other callers fail closed.
const refreshing=new WeakMap<Database,Map<string,Promise<void>>>()
async function refreshCredential(db:Database,owner:string,refresh:OAuthRefresh){
 let pending=refreshing.get(db);if(!pending){pending=new Map();refreshing.set(db,pending)}
 const existing=pending.get(owner);if(existing)return existing
 const claim=db.transaction(()=>{
  const value=row(db,owner)
  if(!value?.encrypted_credential)throw new OAuthVaultError(404,'oauth_credential_missing')
  if(value.state!=='ready')throw new OAuthVaultError(409,providerOAuthMetadata(db,owner).state==='reauthorize'?'oauth_reauthorization_required':'oauth_refresh_in_progress')
  if((value.expires_at??0)>Date.now()+REFRESH_MARGIN)return
  const credential=decrypt(db,owner,value),nonce=randomUUID()
  db.prepare("UPDATE provider_oauth_credentials SET state='refreshing',refresh_nonce=?,refresh_started_at=? WHERE owner_subject=? AND provider=?").run(nonce,Date.now(),owner,CODEX_PROVIDER)
  audit(db,owner,'oauth_refresh_started');return {credential,nonce}
 }).immediate()
 if(!claim)return
 const work=Promise.resolve().then(async()=>{
  const signal=AbortSignal.timeout(REFRESH_DEADLINE)
  let abort:()=>void=()=>{}
  try{
   const deadline=new Promise<never>((_,reject)=>{abort=()=>reject(new OAuthVaultError(503,'oauth_refresh_uncertain'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()})
   const result=validateCodexCredential(await Promise.race([refresh(claim.credential,signal),deadline]))
   if(signal.aborted||result.accountId!==claim.credential.accountId||result.expires<=Date.now()+REFRESH_MARGIN)throw Error()
   db.transaction(()=>{
    const current=row(db,owner)
    if(current?.state!=='refreshing'||current.refresh_nonce!==claim.nonce)throw new OAuthVaultError(409,'oauth_credential_changed')
    const encrypted=encryptCredential(db,scope(owner),JSON.stringify(result))
    db.prepare("UPDATE provider_oauth_credentials SET encrypted_credential=?,expires_at=?,state='ready',refresh_nonce=NULL,refresh_started_at=NULL WHERE owner_subject=? AND provider=? AND refresh_nonce=?").run(encrypted,result.expires,owner,CODEX_PROVIDER,claim.nonce)
    audit(db,owner,'oauth_refresh_completed')
   }).immediate()
  }catch{
   db.transaction(()=>{
    const changed=db.prepare("UPDATE provider_oauth_credentials SET state='reauthorize',refresh_nonce=NULL,refresh_started_at=NULL WHERE owner_subject=? AND provider=? AND refresh_nonce=?").run(owner,CODEX_PROVIDER,claim.nonce)
    if(changed.changes)audit(db,owner,'oauth_refresh_uncertain')
   }).immediate()
   throw new OAuthVaultError(503,'oauth_reauthorization_required')
  }finally{signal.removeEventListener('abort',abort)}
 }).finally(()=>pending!.delete(owner))
 pending.set(owner,work);return work
}
export function delegatedOAuthAvailable(db:Database,owner:string,id:string,current:()=>boolean){
 authorized(db,owner,id,current)
 const metadata=providerOAuthMetadata(db,owner)
 return metadata.configured&&metadata.keyStorageAvailable&&metadata.state==='ready'
}
/** Machine-only primitive. `current` must validate the caller's token, instance and
 * live lease synchronously. Refresh tokens NEVER leave this vault. Recheck both
 * live machine authority and the explicit grant after every asynchronous refresh. */
export async function delegatedOAuthAccess(db:Database,owner:string,id:string,current:()=>boolean,refresh:OAuthRefresh){
 authorized(db,owner,id,current)
 await refreshCredential(db,owner,refresh)
 return db.transaction(()=>{
  authorized(db,owner,id,current)
  const value=row(db,owner)
  if(!value||value.state!=='ready'||(value.expires_at??0)<=Date.now())throw new OAuthVaultError(409,'oauth_reauthorization_required')
  const credential=decrypt(db,owner,value)
  audit(db,owner,'oauth_access',id)
  return {provider:CODEX_PROVIDER,credentialType:'oauth' as const,accessToken:credential.access,expiresAt:credential.expires}
 }).immediate()
}
