import {randomUUID} from 'node:crypto'
import {and,desc,eq,isNull,sql} from 'drizzle-orm'
import type {RuePostgresDatabase} from './client.js'
import type {CredentialCodec} from './projects.js'
import {lockPostgresOwner} from './owner-lock.js'
import {agentSettings,providerKeys,providerKeyGrants,providerKeyAudit,providerModelPreferences,providerOauthCredentials,terminalConnections,workers} from './schema.js'
type Tx=Parameters<Parameters<RuePostgresDatabase['transaction']>[0]>[0]
export type CredentialTarget={type:'worker'|'terminal';id:string}
import {ProviderKeyError as PostgresProviderKeyError} from '../credential-errors.js'
export {PostgresProviderKeyError}
const fail=(status:403|404|409,code:string):never=>{throw new PostgresProviderKeyError(status,code)}
const validProvider=(value:string)=>typeof value==='string'&&value.length<=128&&/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)&&value!=='openai-codex'
function validateProvider(value:string){if(!validProvider(value))fail(403,'provider_key_invalid')}
function validateTarget(target:CredentialTarget){if(!['terminal','worker'].includes(target.type)||!target.id||target.id.length>128)fail(403,'credential_target_invalid')}
function nextRevision(revision:number){if(!Number.isSafeInteger(revision)||revision<0||revision>=Number.MAX_SAFE_INTEGER)return fail(409,'provider_key_changed');return revision+1}
async function audit(tx:Tx,owner:string,provider:string,action:string,target?:CredentialTarget,now=Date.now()){await tx.insert(providerKeyAudit).values({id:randomUUID(),ownerSubject:owner,provider,action,targetType:target?.type??null,targetId:target?.id??null,createdAt:now})}
async function stored(tx:Tx,owner:string,provider:string){
 if(provider==='openai'){const [row]=await tx.select().from(agentSettings).where(eq(agentSettings.ownerSubject,owner));return row}
 const [row]=await tx.select().from(providerKeys).where(and(eq(providerKeys.ownerSubject,owner),eq(providerKeys.provider,provider)));return row
}
/** Caller must hold the owner's advisory lock and the target's authority lock.
 * Accepts only a transaction so revocation and child mutations can be atomic. */
export async function clearPostgresProviderKeyGrants(tx:Tx,owner:string,target:CredentialTarget,now=Date.now()){
 validateTarget(target)
 const removed=await tx.delete(providerKeyGrants).where(and(eq(providerKeyGrants.ownerSubject,owner),eq(providerKeyGrants.targetType,target.type),eq(providerKeyGrants.targetId,target.id))).returning({provider:providerKeyGrants.provider})
 for(const {provider} of removed){
  if(provider==='openai-codex'){
   const [row]=await tx.select().from(providerOauthCredentials).where(and(eq(providerOauthCredentials.ownerSubject,owner),eq(providerOauthCredentials.provider,provider))).for('update')
   if(row)await tx.update(providerOauthCredentials).set({revision:nextRevision(row.revision)}).where(and(eq(providerOauthCredentials.ownerSubject,owner),eq(providerOauthCredentials.provider,provider)))
  }else{
   const row=await stored(tx,owner,provider)
   if(row){
    if(provider==='openai')await tx.update(agentSettings).set({revision:nextRevision(row.revision)}).where(eq(agentSettings.ownerSubject,owner))
    else await tx.update(providerKeys).set({revision:nextRevision(row.revision)}).where(and(eq(providerKeys.ownerSubject,owner),eq(providerKeys.provider,provider)))
   }
  }
  await audit(tx,owner,provider,'target_reset',target,now)
 }
}
export interface ProviderKeyOptions {
 codec:CredentialCodec;keyStorageAvailable():boolean
 defaultAgentSettings:unknown
 parseAgentSettings(value:unknown):unknown
 /** Apply the API's strict telemetry validator; rows are already owner filtered. */
 reportedProviders(health:string[]):string[]
}
export function createPostgresProviderKeyRepository(db:RuePostgresDatabase,options:ProviderKeyOptions){
 async function list(tx:Tx,owner:string){
  const saved=await tx.select().from(providerKeys).where(eq(providerKeys.ownerSubject,owner))
  const [legacy]=await tx.select().from(agentSettings).where(eq(agentSettings.ownerSubject,owner))
  const preferences=await tx.select().from(providerModelPreferences).where(eq(providerModelPreferences.ownerSubject,owner))
  const grants=await tx.select().from(providerKeyGrants).where(eq(providerKeyGrants.ownerSubject,owner))
  const reports=await tx.select({health:terminalConnections.relayHealth}).from(terminalConnections).where(and(eq(terminalConnections.ownerSubject,owner),isNull(terminalConnections.revokedAt),sql`${terminalConnections.relayHealth} IS NOT NULL`)).orderBy(desc(terminalConnections.lastSeenAt)).limit(64)
  const [oauth]=await tx.select().from(providerOauthCredentials).where(and(eq(providerOauthCredentials.ownerSubject,owner),eq(providerOauthCredentials.provider,'openai-codex')))
  const available=options.keyStorageAvailable(),state=oauth?.state==='refreshing'&&Date.now()-(oauth.refreshStartedAt??0)>=6000?'reauthorize':oauth?.state??'removed'
  const providers=[...new Set(['openai','anthropic','google','openrouter',...saved.map(row=>row.provider),...options.reportedProviders(reports.map(row=>row.health!))])].filter(validProvider)
  const targets=(provider:string)=>grants.filter(row=>row.provider===provider).map(row=>({type:row.targetType as CredentialTarget['type'],id:row.targetId}))
  return {ownerSubject:owner,keyStorageAvailable:available,oauth:{ownerSubject:owner,provider:'openai-codex' as const,credentialType:'oauth' as const,configured:Boolean(oauth?.encryptedCredential),revision:oauth?.revision??0,grants:targets('openai-codex').filter(row=>row.type==='terminal'),expiresAt:oauth?.expiresAt??null,state,keyStorageAvailable:available,runtimeSupported:true},keys:providers.map(provider=>{
   const row=provider==='openai'?legacy:saved.find(row=>row.provider===provider)
   return {provider,configured:Boolean(row?.encryptedKey),revision:row?.revision??0,model:preferences.find(row=>row.provider===provider)?.model??null,grants:targets(provider)}
  })}
 }
 async function revise(tx:Tx,owner:string,provider:string,expected:number,key?:string|null){
  const row=await stored(tx,owner,provider)
  if((row?.revision??0)!==expected)return fail(409,'provider_key_changed')
  const revision=nextRevision(expected),encryptedKey=key===undefined?row?.encryptedKey??null:key===null?null:options.codec.encrypt(provider==='openai'?[owner,'openai']:[owner,'provider-key',provider],key)
  if(provider==='openai'){
   const [old]=await tx.select().from(agentSettings).where(eq(agentSettings.ownerSubject,owner))
   const settings=JSON.stringify(options.parseAgentSettings(old?JSON.parse(old.settings):options.defaultAgentSettings))
   await tx.insert(agentSettings).values({ownerSubject:owner,settings,encryptedKey,revision}).onConflictDoUpdate({target:agentSettings.ownerSubject,set:{settings,encryptedKey,revision}})
  }else await tx.insert(providerKeys).values({ownerSubject:owner,provider,encryptedKey,revision}).onConflictDoUpdate({target:[providerKeys.ownerSubject,providerKeys.provider],set:{encryptedKey,revision}})
 }
 return {
  async reportedHealth(owner:string){
   const rows=await db.select({health:terminalConnections.relayHealth}).from(terminalConnections).where(and(eq(terminalConnections.ownerSubject,owner),isNull(terminalConnections.revokedAt),sql`${terminalConnections.relayHealth} IS NOT NULL`)).orderBy(desc(terminalConnections.lastSeenAt)).limit(64)
   return rows.map(row=>row.health!)
  },
  /** Caller holds the same live authority transaction as secret delivery. */
  async available(tx:Tx,owner:string,provider:string,target:CredentialTarget){
   validateProvider(provider);validateTarget(target)
   const [grant]=await tx.select().from(providerKeyGrants).where(and(eq(providerKeyGrants.ownerSubject,owner),eq(providerKeyGrants.provider,provider),eq(providerKeyGrants.targetType,target.type),eq(providerKeyGrants.targetId,target.id)))
   return Boolean(grant&&(await stored(tx,owner,provider))?.encryptedKey)
  },
  list(owner:string){return db.transaction(tx=>list(tx,owner),{isolationLevel:'repeatable read',accessMode:'read only'})},
  async save(owner:string,provider:string,expected:number,key:string|null,model?:string){
   validateProvider(provider)
   if(key!==null&&(typeof key!=='string'||!key.length))return fail(409,'provider_key_invalid')
   return db.transaction(async tx=>{
    await lockPostgresOwner(tx,owner);await revise(tx,owner,provider,expected,key)
    if(key===null){
     await tx.delete(providerKeyGrants).where(and(eq(providerKeyGrants.ownerSubject,owner),eq(providerKeyGrants.provider,provider)))
     await tx.delete(providerModelPreferences).where(and(eq(providerModelPreferences.ownerSubject,owner),eq(providerModelPreferences.provider,provider)))
    }else if(model)await tx.insert(providerModelPreferences).values({ownerSubject:owner,provider,model}).onConflictDoUpdate({target:[providerModelPreferences.ownerSubject,providerModelPreferences.provider],set:{model}})
    await audit(tx,owner,provider,key===null?'remove':'save');return list(tx,owner)
   })
  },
  async grant(owner:string,provider:string,expected:number,target:CredentialTarget,enabled:boolean){
   validateProvider(provider);validateTarget(target)
   return db.transaction(async tx=>{
    await lockPostgresOwner(tx,owner)
    if(enabled){
     const rows=target.type==='worker'
      ?await tx.select({id:workers.id}).from(workers).where(and(eq(workers.id,target.id),eq(workers.ownerSubject,owner),isNull(workers.revokedAt))).for('update')
      :await tx.select({id:terminalConnections.id,expiresAt:terminalConnections.expiresAt}).from(terminalConnections).where(and(eq(terminalConnections.id,target.id),eq(terminalConnections.ownerSubject,owner),isNull(terminalConnections.revokedAt),sql`${terminalConnections.activatedAt} IS NOT NULL`)).for('update')
     if(!rows[0]||('expiresAt' in rows[0]&&Number(rows[0].expiresAt)<=Date.now()))return fail(404,'credential_target_unavailable')
     if(!(await stored(tx,owner,provider))?.encryptedKey)return fail(409,'provider_key_missing')
    }
    await revise(tx,owner,provider,expected)
    if(enabled)await tx.insert(providerKeyGrants).values({ownerSubject:owner,provider,targetType:target.type,targetId:target.id}).onConflictDoNothing()
    else await tx.delete(providerKeyGrants).where(and(eq(providerKeyGrants.ownerSubject,owner),eq(providerKeyGrants.provider,provider),eq(providerKeyGrants.targetType,target.type),eq(providerKeyGrants.targetId,target.id)))
    await audit(tx,owner,provider,enabled?'grant':'revoke',target);return list(tx,owner)
   })
  },
  /** Invoke inside the target repository's withAuthority transaction, never after a snapshot validation. */
  async delegated(tx:Tx,owner:string,provider:string,target:CredentialTarget){
   validateProvider(provider);validateTarget(target)
   const [grant]=await tx.select().from(providerKeyGrants).where(and(eq(providerKeyGrants.ownerSubject,owner),eq(providerKeyGrants.provider,provider),eq(providerKeyGrants.targetType,target.type),eq(providerKeyGrants.targetId,target.id)))
   if(!grant)return fail(403,'provider_key_not_granted')
   const row=await stored(tx,owner,provider);if(!row?.encryptedKey)return fail(404,'provider_key_missing')
   const apiKey=options.codec.decrypt(provider==='openai'?[owner,'openai']:[owner,'provider-key',provider],row.encryptedKey)
   if(!apiKey)return fail(404,'provider_key_missing')
   await audit(tx,owner,provider,'access',target);return {provider,apiKey}
  },
 }
}
