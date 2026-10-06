import type {Database} from 'better-sqlite3'
import {activeOAuthLoginStatuses as active,type OAuthLoginRepository,type OAuthLoginIntent} from '@multiterm/rue-db/postgres'
import {OAuthVaultError,providerOAuthMetadata,saveProviderOAuth} from '../storage/provider-oauth.js'
import {encryptCredential,decryptCredential} from '../storage/agent-settings.js'
export function createSqliteOAuthLoginRepository(db:Database):OAuthLoginRepository {
 const row=(owner:string,id:string)=>db.prepare('SELECT id,expected_revision AS expectedRevision,status,expires_at AS expiresAt FROM oauth_login_intents WHERE owner_subject=? AND id=?').get(owner,id) as OAuthLoginIntent|undefined
 const run=<T>(owner:string,fn:()=>T)=>db.transaction(()=>{
  db.prepare("UPDATE oauth_login_intents SET status='expired' WHERE owner_subject=? AND expires_at<=? AND status IN ('starting','pending','authorizing','review')").run(owner,Date.now())
  db.prepare('DELETE FROM oauth_login_intents WHERE owner_subject=? AND created_at<?').run(owner,Date.now()-86400000)
  return fn()
 }).immediate()
 const quota=(owner:string,starting:boolean)=>{
  const recent=db.prepare('SELECT count(*) AS n FROM oauth_login_intents WHERE owner_subject=? AND created_at>?').get(owner,Date.now()-3600000) as {n:number}
  const running=db.prepare("SELECT count(*) AS n FROM oauth_login_intents WHERE expires_at>? AND status IN ('starting','pending','authorizing','review')").get(Date.now()) as {n:number}
  if(recent.n>=5||(starting&&running.n>=128))throw new OAuthVaultError(409,'oauth_login_limit')
 }
 const set=(owner:string,id:string,status:string)=>db.prepare('UPDATE oauth_login_intents SET status=? WHERE owner_subject=? AND id=?').run(status,owner,id)
 return {
  async get(owner,id){return run(owner,()=>row(owner,id))},
  async reserve(owner,id,expected){return run(owner,()=>{
   const prior=row(owner,id);if(prior){if(prior.status!=='cancelled'&&prior.expectedRevision!==expected)throw new OAuthVaultError(409,'oauth_login_changed');return {created:false,intent:prior}}
   const metadata=providerOAuthMetadata(db,owner)
   if(!metadata.keyStorageAvailable)throw new OAuthVaultError(503,'oauth_storage_unavailable')
   if(metadata.revision!==expected)throw new OAuthVaultError(409,'oauth_credential_changed')
   quota(owner,true);db.prepare("INSERT INTO oauth_login_intents VALUES(?,?,?,'starting',?,?)").run(owner,id,expected,Date.now(),Date.now()+15*60000)
   return {created:true,intent:row(owner,id)!}
  })},
  async transition(owner,id,from,to){return run(owner,()=>{const intent=row(owner,id);if(!intent||!from.includes(intent.status)||intent.expiresAt<=Date.now())return false;set(owner,id,to);return true})},
  async cancel(owner,id){run(owner,()=>{const prior=row(owner,id);if(!prior){quota(owner,false);db.prepare("INSERT INTO oauth_login_intents VALUES(?,?,-1,'cancelled',?,?)").run(owner,id,Date.now(),Date.now()+15*60000)}else if(active.includes(prior.status))set(owner,id,'cancelled')})},
  async confirm(owner,id,encrypted){run(owner,()=>{
   const intent=row(owner,id);if(intent?.status==='complete')return
   if(!intent||intent.status!=='review'||intent.expiresAt<=Date.now())throw new OAuthVaultError(409,'oauth_login_expired')
   const credential=JSON.parse(decryptCredential(db,[owner,'oauth-login',id],encrypted))
   if(!Number.isSafeInteger(credential.expires)||credential.expires<=Date.now()+60000)throw new OAuthVaultError(409,'oauth_login_expired')
   saveProviderOAuth(db,owner,intent.expectedRevision,credential);set(owner,id,'complete')
  })},
  seal:(owner,id,credential)=>encryptCredential(db,[owner,'oauth-login',id],JSON.stringify(credential)),
 }
}
