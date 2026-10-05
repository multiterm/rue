import {and,count,eq,isNull,sql} from 'drizzle-orm'
import type {RuePostgresDatabase} from './client.js'
import type {CredentialCodec} from './projects.js'
import {WorkerError} from '../worker-types.js'
import {lockPostgresOwner} from './owner-lock.js'
import {mcpProfiles as profiles,managedAgents as agents} from './schema.js'
type Tx=Parameters<Parameters<RuePostgresDatabase['transaction']>[0]>[0]
type Row=typeof profiles.$inferSelect
export interface McpProfileInput {name:string;command:string;args:string[];environment:Record<string,string>;acknowledgeTools:true}
const fail=(status:400|401|404|409|429,code:string):never=>{throw new WorkerError(status,code)}
const canonical=(value:Record<string,string>)=>JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))))
const metadata=(row:Omit<Row,'encryptedEnv'>)=>({id:row.id,name:row.name,transport:'stdio' as const,command:row.command,args:JSON.parse(row.args) as string[],environmentNames:JSON.parse(row.environmentNames) as string[],revision:row.revision,createdAt:row.createdAt,revokedAt:row.revokedAt})
/** stopAgent must use the supplied transaction, not open a nested pool transaction.
 * It must perform the normal managed stop (revision/operation/grant/lease fencing).
 * Secret resolution is server-internal; a runtime delivery caller must hold live
 * worker authority for the entire transaction. */
export function createPostgresMcpRepository<T>(db:RuePostgresDatabase,options:{
 codec:CredentialCodec
 parseProfile:(raw:unknown)=>McpProfileInput
 stopAgent:(tx:Tx,owner:string,id:string,revision:number,now:number)=>Promise<T>
}){
 async function get(tx:Pick<RuePostgresDatabase,'select'>,owner:string,id:string){const [row]=await tx.select().from(profiles).where(and(eq(profiles.id,id),eq(profiles.ownerSubject,owner)));return row}
 const env=(row:Row):Record<string,string>=>row.encryptedEnv?JSON.parse(options.codec.decrypt([row.ownerSubject,'mcp-profile',row.id],row.encryptedEnv)):{}
 async function resolveInTransaction(tx:Tx,owner:string,ids:string[]=[]){
  await lockPostgresOwner(tx,owner);const result=[]
  for(const id of ids){const row=await get(tx,owner,id);if(!row||row.revokedAt!==null)return fail(409,'mcp_profile_unavailable');result.push({id:row.id,name:row.name,command:row.command,args:JSON.parse(row.args) as string[],environment:env(row)})}
  if(Buffer.byteLength(JSON.stringify(result))>16384)return fail(409,'mcp_configuration_too_large')
  return result
 }
 return {
  resolveInTransaction,
  async list(owner:string){return (await db.select({id:profiles.id,ownerSubject:profiles.ownerSubject,name:profiles.name,command:profiles.command,args:profiles.args,environmentNames:profiles.environmentNames,revision:profiles.revision,createdAt:profiles.createdAt,revokedAt:profiles.revokedAt}).from(profiles).where(and(eq(profiles.ownerSubject,owner),isNull(profiles.revokedAt))).orderBy(profiles.createdAt,profiles.id)).map(metadata)},
  create(owner:string,id:string,raw:unknown,at?:number){
   if(typeof id!=='string'||!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))return Promise.reject(new WorkerError(400,'mcp_id_invalid'))
   const input=options.parseProfile(raw)
   return db.transaction(async tx=>{
    await lockPostgresOwner(tx,owner);const now=at??Date.now(),previous=await get(tx,owner,id)
    if(previous){
     if(previous.revokedAt!==null||previous.name!==input.name||previous.command!==input.command||previous.args!==JSON.stringify(input.args)||canonical(env(previous))!==canonical(input.environment))return fail(409,'mcp_request_conflict')
     return metadata(previous)
    }
    const [totals]=await tx.select({total:count(),active:sql<number>`COUNT(*) FILTER(WHERE ${profiles.revokedAt} IS NULL)`.mapWith(Number)}).from(profiles).where(eq(profiles.ownerSubject,owner))
    if(totals!.active>=32||totals!.total>=1024)return fail(429,'mcp_profile_limit')
    const encrypted=options.codec.encrypt([owner,'mcp-profile',id],canonical(input.environment))
    const [row]=await tx.insert(profiles).values({id,ownerSubject:owner,name:input.name,command:input.command,args:JSON.stringify(input.args),encryptedEnv:encrypted,environmentNames:JSON.stringify(Object.keys(input.environment)),createdAt:now}).onConflictDoNothing({target:profiles.id}).returning()
    if(!row)return fail(409,'mcp_request_conflict')
    return metadata(row)
   })
  },
  remove(owner:string,id:string,revision:number,at?:number){return db.transaction(async tx=>{
   await lockPostgresOwner(tx,owner);const now=at??Date.now(),row=await get(tx,owner,id)
   if(!row)return fail(404,'mcp_profile_not_found')
   if(row.revokedAt!==null)return {profile:metadata(row),agents:[] as T[]}
   if(row.revision!==revision||!Number.isSafeInteger(row.revision+1))return fail(409,'mcp_revision_conflict')
   // Parse in JavaScript rather than casting legacy JSON text to JSONB: other
   // config fields can contain Unicode that JSONB cannot represent losslessly.
   const candidates=await tx.select({id:agents.id,revision:agents.revision,config:agents.config}).from(agents).where(and(eq(agents.ownerSubject,owner),sql`${agents.desired}<>'destroyed'`)).orderBy(agents.id)
   const stopped:T[]=[]
   for(const a of candidates){
    const config=JSON.parse(a.config);if(!Array.isArray(config.mcp)||!config.mcp.includes(id))continue
    stopped.push(await options.stopAgent(tx,owner,a.id,a.revision,now))
    config.mcp=config.mcp.filter((value:string)=>value!==id);if(!config.mcp.length)delete config.mcp
    await tx.update(agents).set({config:JSON.stringify(config)}).where(and(eq(agents.id,a.id),eq(agents.ownerSubject,owner)))
   }
   const [removed]=await tx.update(profiles).set({encryptedEnv:null,environmentNames:'[]',revokedAt:now,revision:row.revision+1}).where(eq(profiles.id,id)).returning()
   return {profile:metadata(removed!),agents:stopped}
  })},
 }
}
