import {and,eq,inArray,lte,lt,gt,sql} from 'drizzle-orm'
import type {RuePostgresDatabase} from './client.js'
import {oauthLoginIntents as intents,providerOauthCredentials as credentials} from './schema.js'
import {lockPostgresOwner} from './owner-lock.js'
import {OAuthVaultError} from '../credential-errors.js'
import {activeOAuthLoginStatuses as active,type OAuthLoginRepository,type OAuthLoginIntent} from '../oauth-login.js'
import type {CredentialCodec} from './projects.js'
import type {createPostgresOAuthRepository} from './provider-oauth.js'
type Tx=Parameters<Parameters<RuePostgresDatabase['transaction']>[0]>[0]
const fail=(status:404|409|503,code:string):never=>{throw new OAuthVaultError(status,code)}
export function createPostgresOAuthLoginRepository(db:RuePostgresDatabase,options:{codec:CredentialCodec;keyStorageAvailable():boolean;vault:Pick<ReturnType<typeof createPostgresOAuthRepository>,'saveInTransaction'>}):OAuthLoginRepository {
 const where=(owner:string,id:string)=>and(eq(intents.ownerSubject,owner),eq(intents.id,id))
 const row=async(tx:Tx,owner:string,id:string)=>{const [value]=await tx.select().from(intents).where(where(owner,id));return value as OAuthLoginIntent|undefined}
 const run=<T>(owner:string,fn:(tx:Tx)=>Promise<T>)=>db.transaction(async tx=>{
  // Global admission lock bounds all active intents; take it before the owner lock.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('rue:oauth-login',0))`)
  await lockPostgresOwner(tx,owner)
  await tx.update(intents).set({status:'expired'}).where(and(eq(intents.ownerSubject,owner),inArray(intents.status,active),lte(intents.expiresAt,Date.now())))
  await tx.delete(intents).where(and(eq(intents.ownerSubject,owner),lt(intents.createdAt,Date.now()-86400000)))
  return fn(tx)
 })
 const quota=async(tx:Tx,owner:string,starting:boolean)=>{
  const [recent]=await tx.select({n:sql<number>`count(*)::integer`}).from(intents).where(and(eq(intents.ownerSubject,owner),gt(intents.createdAt,Date.now()-3600000)))
  if(recent!.n>=5)fail(409,'oauth_login_limit')
  if(starting){const [running]=await tx.select({n:sql<number>`count(*)::integer`}).from(intents).where(and(inArray(intents.status,active),gt(intents.expiresAt,Date.now())));if(running!.n>=128)fail(409,'oauth_login_limit')}
 }
 return {
  get:(owner,id)=>run(owner,tx=>row(tx,owner,id)),
  reserve:(owner,id,expected)=>run(owner,async tx=>{
   const prior=await row(tx,owner,id)
   if(prior){if(prior.status!=='cancelled'&&prior.expectedRevision!==expected)fail(409,'oauth_login_changed');return {created:false,intent:prior}}
   if(!options.keyStorageAvailable())fail(503,'oauth_storage_unavailable')
   const [credential]=await tx.select({revision:credentials.revision}).from(credentials).where(and(eq(credentials.ownerSubject,owner),eq(credentials.provider,'openai-codex')))
   if((credential?.revision??0)!==expected)fail(409,'oauth_credential_changed')
   await quota(tx,owner,true)
   const intent:OAuthLoginIntent={id,expectedRevision:expected,status:'starting',expiresAt:Date.now()+15*60000}
   await tx.insert(intents).values({...intent,ownerSubject:owner,createdAt:Date.now()});return {created:true,intent}
  }),
  transition:(owner,id,from,to)=>run(owner,async tx=>(await tx.update(intents).set({status:to}).where(and(where(owner,id),inArray(intents.status,from),gt(intents.expiresAt,Date.now()))).returning({id:intents.id})).length===1),
  cancel:(owner,id)=>run(owner,async tx=>{
   const prior=await row(tx,owner,id)
   if(!prior){await quota(tx,owner,false);await tx.insert(intents).values({ownerSubject:owner,id,expectedRevision:-1,status:'cancelled',createdAt:Date.now(),expiresAt:Date.now()+15*60000})}
   else if(active.includes(prior.status))await tx.update(intents).set({status:'cancelled'}).where(where(owner,id))
  }),
  confirm:(owner,id,encrypted)=>run(owner,async tx=>{
   const intent=await row(tx,owner,id)
   if(intent?.status==='complete')return
   if(!intent||intent.status!=='review'||intent.expiresAt<=Date.now())fail(409,'oauth_login_expired')
   const credential=JSON.parse(options.codec.decrypt([owner,'oauth-login',id],encrypted))
   if(!Number.isSafeInteger(credential.expires)||credential.expires<=Date.now()+60000)fail(409,'oauth_login_expired')
   await options.vault.saveInTransaction(tx,owner,intent!.expectedRevision,credential)
   await tx.update(intents).set({status:'complete'}).where(where(owner,id))
  }),
  seal:(owner,id,credential)=>options.codec.encrypt([owner,'oauth-login',id],JSON.stringify(credential)),
 }
}
