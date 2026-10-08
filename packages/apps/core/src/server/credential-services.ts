import type {Database} from 'better-sqlite3'
import {createPostgresProviderKeyRepository,createPostgresOAuthRepository,createPostgresWorkerRepository,createPostgresTerminalRelayRepository,createPostgresUsageRepository,validatePostgresRelay,PostgresProviderKeyError as ProviderKeyError,RelayError,TerminalPairingError,type RuePostgresDatabase,type OAuthRefresh} from '@multiterm/rue-db/postgres'
import {createPostgresOAuthLoginRepository,type OAuthLoginRepository} from '@multiterm/rue-db/postgres'
import {createSqliteOAuthLoginRepository} from './sqlite-oauth-login.js'
import * as keys from '../storage/provider-keys.js'
import * as oauth from '../storage/provider-oauth.js'
import {AgentSettingsSchema,defaultAgentSettings} from '../storage/agent-settings.js'
import {createCredentialCodec} from '../storage/credential-codec.js'
import {reportedProviders,reportedProvidersFromHealth} from '../storage/reported-providers.js'
import {workerHealthSchema,validateWorker} from '../storage/workers.js'
import {validateRelaySocket} from '../storage/terminal-relay.js'
import {postgresRelayOptions} from '../storage/relay-health.js'
import {usageCredential,usageEventSchema} from '../storage/agent-usage.js'
export interface CredentialTransport {id:string;token:string;instance:string;generation?:number}
type KeyResult={provider:string;granted:boolean}|{provider:string;apiKey:string;credentialId:string}
export interface CredentialServices {
 login:OAuthLoginRepository
 keys:Pick<ReturnType<typeof createPostgresProviderKeyRepository>,'list'|'save'|'grant'>
 oauth:Pick<ReturnType<typeof createPostgresOAuthRepository>,'metadata'|'save'|'grant'|'remove'>
 reported(owner:string):Promise<ReturnType<typeof reportedProviders>>
 transportOwner(kind:'terminal'|'worker',auth:CredentialTransport):Promise<string>
 deliver(kind:'terminal'|'worker',auth:CredentialTransport,owner:string,provider:string,availability:boolean):Promise<KeyResult>
 oauthAvailable(auth:CredentialTransport,owner:string):Promise<boolean>
 oauthAccess(auth:CredentialTransport,owner:string,refresh:OAuthRefresh):Promise<{provider:'openai-codex';credentialType:'oauth';accessToken:string;expiresAt:number}>
}
export function createPostgresCredentialServices(db:RuePostgresDatabase,encryptionKey:()=>Buffer|undefined):CredentialServices {
 const codec=createCredentialCodec(encryptionKey)
 const vault=createPostgresProviderKeyRepository(db,{codec,keyStorageAvailable:()=>Boolean(encryptionKey()),defaultAgentSettings,parseAgentSettings:value=>AgentSettingsSchema.parse(value),reportedProviders:health=>reportedProvidersFromHealth(health).filter(p=>p.auth==='api_key').map(p=>p.id)})
 const oauthVault=createPostgresOAuthRepository(db,{codec,keyStorageAvailable:()=>Boolean(encryptionKey()),parseCredential:oauth.validateCodexCredential})
 const worker=createPostgresWorkerRepository(db,value=>workerHealthSchema.parse(value)),relay=createPostgresTerminalRelayRepository(db,postgresRelayOptions)
 const usage=createPostgresUsageRepository(db,{parseEvent:value=>usageEventSchema.parse(value),encryptionKey})
 const authorize=(auth:CredentialTransport,owner:string)=>async(tx:Parameters<Parameters<typeof relay.withSocketAuthority>[3]>[0])=>{
  try{return (await validatePostgresRelay(tx,auth.token,auth.id,auth.instance)).row.ownerSubject===owner}
  catch(error){if(error instanceof RelayError||error instanceof TerminalPairingError)return false;throw error}
 }
 return {
  keys:vault,oauth:oauthVault,
  login:createPostgresOAuthLoginRepository(db,{codec,keyStorageAvailable:()=>Boolean(encryptionKey()),vault:oauthVault}),
  async reported(owner){return reportedProvidersFromHealth(await vault.reportedHealth(owner))},
  async transportOwner(kind,auth){return kind==='terminal'?(await relay.validateSocket(auth.token,auth.id,auth.instance)).ownerSubject:worker.withAuthority(auth.id,auth.token,auth.instance,auth.generation??NaN,async(_tx,w)=>w.ownerSubject)},
  async deliver(kind,auth,owner,provider,availability){
   const run=async(tx:Parameters<Parameters<typeof relay.withSocketAuthority>[3]>[0],actualOwner:string):Promise<KeyResult>=>{
    if(actualOwner!==owner)throw new ProviderKeyError(403,'provider_key_not_granted')
    const target={type:kind,id:auth.id}
    if(availability)return {provider,granted:await vault.available(tx,owner,provider,target)}
    const result=await vault.delegated(tx,owner,provider,target)
    return {...result,credentialId:await usage.credentialInTransaction(tx,owner,provider,result.apiKey)}
   }
   return kind==='terminal'?relay.withSocketAuthority(auth.token,auth.id,auth.instance,(tx,host)=>run(tx,host.ownerSubject)):worker.withAuthority(auth.id,auth.token,auth.instance,auth.generation??NaN,(tx,w)=>run(tx,w.ownerSubject))
  },
  oauthAvailable(auth,owner){return oauthVault.available(owner,auth.id,authorize(auth,owner))},
  oauthAccess(auth,owner,refresh){return oauthVault.access(owner,auth.id,authorize(auth,owner),refresh)},
 }
}
export function createSqliteCredentialServices(db:Database):CredentialServices {
 const owner=(kind:'terminal'|'worker',auth:CredentialTransport)=>kind==='terminal'?validateRelaySocket(db,auth.token,auth.id,auth.instance).ownerSubject:validateWorker(db,auth.id,auth.token,auth.instance,auth.generation??NaN).owner_subject
 const current=(auth:CredentialTransport,expected:string)=>()=>{try{return owner('terminal',auth)===expected}catch(error){if(error instanceof RelayError||error instanceof TerminalPairingError)return false;throw error}}
 return {
  login:createSqliteOAuthLoginRepository(db),
  keys:{async list(subject){return keys.providerKeys(db,subject)},async save(subject,...args){return keys.saveProviderKey(db,subject,...args)},async grant(subject,...args){return keys.grantProviderKey(db,subject,...args)}},
  oauth:{async metadata(subject){return oauth.providerOAuthMetadata(db,subject)},async save(subject,...args){return oauth.saveProviderOAuth(db,subject,...args)},async grant(subject,...args){return oauth.grantProviderOAuth(db,subject,...args)},async remove(subject,...args){return oauth.removeProviderOAuth(db,subject,...args)}},
  async reported(subject){return reportedProviders(db,subject)},
  async transportOwner(kind,auth){return owner(kind,auth)},
  async deliver(kind,auth,subject,provider,availability){return db.transaction(()=>{
   if(owner(kind,auth)!==subject)throw new ProviderKeyError(403,'provider_key_not_granted')
   const target={type:kind,id:auth.id}
   if(availability)return {provider,granted:keys.delegatedProviderKeyAvailable(db,subject,provider,target)}
   const result=keys.delegatedProviderKey(db,subject,provider,target)
   return {...result,credentialId:usageCredential(db,subject,provider,result.apiKey)}
  }).immediate()},
  async oauthAvailable(auth,subject){return oauth.delegatedOAuthAvailable(db,subject,auth.id,current(auth,subject))},
  oauthAccess(auth,subject,refresh){return oauth.delegatedOAuthAccess(db,subject,auth.id,current(auth,subject),refresh)},
 }
}
