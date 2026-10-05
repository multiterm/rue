import {randomUUID} from 'node:crypto'
import {and,eq,isNull,sql} from 'drizzle-orm'
import type {RuePostgresDatabase} from './client.js'
import type {CredentialCodec} from './projects.js'
import {lockPostgresOwner} from './owner-lock.js'
import {providerOauthCredentials as credentials,providerKeyGrants as grants,providerKeyAudit as audits,terminalConnections as terminals,managedAgents,workers} from './schema.js'
type Tx=Parameters<Parameters<RuePostgresDatabase['transaction']>[0]>[0]
export interface OAuthCredential {type:'oauth';access:string;refresh:string;expires:number;accountId:string}
export type OAuthRefresh=(credential:OAuthCredential,signal:AbortSignal)=>Promise<unknown>
import {OAuthVaultError as PostgresOAuthError} from '../credential-errors.js'
export {PostgresOAuthError}
const provider='openai-codex' as const,deadline=6000,margin=60000
const fail=(status:403|404|409|503,code:string):never=>{throw new PostgresOAuthError(status,code)}
const scope=(owner:string)=>[owner,'provider-oauth',provider]
const ownerWhere=(owner:string)=>and(eq(credentials.ownerSubject,owner),eq(credentials.provider,provider))
const grantWhere=(owner:string,id?:string)=>and(eq(grants.ownerSubject,owner),eq(grants.provider,provider),...(id===undefined?[]:[eq(grants.targetType,'terminal'),eq(grants.targetId,id)]))
const revision=(value:number)=>{if(!Number.isSafeInteger(value)||value<0||value>=Number.MAX_SAFE_INTEGER)return fail(409,'oauth_credential_changed');return value+1}
async function row(tx:Tx,owner:string){const [value]=await tx.select().from(credentials).where(ownerWhere(owner));return value}
async function audit(tx:Tx,owner:string,action:string,id?:string){await tx.insert(audits).values({id:randomUUID(),ownerSubject:owner,provider,action,targetType:id?'terminal':null,targetId:id??null,createdAt:Date.now()})}
export function createPostgresOAuthRepository(db:RuePostgresDatabase,options:{codec:CredentialCodec;keyStorageAvailable():boolean;parseCredential(value:unknown):OAuthCredential}){
 const pending=new Map<string,Promise<void>>()
 const metadata=async(tx:Tx,owner:string)=>{
  const value=await row(tx,owner),targets=await tx.select({type:grants.targetType,id:grants.targetId}).from(grants).where(and(grantWhere(owner),eq(grants.targetType,'terminal')))
  const state=value?.state==='refreshing'&&Date.now()-(value.refreshStartedAt??0)>=deadline?'reauthorize':value?.state??'removed'
  return {provider,credentialType:'oauth' as const,configured:Boolean(value?.encryptedCredential),revision:value?.revision??0,grants:targets.map(target=>({type:'terminal' as const,id:target.id})),expiresAt:value?.expiresAt??null,state,keyStorageAvailable:options.keyStorageAvailable()}
 }
 function decrypt(owner:string,value:typeof credentials.$inferSelect){
  if(!value.encryptedCredential)return fail(404,'oauth_credential_missing')
  try{return options.parseCredential(JSON.parse(options.codec.decrypt(scope(owner),value.encryptedCredential)))}catch{return fail(503,'oauth_storage_unavailable')}
 }
 async function targetAlive(tx:Tx,owner:string,id:string){
  const [target]=await tx.select().from(terminals).where(and(eq(terminals.id,id),eq(terminals.ownerSubject,owner),isNull(terminals.revokedAt),sql`${terminals.activatedAt} IS NOT NULL`)).for('update')
  return Boolean(target&&target.expiresAt>Date.now())
 }
 /** authorize must validate the transport credential, instance and current lease
  * using this transaction; never perform network I/O or open a nested transaction. */
 async function authorized(tx:Tx,owner:string,id:string,authorize:(tx:Tx)=>Promise<boolean>){
  if(!await targetAlive(tx,owner,id)||!await authorize(tx))return fail(403,'oauth_authority_expired')
  const [grant]=await tx.select().from(grants).where(grantWhere(owner,id));if(!grant)return fail(403,'oauth_not_granted')
 }
 async function accessTransaction<T>(owner:string,id:string,authorize:(tx:Tx)=>Promise<boolean>,run:(tx:Tx)=>Promise<T>){return db.transaction(async tx=>{await lockPostgresOwner(tx,owner);await authorized(tx,owner,id,authorize);return run(tx)})}
 async function refresh(owner:string,id:string,authorize:(tx:Tx)=>Promise<boolean>,fetchCredential:OAuthRefresh){
  const previous=pending.get(owner);if(previous)return previous
  // Install local singleflight before the first SQL await. Other repository
  // instances/processes still arbitrate using the durable state+nonce claim.
  const work=(async()=>{
   const claim=await accessTransaction(owner,id,authorize,async tx=>{
    const value=await row(tx,owner)
    if(!value?.encryptedCredential)return fail(404,'oauth_credential_missing')
    if(value.state!=='ready')return fail(409,(await metadata(tx,owner)).state==='reauthorize'?'oauth_reauthorization_required':'oauth_refresh_in_progress')
    if((value.expiresAt??0)>Date.now()+margin)return
    const credential=decrypt(owner,value),nonce=randomUUID()
    await tx.update(credentials).set({state:'refreshing',refreshNonce:nonce,refreshStartedAt:Date.now()}).where(ownerWhere(owner));await audit(tx,owner,'oauth_refresh_started')
    return {credential,nonce}
   })
   if(!claim)return
   const signal=AbortSignal.timeout(deadline);let abort=()=>{}
   try{
    const timeout=new Promise<never>((_,reject)=>{abort=()=>reject(Error('refresh_timeout'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()})
    const result=options.parseCredential(await Promise.race([fetchCredential(claim.credential,signal),timeout]))
    if(signal.aborted||result.accountId!==claim.credential.accountId||result.expires<=Date.now()+margin)throw Error('refresh_invalid')
    await db.transaction(async tx=>{
     await lockPostgresOwner(tx,owner);const current=await row(tx,owner)
     if(signal.aborted||current?.state!=='refreshing'||current.refreshNonce!==claim.nonce)throw Error('refresh_fenced')
     await tx.update(credentials).set({encryptedCredential:options.codec.encrypt(scope(owner),JSON.stringify(result)),expiresAt:result.expires,state:'ready',refreshNonce:null,refreshStartedAt:null}).where(and(ownerWhere(owner),eq(credentials.refreshNonce,claim.nonce)))
     if(signal.aborted)throw Error('refresh_expired')
     await audit(tx,owner,'oauth_refresh_completed')
    })
   }catch{
    await db.transaction(async tx=>{
     await lockPostgresOwner(tx,owner)
     const changed=await tx.update(credentials).set({state:'reauthorize',refreshNonce:null,refreshStartedAt:null}).where(and(ownerWhere(owner),eq(credentials.refreshNonce,claim.nonce))).returning({owner:credentials.ownerSubject})
     if(changed.length)await audit(tx,owner,'oauth_refresh_uncertain')
    })
    return fail(503,'oauth_reauthorization_required')
   }finally{signal.removeEventListener('abort',abort)}
  })()
  pending.set(owner,work)
  try{await work}finally{if(pending.get(owner)===work)pending.delete(owner)}
 }
 return {
  metadata(owner:string){return db.transaction(tx=>metadata(tx,owner),{isolationLevel:'repeatable read',accessMode:'read only'})},
  async save(owner:string,expected:number,input:unknown){
   const value=options.parseCredential(input)
   return db.transaction(async tx=>{
    await lockPostgresOwner(tx,owner);if(((await row(tx,owner))?.revision??0)!==expected)return fail(409,'oauth_credential_changed')
    const values={ownerSubject:owner,provider,encryptedCredential:options.codec.encrypt(scope(owner),JSON.stringify(value)),revision:revision(expected),expiresAt:value.expires,state:'ready',refreshNonce:null,refreshStartedAt:null}
    await tx.insert(credentials).values(values).onConflictDoUpdate({target:[credentials.ownerSubject,credentials.provider],set:values})
    await tx.delete(grants).where(grantWhere(owner));await audit(tx,owner,'oauth_save');return metadata(tx,owner)
   })
  },
  async remove(owner:string,expected:number){return db.transaction(async tx=>{
   await lockPostgresOwner(tx,owner);if(((await row(tx,owner))?.revision??0)!==expected)return fail(409,'oauth_credential_changed')
   const values={ownerSubject:owner,provider,encryptedCredential:null,revision:revision(expected),expiresAt:null,state:'removed',refreshNonce:null,refreshStartedAt:null}
   await tx.insert(credentials).values(values).onConflictDoUpdate({target:[credentials.ownerSubject,credentials.provider],set:values})
   await tx.delete(grants).where(grantWhere(owner));await audit(tx,owner,'oauth_remove');return metadata(tx,owner)
  })},
  async grant(owner:string,expected:number,id:string,enabled:boolean){return db.transaction(async tx=>{
   await lockPostgresOwner(tx,owner);const current=await metadata(tx,owner)
   if(current.revision!==expected)return fail(409,'oauth_credential_changed')
   if(enabled){
    if(!current.keyStorageAvailable)return fail(503,'oauth_storage_unavailable')
    if(!current.configured||current.state==='reauthorize')return fail(409,'oauth_reauthorization_required')
    if(!await targetAlive(tx,owner,id))return fail(404,'oauth_target_unavailable')
    const [agent]=await tx.select({health:workers.health}).from(managedAgents).innerJoin(workers,and(eq(workers.id,managedAgents.workerId),eq(workers.ownerSubject,owner))).where(and(eq(managedAgents.connectionId,id),eq(managedAgents.ownerSubject,owner)))
    if(agent){let supported=false;try{supported=JSON.parse(agent.health??'null')?.capabilities?.includes('managed-codex-v1')===true}catch{}if(!supported)return fail(409,'oauth_runtime_not_supported')}
    await tx.insert(grants).values({ownerSubject:owner,provider,targetType:'terminal',targetId:id}).onConflictDoNothing()
   }else await tx.delete(grants).where(grantWhere(owner,id))
   await tx.update(credentials).set({revision:revision(expected)}).where(ownerWhere(owner));await audit(tx,owner,enabled?'oauth_grant':'oauth_revoke',id);return metadata(tx,owner)
  })},
  available(owner:string,id:string,authorize:(tx:Tx)=>Promise<boolean>){return accessTransaction(owner,id,authorize,async tx=>{const value=await metadata(tx,owner);return value.configured&&value.keyStorageAvailable&&value.state==='ready'})},
  async access(owner:string,id:string,authorize:(tx:Tx)=>Promise<boolean>,fetchCredential:OAuthRefresh){
   await accessTransaction(owner,id,authorize,async()=>{})
   await refresh(owner,id,authorize,fetchCredential)
   return accessTransaction(owner,id,authorize,async tx=>{
    const value=await row(tx,owner);if(!value||value.state!=='ready'||(value.expiresAt??0)<=Date.now())return fail(409,'oauth_reauthorization_required')
    const credential=decrypt(owner,value);await audit(tx,owner,'oauth_access',id)
    return {provider,credentialType:'oauth' as const,accessToken:credential.access,expiresAt:credential.expires}
   })
  },
 }
}
