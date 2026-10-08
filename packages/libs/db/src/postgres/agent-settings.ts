import {and,eq} from 'drizzle-orm'
import type {RuePostgresDatabase} from './client.js'
import type {CredentialCodec} from './projects.js'
import {agentSettings,providerKeyGrants} from './schema.js'
import {lockPostgresOwner} from './owner-lock.js'
import {AgentSettingsError} from '../credential-errors.js'
export interface AgentConfiguration {harness:'pi';provider:'openai';model:string;systemPrompt:string}
export interface AgentConfigurationUpdate extends AgentConfiguration {expectedOwnerSubject:string;expectedRevision:number;apiKey?:string|null}
export function createPostgresAgentSettingsRepository(db:RuePostgresDatabase,options:{codec:CredentialCodec;keyStorageAvailable():boolean;defaults:AgentConfiguration;parse(value:unknown):AgentConfiguration}){
 type Row=typeof agentSettings.$inferSelect
 function metadata(row:Row|undefined){
  const settings=options.parse(row?JSON.parse(row.settings):options.defaults)
  return {...settings,revision:row?.revision??0,apiKeyConfigured:Boolean(row?.encryptedKey),keyStorageAvailable:options.keyStorageAvailable()}
 }
 return {
  async get(owner:string){const [row]=await db.select().from(agentSettings).where(eq(agentSettings.ownerSubject,owner));return metadata(row)},
  async apiKey(owner:string){const [row]=await db.select({key:agentSettings.encryptedKey}).from(agentSettings).where(eq(agentSettings.ownerSubject,owner));return row?.key?options.codec.decrypt([owner,'openai'],row.key):undefined},
  save(owner:string,input:AgentConfigurationUpdate){return db.transaction(async tx=>{
   await lockPostgresOwner(tx,owner)
   if(input.expectedOwnerSubject!==owner||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||input.expectedRevision>=Number.MAX_SAFE_INTEGER)throw new AgentSettingsError('agent_settings_conflict')
   const [old]=await tx.select().from(agentSettings).where(eq(agentSettings.ownerSubject,owner)).for('update')
   if((old?.revision??0)!==input.expectedRevision)throw new AgentSettingsError('agent_settings_conflict')
   const settings=options.parse({harness:input.harness,provider:input.provider,model:input.model,systemPrompt:input.systemPrompt})
   const encryptedKey=input.apiKey===undefined?old?.encryptedKey??null:input.apiKey===null?null:options.codec.encrypt([owner,'openai'],input.apiKey)
   const revision=input.expectedRevision+1
   const [saved]=await tx.insert(agentSettings).values({ownerSubject:owner,settings:JSON.stringify(settings),encryptedKey,revision}).onConflictDoUpdate({target:agentSettings.ownerSubject,set:{settings:JSON.stringify(settings),encryptedKey,revision}}).returning()
   if(input.apiKey===null)await tx.delete(providerKeyGrants).where(and(eq(providerKeyGrants.ownerSubject,owner),eq(providerKeyGrants.provider,'openai')))
   return metadata(saved)
  })},
 }
}
