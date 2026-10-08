import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import type {Database} from 'better-sqlite3'
import {encryptCredential,decryptCredential} from './agent-settings.js'
import {WorkerError} from './workers.js'
import {changeManagedAgent} from './managed-agents.js'
const printable=z.string().refine(v=>!/[\x00-\x1f\x7f]/.test(v))
const environment=z.record(z.string().regex(/^[A-Z_][A-Z0-9_]*$/).max(80),z.string().max(2048).refine(v=>!v.includes('\0'))).refine(v=>Object.keys(v).length<=16&&Buffer.byteLength(JSON.stringify(v))<=4096)
export const mcpProfileSchema=z.object({name:printable.pipe(z.string().trim().min(1).max(60)),command:z.string().min(1).max(256).regex(/^[a-zA-Z0-9_./-]+$/).refine(v=>!v.startsWith('-')&&!v.includes('\n')),args:z.array(printable.pipe(z.string().max(256))).max(16),environment,acknowledgeTools:z.literal(true)}).strict()
interface Row {id:string;owner_subject:string;name:string;command:string;args:string;encrypted_env:string|null;environment_names:string;revision:number;created_at:number;revoked_at:number|null}
const get=(db:Database,owner:string,id:string)=>db.prepare('SELECT * FROM mcp_profiles WHERE id=? AND owner_subject=?').get(id,owner) as Row|undefined
function env(db:Database,row:Row):Record<string,string>{return row.encrypted_env?JSON.parse(decryptCredential(db,[row.owner_subject,'mcp-profile',row.id],row.encrypted_env)):{}}
const metadata=(row:Row)=>({id:row.id,name:row.name,transport:'stdio' as const,command:row.command,args:JSON.parse(row.args) as string[],environmentNames:JSON.parse(row.environment_names) as string[],revision:row.revision,createdAt:row.created_at,revokedAt:row.revoked_at})
const canonical=(value:Record<string,string>)=>JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))))
export function listMcpProfiles(db:Database,owner:string){
 return (db.prepare('SELECT id,owner_subject,name,command,args,environment_names,revision,created_at,revoked_at FROM mcp_profiles WHERE owner_subject=? AND revoked_at IS NULL ORDER BY created_at,id').all(owner) as Row[]).map(metadata)
}
export function createMcpProfile(db:Database,owner:string,id:string,raw:unknown,now=Date.now()){
 z.string().uuid().parse(id);const input=mcpProfileSchema.parse(raw)
 return db.transaction(()=>{
  const previous=get(db,owner,id)
  if(previous){
   if(previous.revoked_at!==null||previous.name!==input.name||previous.command!==input.command||previous.args!==JSON.stringify(input.args)||canonical(env(db,previous))!==canonical(input.environment))throw new WorkerError(409,'mcp_request_conflict')
   return metadata(previous)
  }
  if(db.prepare('SELECT 1 FROM mcp_profiles WHERE id=?').get(id))throw new WorkerError(409,'mcp_request_conflict')
  if((db.prepare('SELECT count(*) AS n FROM mcp_profiles WHERE owner_subject=? AND revoked_at IS NULL').get(owner) as {n:number}).n>=32||(db.prepare('SELECT count(*) AS n FROM mcp_profiles WHERE owner_subject=?').get(owner) as {n:number}).n>=1024)throw new WorkerError(429,'mcp_profile_limit')
  const encrypted=encryptCredential(db,[owner,'mcp-profile',id],canonical(input.environment))
  db.prepare('INSERT INTO mcp_profiles(id,owner_subject,name,command,args,encrypted_env,environment_names,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,owner,input.name,input.command,JSON.stringify(input.args),encrypted,JSON.stringify(Object.keys(input.environment)),now)
  return metadata(get(db,owner,id)!)
 }).immediate()
}
/** Only owner mutation can stop/reconfigure affected agents. No secret-bearing audit payload. */
export function removeMcpProfile(db:Database,owner:string,id:string,revision:number,now=Date.now()){
 return db.transaction(()=>{
  const row=get(db,owner,id);if(!row)throw new WorkerError(404,'mcp_profile_not_found')
  if(row.revoked_at!==null)return {profile:metadata(row),agents:[]}
  if(row.revision!==revision)throw new WorkerError(409,'mcp_revision_conflict')
  const affected=db.prepare("SELECT id,revision,config FROM managed_agents WHERE owner_subject=? AND desired!='destroyed' AND EXISTS (SELECT 1 FROM json_each(managed_agents.config,'$.mcp') WHERE value=?)").all(owner,id) as Array<{id:string;revision:number;config:string}>
  const agents=affected.map(a=>{
   const stopped=changeManagedAgent(db,owner,a.id,{requestId:randomUUID(),expectedRevision:a.revision,action:'stop'},now)
   const config=JSON.parse(a.config);config.mcp=config.mcp.filter((value:string)=>value!==id);if(!config.mcp.length)delete config.mcp
   db.prepare('UPDATE managed_agents SET config=? WHERE id=?').run(JSON.stringify(config),a.id)
   return stopped.agent
  })
  db.prepare("UPDATE mcp_profiles SET encrypted_env=NULL,environment_names='[]',revoked_at=?,revision=revision+1 WHERE id=?").run(now,id)
  return {profile:metadata(get(db,owner,id)!),agents}
 }).immediate()
}
export function resolveMcpProfiles(db:Database,owner:string,ids:string[]=[]){
 const profiles=ids.map(id=>{
  const row=get(db,owner,id);if(!row||row.revoked_at!==null)throw new WorkerError(409,'mcp_profile_unavailable')
  return {id:row.id,name:row.name,command:row.command,args:JSON.parse(row.args) as string[],environment:env(db,row)}
 })
 if(Buffer.byteLength(JSON.stringify(profiles))>16384)throw new WorkerError(409,'mcp_configuration_too_large')
 return profiles
}
